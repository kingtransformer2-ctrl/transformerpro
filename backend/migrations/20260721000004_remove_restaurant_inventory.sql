BEGIN;

-- Clean up duplicate restaurant-specific inventory schema to avoid mixed logic.
-- Note: hotel inventory uses hotel_ingredients, hotel_inventory_locations, hotel_ingredient_movements.
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.transfer_items CASCADE;
DROP TABLE IF EXISTS public.transfers CASCADE;
DROP TABLE IF EXISTS public.purchase_items CASCADE;
DROP TABLE IF EXISTS public.purchases CASCADE;
DROP TABLE IF EXISTS public.recipes CASCADE;
DROP TABLE IF EXISTS public.menu_items CASCADE;
DROP TABLE IF EXISTS public.stock_balances CASCADE;
DROP TABLE IF EXISTS public.stock_ledger CASCADE;
DROP TABLE IF EXISTS public.ingredients CASCADE;
DROP TABLE IF EXISTS public.stores CASCADE;

DROP TRIGGER IF EXISTS trg_update_stock_balance ON public.stock_ledger;
DROP FUNCTION IF EXISTS public.recalculate_stock_balance(UUID, UUID);
DROP FUNCTION IF EXISTS public.update_stock_balance();
DROP FUNCTION IF EXISTS public.record_stock_ledger_entry(UUID, UUID, TEXT, NUMERIC, UUID, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.place_order(UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.record_purchase(UUID, JSONB, TEXT, DATE);
DROP FUNCTION IF EXISTS public.create_transfer(UUID, UUID, UUID, JSONB, UUID);
DROP FUNCTION IF EXISTS public.record_wastage(UUID, UUID, UUID, NUMERIC, TEXT);

COMMIT;