
-- 1. Enable pgcrypto extension for secure hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Add 'waiter' to the staff_role enum
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'waiter';

-- 3. Update/Add columns for secure PIN management
ALTER TABLE public.hotel_staff 
  ADD COLUMN IF NOT EXISTS pin text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS allowed_hotel_routes text[] DEFAULT '{}'::text[];

-- 4. Create a trigger to automatically hash PINs when they are set or changed
CREATE OR REPLACE FUNCTION public.hash_hotel_staff_pin()
RETURNS trigger AS $$
BEGIN
  IF NEW.pin IS NOT NULL AND (OLD.pin IS NULL OR NEW.pin <> OLD.pin) THEN
    -- Only hash if it's not already a crypt hash
    IF NEW.pin !~ '^\$2[ayb]\$.*' THEN
      NEW.pin := crypt(NEW.pin, gen_salt('bf', 10));
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_hash_hotel_staff_pin ON public.hotel_staff;
CREATE TRIGGER trigger_hash_hotel_staff_pin
  BEFORE INSERT OR UPDATE OF pin ON public.hotel_staff
  FOR EACH ROW
  EXECUTE FUNCTION public.hash_hotel_staff_pin();

-- 5. Create a secure function to verify staff PIN with rate limiting
CREATE OR REPLACE FUNCTION public.verify_staff_pin(staff_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff_record record;
  v_now timestamptz := now();
BEGIN
  -- Basic validation
  IF staff_pin IS NULL OR staff_pin = '' THEN
    RETURN json_build_object('success', false, 'error', 'PIN is required');
  END IF;
  
  -- Find the staff member
  SELECT id, first_name, last_name, role, is_active, allowed_hotel_routes, pin, pin_failed_attempts, pin_locked_until
  INTO staff_record
  FROM public.hotel_staff
  WHERE is_active = true
    AND pin IS NOT NULL
  ORDER BY id -- Stability
  LIMIT 10; -- Check a few if multiple (though PIN should be unique)

  -- Since PINs are unique but we don't have the ID yet, we must iterate or find by PIN
  -- But we can't find by hashed PIN directly. We need to find the specific staff member.
  -- Wait, the login UI doesn't send a staff_id, it only sends a PIN.
  -- This means we must check the PIN against ALL active staff.
  
  FOR staff_record IN 
    SELECT id, first_name, last_name, role, is_active, allowed_hotel_routes, pin, pin_failed_attempts, pin_locked_until
    FROM public.hotel_staff
    WHERE is_active = true AND pin IS NOT NULL
  LOOP
    -- Check if locked
    IF staff_record.pin_locked_until IS NOT NULL AND staff_record.pin_locked_until > v_now THEN
      CONTINUE; -- Skip locked accounts
    END IF;

    -- Verify PIN
    IF staff_record.pin = crypt(staff_pin, staff_record.pin) THEN
      -- Success: Reset failed attempts
      UPDATE public.hotel_staff 
      SET pin_failed_attempts = 0, 
          pin_locked_until = NULL 
      WHERE id = staff_record.id;

      RETURN json_build_object(
        'success', true,
        'staff_id', staff_record.id,
        'first_name', staff_record.first_name,
        'last_name', staff_record.last_name,
        'role', staff_record.role,
        'allowed_hotel_routes', staff_record.allowed_hotel_routes
      );
    ELSE
      -- Failure: Increment attempts
      UPDATE public.hotel_staff 
      SET pin_failed_attempts = pin_failed_attempts + 1,
          pin_locked_until = CASE 
            WHEN pin_failed_attempts + 1 >= 5 THEN v_now + interval '15 minutes'
            ELSE NULL 
          END
      WHERE id = staff_record.id;
    END IF;
  END LOOP;
  
  RETURN json_build_object('success', false, 'error', 'Invalid PIN or account locked');
END;
$$;
