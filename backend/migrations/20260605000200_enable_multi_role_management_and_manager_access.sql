CREATE OR REPLACE FUNCTION public.enforce_hotel_staff_allowed_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  manager_like_allowed_routes text[] := ARRAY[
    '/hotel',
    '/hotel/restaurant-dashboard',
    '/hotel/pos',
    '/hotel/tables',
    '/hotel/service-menu',
    '/hotel/billing',
    '/hotel/rooms',
    '/hotel/bookings',
    '/hotel/bookings/new',
    '/hotel/check-in-out',
    '/hotel/guests',
    '/hotel/housekeeping',
    '/hotel/staff',
    '/hotel/attendance',
    '/hotel/shifts',
    '/hotel/shift-report',
    '/hotel/finance',
    '/hotel/reports',
    '/hotel/settings',
    '/hotel/kitchen',
    '/hotel/bar'
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
      NEW.allowed_hotel_routes := ARRAY(
        SELECT DISTINCT route
        FROM unnest(manager_like_allowed_routes || COALESCE(NEW.allowed_hotel_routes, ARRAY[]::text[])) AS route
        ORDER BY route
      );
    WHEN 'owner' THEN
      NEW.allowed_hotel_routes := ARRAY(
        SELECT DISTINCT route
        FROM unnest(manager_like_allowed_routes || COALESCE(NEW.allowed_hotel_routes, ARRAY[]::text[])) AS route
        ORDER BY route
      );
    WHEN 'admin' THEN
      NEW.allowed_hotel_routes := ARRAY(
        SELECT DISTINCT route
        FROM unnest(manager_like_allowed_routes || COALESCE(NEW.allowed_hotel_routes, ARRAY[]::text[])) AS route
        ORDER BY route
      );
    ELSE
      NEW.allowed_hotel_routes := COALESCE(NEW.allowed_hotel_routes, ARRAY[]::text[]);
  END CASE;

  RETURN NEW;
END;
$$;

ALTER TABLE public.user_roles
DROP CONSTRAINT IF EXISTS user_roles_user_id_key;

ALTER TABLE public.user_roles
ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);

CREATE OR REPLACE FUNCTION public.safe_update_user_role(
  target_user_id uuid,
  new_role text,
  reason text DEFAULT NULL,
  ip_address text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_exists boolean;
  old_roles text;
BEGIN
  IF target_user_id IS NULL OR new_role IS NULL OR btrim(new_role) = '' THEN
    RAISE EXCEPTION 'User ID and role are required';
  END IF;

  new_role := lower(trim(new_role));

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role = new_role
  ) THEN
    RAISE EXCEPTION 'Invalid role specified: %', new_role;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Access denied. Only managers or administrators can modify user roles.';
  END IF;

  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot modify your own role for security reasons';
  END IF;

  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = target_user_id)
  INTO target_user_exists;

  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;

  SELECT string_agg(role, ', ' ORDER BY role)
  INTO old_roles
  FROM public.user_roles
  WHERE user_id = target_user_id;

  INSERT INTO public.user_role_audit (
    changed_by,
    target_user_id,
    old_role,
    new_role,
    reason,
    ip_address,
    user_agent
  ) VALUES (
    auth.uid(),
    target_user_id,
    old_roles,
    new_role,
    COALESCE(reason, 'Role added via management interface'),
    ip_address,
    user_agent
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, new_role)
  ON CONFLICT (user_id, role) DO UPDATE
  SET updated_at = now();

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.safe_remove_user_role(
  target_user_id uuid,
  target_role text,
  reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_role_count integer;
  old_roles text;
BEGIN
  IF target_user_id IS NULL OR target_role IS NULL OR btrim(target_role) = '' THEN
    RAISE EXCEPTION 'User ID and role are required';
  END IF;

  target_role := lower(trim(target_role));

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Access denied. Only managers or administrators can modify user roles.';
  END IF;

  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot modify your own role for security reasons';
  END IF;

  SELECT string_agg(role, ', ' ORDER BY role), count(*)
  INTO old_roles, existing_role_count
  FROM public.user_roles
  WHERE user_id = target_user_id;

  IF existing_role_count IS NULL OR existing_role_count = 0 THEN
    RETURN true;
  END IF;

  IF existing_role_count = 1 AND EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = target_user_id
      AND role = target_role
  ) THEN
    RAISE EXCEPTION 'A user must keep at least one role';
  END IF;

  INSERT INTO public.user_role_audit (
    changed_by,
    target_user_id,
    old_role,
    new_role,
    reason
  ) VALUES (
    auth.uid(),
    target_user_id,
    old_roles,
    NULL,
    COALESCE(reason, format('Role removed: %s', target_role))
  );

  DELETE FROM public.user_roles
  WHERE user_id = target_user_id
    AND role = target_role;

  RETURN true;
END;
$$;

UPDATE public.role_permissions
SET hotel_routes = ARRAY[
  '/hotel',
  '/hotel/restaurant-dashboard',
  '/hotel/settings',
  '/hotel/staff',
  '/hotel/attendance',
  '/hotel/shifts',
  '/hotel/shift-report',
  '/hotel/reports',
  '/hotel/billing',
  '/hotel/service-menu',
  '/hotel/pos',
  '/hotel/rooms',
  '/hotel/tables',
  '/hotel/bookings',
  '/hotel/bookings/new',
  '/hotel/check-in-out',
  '/hotel/guests',
  '/hotel/housekeeping',
  '/hotel/finance',
  '/hotel/kitchen',
  '/hotel/bar'
],
updated_at = now()
WHERE role IN ('manager', 'owner', 'admin');

UPDATE public.hotel_staff
SET allowed_hotel_routes = ARRAY(
  SELECT DISTINCT route
  FROM unnest(COALESCE(allowed_hotel_routes, ARRAY[]::text[]) || ARRAY[
    '/hotel',
    '/hotel/restaurant-dashboard',
    '/hotel/pos',
    '/hotel/tables',
    '/hotel/service-menu',
    '/hotel/billing',
    '/hotel/rooms',
    '/hotel/bookings',
    '/hotel/bookings/new',
    '/hotel/check-in-out',
    '/hotel/guests',
    '/hotel/housekeeping',
    '/hotel/staff',
    '/hotel/attendance',
    '/hotel/shifts',
    '/hotel/shift-report',
    '/hotel/finance',
    '/hotel/reports',
    '/hotel/settings',
    '/hotel/kitchen',
    '/hotel/bar'
  ]::text[]) AS route
  ORDER BY route
)
WHERE role IN ('manager', 'owner', 'admin');