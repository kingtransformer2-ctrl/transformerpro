-- Re-apply the table-session recursion guard for environments that missed
-- the original fix migration. Safe to run repeatedly because it only replaces
-- the affected functions.

CREATE OR REPLACE FUNCTION public.refresh_hotel_table_session_state(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_seat RECORD;
  v_due NUMERIC;
  v_direct_paid NUMERIC;
  v_has_paid_group BOOLEAN;
  v_has_partial_group BOOLEAN;
  v_status TEXT;
  v_all_paid BOOLEAN;
  v_any_paid BOOLEAN;
  v_table_id UUID;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.hotel_table_payment_groups AS g
  SET
    total_amount = totals.total_amount,
    paid_amount = totals.paid_amount,
    payment_status = totals.payment_status,
    updated_at = now()
  FROM (
    SELECT
      g_inner.id,
      COALESCE((
        SELECT SUM(oi.total_price)
        FROM public.hotel_table_payment_group_seats pgs
        JOIN public.hotel_table_session_seats seats ON seats.id = pgs.seat_id
        JOIN public.hotel_order_items oi ON oi.seat_id = seats.id
        JOIN public.hotel_orders o ON o.id = oi.order_id
        WHERE pgs.payment_group_id = g_inner.id
          AND oi.status <> 'cancelled'
          AND o.session_id = g_inner.session_id
      ), 0) AS total_amount,
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments p
        WHERE p.payment_group_id = g_inner.id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0) AS paid_amount,
      CASE
        WHEN COALESCE((
          SELECT SUM(oi.total_price)
          FROM public.hotel_table_payment_group_seats pgs
          JOIN public.hotel_table_session_seats seats ON seats.id = pgs.seat_id
          JOIN public.hotel_order_items oi ON oi.seat_id = seats.id
          JOIN public.hotel_orders o ON o.id = oi.order_id
          WHERE pgs.payment_group_id = g_inner.id
            AND oi.status <> 'cancelled'
            AND o.session_id = g_inner.session_id
        ), 0) <= 0 THEN 'paid'
        WHEN COALESCE((
          SELECT SUM(p.amount)
          FROM public.hotel_payments p
          WHERE p.payment_group_id = g_inner.id
            AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
        ), 0) >= COALESCE((
          SELECT SUM(oi.total_price)
          FROM public.hotel_table_payment_group_seats pgs
          JOIN public.hotel_table_session_seats seats ON seats.id = pgs.seat_id
          JOIN public.hotel_order_items oi ON oi.seat_id = seats.id
          JOIN public.hotel_orders o ON o.id = oi.order_id
          WHERE pgs.payment_group_id = g_inner.id
            AND oi.status <> 'cancelled'
            AND o.session_id = g_inner.session_id
        ), 0) THEN 'paid'
        WHEN COALESCE((
          SELECT SUM(p.amount)
          FROM public.hotel_payments p
          WHERE p.payment_group_id = g_inner.id
            AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
        ), 0) > 0 THEN 'partial'
        ELSE 'pending'
      END AS payment_status
    FROM public.hotel_table_payment_groups g_inner
    WHERE g_inner.session_id = p_session_id
  ) AS totals
  WHERE g.id = totals.id
    AND (
      COALESCE(g.total_amount, 0) IS DISTINCT FROM COALESCE(totals.total_amount, 0)
      OR COALESCE(g.paid_amount, 0) IS DISTINCT FROM COALESCE(totals.paid_amount, 0)
      OR COALESCE(g.payment_status, 'pending') IS DISTINCT FROM COALESCE(totals.payment_status, 'pending')
    );

  FOR v_seat IN
    SELECT id, paid_at, payment_status
    FROM public.hotel_table_session_seats
    WHERE session_id = p_session_id
  LOOP
    SELECT COALESCE(SUM(oi.total_price), 0)
    INTO v_due
    FROM public.hotel_order_items oi
    JOIN public.hotel_orders o ON o.id = oi.order_id
    WHERE o.session_id = p_session_id
      AND oi.seat_id = v_seat.id
      AND oi.status <> 'cancelled';

    SELECT COALESCE(SUM(amount), 0)
    INTO v_direct_paid
    FROM public.hotel_payments
    WHERE seat_id = v_seat.id
      AND COALESCE(status, 'posted') NOT IN ('void', 'refunded');

    SELECT EXISTS (
      SELECT 1
      FROM public.hotel_table_payment_group_seats pgs
      JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
      WHERE pgs.seat_id = v_seat.id
        AND g.session_id = p_session_id
        AND g.payment_status = 'paid'
    )
    INTO v_has_paid_group;

    SELECT EXISTS (
      SELECT 1
      FROM public.hotel_table_payment_group_seats pgs
      JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
      WHERE pgs.seat_id = v_seat.id
        AND g.session_id = p_session_id
        AND g.payment_status = 'partial'
    )
    INTO v_has_partial_group;

    v_status := CASE
      WHEN v_due <= 0 THEN 'paid'
      WHEN v_direct_paid >= v_due OR v_has_paid_group THEN 'paid'
      WHEN v_direct_paid > 0 OR v_has_partial_group THEN 'partial'
      ELSE 'pending'
    END;

    UPDATE public.hotel_table_session_seats
    SET
      payment_status = v_status,
      paid_at = CASE WHEN v_status = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END,
      updated_at = now()
    WHERE id = v_seat.id
      AND (
        COALESCE(payment_status, 'pending') IS DISTINCT FROM COALESCE(v_status, 'pending')
        OR COALESCE(paid_at, 'epoch'::timestamptz) IS DISTINCT FROM
          COALESCE(CASE WHEN v_status = 'paid' THEN v_seat.paid_at ELSE NULL END, 'epoch'::timestamptz)
      );
  END LOOP;

  SELECT
    COALESCE(bool_and(payment_status = 'paid'), false),
    COALESCE(bool_or(payment_status IN ('partial', 'paid')), false)
  INTO v_all_paid, v_any_paid
  FROM public.hotel_table_session_seats
  WHERE session_id = p_session_id;

  UPDATE public.hotel_table_sessions
  SET
    payment_status = CASE
      WHEN v_all_paid THEN 'paid'
      WHEN v_any_paid THEN 'partial'
      ELSE 'pending'
    END,
    status = CASE
      WHEN v_all_paid THEN 'closed'
      WHEN v_any_paid THEN 'partially_paid'
      ELSE 'active'
    END,
    closed_at = CASE WHEN v_all_paid THEN COALESCE(closed_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = p_session_id
    AND (
      COALESCE(payment_status, 'pending') IS DISTINCT FROM
        COALESCE(CASE
          WHEN v_all_paid THEN 'paid'
          WHEN v_any_paid THEN 'partial'
          ELSE 'pending'
        END, 'pending')
      OR COALESCE(status, 'active') IS DISTINCT FROM
        COALESCE(CASE
          WHEN v_all_paid THEN 'closed'
          WHEN v_any_paid THEN 'partially_paid'
          ELSE 'active'
        END, 'active')
      OR COALESCE(closed_at, 'epoch'::timestamptz) IS DISTINCT FROM
        COALESCE(CASE WHEN v_all_paid THEN closed_at ELSE NULL END, 'epoch'::timestamptz)
    );

  SELECT table_id
  INTO v_table_id
  FROM public.hotel_table_sessions
  WHERE id = p_session_id;

  IF v_all_paid AND v_table_id IS NOT NULL THEN
    UPDATE public.hotel_tables
    SET status = 'free'
    WHERE id = v_table_id
      AND status IS DISTINCT FROM 'free'
      AND NOT EXISTS (
        SELECT 1
        FROM public.hotel_table_sessions
        WHERE table_id = v_table_id
          AND status IN ('active', 'partially_paid')
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_hotel_session_related_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_session_id := COALESCE(NEW.session_id, OLD.session_id);

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_order_items' THEN
    SELECT session_id
    INTO v_session_id
    FROM public.hotel_orders
    WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  END IF;

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_table_session_seats' THEN
    v_session_id := COALESCE(NEW.session_id, OLD.session_id);
  END IF;

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_table_payment_groups' THEN
    v_session_id := COALESCE(NEW.session_id, OLD.session_id);
  END IF;

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_table_payment_group_seats' THEN
    SELECT g.session_id
    INTO v_session_id
    FROM public.hotel_table_payment_groups g
    WHERE g.id = COALESCE(NEW.payment_group_id, OLD.payment_group_id);
  END IF;

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_payments' THEN
    v_session_id := COALESCE(NEW.session_id, OLD.session_id);

    IF v_session_id IS NULL AND COALESCE(NEW.seat_id, OLD.seat_id) IS NOT NULL THEN
      SELECT session_id
      INTO v_session_id
      FROM public.hotel_table_session_seats
      WHERE id = COALESCE(NEW.seat_id, OLD.seat_id);
    END IF;

    IF v_session_id IS NULL AND COALESCE(NEW.payment_group_id, OLD.payment_group_id) IS NOT NULL THEN
      SELECT session_id
      INTO v_session_id
      FROM public.hotel_table_payment_groups
      WHERE id = COALESCE(NEW.payment_group_id, OLD.payment_group_id);
    END IF;
  END IF;

  PERFORM public.refresh_hotel_table_session_state(v_session_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;
