-- Fix record_hotel_table_payment after schema drift.
-- hotel_table_session_seats does not store total_amount/paid_amount, so seat/full
-- settlement must compute balances from order items and posted payments.

CREATE OR REPLACE FUNCTION public.record_hotel_table_payment(
  p_session_id UUID,
  p_payment_method TEXT,
  p_staff_id UUID DEFAULT NULL,
  p_shift_id UUID DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_seat_id UUID DEFAULT NULL,
  p_payment_group_id UUID DEFAULT NULL,
  p_receipt_no TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_payment_ids UUID[] := ARRAY[]::UUID[];
  v_inserted_payment_id UUID;
  v_group RECORD;
  v_seat RECORD;
  v_target_amount NUMERIC;
  v_group_due NUMERIC;
  v_seat_due NUMERIC;
  v_group_session_id UUID;
  v_seat_session_id UUID;
  v_seat_no INTEGER;
  v_current_staff_id UUID;
BEGIN
  v_current_staff_id := public.current_staff_id();
  IF v_current_staff_id IS NULL AND p_staff_id IS NOT NULL THEN
    PERFORM public.set_current_staff_id(p_staff_id);
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id is required';
  END IF;

  IF COALESCE(NULLIF(trim(p_payment_method), ''), '') = '' THEN
    RAISE EXCEPTION 'payment method is required';
  END IF;

  IF p_seat_id IS NOT NULL AND p_payment_group_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose either seat payment or group payment, not both';
  END IF;

  IF p_payment_group_id IS NOT NULL THEN
    SELECT session_id
    INTO v_group_session_id
    FROM public.hotel_table_payment_groups
    WHERE id = p_payment_group_id;

    IF v_group_session_id IS DISTINCT FROM p_session_id THEN
      RAISE EXCEPTION 'Payment group does not belong to this session';
    END IF;

    SELECT GREATEST(g.total_amount - g.paid_amount, 0)
    INTO v_group_due
    FROM public.hotel_table_payment_groups g
    WHERE g.id = p_payment_group_id;

    v_target_amount := COALESCE(p_amount, v_group_due);

    IF v_target_amount <= 0 OR v_target_amount > v_group_due THEN
      RAISE EXCEPTION 'Payment amount must be between 0 and the outstanding group balance';
    END IF;

    INSERT INTO public.hotel_payments (
      invoice_id,
      session_id,
      payment_group_id,
      amount,
      payment_method,
      shift_id,
      staff_id,
      status,
      receipt_no,
      notes
    )
    VALUES (
      NULL,
      p_session_id,
      p_payment_group_id,
      v_target_amount,
      p_payment_method,
      p_shift_id,
      p_staff_id,
      'posted',
      p_receipt_no,
      COALESCE(p_notes, 'Grouped table payment')
    )
    RETURNING id
    INTO v_inserted_payment_id;

    v_inserted_payment_ids := array_append(v_inserted_payment_ids, v_inserted_payment_id);
  ELSIF p_seat_id IS NOT NULL THEN
    SELECT session_id, seat_no
    INTO v_seat_session_id, v_seat_no
    FROM public.hotel_table_session_seats
    WHERE id = p_seat_id;

    IF v_seat_session_id IS DISTINCT FROM p_session_id THEN
      RAISE EXCEPTION 'Seat does not belong to this session';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.hotel_table_payment_group_seats pgs
      JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
      WHERE pgs.seat_id = p_seat_id
        AND g.session_id = p_session_id
        AND g.status = 'active'
    ) THEN
      RAISE EXCEPTION 'This seat belongs to an active payment group. Please pay the group instead.';
    END IF;

    SELECT GREATEST(
      COALESCE((
        SELECT SUM(oi.total_price)
        FROM public.hotel_order_items oi
        JOIN public.hotel_orders o ON o.id = oi.order_id
        WHERE o.session_id = p_session_id
          AND (
            oi.seat_id = p_seat_id
            OR (oi.seat_id IS NULL AND v_seat_no = 1)
          )
          AND oi.status <> 'cancelled'
      ), 0) - COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments p
        WHERE p.seat_id = p_seat_id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0),
      0
    )
    INTO v_seat_due;

    v_target_amount := COALESCE(p_amount, v_seat_due);

    IF v_target_amount <= 0 OR v_target_amount > v_seat_due THEN
      RAISE EXCEPTION 'Payment amount must be between 0 and the outstanding seat balance';
    END IF;

    INSERT INTO public.hotel_payments (
      invoice_id,
      session_id,
      seat_id,
      amount,
      payment_method,
      shift_id,
      staff_id,
      status,
      receipt_no,
      notes
    )
    VALUES (
      NULL,
      p_session_id,
      p_seat_id,
      v_target_amount,
      p_payment_method,
      p_shift_id,
      p_staff_id,
      'posted',
      p_receipt_no,
      COALESCE(p_notes, 'Seat payment')
    )
    RETURNING id
    INTO v_inserted_payment_id;

    v_inserted_payment_ids := array_append(v_inserted_payment_ids, v_inserted_payment_id);
  ELSE
    FOR v_group IN
      SELECT
        g.id,
        GREATEST(g.total_amount - g.paid_amount, 0) AS outstanding_amount
      FROM public.hotel_table_payment_groups g
      WHERE g.session_id = p_session_id
        AND g.status = 'active'
        AND GREATEST(g.total_amount - g.paid_amount, 0) > 0
      ORDER BY g.group_name
    LOOP
      INSERT INTO public.hotel_payments (
        invoice_id,
        session_id,
        payment_group_id,
        amount,
        payment_method,
        shift_id,
        staff_id,
        status,
        receipt_no,
        notes
      )
      VALUES (
        NULL,
        p_session_id,
        v_group.id,
        v_group.outstanding_amount,
        p_payment_method,
        p_shift_id,
        p_staff_id,
        'posted',
        p_receipt_no,
        COALESCE(p_notes, 'Full table settlement')
      )
      RETURNING id
      INTO v_inserted_payment_id;

      v_inserted_payment_ids := array_append(v_inserted_payment_ids, v_inserted_payment_id);
    END LOOP;

    FOR v_seat IN
      SELECT
        s.id,
        s.seat_no,
        GREATEST(
          COALESCE((
            SELECT SUM(oi.total_price)
            FROM public.hotel_order_items oi
            JOIN public.hotel_orders o ON o.id = oi.order_id
            WHERE o.session_id = p_session_id
              AND (
                oi.seat_id = s.id
                OR (oi.seat_id IS NULL AND s.seat_no = 1)
              )
              AND oi.status <> 'cancelled'
          ), 0) - COALESCE((
            SELECT SUM(p.amount)
            FROM public.hotel_payments p
            WHERE p.seat_id = s.id
              AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
          ), 0),
          0
        ) AS outstanding_amount
      FROM public.hotel_table_session_seats s
      WHERE s.session_id = p_session_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.hotel_table_payment_group_seats pgs
          JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
          WHERE pgs.seat_id = s.id
            AND g.session_id = p_session_id
            AND g.status = 'active'
        )
      ORDER BY s.seat_no
    LOOP
      IF v_seat.outstanding_amount <= 0 THEN
        CONTINUE;
      END IF;

      INSERT INTO public.hotel_payments (
        invoice_id,
        session_id,
        seat_id,
        amount,
        payment_method,
        shift_id,
        staff_id,
        status,
        receipt_no,
        notes
      )
      VALUES (
        NULL,
        p_session_id,
        v_seat.id,
        v_seat.outstanding_amount,
        p_payment_method,
        p_shift_id,
        p_staff_id,
        'posted',
        p_receipt_no,
        COALESCE(p_notes, 'Full table settlement')
      )
      RETURNING id
      INTO v_inserted_payment_id;

      v_inserted_payment_ids := array_append(v_inserted_payment_ids, v_inserted_payment_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_ids', v_inserted_payment_ids
  );
END;
$$;
