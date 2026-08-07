-- Fix shift opening for PIN-based staff sessions.
-- Supabase RPC requests are stateless, so we cannot rely on set_config()
-- from a previous request to identify the active staff member here.

CREATE OR REPLACE FUNCTION public.open_hotel_staff_shift(
  p_staff_id uuid,
  p_staff_role text,
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
  existing_shift public.hotel_staff_shifts;
  created_shift public.hotel_staff_shifts;
  v_staff_id uuid;
  v_staff_role public.staff_role;
BEGIN
  IF p_staff_id IS NULL THEN
    RAISE EXCEPTION 'Staff identity is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, role
  INTO v_staff_id, v_staff_role
  FROM public.hotel_staff
  WHERE id = p_staff_id
    AND is_active = true
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User is not mapped to an active staff member.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO existing_shift
  FROM public.hotel_staff_shifts
  WHERE staff_id = v_staff_id
    AND closed_at IS NULL
  ORDER BY opened_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF existing_shift.status NOT IN ('ACTIVE', 'PENDING') THEN
      UPDATE public.hotel_staff_shifts
      SET status = 'ACTIVE'
      WHERE id = existing_shift.id
      RETURNING * INTO existing_shift;
    END IF;

    RETURN existing_shift;
  END IF;

  INSERT INTO public.hotel_staff_shifts (
    staff_id,
    staff_role,
    shift_label,
    status,
    opening_cash,
    opening_notes,
    opened_at,
    started_at
  )
  VALUES (
    v_staff_id,
    v_staff_role,
    COALESCE(NULLIF(BTRIM(p_shift_label), ''), 'general'),
    'ACTIVE',
    COALESCE(p_opening_cash, 0),
    NULLIF(BTRIM(COALESCE(p_opening_notes, '')), ''),
    now(),
    now()
  )
  RETURNING * INTO created_shift;

  RETURN created_shift;
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_hotel_staff_shift(uuid, text, text, numeric, text) TO authenticated, service_role;
