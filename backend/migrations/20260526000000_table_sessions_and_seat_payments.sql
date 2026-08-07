-- Seat-aware restaurant table sessions, split billing, and grouped payments
-- Created: 2026-05-26

CREATE TABLE IF NOT EXISTS public.hotel_table_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID NOT NULL REFERENCES public.hotel_tables(id) ON DELETE CASCADE,
  table_number TEXT,
  guest_count INTEGER NOT NULL DEFAULT 1 CHECK (guest_count > 0),
  opened_by UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL,
  opened_shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'partially_paid', 'closed', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid')),
  notes TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hotel_table_session_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.hotel_table_sessions(id) ON DELETE CASCADE,
  seat_no INTEGER NOT NULL CHECK (seat_no > 0),
  guest_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'closed', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seat_no)
);

CREATE TABLE IF NOT EXISTS public.hotel_table_payment_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.hotel_table_sessions(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, group_name)
);

CREATE TABLE IF NOT EXISTS public.hotel_table_payment_group_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_group_id UUID NOT NULL REFERENCES public.hotel_table_payment_groups(id) ON DELETE CASCADE,
  seat_id UUID NOT NULL REFERENCES public.hotel_table_session_seats(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_group_id, seat_id)
);

ALTER TABLE public.hotel_orders
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.hotel_table_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seat_id UUID REFERENCES public.hotel_table_session_seats(id) ON DELETE SET NULL;

ALTER TABLE public.hotel_order_items
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS seat_id UUID REFERENCES public.hotel_table_session_seats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seat_no INTEGER,
  ADD COLUMN IF NOT EXISTS payment_group_id UUID REFERENCES public.hotel_table_payment_groups(id) ON DELETE SET NULL;

ALTER TABLE public.hotel_payments
  ALTER COLUMN invoice_id DROP NOT NULL;

ALTER TABLE public.hotel_payments
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.hotel_table_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS seat_id UUID REFERENCES public.hotel_table_session_seats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_group_id UUID REFERENCES public.hotel_table_payment_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('pending', 'posted', 'void', 'refunded')),
  ADD COLUMN IF NOT EXISTS receipt_no TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_hotel_table_sessions_table_id
  ON public.hotel_table_sessions(table_id);
CREATE INDEX IF NOT EXISTS idx_hotel_table_sessions_status
  ON public.hotel_table_sessions(status, payment_status);
CREATE INDEX IF NOT EXISTS idx_hotel_table_session_seats_session
  ON public.hotel_table_session_seats(session_id, seat_no);
CREATE INDEX IF NOT EXISTS idx_hotel_table_payment_groups_session
  ON public.hotel_table_payment_groups(session_id);
CREATE INDEX IF NOT EXISTS idx_hotel_table_payment_group_seats_group
  ON public.hotel_table_payment_group_seats(payment_group_id);
CREATE INDEX IF NOT EXISTS idx_hotel_order_items_seat_id
  ON public.hotel_order_items(seat_id);
CREATE INDEX IF NOT EXISTS idx_hotel_order_items_payment_group_id
  ON public.hotel_order_items(payment_group_id);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_session_id
  ON public.hotel_orders(session_id);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_seat_id
  ON public.hotel_orders(seat_id);
CREATE INDEX IF NOT EXISTS idx_hotel_payments_session_id
  ON public.hotel_payments(session_id);
CREATE INDEX IF NOT EXISTS idx_hotel_payments_seat_id
  ON public.hotel_payments(seat_id);
CREATE INDEX IF NOT EXISTS idx_hotel_payments_payment_group_id
  ON public.hotel_payments(payment_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_table_sessions_one_open_per_table
  ON public.hotel_table_sessions(table_id)
  WHERE status IN ('active', 'partially_paid');






DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'hotel_table_sessions'
      AND policyname = 'Authenticated users can manage hotel table sessions'
  ) THEN
    
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'hotel_table_session_seats'
      AND policyname = 'Authenticated users can manage hotel table session seats'
  ) THEN
    
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'hotel_table_payment_groups'
      AND policyname = 'Authenticated users can manage hotel table payment groups'
  ) THEN
    
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'hotel_table_payment_group_seats'
      AND policyname = 'Authenticated users can manage hotel table payment group seats'
  ) THEN
    
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_hotel_order_seat_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order_session_id UUID;
  v_seat_session_id UUID;
  v_group_session_id UUID;
  v_seat_no INTEGER;
BEGIN
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT session_id
  INTO v_order_session_id
  FROM public.hotel_orders
  WHERE id = NEW.order_id;

  IF NEW.seat_id IS NOT NULL THEN
    SELECT session_id, seat_no
    INTO v_seat_session_id, v_seat_no
    FROM public.hotel_table_session_seats
    WHERE id = NEW.seat_id;

    IF v_order_session_id IS NULL THEN
      RAISE EXCEPTION 'Order % must have session_id before assigning seat_id', NEW.order_id;
    END IF;

    IF v_seat_session_id IS DISTINCT FROM v_order_session_id THEN
      RAISE EXCEPTION 'Seat % does not belong to the same table session as order %', NEW.seat_id, NEW.order_id;
    END IF;

    NEW.seat_no := COALESCE(NEW.seat_no, v_seat_no);
  END IF;

  IF NEW.payment_group_id IS NOT NULL THEN
    SELECT session_id
    INTO v_group_session_id
    FROM public.hotel_table_payment_groups
    WHERE id = NEW.payment_group_id;

    IF v_order_session_id IS NULL OR v_group_session_id IS DISTINCT FROM v_order_session_id THEN
      RAISE EXCEPTION 'Payment group % does not belong to the same table session as order %', NEW.payment_group_id, NEW.order_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

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
    payment_status = CASE
      WHEN totals.total_amount <= 0 THEN 'paid'
      WHEN totals.paid_amount >= totals.total_amount THEN 'paid'
      WHEN totals.paid_amount > 0 THEN 'partial'
      ELSE 'pending'
    END,
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
      ), 0) AS paid_amount
    FROM public.hotel_table_payment_groups g_inner
    WHERE g_inner.session_id = p_session_id
  ) AS totals
  WHERE g.id = totals.id;

  FOR v_seat IN
    SELECT id
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
    WHERE id = v_seat.id;
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
  WHERE id = p_session_id;

  SELECT table_id
  INTO v_table_id
  FROM public.hotel_table_sessions
  WHERE id = p_session_id;

  IF v_all_paid AND v_table_id IS NOT NULL THEN
    UPDATE public.hotel_tables
    SET status = 'free'
    WHERE id = v_table_id
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

DROP TRIGGER IF EXISTS trigger_validate_hotel_order_seat_assignment ON public.hotel_order_items;
CREATE TRIGGER trigger_validate_hotel_order_seat_assignment
  BEFORE INSERT OR UPDATE OF seat_id, payment_group_id ON public.hotel_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_hotel_order_seat_assignment();

DROP TRIGGER IF EXISTS trigger_hotel_order_items_refresh_session_state ON public.hotel_order_items;
CREATE TRIGGER trigger_hotel_order_items_refresh_session_state
  AFTER INSERT OR UPDATE OR DELETE ON public.hotel_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_hotel_session_related_change();

DROP TRIGGER IF EXISTS trigger_hotel_orders_refresh_session_state ON public.hotel_orders;
CREATE TRIGGER trigger_hotel_orders_refresh_session_state
  AFTER INSERT OR UPDATE OF session_id, seat_id, status ON public.hotel_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_hotel_session_related_change();

DROP TRIGGER IF EXISTS trigger_hotel_payments_refresh_session_state ON public.hotel_payments;
CREATE TRIGGER trigger_hotel_payments_refresh_session_state
  AFTER INSERT OR UPDATE OR DELETE ON public.hotel_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_hotel_session_related_change();

DROP TRIGGER IF EXISTS trigger_hotel_table_session_seats_refresh_state ON public.hotel_table_session_seats;
CREATE TRIGGER trigger_hotel_table_session_seats_refresh_state
  AFTER INSERT OR UPDATE OR DELETE ON public.hotel_table_session_seats
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_hotel_session_related_change();

DROP TRIGGER IF EXISTS trigger_hotel_table_payment_groups_refresh_state ON public.hotel_table_payment_groups;
CREATE TRIGGER trigger_hotel_table_payment_groups_refresh_state
  AFTER INSERT OR UPDATE OR DELETE ON public.hotel_table_payment_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_hotel_session_related_change();

DROP TRIGGER IF EXISTS trigger_hotel_table_payment_group_seats_refresh_state ON public.hotel_table_payment_group_seats;
CREATE TRIGGER trigger_hotel_table_payment_group_seats_refresh_state
  AFTER INSERT OR UPDATE OR DELETE ON public.hotel_table_payment_group_seats
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_hotel_session_related_change();

DROP TRIGGER IF EXISTS trigger_hotel_table_sessions_updated_at ON public.hotel_table_sessions;
CREATE TRIGGER trigger_hotel_table_sessions_updated_at
  BEFORE UPDATE ON public.hotel_table_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_hotel_table_session_seats_updated_at ON public.hotel_table_session_seats;
CREATE TRIGGER trigger_hotel_table_session_seats_updated_at
  BEFORE UPDATE ON public.hotel_table_session_seats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_hotel_table_payment_groups_updated_at ON public.hotel_table_payment_groups;
CREATE TRIGGER trigger_hotel_table_payment_groups_updated_at
  BEFORE UPDATE ON public.hotel_table_payment_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.open_hotel_table_session(
  p_table_id UUID,
  p_guest_count INTEGER DEFAULT 1,
  p_opened_by UUID DEFAULT NULL,
  p_opened_shift_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.hotel_table_sessions
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_session public.hotel_table_sessions%ROWTYPE;
  v_target_guest_count INTEGER;
  v_seat_no INTEGER;
BEGIN
  IF p_table_id IS NULL THEN
    RAISE EXCEPTION 'table_id is required';
  END IF;

  v_target_guest_count := GREATEST(COALESCE(p_guest_count, 1), 1);

  SELECT *
  INTO v_session
  FROM public.hotel_table_sessions
  WHERE table_id = p_table_id
    AND status IN ('active', 'partially_paid')
  ORDER BY opened_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.hotel_table_sessions (
      table_id,
      table_number,
      guest_count,
      opened_by,
      opened_shift_id,
      status,
      payment_status,
      notes
    )
    SELECT
      t.id,
      t.table_number,
      v_target_guest_count,
      p_opened_by,
      p_opened_shift_id,
      'active',
      'pending',
      p_notes
    FROM public.hotel_tables t
    WHERE t.id = p_table_id
    RETURNING *
    INTO v_session;
  ELSE
    UPDATE public.hotel_table_sessions
    SET
      guest_count = GREATEST(COALESCE(guest_count, 1), v_target_guest_count),
      opened_by = COALESCE(opened_by, p_opened_by),
      opened_shift_id = COALESCE(opened_shift_id, p_opened_shift_id),
      notes = COALESCE(p_notes, notes),
      updated_at = now()
    WHERE id = v_session.id
    RETURNING *
    INTO v_session;
  END IF;

  FOR v_seat_no IN 1..v_session.guest_count LOOP
    INSERT INTO public.hotel_table_session_seats (
      session_id,
      seat_no,
      status,
      payment_status
    )
    VALUES (
      v_session.id,
      v_seat_no,
      'active',
      'pending'
    )
    ON CONFLICT (session_id, seat_no) DO UPDATE
    SET
      status = CASE
        WHEN public.hotel_table_session_seats.status = 'cancelled' THEN 'active'
        ELSE public.hotel_table_session_seats.status
      END,
      updated_at = now();
  END LOOP;

  UPDATE public.hotel_tables
  SET
    status = 'occupied',
    updated_at = now()
  WHERE id = p_table_id;

  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_hotel_table_payment_group(
  p_session_id UUID,
  p_group_name TEXT,
  p_seat_ids UUID[],
  p_created_by UUID DEFAULT NULL
)
RETURNS public.hotel_table_payment_groups
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_group public.hotel_table_payment_groups%ROWTYPE;
  v_invalid_seat_count INTEGER;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id is required';
  END IF;

  IF COALESCE(array_length(p_seat_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one seat is required to build a payment group';
  END IF;

  SELECT COUNT(*)
  INTO v_invalid_seat_count
  FROM public.hotel_table_session_seats s
  WHERE s.id = ANY (p_seat_ids)
    AND s.session_id <> p_session_id;

  IF v_invalid_seat_count > 0 THEN
    RAISE EXCEPTION 'All seats in a payment group must belong to the same table session';
  END IF;

  SELECT COUNT(*)
  INTO v_invalid_seat_count
  FROM public.hotel_table_session_seats s
  WHERE s.id = ANY (p_seat_ids)
    AND s.payment_status = 'paid';

  IF v_invalid_seat_count > 0 THEN
    RAISE EXCEPTION 'Paid seats cannot be moved into a new payment group';
  END IF;

  INSERT INTO public.hotel_table_payment_groups (
    session_id,
    group_name,
    created_by
  )
  VALUES (
    p_session_id,
    p_group_name,
    p_created_by
  )
  ON CONFLICT (session_id, group_name) DO UPDATE
  SET
    status = 'active',
    created_by = COALESCE(EXCLUDED.created_by, public.hotel_table_payment_groups.created_by),
    updated_at = now()
  RETURNING *
  INTO v_group;

  DELETE FROM public.hotel_table_payment_group_seats existing
  USING public.hotel_table_payment_groups g
  WHERE existing.payment_group_id = g.id
    AND g.session_id = p_session_id
    AND g.id <> v_group.id
    AND existing.seat_id = ANY (p_seat_ids);

  DELETE FROM public.hotel_table_payment_group_seats
  WHERE payment_group_id = v_group.id;

  INSERT INTO public.hotel_table_payment_group_seats (
    payment_group_id,
    seat_id
  )
  SELECT
    v_group.id,
    s.id
  FROM public.hotel_table_session_seats s
  WHERE s.id = ANY (p_seat_ids);

  UPDATE public.hotel_table_session_seats
  SET
    status = 'merged',
    updated_at = now()
  WHERE id = ANY (p_seat_ids);

  UPDATE public.hotel_table_session_seats
  SET
    status = 'active',
    updated_at = now()
  WHERE session_id = p_session_id
    AND id NOT IN (
      SELECT pgs.seat_id
      FROM public.hotel_table_payment_group_seats pgs
      JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
      WHERE g.session_id = p_session_id
        AND g.status = 'active'
    )
    AND status = 'merged'
    AND payment_status <> 'paid';

  PERFORM public.refresh_hotel_table_session_state(p_session_id);

  SELECT *
  INTO v_group
  FROM public.hotel_table_payment_groups
  WHERE id = v_group.id;

  RETURN v_group;
END;
$$;

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
BEGIN
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

    SELECT
      GREATEST(g.total_amount - g.paid_amount, 0)
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
    SELECT session_id
    INTO v_seat_session_id
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
          AND oi.seat_id = p_seat_id
          AND oi.status <> 'cancelled'
      ), 0) - COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments p
        WHERE p.seat_id = p_seat_id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0), 0)
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
        GREATEST(
          COALESCE((
            SELECT SUM(oi.total_price)
            FROM public.hotel_order_items oi
            JOIN public.hotel_orders o ON o.id = oi.order_id
            WHERE o.session_id = p_session_id
              AND oi.seat_id = s.id
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

    IF COALESCE(array_length(v_inserted_payment_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION 'This table session has no outstanding balance';
    END IF;
  END IF;

  PERFORM public.refresh_hotel_table_session_state(p_session_id);

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'payment_ids', v_inserted_payment_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hotel_table_session_summary(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'session_id', s.id,
    'table_id', s.table_id,
    'table_number', COALESCE(s.table_number, t.table_number),
    'guest_count', s.guest_count,
    'status', s.status,
    'payment_status', s.payment_status,
    'opened_at', s.opened_at,
    'opened_by', s.opened_by,
    'opened_shift_id', s.opened_shift_id,
    'total_amount', COALESCE((
      SELECT SUM(oi.total_price)
      FROM public.hotel_order_items oi
      JOIN public.hotel_orders o ON o.id = oi.order_id
      WHERE o.session_id = s.id
        AND oi.status <> 'cancelled'
    ), 0),
    'total_paid', COALESCE((
      SELECT SUM(p.amount)
      FROM public.hotel_payments p
      WHERE p.session_id = s.id
        AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
    ), 0),
    'outstanding_amount', GREATEST(
      COALESCE((
        SELECT SUM(oi.total_price)
        FROM public.hotel_order_items oi
        JOIN public.hotel_orders o ON o.id = oi.order_id
        WHERE o.session_id = s.id
          AND oi.status <> 'cancelled'
      ), 0) - COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments p
        WHERE p.session_id = s.id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0),
      0
    ),
    'seats', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'seat_id', seat.id,
          'seat_no', seat.seat_no,
          'guest_name', seat.guest_name,
          'status', seat.status,
          'payment_status', seat.payment_status,
          'item_total', seat.item_total,
          'total_paid', seat.total_paid,
          'outstanding_amount', GREATEST(seat.item_total - seat.total_paid, 0),
          'payment_group_id', seat.payment_group_id,
          'payment_group_name', seat.payment_group_name
        )
        ORDER BY seat.seat_no
      )
      FROM (
        SELECT
          sseat.id,
          sseat.seat_no,
          sseat.guest_name,
          sseat.status,
          sseat.payment_status,
          COALESCE((
            SELECT SUM(oi.total_price)
            FROM public.hotel_order_items oi
            JOIN public.hotel_orders o ON o.id = oi.order_id
            WHERE o.session_id = p_session_id
              AND oi.seat_id = sseat.id
              AND oi.status <> 'cancelled'
          ), 0) AS item_total,
          COALESCE((
            SELECT SUM(p.amount)
            FROM public.hotel_payments p
            WHERE p.seat_id = sseat.id
              AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
          ), 0) + COALESCE((
            SELECT SUM(p.amount)
            FROM public.hotel_table_payment_group_seats pgs
            JOIN public.hotel_payments p ON p.payment_group_id = pgs.payment_group_id
            WHERE pgs.seat_id = sseat.id
              AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
          ), 0) AS total_paid,
          grp.payment_group_id,
          grp.payment_group_name
        FROM public.hotel_table_session_seats sseat
        LEFT JOIN LATERAL (
          SELECT
            g.id AS payment_group_id,
            g.group_name AS payment_group_name
          FROM public.hotel_table_payment_group_seats pgs
          JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
          WHERE pgs.seat_id = sseat.id
            AND g.session_id = p_session_id
            AND g.status = 'active'
          LIMIT 1
        ) grp ON TRUE
        WHERE sseat.session_id = p_session_id
      ) seat
    ), '[]'::jsonb),
    'groups', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'payment_group_id', grp.id,
          'group_name', grp.group_name,
          'status', grp.status,
          'payment_status', grp.payment_status,
          'total_amount', grp.total_amount,
          'paid_amount', grp.paid_amount,
          'outstanding_amount', GREATEST(grp.total_amount - grp.paid_amount, 0),
          'seat_ids', grp.seat_ids,
          'seat_numbers', grp.seat_numbers
        )
        ORDER BY grp.group_name
      )
      FROM (
        SELECT
          g.id,
          g.group_name,
          g.status,
          g.payment_status,
          g.total_amount,
          g.paid_amount,
          ARRAY_AGG(sseat.id ORDER BY sseat.seat_no) AS seat_ids,
          ARRAY_AGG(sseat.seat_no ORDER BY sseat.seat_no) AS seat_numbers
        FROM public.hotel_table_payment_groups g
        LEFT JOIN public.hotel_table_payment_group_seats pgs ON pgs.payment_group_id = g.id
        LEFT JOIN public.hotel_table_session_seats sseat ON sseat.id = pgs.seat_id
        WHERE g.session_id = p_session_id
        GROUP BY g.id, g.group_name, g.status, g.payment_status, g.total_amount, g.paid_amount
      ) grp
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.hotel_table_sessions s
  JOIN public.hotel_tables t ON t.id = s.table_id
  WHERE s.id = p_session_id;

  RETURN v_result;
END;
$$;
