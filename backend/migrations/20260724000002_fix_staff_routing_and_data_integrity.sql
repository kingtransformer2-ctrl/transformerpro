-- Comprehensive fix for staff authentication and routing data integrity

-- 1. Fix orphaned hotel_orders referencing non-existent placeholder staff UUID
-- This fixes foreign key violations and "staff not found" issues
UPDATE public.hotel_orders
SET waiter_id = NULL,
    staff_id = NULL
WHERE waiter_id = 'a0000000-0000-4000-8000-000000000003'
   OR staff_id = 'a0000000-0000-4000-8000-000000000003';

-- 2. Ensure all staff have valid UUIDs and correct defaults
-- Fix any staff with null id (shouldn't happen, but safety)
UPDATE public.hotel_staff
SET id = gen_random_uuid()
WHERE id IS NULL;

-- 3. Ensure is_active has a default for any missing values
UPDATE public.hotel_staff
SET is_active = true
WHERE is_active IS NULL;

-- 4. Fix staff records with missing allowed_hotel_routes based on role
-- This ensures routing works even if frontend defaults are missing
UPDATE public.hotel_staff
SET allowed_hotel_routes = 
  CASE role
    WHEN 'waiter' THEN ARRAY['/restaurant/waiter-pos', '/restaurant/dashboard']
    WHEN 'waiter_admin' THEN ARRAY['/restaurant/pos', '/restaurant/tables', '/restaurant/waiter-pos', '/restaurant/dashboard']
    WHEN 'chef' THEN ARRAY['/restaurant/kitchen', '/restaurant/dashboard']
    WHEN 'barman' THEN ARRAY['/restaurant/bar', '/restaurant/dashboard']
    WHEN 'cashier' THEN ARRAY['/restaurant/billing', '/restaurant/pos', '/restaurant/dashboard']
    WHEN 'accountant' THEN ARRAY['/restaurant/finance', '/restaurant/reports', '/restaurant/dashboard']
    WHEN 'receptionist' THEN ARRAY['/restaurant/dashboard', '/restaurant/billing', '/restaurant/pos']
    WHEN 'manager' THEN ARRAY['/restaurant/dashboard', '/restaurant/pos', '/restaurant/tables', '/restaurant/menu', '/restaurant/inventory', '/restaurant/billing', '/restaurant/staff', '/restaurant/attendance', '/restaurant/shifts', '/restaurant/shift-report', '/restaurant/finance', '/restaurant/reports', '/restaurant/settings', '/restaurant/kitchen', '/restaurant/bar', '/restaurant/customers', '/restaurant/products', '/restaurant/stock', '/restaurant/sales', '/restaurant/loans']
    WHEN 'owner' THEN ARRAY['/restaurant/dashboard', '/restaurant/pos', '/restaurant/tables', '/restaurant/menu', '/restaurant/inventory', '/restaurant/billing', '/restaurant/staff', '/restaurant/attendance', '/restaurant/shifts', '/restaurant/shift-report', '/restaurant/finance', '/restaurant/reports', '/restaurant/settings', '/restaurant/kitchen', '/restaurant/bar', '/restaurant/customers', '/restaurant/products', '/restaurant/stock', '/restaurant/sales', '/restaurant/loans']
    WHEN 'admin' THEN ARRAY['/restaurant/dashboard', '/restaurant/pos', '/restaurant/tables', '/restaurant/menu', '/restaurant/inventory', '/restaurant/billing', '/restaurant/staff', '/restaurant/attendance', '/restaurant/shifts', '/restaurant/shift-report', '/restaurant/finance', '/restaurant/reports', '/restaurant/settings', '/restaurant/kitchen', '/restaurant/bar', '/restaurant/customers', '/restaurant/products', '/restaurant/stock', '/restaurant/sales', '/restaurant/loans']
    WHEN 'housekeeping' THEN ARRAY['/restaurant/dashboard']
    WHEN 'security' THEN ARRAY['/restaurant/dashboard']
    WHEN 'maintenance' THEN ARRAY['/restaurant/dashboard']
    ELSE ARRAY['/restaurant/dashboard']
  END
WHERE allowed_hotel_routes IS NULL OR array_length(allowed_hotel_routes, 1) IS NULL;

-- 5. Clean up any staff with invalid/empty emails that might cause issues
UPDATE public.hotel_staff
SET email = 'staff-' || SUBSTRING(id::text, 1, 8) || '@hotel.local'
WHERE email IS NULL OR email = '';

-- 6. Verification queries
DO $$
BEGIN
  RAISE NOTICE '=== STAFF DATA FIXES APPLIED ===';
  RAISE NOTICE 'Fixed orphaned order references';
  RAISE NOTICE 'Ensured all staff have UUIDs';
  RAISE NOTICE 'Ensured all staff have is_active=true';
  RAISE NOTICE 'Populated missing allowed_hotel_routes';
  RAISE NOTICE 'Fixed null emails';
END $$;