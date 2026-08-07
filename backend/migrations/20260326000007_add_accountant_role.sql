-- Migration to add 'accountant' to the staff_role enum
-- Created: 2026-03-26

DO $$ 
BEGIN
    ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'accountant';
EXCEPTION
    WHEN others THEN NULL;
END $$;

-- Add default permissions for accountant role
INSERT INTO public.role_permissions (role, pos_routes, hotel_routes, description)
VALUES (
    'accountant', 
    ARRAY['/reports', '/loans', '/sales', '/customers'],
    ARRAY['/hotel/finance', '/hotel/billing', '/hotel/reports'],
    'Financial and accounting access'
)
ON CONFLICT (role) DO UPDATE 
SET hotel_routes = array_append(public.role_permissions.hotel_routes, '/hotel/finance')
WHERE NOT ('/hotel/finance' = ANY(public.role_permissions.hotel_routes));
