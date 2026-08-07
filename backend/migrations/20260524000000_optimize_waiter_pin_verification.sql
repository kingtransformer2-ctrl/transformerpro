-- Fast waiter PIN verification for table-entry and POS unlock flows.
-- This avoids scanning unrelated staff when we already know the expected waiter,
-- and it preloads attendance + open shift in the same round-trip.

CREATE INDEX IF NOT EXISTS idx_hotel_staff_attendance_active_lookup
  ON public.hotel_staff_attendance(staff_id, date, created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_hotel_staff_shifts_open_lookup
  ON public.hotel_staff_shifts(staff_id, opened_at DESC)
  WHERE closed_at IS NULL;

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
  v_is_match boolean := false;
BEGIN
  IF staff_pin IS NULL OR staff_pin = '' THEN
    RETURN json_build_object('success', false, 'error', 'PIN is required');
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
      RETURN json_build_object('success', false, 'error', 'Invalid PIN');
    END IF;

    IF staff_record.pin_locked_until IS NOT NULL AND staff_record.pin_locked_until > v_now THEN
      IF staff_record.pin ~ '^\$2[ayb]\$.*' THEN
        v_is_match := (staff_record.pin = extensions.crypt(staff_pin, staff_record.pin));
      ELSE
        v_is_match := (staff_record.pin = staff_pin);
      END IF;

      IF v_is_match THEN
        RETURN json_build_object('success', false, 'error', 'Account is temporarily locked. Please try again in 15 minutes.');
      END IF;

      RETURN json_build_object('success', false, 'error', 'Invalid PIN');
    END IF;

    IF staff_record.pin ~ '^\$2[ayb]\$.*' THEN
      v_is_match := (staff_record.pin = extensions.crypt(staff_pin, staff_record.pin));
    ELSE
      v_is_match := (staff_record.pin = staff_pin);
    END IF;

    IF NOT v_is_match THEN
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
      IF staff_record.pin_locked_until IS NOT NULL AND staff_record.pin_locked_until > v_now THEN
        CONTINUE;
      END IF;

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
      RETURN json_build_object('success', false, 'error', 'Invalid PIN');
    END IF;
  END IF;

  UPDATE public.hotel_staff
  SET
    pin_failed_attempts = 0,
    pin_locked_until = NULL
  WHERE id = staff_record.id;

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

GRANT EXECUTE ON FUNCTION public.verify_waiter_pos_pin(text, uuid, boolean) TO anon, authenticated, service_role;
