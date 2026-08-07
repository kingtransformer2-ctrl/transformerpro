-- Migration to add landing_page to role_permissions and seed waiter_admin role
-- Created: 2026-05-29

-- 1. Add landing_page column to role_permissions
ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS landing_page TEXT;

-- 2. Update existing system roles with default landing pages
UPDATE public.role_permissions
SET landing_page = '/restaurant/dashboard'
WHERE role IN ('admin', 'manager', 'cashier') AND landing_page IS NULL;

-- 3. Create 'waiter_admin' role if it doesn't exist
INSERT INTO public.role_permissions (role, pos_routes, hotel_routes, landing_page, description, is_system)
VALUES (
    'waiter_admin', 
    ARRAY['/restaurant/pos', '/restaurant/tables'],
    ARRAY['/hotel/pos', '/hotel/tables'],
    '/restaurant/pos',
    'Special role for waiter stations - goes directly to POS table selection',
    true
)
ON CONFLICT (role) DO UPDATE 
SET landing_page = '/restaurant/pos',
    description = 'Special role for waiter stations - goes directly to POS table selection',
    pos_routes = ARRAY['/restaurant/pos', '/restaurant/tables'],
    hotel_routes = ARRAY['/hotel/pos', '/hotel/tables'];
