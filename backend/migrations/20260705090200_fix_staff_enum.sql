-- Fix staff_role enum to include all roles used by the frontend
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'manager',
    'receptionist', 
    'housekeeping',
    'security',
    'maintenance',
    'waiter',
    'waiter_admin',
    'accountant',
    'cashier',
    'chef',
    'barman',
    'owner',
    'admin',
    'barista'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'staff_role' AND e.enumlabel = v_role
    ) THEN
      EXECUTE format('ALTER TYPE public.staff_role ADD VALUE %L', v_role);
    END IF;
  END LOOP;
END
$$;