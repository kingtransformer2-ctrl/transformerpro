-- Final verification of the complete authentication and authorization audit
-- Run this to confirm all fixes are in place

-- 1. Verify no orphaned hotel_orders
SELECT 'ORPHANED_ORDERS' as check_name, COUNT(*) as count FROM public.hotel_orders 
WHERE waiter_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.hotel_staff WHERE id = hotel_orders.waiter_id)
   OR staff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.hotel_staff WHERE id = hotel_orders.staff_id);

-- 2. Verify all staff have required fields
SELECT 'STAFF_MISSING_REQUIRED' as check_name, COUNT(*) as count FROM public.hotel_staff 
WHERE id IS NULL OR pin IS NULL OR role IS NULL OR is_active IS NULL;

-- 3. Verify role_permissions landing pages
SELECT 'LANDING_PAGE_MISSING' as check_name, role, landing_page FROM public.role_permissions 
WHERE landing_page IS NULL ORDER BY role;

-- 4. Verify staff allowed routes populated
SELECT 'STAFF_MISSING_ROUTES' as check_name, COUNT(*) as count FROM public.hotel_staff 
WHERE allowed_hotel_routes IS NULL OR array_length(allowed_hotel_routes, 1) IS NULL;

-- 5. Verify PIN storage consistency
SELECT 'PIN_STORAGE_MIX' as check_name, 
  COUNT(*) FILTER (WHERE pin LIKE '$2a$%' OR pin LIKE '$2b$%' OR pin LIKE '$2y$%') as hashed,
  COUNT(*) FILTER (WHERE pin IS NOT NULL AND pin NOT LIKE '$2a$%' AND pin NOT LIKE '$2b$%' AND pin NOT LIKE '$2y$%') as plaintext,
  COUNT(*) as total
FROM public.hotel_staff WHERE pin IS NOT NULL;

-- 6. Summary of all staff
SELECT 'STAFF_SUMMARY' as check_name, role, COUNT(*) as count, 
  COUNT(*) FILTER (WHERE is_active = true) as active,
  COUNT(*) FILTER (WHERE pin IS NOT NULL) as has_pin,
  COUNT(*) FILTER (WHERE allowed_hotel_routes IS NOT NULL AND array_length(allowed_hotel_routes, 1) > 0) as has_routes
FROM public.hotel_staff GROUP BY role ORDER BY role;