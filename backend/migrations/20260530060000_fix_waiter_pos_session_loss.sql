-- Improve open_hotel_table_session to be more resilient to session loss
-- and ensure staff identity is preserved during the call.

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
  v_current_staff_role TEXT;
  v_resolved_opened_by UUID;
  v_resolved_shift_id UUID;
BEGIN
  -- 1. Try to recover staff session from parameter if missing in current connection
  v_current_staff_id := public.current_staff_id();
  
  IF v_current_staff_id IS NULL AND p_opened_by IS NOT NULL THEN
    -- Attempt to set the session identity. This will fail if the caller is not authorized.
    PERFORM public.set_current_staff_id(p_opened_by);
    v_current_staff_id := public.current_staff_id();
  END IF;

  -- 2. Validate session existence
  IF v_current_staff_id IS NULL THEN
    RAISE EXCEPTION 'An active staff session is required to open a table session';
  END IF;

  -- 3. Validate role
  v_current_staff_role := public.current_staff_role();
  IF NOT (public.is_manager_or_owner() OR v_current_staff_role = 'waiter') THEN
    RAISE EXCEPTION 'Only waiter or manager sessions can open a table session';
  END IF;

  IF p_table_id IS NULL THEN
    RAISE EXCEPTION 'table_id is required';
  END IF;

  v_target_guest_count := GREATEST(COALESCE(p_guest_count, 1), 1);
  v_resolved_opened_by := CASE
    WHEN public.is_manager_or_owner() AND p_opened_by IS NOT NULL THEN p_opened_by
    ELSE v_current_staff_id
  END;

  -- 4. Resolve shift
  IF public.is_manager_or_owner() AND p_opened_shift_id IS NOT NULL THEN
    SELECT hs.id
    INTO v_resolved_shift_id
    FROM public.hotel_staff_shifts AS hs
    WHERE hs.id = p_opened_shift_id
      AND hs.staff_id = v_resolved_opened_by
      AND hs.closed_at IS NULL
    LIMIT 1;
  ELSE
    SELECT hs.id
    INTO v_resolved_shift_id
    FROM public.hotel_staff_shifts AS hs
    WHERE hs.staff_id = v_resolved_opened_by
      AND hs.closed_at IS NULL
    ORDER BY hs.opened_at DESC
    LIMIT 1;
  END IF;

  -- 5. Check for existing active session
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
      v_resolved_opened_by,
      v_resolved_shift_id,
      'active',
      'pending',
      p_notes
    FROM public.hotel_tables t
    WHERE t.id = p_table_id
    RETURNING *
    INTO v_session;
  ELSE
    IF NOT public.current_staff_can_access_table_session(v_session.id) THEN
      RAISE EXCEPTION 'This table session belongs to another waiter';
    END IF;

    UPDATE public.hotel_table_sessions
    SET
      guest_count = GREATEST(COALESCE(guest_count, 1), v_target_guest_count),
      opened_by = COALESCE(opened_by, v_resolved_opened_by),
      opened_shift_id = COALESCE(opened_shift_id, v_resolved_shift_id),
      notes = COALESCE(p_notes, notes),
      updated_at = now()
    WHERE id = v_session.id
    RETURNING *
    INTO v_session;
  END IF;

  -- 6. Ensure seats exist
  FOR v_seat_no IN 1..v_session.guest_count LOOP
    INSERT INTO public.hotel_table_session_seats (
      session_id,
      seat_no,
      status
    )
    VALUES (
      v_session.id,
      v_seat_no,
      'active'
    )
    ON CONFLICT (session_id, seat_no) DO NOTHING;
  END LOOP;

  RETURN v_session;
END;
$$;

-- Improve record_hotel_table_payment to handle session loss
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
  v_current_staff_id UUID;
BEGIN
  -- Recover staff session if missing
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
      WHERE pgs.seat_id = p_seat_id
    ) THEN
      RAISE EXCEPTION 'Seat is part of a payment group. Pay via the group instead.';
    END IF;

    SELECT
      GREATEST(s.total_amount - s.paid_amount, 0)
    INTO v_seat_due
    FROM public.hotel_table_session_seats s
    WHERE s.id = p_seat_id;

    v_target_amount := COALESCE(p_amount, v_seat_due);

    IF v_target_amount <= 0 OR v_target_amount > v_seat_due THEN
      RAISE EXCEPTION 'Payment amount must be between 0 and the outstanding seat balance';
    END IF;

    INSERT INTO public.hotel_payments (
      invoice_id,
      session_id,
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
      v_target_amount,
      p_payment_method,
      p_shift_id,
      p_staff_id,
      'posted',
      p_receipt_no,
      COALESCE(p_notes, 'Direct seat payment')
    )
    RETURNING id
    INTO v_inserted_payment_id;
    v_inserted_payment_ids := array_append(v_inserted_payment_ids, v_inserted_payment_id);
  ELSE
    -- Bulk session payment (all unpaid seats)
    FOR v_seat IN 
      SELECT id, total_amount, paid_amount 
      FROM public.hotel_table_session_seats 
      WHERE session_id = p_session_id AND total_amount > paid_amount
    LOOP
      INSERT INTO public.hotel_payments (
        invoice_id,
        session_id,
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
        v_seat.total_amount - v_seat.paid_amount,
        p_payment_method,
        p_shift_id,
        p_staff_id,
        'posted',
        p_receipt_no,
        COALESCE(p_notes, 'Full session payment')
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
