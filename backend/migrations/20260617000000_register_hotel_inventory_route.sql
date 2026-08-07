-- Register the restaurant inventory page in persisted hotel route permissions

UPDATE public.role_permissions
SET hotel_routes = ARRAY(
  SELECT DISTINCT route
  FROM unnest(COALESCE(hotel_routes, ARRAY[]::text[]) || ARRAY['/restaurant/inventory']) AS route
  WHERE route IS NOT NULL
)
WHERE role IN ('admin', 'manager', 'owner');

UPDATE public.hotel_staff
SET allowed_hotel_routes = ARRAY(
  SELECT DISTINCT route
  FROM unnest(COALESCE(allowed_hotel_routes, ARRAY[]::text[]) || ARRAY['/restaurant/inventory']) AS route
  WHERE route IS NOT NULL
)
WHERE role IN ('admin', 'manager', 'owner');

CREATE OR REPLACE FUNCTION public.enforce_hotel_staff_allowed_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_routes text[];
BEGIN
  NEW.role := lower(trim(coalesce(NEW.role, '')));

  CASE NEW.role
    WHEN 'waiter' THEN
      default_routes := ARRAY['/restaurant/pos'];
    WHEN 'waiter_admin' THEN
      default_routes := ARRAY['/restaurant/pos', '/restaurant/tables'];
    WHEN 'chef' THEN
      default_routes := ARRAY['/restaurant/kitchen'];
    WHEN 'barman' THEN
      default_routes := ARRAY['/restaurant/bar'];
    WHEN 'barista' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/bar',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/menu',
        '/restaurant/tables'
      ];
    WHEN 'cashier' THEN
      default_routes := ARRAY['/restaurant/billing', '/restaurant/pos'];
    WHEN 'receptionist' THEN
      default_routes := ARRAY['/restaurant/dashboard', '/restaurant/billing', '/restaurant/pos', '/restaurant/tables'];
    WHEN 'housekeeping' THEN
      default_routes := ARRAY['/restaurant/dashboard'];
    WHEN 'security' THEN
      default_routes := ARRAY['/restaurant/dashboard'];
    WHEN 'maintenance' THEN
      default_routes := ARRAY['/restaurant/dashboard'];
    WHEN 'accountant' THEN
      default_routes := ARRAY['/restaurant/finance', '/restaurant/reports'];
    WHEN 'manager' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/tables',
        '/restaurant/menu',
        '/restaurant/inventory',
        '/restaurant/kitchen',
        '/restaurant/bar',
        '/restaurant/billing',
        '/restaurant/staff',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/finance',
        '/restaurant/reports',
        '/restaurant/settings',
        '/restaurant/customers',
        '/restaurant/products',
        '/restaurant/stock',
        '/restaurant/sales',
        '/restaurant/loans'
      ];
    WHEN 'owner' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/tables',
        '/restaurant/menu',
        '/restaurant/inventory',
        '/restaurant/kitchen',
        '/restaurant/bar',
        '/restaurant/billing',
        '/restaurant/staff',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/finance',
        '/restaurant/reports',
        '/restaurant/settings',
        '/restaurant/customers',
        '/restaurant/products',
        '/restaurant/stock',
        '/restaurant/sales',
        '/restaurant/loans'
      ];
    WHEN 'admin' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/tables',
        '/restaurant/menu',
        '/restaurant/inventory',
        '/restaurant/kitchen',
        '/restaurant/bar',
        '/restaurant/billing',
        '/restaurant/staff',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/finance',
        '/restaurant/reports',
        '/restaurant/settings',
        '/restaurant/customers',
        '/restaurant/products',
        '/restaurant/stock',
        '/restaurant/sales',
        '/restaurant/loans'
      ];
    ELSE
      default_routes := ARRAY[]::text[];
  END CASE;

  IF NEW.role = 'manager' OR NEW.role = 'owner' OR NEW.role = 'admin' THEN
    NEW.allowed_hotel_routes := ARRAY(
      SELECT DISTINCT route
      FROM unnest(COALESCE(NEW.allowed_hotel_routes, default_routes)) AS route
      WHERE route = ANY(default_routes)
    );

    IF COALESCE(array_length(NEW.allowed_hotel_routes, 1), 0) = 0 THEN
      NEW.allowed_hotel_routes := default_routes;
    END IF;
  ELSE
    NEW.allowed_hotel_routes := default_routes;
  END IF;

  RETURN NEW;
END;
$$;
