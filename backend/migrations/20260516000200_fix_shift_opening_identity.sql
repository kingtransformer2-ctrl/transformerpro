-- Fix shift opening to respect PIN-login session identity
CREATE OR REPLACE FUNCTION public.open_hotel_staff_shift(
  p_shift_label text DEFAULT NULL,
  p_opening_cash numeric DEFAULT 0,
  p_opening_notes text DEFAULT NULL
)
RETURNS public.hotel_staff_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_staff_id uuid;
  v_staff_role public.staff_role;
  existing_shift public.hotel_staff_shifts;
  created_shift public.hotel_staff_shifts;
BEGIN
  -- 1. Try to get identity from session-scoped staff (PIN login)
  v_staff_id := public.current_staff_id();
  
  -- 2. Fallback to deriving from auth.uid() if no session variable is set
  IF v_staff_id IS NULL THEN
    SELECT id, role INTO v_staff_id, v_staff_role
    FROM public.hotel_staff
    WHERE user_id = v_auth_uid AND is_active = true
    LIMIT 1;
  ELSE
    -- If we have a session staff_id, load their role
    SELECT role INTO v_staff_role FROM public.hotel_staff WHERE id = v_staff_id;
  END IF;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User is not mapped to an active staff member.'
      USING ERRCODE = '42501';
  END IF;

  -- Match the database unique constraint exactly
  SELECT * INTO existing_shift FROM public.hotel_staff_shifts
  WHERE staff_id = v_staff_id AND closed_at IS NULL 
  ORDER BY opened_at DESC LIMIT 1;

  -- If an open shift exists, return it
  IF FOUND THEN 
    IF existing_shift.status NOT IN ('ACTIVE', 'PENDING') THEN
      UPDATE public.hotel_staff_shifts SET status = 'ACTIVE' WHERE id = existing_shift.id;
      existing_shift.status := 'ACTIVE';
    END IF;
    RETURN existing_shift; 
  END IF;

  -- Otherwise create a new one
  INSERT INTO public.hotel_staff_shifts (
    staff_id, staff_role, shift_label, status, 
    opening_cash, opening_notes, opened_at, started_at
  )
  VALUES (
    v_staff_id, v_staff_role, COALESCE(NULLIF(BTRIM(p_shift_label), ''), 'general'),
    'ACTIVE', COALESCE(p_opening_cash, 0), NULLIF(BTRIM(COALESCE(p_opening_notes, '')), ''),
    now(), now()
  )
  RETURNING * INTO created_shift;

  RETURN created_shift;
END;
$$;
