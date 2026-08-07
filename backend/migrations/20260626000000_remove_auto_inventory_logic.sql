-- Remove all automatic inventory deduction features and disable auto-stock tracking
-- This makes inventory management completely manual

DO $$
BEGIN
  -- Drop the auto-inventory trigger first
  DROP TRIGGER IF EXISTS trig_process_hotel_order_item_inventory ON public.hotel_order_items;
  
  -- Drop triggers related to auto-syncing display stock
  DROP TRIGGER IF EXISTS trig_refresh_hotel_service_menu_metrics ON public.hotel_service_menu;
  
  -- Drop all inventory automation functions
  DROP FUNCTION IF EXISTS public.consume_hotel_order_item_inventory(UUID);
  DROP FUNCTION IF EXISTS public.process_hotel_order_item_inventory();
  DROP FUNCTION IF EXISTS public.consume_hotel_inventory_location_stock_for_order(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID, UUID, TEXT);
  DROP FUNCTION IF EXISTS public.sync_hotel_service_menu_display_stock(UUID);
  DROP FUNCTION IF EXISTS public.sync_hotel_service_menu_display_stock_by_ingredient(UUID);
  DROP FUNCTION IF EXISTS public.sync_hotel_ingredient_stock_totals(UUID);
  DROP FUNCTION IF EXISTS public.update_service_item_cost() CASCADE;
  DROP FUNCTION IF EXISTS public.refresh_hotel_service_menu_metrics();
END $$;

-- Remove inventory-deducted column since we don't use it anymore
ALTER TABLE public.hotel_order_items DROP COLUMN IF EXISTS inventory_deducted;

-- Drop unlinked order flags table since we don't need it
DROP TABLE IF EXISTS public.hotel_unlinked_order_flags;

-- Set all track_stock to false so no auto-stock tracking happens
UPDATE public.hotel_service_menu SET track_stock = FALSE, stock_quantity = 0;
UPDATE public.hotel_ingredients SET stock_quantity = 0;

-- Clear all inventory location stock
UPDATE public.hotel_inventory_item_locations SET quantity = 0, open_unit_volume = 0, empty_units_count = 0;
