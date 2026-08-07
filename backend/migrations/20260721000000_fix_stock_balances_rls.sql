BEGIN;

-- Drop the overly restrictive policies that block all access
DROP POLICY IF EXISTS balances_read_only ON public.stock_balances;
DROP POLICY IF EXISTS ledger_immutable ON public.stock_ledger;

-- The read policies already exist and allow authenticated users to read
-- (created in 20260719000000_simple_restaurant_inventory.sql)
-- stock_balances_read - allows SELECT for authenticated users
-- stock_ledger_read - allows SELECT for authenticated users

COMMIT;