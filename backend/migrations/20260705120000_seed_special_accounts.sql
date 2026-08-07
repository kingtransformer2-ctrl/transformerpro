-- Seed special hotel accounts
-- These are hardcoded login credentials for quick access

-- Ensure pgcrypto extension is available for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_manager_user_id uuid;
  v_waiter_user_id uuid;
  v_system_user_id uuid;
BEGIN
  -- Create manager user (admin@admin.com / 123456)
  INSERT INTO app_users (email, password_hash)
  VALUES (
    'admin@admin.com',
    crypt('123456', gen_salt('bf', 10))
  )
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  RETURNING id INTO v_manager_user_id;

  -- Ensure manager has manager role
  INSERT INTO user_roles (user_id, role)
  VALUES (v_manager_user_id, 'manager')
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  -- Create/update hotel_staff record for manager
  INSERT INTO public.hotel_staff (
    user_id, first_name, last_name, email, role, is_active, shift, salary, hire_date, pin, allowed_hotel_routes, pin_failed_attempts, pin_locked_until
  ) VALUES (
    v_manager_user_id, 'Hotel', 'Manager', 'admin@admin.com', 'manager', true, 'morning', 0, CURRENT_DATE, NULL, ARRAY[]::text[], 0, NULL
  )
  ON CONFLICT (user_id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active;

  -- Create waiter admin user (waiter@admin.com / waiter123)
  INSERT INTO app_users (email, password_hash)
  VALUES (
    'waiter@admin.com',
    crypt('waiter123', gen_salt('bf', 10))
  )
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  RETURNING id INTO v_waiter_user_id;

  -- Ensure waiter has waiter_admin role
  INSERT INTO user_roles (user_id, role)
  VALUES (v_waiter_user_id, 'waiter_admin')
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  -- Create/update hotel_staff record for waiter admin
  INSERT INTO public.hotel_staff (
    user_id, first_name, last_name, email, role, is_active, shift, salary, hire_date, pin, allowed_hotel_routes, pin_failed_attempts, pin_locked_until
  ) VALUES (
    v_waiter_user_id, 'Waiter', 'Admin', 'waiter@admin.com', 'waiter_admin', true, 'morning', 0, CURRENT_DATE, NULL, ARRAY[]::text[], 0, NULL
  )
  ON CONFLICT (user_id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active;

  -- Create system admin user (admin@system.com / admin123)
  INSERT INTO app_users (email, password_hash)
  VALUES (
    'admin@system.com',
    crypt('admin123', gen_salt('bf', 10))
  )
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  RETURNING id INTO v_system_user_id;

  -- Ensure system admin has admin role
  INSERT INTO user_roles (user_id, role)
  VALUES (v_system_user_id, 'admin')
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

  -- Create/update hotel_staff record for system admin
  INSERT INTO public.hotel_staff (
    user_id, first_name, last_name, email, role, is_active, shift, salary, hire_date, pin, allowed_hotel_routes, pin_failed_attempts, pin_locked_until
  ) VALUES (
    v_system_user_id, 'System', 'Administrator', 'admin@system.com', 'admin', true, 'morning', 0, CURRENT_DATE, NULL, ARRAY[]::text[], 0, NULL
  )
  ON CONFLICT (user_id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active;

  RAISE NOTICE 'Special accounts seeded successfully';
END $$;