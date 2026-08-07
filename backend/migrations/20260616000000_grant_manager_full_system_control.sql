-- Promote manager/owner/admin to the same top-level control tier.
-- This keeps existing policies based on public.is_admin() working while
-- allowing managers to perform full system-management operations.


CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'manager', 'owner')
  );
$$;

UPDATE public.role_permissions
SET
  pos_routes = ARRAY[
    '/owner',
    '/settings',
    '/reports',
    '/stock',
    '/products',
    '/loans',
    '/',
    '/pos',
    '/sales',
    '/customers',
    '/scanner',
    '/notifications'
  ]::text[],
  hotel_routes = ARRAY[
    '/restaurant/dashboard',
    '/restaurant/pos',
    '/restaurant/tables',
    '/restaurant/menu',
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
  ]::text[],
  landing_page = COALESCE(landing_page, '/restaurant/dashboard'),
  updated_at = now()
WHERE role IN ('admin', 'manager', 'owner');

UPDATE public.hotel_staff
SET allowed_hotel_routes = ARRAY[
  '/restaurant/dashboard',
  '/restaurant/pos',
  '/restaurant/tables',
  '/restaurant/menu',
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
]::text[]
WHERE role IN ('admin', 'manager', 'owner');

