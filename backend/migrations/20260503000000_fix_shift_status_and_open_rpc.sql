-- Fix conflicting shift status logic and provide a canonical server-side
-- shift opening function so the client no longer has to guess the schema.

-- 1. Drop the old constraint FIRST
ALTER TABLE public.hotel_staff_shifts
  DROP CONSTRAINT IF EXISTS hotel_staff_shifts_status_check;

-- 2. Force ALL rows to have a valid UPPERCASE status
-- We use a CASE statement to ensure every single row is mapped correctly
-- Any row that doesn't match 'active', 'pending', or 'closed' will be set to 'CLOSED' as a safe default
UPDATE public.hotel_staff_shifts
SET status = CASE 
  WHEN UPPER(status) IN ('ACTIVE', 'PENDING') THEN UPPER(status)
  ELSE 'CLOSED'
END;

-- 3. Add the new constraint with strict UPPER case values
ALTER TABLE public.hotel_staff_shifts
  ADD CONSTRAINT hotel_staff_shifts_status_check
  CHECK (status IN ('PENDING', 'ACTIVE', 'CLOSED', 'REVIEWED'));

CREATE OR REPLACE FUNCTION public.ensure_single_active_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.closed_at IS NULL AND UPPER(COALESCE(NEW.status, '')) IN ('ACTIVE', 'PENDING') THEN
    IF EXISTS (
      SELECT 1
      FROM public.hotel_staff_shifts
      WHERE staff_id = NEW.staff_id
        AND closed_at IS NULL
        AND UPPER(COALESCE(status, '')) IN ('ACTIVE', 'PENDING')
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      RAISE EXCEPTION 'Staff member already has an open shift. Close the existing shift first.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  NEW.status := UPPER(COALESCE(NEW.status, 'PENDING'));
  RETURN NEW;
END;
$$;

-- 5. Create/Update the open_hotel_staff_shift RPC
-- We use TEXT for p_staff_role to ensure compatibility with JS calls
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
  v_role public.staff_role;
BEGIN
  -- Convert input text to the enum type safely
  v_role := p_staff_role::public.staff_role;

  -- CRITICAL FIX: Check for ANY shift where closed_at IS NULL.
  -- This exactly matches the likely unique constraint logic.
  SELECT * INTO existing_shift FROM public.hotel_staff_shifts
  WHERE staff_id = p_staff_id AND closed_at IS NULL 
  ORDER BY opened_at DESC LIMIT 1;

  IF FOUND THEN 
    -- If it's not ACTIVE/PENDING, force it to ACTIVE to satisfy the application
    IF existing_shift.status NOT IN ('ACTIVE', 'PENDING') THEN
      UPDATE public.hotel_staff_shifts 
      SET status = 'ACTIVE' 
      WHERE id = existing_shift.id 
      RETURNING * INTO existing_shift;
    END IF;
    RETURN existing_shift; 
  END IF;

  -- Create new shift
  INSERT INTO public.hotel_staff_shifts (
    staff_id, staff_role, shift_label, status, 
    opening_cash, opening_notes, opened_at, started_at
  )
  VALUES (
    p_staff_id, v_role, COALESCE(NULLIF(BTRIM(p_shift_label), ''), 'general'),
    'ACTIVE', COALESCE(p_opening_cash, 0), NULLIF(BTRIM(COALESCE(p_opening_notes, '')), ''),
    now(), now()
  )
  RETURNING * INTO created_shift;

  RETURN created_shift;
END;
$$;

-- 6. Grants - be very explicit and grant to ALL roles
GRANT EXECUTE ON FUNCTION public.open_hotel_staff_shift(uuid, text, text, numeric, text) TO anon;
GRANT EXECUTE ON FUNCTION public.open_hotel_staff_shift(uuid, text, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_hotel_staff_shift(uuid, text, text, numeric, text) TO service_role;
