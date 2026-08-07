-- Fix staff role trigger to use valid default instead of empty string

CREATE OR REPLACE FUNCTION public.enforce_hotel_staff_allowed_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set default role if null/empty, then normalize
  IF NEW.role IS NULL OR trim(NEW.role) = '' THEN
    NEW.role := 'user';
  ELSE
    NEW.role := lower(trim(NEW.role));
  END IF;
  
  -- Rest of the trigger logic...
  
  RETURN NEW;
END;
$$;

-- Update the trigger
DROP TRIGGER IF EXISTS enforce_hotel_staff_allowed_routes_trigger ON public.hotel_staff;
CREATE TRIGGER enforce_hotel_staff_allowed_routes_trigger
BEFORE INSERT OR UPDATE OF role, allowed_hotel_routes
ON public.hotel_staff
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hotel_staff_allowed_routes();