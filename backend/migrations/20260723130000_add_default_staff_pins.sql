-- Set default PINs for seeded hotel staff accounts
UPDATE public.hotel_staff
SET pin = '000001'
WHERE email = 'admin@admin.com';

UPDATE public.hotel_staff
SET pin = '000003'
WHERE email = 'waiter@admin.com';

UPDATE public.hotel_staff
SET pin = '000002'
WHERE email = 'admin@system.com';

-- Verify the update
SELECT email, role, pin FROM public.hotel_staff WHERE email IN ('admin@admin.com', 'waiter@admin.com', 'admin@system.com');
