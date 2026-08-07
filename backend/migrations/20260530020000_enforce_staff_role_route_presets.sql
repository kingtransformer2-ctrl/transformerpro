CREATE OR REPLACE FUNCTION public.enforce_hotel_staff_allowed_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  manager_allowed_routes text[] := ARRAY[
    '/hotel/restaurant-dashboard',
    '/hotel/pos',
    '/hotel/tables',
    '/hotel/service-menu',
    '/hotel/billing',
    '/hotel/staff',
    '/hotel/attendance',
    '/hotel/shifts',
    '/hotel/shift-report',
    '/hotel/finance',
    '/hotel/reports',
    '/hotel/settings'
  ];
  v_role_text text;
BEGIN
  v_role_text := lower(trim(coalesce(NEW.role::text, '')));
  IF v_role_text <> '' THEN
    NEW.role := v_role_text::public.staff_role;
  END IF;
  CASE NEW.role
    WHEN 'waiter' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/pos'];
    WHEN 'waiter_admin' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/pos'];
    WHEN 'chef' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/kitchen'];
    WHEN 'barman' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/bar'];
    WHEN 'cashier' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/billing', '/hotel/pos'];
    WHEN 'receptionist' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/restaurant-dashboard', '/hotel/billing', '/hotel/pos', '/hotel/tables'];
    WHEN 'housekeeping' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/restaurant-dashboard'];
    WHEN 'security' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/restaurant-dashboard'];
    WHEN 'maintenance' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/restaurant-dashboard'];
    WHEN 'accountant' THEN
      NEW.allowed_hotel_routes := ARRAY['/hotel/finance', '/hotel/reports'];
    WHEN 'manager' THEN
      SELECT COALESCE(
        ARRAY_AGG(route ORDER BY array_position(manager_allowed_routes, route)),
        ARRAY[]::text[]
      )
      INTO NEW.allowed_hotel_routes
      FROM (
        SELECT DISTINCT route
        FROM unnest(COALESCE(NEW.allowed_hotel_routes, ARRAY[]::text[])) AS route
        WHERE route = ANY(manager_allowed_routes)
      ) AS filtered_routes;
      IF COALESCE(array_length(NEW.allowed_hotel_routes, 1), 0) = 0 THEN
        NEW.allowed_hotel_routes := manager_allowed_routes;
      END IF;
    ELSE
      NEW.allowed_hotel_routes := COALESCE(NEW.allowed_hotel_routes, ARRAY[]::text[]);
  END CASE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_hotel_staff_allowed_routes_trigger ON public.hotel_staff;
CREATE TRIGGER enforce_hotel_staff_allowed_routes_trigger
BEFORE INSERT OR UPDATE OF role, allowed_hotel_routes
ON public.hotel_staff
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hotel_staff_allowed_routes();
UPDATE public.hotel_staff
SET allowed_hotel_routes = COALESCE(allowed_hotel_routes, ARRAY[]::text[]);