-- Harden waiter/staff security around PIN verification, table sessions,
-- order-item access, and table-session ownership.

CREATE TABLE IF NOT EXISTS public.hotel_pin_auth_attempts (
  auth_user_id UUID PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);



REVOKE ALL ON TABLE public.hotel_pin_auth_attempts FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION public.register_pin_auth_failure(
  p_auth_user_id UUID,
  p_max_attempts INTEGER DEFAULT 8,
  p_lock_minutes INTEGER DEFAULT 10
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.hotel_pin_auth_attempts%ROWTYPE;
  v_next_attempts INTEGER;
  v_locked_until TIMESTAMPTZ;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_attempt
  FROM public.hotel_pin_auth_attempts
  WHERE auth_user_id = p_auth_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_next_attempts := 1;
    v_locked_until := CASE
      WHEN p_max_attempts <= 1 THEN now() + make_interval(mins => GREATEST(p_lock_minutes, 1))
      ELSE NULL
    END;

    INSERT INTO public.hotel_pin_auth_attempts (
      auth_user_id,
      failed_attempts,
      locked_until,
      last_failed_at,
      updated_at
    )
    VALUES (
      p_auth_user_id,
      v_next_attempts,
      v_locked_until,
      now(),
      now()
    );

    RETURN v_locked_until;
  END IF;

  IF v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until > now() THEN
    RETURN v_attempt.locked_until;
  END IF;

  v_next_attempts := COALESCE(v_attempt.failed_attempts, 0) + 1;
  v_locked_until := CASE
    WHEN v_next_attempts >= GREATEST(p_max_attempts, 1)
      THEN now() + make_interval(mins => GREATEST(p_lock_minutes, 1))
    ELSE NULL
  END;

  UPDATE public.hotel_pin_auth_attempts
  SET
    failed_attempts = v_next_attempts,
    locked_until = v_locked_until,
    last_failed_at = now(),
    updated_at = now()
  WHERE auth_user_id = p_auth_user_id;

  RETURN v_locked_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_pin_auth_failures(p_auth_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.hotel_pin_auth_attempts
  WHERE auth_user_id = p_auth_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_auth_pin_lock_until(p_auth_user_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hpa.locked_until
  FROM public.hotel_pin_auth_attempts AS hpa
  WHERE hpa.auth_user_id = p_auth_user_id
$$;

GRANT EXECUTE ON FUNCTION public.register_pin_auth_failure(UUID, INTEGER, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_pin_auth_failures(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_auth_pin_lock_until(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verify_staff_pin(staff_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  staff_record record;
  v_now timestamptz := now();
  v_auth_uid uuid := auth.uid();
  v_is_match boolean := false;
  v_caller_locked_until timestamptz;
BEGIN
  IF v_auth_uid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF staff_pin IS NULL OR staff_pin = '' THEN
    RETURN json_build_object('success', false, 'error', 'PIN is required');
  END IF;

  v_caller_locked_until := public.current_auth_pin_lock_until(v_auth_uid);
  IF v_caller_locked_until IS NOT NULL AND v_caller_locked_until > v_now THEN
    RETURN json_build_object('success', false, 'error', 'Too many failed attempts. Please try again in 10 minutes.');
  END IF;

  FOR staff_record IN
    SELECT id, first_name, last_name, role, is_active, allowed_hotel_routes, pin, pin_failed_attempts, pin_locked_until
    FROM public.hotel_staff
    WHERE is_active = true
      AND pin IS NOT NULL
  LOOP
    IF staff_record.pin ~ '^\$2[ayb]\$.*' THEN
      v_is_match := (staff_record.pin = extensions.crypt(staff_pin, staff_record.pin));
    ELSE
      v_is_match := (staff_record.pin = staff_pin);
    END IF;

    IF NOT v_is_match THEN
      CONTINUE;
    END IF;

    IF staff_record.pin_locked_until IS NOT NULL AND staff_record.pin_locked_until > v_now THEN
      RETURN json_build_object('success', false, 'error', 'Account is temporarily locked. Please try again in 15 minutes.');
    END IF;

    UPDATE public.hotel_staff
    SET
      pin_failed_attempts = 0,
      pin_locked_until = NULL
    WHERE id = staff_record.id;

    PERFORM public.clear_pin_auth_failures(v_auth_uid);

    RETURN json_build_object(
      'success', true,
      'staff_id', staff_record.id,
      'first_name', staff_record.first_name,
      'last_name', staff_record.last_name,
      'role', staff_record.role,
      'allowed_hotel_routes', staff_record.allowed_hotel_routes
    );
  END LOOP;

  PERFORM public.register_pin_auth_failure(v_auth_uid, 8, 10);
  PERFORM pg_sleep(0.35);
  RETURN json_build_object('success', false, 'error', 'Invalid PIN');
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_waiter_pos_pin(
  staff_pin text,
  expected_staff_id uuid DEFAULT NULL,
  waiter_only boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  staff_record record;
  attendance_record public.hotel_staff_attendance%ROWTYPE;
  shift_record public.hotel_staff_shifts%ROWTYPE;
  v_now timestamptz := now();
  v_today date := current_date;
  v_auth_uid uuid := auth.uid();
  v_is_match boolean := false;
  v_caller_locked_until timestamptz;
BEGIN
  IF v_auth_uid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF staff_pin IS NULL OR staff_pin = '' THEN
    RETURN json_build_object('success', false, 'error', 'PIN is required');
  END IF;

  v_caller_locked_until := public.current_auth_pin_lock_until(v_auth_uid);
  IF v_caller_locked_until IS NOT NULL AND v_caller_locked_until > v_now THEN
    RETURN json_build_object('success', false, 'error', 'Too many failed attempts. Please try again in 10 minutes.');
  END IF;

  IF expected_staff_id IS NOT NULL THEN
    SELECT id, first_name, last_name, role, is_active, allowed_hotel_routes, pin, pin_failed_attempts, pin_locked_until
    INTO staff_record
    FROM public.hotel_staff
    WHERE id = expected_staff_id
      AND is_active = true
      AND pin IS NOT NULL
      AND (
        waiter_only = false
        OR role = 'waiter'
      )
    LIMIT 1;

    IF NOT FOUND THEN
      PERFORM public.register_pin_auth_failure(v_auth_uid, 8, 10);
      PERFORM pg_sleep(0.35);
      RETURN json_build_object('success', false, 'error', 'Invalid PIN');
    END IF;

    IF staff_record.pin ~ '^\$2[ayb]\$.*' THEN
      v_is_match := (staff_record.pin = extensions.crypt(staff_pin, staff_record.pin));
    ELSE
      v_is_match := (staff_record.pin = staff_pin);
    END IF;

    IF NOT v_is_match THEN
      UPDATE public.hotel_staff
      SET
        pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
        pin_locked_until = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= 5
            THEN v_now + interval '15 minutes'
          ELSE pin_locked_until
        END
      WHERE id = staff_record.id;

      PERFORM public.register_pin_auth_failure(v_auth_uid, 8, 10);
      PERFORM pg_sleep(0.35);
      RETURN json_build_object('success', false, 'error', 'Invalid PIN');
    END IF;
  ELSE
    FOR staff_record IN
      SELECT id, first_name, last_name, role, is_active, allowed_hotel_routes, pin, pin_failed_attempts, pin_locked_until
      FROM public.hotel_staff
      WHERE is_active = true
        AND pin IS NOT NULL
        AND (
          waiter_only = false
          OR role = 'waiter'
        )
    LOOP
      IF staff_record.pin ~ '^\$2[ayb]\$.*' THEN
        v_is_match := (staff_record.pin = extensions.crypt(staff_pin, staff_record.pin));
      ELSE
        v_is_match := (staff_record.pin = staff_pin);
      END IF;

      IF v_is_match THEN
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_is_match THEN
      PERFORM public.register_pin_auth_failure(v_auth_uid, 8, 10);
      PERFORM pg_sleep(0.35);
      RETURN json_build_object('success', false, 'error', 'Invalid PIN');
    END IF;
  END IF;

  IF staff_record.pin_locked_until IS NOT NULL AND staff_record.pin_locked_until > v_now THEN
    RETURN json_build_object('success', false, 'error', 'Account is temporarily locked. Please try again in 15 minutes.');
  END IF;

  UPDATE public.hotel_staff
  SET
    pin_failed_attempts = 0,
    pin_locked_until = NULL
  WHERE id = staff_record.id;

  PERFORM public.clear_pin_auth_failures(v_auth_uid);

  SELECT *
  INTO attendance_record
  FROM public.hotel_staff_attendance
  WHERE staff_id = staff_record.id
    AND date = v_today
    AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT *
  INTO shift_record
  FROM public.hotel_staff_shifts
  WHERE staff_id = staff_record.id
    AND closed_at IS NULL
  ORDER BY opened_at DESC
  LIMIT 1;

  RETURN json_build_object(
    'success', true,
    'staff_id', staff_record.id,
    'first_name', staff_record.first_name,
    'last_name', staff_record.last_name,
    'role', staff_record.role,
    'allowed_hotel_routes', staff_record.allowed_hotel_routes,
    'attendance', CASE WHEN attendance_record.id IS NOT NULL THEN row_to_json(attendance_record) ELSE NULL END,
    'active_shift', CASE WHEN shift_record.id IS NOT NULL THEN row_to_json(shift_record) ELSE NULL END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_staff_pin(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.verify_waiter_pos_pin(text, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_waiter_pos_pin(text, uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_staff_can_access_table_session(target_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.hotel_table_sessions AS s
    WHERE s.id = target_session_id
      AND (
        public.is_manager_or_owner()
        OR public.current_staff_role() = 'cashier'
        OR (
          public.current_staff_role() = 'waiter'
          AND (
            s.opened_by = public.current_staff_id()
            OR EXISTS (
              SELECT 1
              FROM public.hotel_orders AS o
              WHERE o.session_id = s.id
                AND (
                  o.waiter_id = public.current_staff_id()
                  OR o.staff_id = public.current_staff_id()
                )
            )
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_staff_can_access_table_seat(target_seat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.hotel_table_session_seats AS seat
    WHERE seat.id = target_seat_id
      AND public.current_staff_can_access_table_session(seat.session_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.current_staff_can_access_payment_group(target_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.hotel_table_payment_groups AS grp
    WHERE grp.id = target_group_id
      AND public.current_staff_can_access_table_session(grp.session_id)
  )
$$;

GRANT EXECUTE ON FUNCTION public.current_staff_can_access_table_session(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_staff_can_access_table_seat(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_staff_can_access_payment_group(uuid) TO authenticated, service_role;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can manage hotel table sessions" ON public.hotel_table_sessions;
  DROP POLICY IF EXISTS "Authenticated users can manage hotel table session seats" ON public.hotel_table_session_seats;
  DROP POLICY IF EXISTS "Authenticated users can manage hotel table payment groups" ON public.hotel_table_payment_groups;
  DROP POLICY IF EXISTS "Authenticated users can manage hotel table payment group seats" ON public.hotel_table_payment_group_seats;

  DROP POLICY IF EXISTS "waiter isolation hotel_order_items select" ON public.hotel_order_items;
  DROP POLICY IF EXISTS "waiter isolation hotel_order_items insert" ON public.hotel_order_items;
  DROP POLICY IF EXISTS "waiter isolation hotel_order_items update" ON public.hotel_order_items;
  DROP POLICY IF EXISTS "Authenticated users can manage hotel order items" ON public.hotel_order_items;

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
END
$$;

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
  v_current_staff_id UUID := public.current_staff_id();
  v_current_staff_role TEXT := public.current_staff_role();
  v_resolved_opened_by UUID;
  v_resolved_shift_id UUID;
BEGIN
  IF p_table_id IS NULL THEN
    RAISE EXCEPTION 'table_id is required';
  END IF;

  IF v_current_staff_id IS NULL THEN
    RAISE EXCEPTION 'An active staff session is required to open a table session';
  END IF;

  IF NOT (public.is_manager_or_owner() OR v_current_staff_role = 'waiter') THEN
    RAISE EXCEPTION 'Only waiter or manager sessions can open a table session';
  END IF;

  v_target_guest_count := GREATEST(COALESCE(p_guest_count, 1), 1);
  v_resolved_opened_by := CASE
    WHEN public.is_manager_or_owner() AND p_opened_by IS NOT NULL THEN p_opened_by
    ELSE v_current_staff_id
  END;

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

  RETURN v_session;
END;
$$;
