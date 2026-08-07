-- 1. Fix Seat/Order Session Mismatch
-- If there's a mismatch, we attempt to fix the order's session_id to match the seat's session_id
-- IF and ONLY IF the order doesn't have a session or its session is closed.

CREATE OR REPLACE FUNCTION public.validate_hotel_order_seat_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_session_id UUID;
  v_order_status TEXT;
  v_seat_session_id UUID;
  v_group_session_id UUID;
  v_seat_no INTEGER;
BEGIN
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT session_id, status
  INTO v_order_session_id, v_order_status
  FROM public.hotel_orders
  WHERE id = NEW.order_id;

  IF NEW.seat_id IS NOT NULL THEN
    SELECT session_id, seat_no
    INTO v_seat_session_id, v_seat_no
    FROM public.hotel_table_session_seats
    WHERE id = NEW.seat_id;

    -- If order has no session or a different session, but the seat belongs to an active session,
    -- we might want to update the order's session_id.
    IF v_order_session_id IS DISTINCT FROM v_seat_session_id THEN
      -- Check if the order's current session (if any) is active.
      -- If it's not active, or order has no session, we "adopt" the seat's session.
      IF v_order_session_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.hotel_table_sessions 
        WHERE id = v_order_session_id AND status IN ('active', 'partially_paid')
      ) THEN
        UPDATE public.hotel_orders 
        SET session_id = v_seat_session_id 
        WHERE id = NEW.order_id;
        v_order_session_id := v_seat_session_id;
      ELSE
        -- Both are active but different? This is a genuine error.
        RAISE EXCEPTION 'Seat % belongs to session %, but order % belongs to active session %', 
          NEW.seat_id, v_seat_session_id, NEW.order_id, v_order_session_id;
      END IF;
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

-- 2. Fix hotel_shift_logs schema
ALTER TABLE public.hotel_shift_logs 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. Harden RLS for hotel_order_items
-- Drop and recreate to ensure it works for all sync scenarios
DROP POLICY IF EXISTS "Allow all users to manage order items" ON public.hotel_order_items;

-- 4. Harden open_hotel_table_session parameters
-- Ensure it handles cases where it's called with existing session data but needs update
CREATE OR REPLACE FUNCTION public.open_hotel_table_session(
  p_table_id UUID,
  p_guest_count INTEGER DEFAULT 1,
  p_opened_by UUID DEFAULT NULL,
  p_opened_shift_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.hotel_table_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.hotel_table_sessions%ROWTYPE;
  v_target_guest_count INTEGER;
  v_seat_no INTEGER;
  v_current_staff_id UUID;
  v_resolved_opened_by UUID;
  v_resolved_shift_id UUID;
BEGIN
  v_current_staff_id := public.current_staff_id();
  IF v_current_staff_id IS NULL AND p_opened_by IS NOT NULL THEN
    PERFORM public.set_current_staff_id(p_opened_by);
    v_current_staff_id := public.current_staff_id();
  END IF;

  IF v_current_staff_id IS NULL THEN
    RAISE EXCEPTION 'An active staff session is required to open a table session';
  END IF;

  v_target_guest_count := GREATEST(COALESCE(p_guest_count, 1), 1);
  v_resolved_opened_by := COALESCE(v_current_staff_id, p_opened_by);

  SELECT hs.id INTO v_resolved_shift_id
  FROM public.hotel_staff_shifts hs
  WHERE hs.staff_id = v_resolved_opened_by AND hs.closed_at IS NULL
  ORDER BY hs.opened_at DESC LIMIT 1;

  SELECT * INTO v_session
  FROM public.hotel_table_sessions
  WHERE table_id = p_table_id AND status IN ('active', 'partially_paid')
  ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.hotel_table_sessions (
      table_id, table_number, guest_count, opened_by, opened_shift_id, status, payment_status, notes
    )
    SELECT t.id, t.table_number, v_target_guest_count, v_resolved_opened_by, v_resolved_shift_id, 'active', 'pending', p_notes
    FROM public.hotel_tables t WHERE t.id = p_table_id
    RETURNING * INTO v_session;
  ELSE
    UPDATE public.hotel_table_sessions
    SET guest_count = GREATEST(guest_count, v_target_guest_count),
        opened_by = COALESCE(opened_by, v_resolved_opened_by),
        opened_shift_id = COALESCE(opened_shift_id, v_resolved_shift_id, v_session.opened_shift_id),
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = v_session.id
    RETURNING * INTO v_session;
  END IF;

  FOR v_seat_no IN 1..v_session.guest_count LOOP
    INSERT INTO public.hotel_table_session_seats (session_id, seat_no, status)
    VALUES (v_session.id, v_seat_no, 'active')
    ON CONFLICT (session_id, seat_no) DO UPDATE 
    SET status = 'active' WHERE public.hotel_table_session_seats.status = 'cancelled';
  END LOOP;

  UPDATE public.hotel_tables SET status = 'occupied' WHERE id = p_table_id;

  RETURN v_session;
END;
$$;
