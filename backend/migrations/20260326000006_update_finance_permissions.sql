-- Migration to add /hotel/finance to database permissions
-- Created: 2026-03-26

-- 1. Update role_permissions table
-- Add /hotel/finance to 'admin' and 'manager' roles in the role_permissions table
UPDATE public.role_permissions
SET hotel_routes = array_append(hotel_routes, '/hotel/finance')
WHERE role IN ('admin', 'manager')
AND NOT ('/hotel/finance' = ANY(hotel_routes));

-- 2. Update existing hotel_staff members
-- Add /hotel/finance to the allowed_hotel_routes array for any staff member with manager role
UPDATE public.hotel_staff
SET allowed_hotel_routes = array_append(allowed_hotel_routes, '/hotel/finance')
WHERE role = 'manager'
AND NOT ('/hotel/finance' = ANY(allowed_hotel_routes));
