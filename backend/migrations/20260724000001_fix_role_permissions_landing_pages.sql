-- Fix missing landing_page values in role_permissions
-- These null values cause frontend fallback confusion and inconsistent routing

UPDATE public.role_permissions
SET landing_page = '/restaurant/finance'
WHERE role = 'accountant' AND landing_page IS NULL;

UPDATE public.role_permissions
SET landing_page = '/restaurant/waiter-pos'
WHERE role = 'waiter' AND landing_page IS NULL;

-- user role should default to dashboard as well
UPDATE public.role_permissions
SET landing_page = '/restaurant/dashboard'
WHERE role = 'user' AND landing_page IS NULL;

-- Ensure security and maintenance have landing pages if missing
UPDATE public.role_permissions
SET landing_page = '/restaurant/dashboard'
WHERE role IN ('security', 'maintenance') AND landing_page IS NULL;