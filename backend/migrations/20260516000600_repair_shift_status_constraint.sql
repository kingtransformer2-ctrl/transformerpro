-- Repair shift status values and constraint after legacy lowercase variants.
-- This migration is defensive against databases that still have older logic
-- using 'active' / 'pending' / 'closed' while newer RPCs insert uppercase values.

ALTER TABLE public.hotel_staff_shifts
  DROP CONSTRAINT IF EXISTS hotel_staff_shifts_status_check;

UPDATE public.hotel_staff_shifts
SET status = CASE
  WHEN UPPER(COALESCE(status, '')) IN ('PENDING', 'ACTIVE', 'CLOSED', 'REVIEWED') THEN UPPER(status)
  WHEN LOWER(COALESCE(status, '')) = 'active' THEN 'ACTIVE'
  WHEN LOWER(COALESCE(status, '')) = 'pending' THEN 'PENDING'
  WHEN LOWER(COALESCE(status, '')) = 'closed' THEN 'CLOSED'
  WHEN LOWER(COALESCE(status, '')) = 'reviewed' THEN 'REVIEWED'
  ELSE 'CLOSED'
END;

ALTER TABLE public.hotel_staff_shifts
  ALTER COLUMN status SET DEFAULT 'PENDING';

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
  NEW.status := UPPER(COALESCE(NEW.status, 'PENDING'));

  IF NEW.closed_at IS NULL AND NEW.status IN ('ACTIVE', 'PENDING') THEN
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

  RETURN NEW;
END;
$$;
