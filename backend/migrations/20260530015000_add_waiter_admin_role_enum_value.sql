-- Ensure every role referenced anywhere in the migration chain exists
-- in the staff_role enum. Must be its own migration/transaction: ALTER TYPE
-- ... ADD VALUE cannot be used in the same transaction as code that
-- references the new value.
DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['waiter','waiter_admin','chef','barman','cashier','receptionist','housekeeping','security','maintenance','accountant','manager','owner','admin','barista']
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