
-- Comprehensive fixes for hotel staff and orders

-- 1. Ensure hotel_staff id column has gen_random_uuid() default
ALTER TABLE public.hotel_staff ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 2. Update seed special accounts to set PINs and ensure IDs match client-side constants
DO $$
DECLARE
  v_manager_user_id uuid;
  v_waiter_user_id uuid;
  v_system_user_id uuid;
  -- Client-side hardcoded UUIDs for special accounts
  c_manager_uuid constant uuid := 'a0000000-0000-4000-8000-000000000001';
  c_waiter_admin_uuid constant uuid := 'a0000000-0000-4000-8000-000000000003';
  c_system_admin_uuid constant uuid := 'a0000000-0000-4000-8000-000000000002';
BEGIN
  -- First, clear any existing PINs that conflict with our special accounts to avoid unique constraint violation
  UPDATE public.hotel_staff
  SET pin = NULL
  WHERE pin IN ('000001', '000003', '000002') AND id NOT IN (c_manager_uuid, c_waiter_admin_uuid, c_system_admin_uuid);
  
  -- Delete any existing hotel_staff rows for our special users that are not using our target UUIDs (to avoid user_id conflict)
  DELETE FROM public.hotel_staff
  WHERE user_id IN (
    SELECT id FROM app_users WHERE email IN ('admin@admin.com', 'waiter@admin.com', 'admin@system.com')
  ) AND id NOT IN (c_manager_uuid, c_waiter_admin_uuid, c_system_admin_uuid);
  -- Update or insert special accounts with fixed IDs and PINs
  -- Manager (admin@admin.com)
  INSERT INTO public.hotel_staff (
    id, user_id, first_name, last_name, email, role, is_active, shift, salary, hire_date, pin, allowed_hotel_routes, pin_failed_attempts, pin_locked_until
  )
  VALUES (
    c_manager_uuid,
    (SELECT id FROM app_users WHERE email = 'admin@admin.com'),
    'Hotel',
    'Manager',
    'admin@admin.com',
    'manager',
    true,
    'morning',
    0,
    CURRENT_DATE,
    '1234',
    ARRAY[]::text[],
    0,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    pin = CASE WHEN public.hotel_staff.pin IS NULL THEN EXCLUDED.pin ELSE public.hotel_staff.pin END;
  
  -- Waiter Admin (waiter@admin.com)
  INSERT INTO public.hotel_staff (
    id, user_id, first_name, last_name, email, role, is_active, shift, salary, hire_date, pin, allowed_hotel_routes, pin_failed_attempts, pin_locked_until
  )
  VALUES (
    c_waiter_admin_uuid,
    (SELECT id FROM app_users WHERE email = 'waiter@admin.com'),
    'Waiter',
    'Admin',
    'waiter@admin.com',
    'waiter_admin',
    true,
    'morning',
    0,
    CURRENT_DATE,
    '1235',
    ARRAY[]::text[],
    0,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    pin = CASE WHEN public.hotel_staff.pin IS NULL THEN EXCLUDED.pin ELSE public.hotel_staff.pin END;
  
  -- System Admin (admin@system.com)
  INSERT INTO public.hotel_staff (
    id, user_id, first_name, last_name, email, role, is_active, shift, salary, hire_date, pin, allowed_hotel_routes, pin_failed_attempts, pin_locked_until
  )
  VALUES (
    c_system_admin_uuid,
    (SELECT id FROM app_users WHERE email = 'admin@system.com'),
    'System',
    'Administrator',
    'admin@system.com',
    'admin',
    true,
    'morning',
    0,
    CURRENT_DATE,
    '1236',
    ARRAY[]::text[],
    0,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    pin = CASE WHEN public.hotel_staff.pin IS NULL THEN EXCLUDED.pin ELSE public.hotel_staff.pin END;
  
  RAISE NOTICE 'Special hotel staff accounts updated with fixed IDs and PINs';
END $$;

-- 3. Ensure hotel_orders has order_type column
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS order_type text DEFAULT 'dine_in';

-- 4. Ensure foreign key constraint hotel_orders_waiter_id_fkey is set properly with ON DELETE SET NULL
-- First drop existing constraint if any (to handle re-runs safely)
ALTER TABLE public.hotel_orders DROP CONSTRAINT IF EXISTS hotel_orders_waiter_id_fkey;
-- Re-add with ON DELETE SET NULL
ALTER TABLE public.hotel_orders ADD CONSTRAINT hotel_orders_waiter_id_fkey FOREIGN KEY (waiter_id) REFERENCES public.hotel_staff (id) ON DELETE SET NULL;

-- 5. Ensure foreign key constraint hotel_orders_staff_id_fkey is also set with ON DELETE SET NULL
ALTER TABLE public.hotel_orders DROP CONSTRAINT IF EXISTS hotel_orders_staff_id_fkey;
ALTER TABLE public.hotel_orders ADD CONSTRAINT hotel_orders_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.hotel_staff (id) ON DELETE SET NULL;

-- 6. Create an index on hotel_staff (is_active, id) to optimize the defensive check queries
CREATE INDEX IF NOT EXISTS idx_hotel_staff_is_active_id ON public.hotel_staff (is_active, id);
