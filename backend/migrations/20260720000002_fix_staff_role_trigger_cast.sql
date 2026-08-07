-- Fix staff role trigger to cast enum to text before trimming

CREATE OR REPLACE FUNCTION public.enforce_hotel_staff_allowed_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Cast enum to text before trimming, then cast back
  IF NEW.role IS NULL OR trim(NEW.role::text) = '' THEN
    NEW.role := 'user'::staff_role;
  ELSE
    NEW.role := trim(NEW.role::text)::staff_role;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Replace trigger
DROP TRIGGER IF EXISTS enforce_hotel_staff_allowed_routes_trigger ON public.hotel_staff;
CREATE TRIGGER enforce_hotel_staff_allowed_routes_trigger
BEFORE INSERT OR UPDATE OF role, allowed_hotel_routes
ON public.hotel_staff
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hotel_staff_allowed_routes();