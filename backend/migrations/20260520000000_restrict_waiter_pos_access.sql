-- Restrict waiter access to the table-entry -> PIN -> hotel POS workflow only.

INSERT INTO public.role_permissions (role, pos_routes, hotel_routes, is_system, description)
VALUES (
  'waiter',
  ARRAY[]::text[],
  ARRAY['/hotel/pos'],
  true,
  'Waiter access limited to table entry and hotel POS ordering'
)
ON CONFLICT (role) DO UPDATE
SET
  pos_routes = EXCLUDED.pos_routes,
  hotel_routes = EXCLUDED.hotel_routes,
  is_system = COALESCE(public.role_permissions.is_system, EXCLUDED.is_system),
  description = EXCLUDED.description,
  updated_at = now();

UPDATE public.hotel_staff
SET
  allowed_hotel_routes = ARRAY['/hotel/pos'],
  updated_at = now()
WHERE role = 'waiter';
