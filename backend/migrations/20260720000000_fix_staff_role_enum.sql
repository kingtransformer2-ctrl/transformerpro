-- Fix staff_role enum to include all restaurant roles

-- Add new values to the enum
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'waiter';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'chef';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'barman';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'accountant';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'cashier';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'waiter_admin';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'barista';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'admin';

-- Update any existing staff with old roles that need mapping
UPDATE public.hotel_staff 
SET role = 'manager' 
WHERE role = 'receptionist' AND first_name IN ('Emily', 'David');