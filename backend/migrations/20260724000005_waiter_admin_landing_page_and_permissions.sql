-- Fix waiter_admin landing page and ensure proper permissions
-- Set waiter_admin landing page to /restaurant/waiter-pos
UPDATE public.role_permissions
SET landing_page = '/restaurant/waiter-pos'
WHERE role = 'waiter_admin' AND (landing_page IS NULL OR landing_page != '/restaurant/waiter-pos');

-- Ensure waiter_admin has access to necessary routes in hotel_routes
UPDATE public.role_permissions
SET hotel_routes = ARRAY[
    '/restaurant/waiter-pos',
    '/restaurant/staff',
    '/restaurant/shifts',
    '/restaurant/tables'
]::text[]
WHERE role = 'waiter_admin' AND (
    hotel_routes IS NULL OR
    NOT (hotel_routes @> ARRAY['/restaurant/waiter-pos', '/restaurant/shifts']::text[])
);
