BEGIN;

-- Fix the total stock calculation: transfers should NOT change total stock
-- They only move stock between locations, so they are neutral for total
CREATE OR REPLACE FUNCTION public.update_hotel_ingredient_total_stock(
  p_ingredient_id UUID
) RETURNS VOID AS $$
DECLARE v_total NUMERIC(12,3);
BEGIN
  SELECT COALESCE(SUM(
    CASE 
      WHEN movement_type IN ('in', 'adjustment') THEN quantity
      WHEN movement_type = 'transfer' THEN 0  -- transfers are neutral for total stock
      WHEN movement_type = 'out' THEN -quantity  -- 'out' reduces stock
      ELSE 0
    END
  ), 0) INTO v_total
  FROM public.hotel_ingredient_movements
  WHERE ingredient_id = p_ingredient_id;
  
  UPDATE public.hotel_ingredients
  SET stock_quantity = v_total, updated_at = NOW()
  WHERE id = p_ingredient_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix recalculate_location_stock to include 'out' movements (they were missing!)
CREATE OR REPLACE FUNCTION public.recalculate_location_stock(
  p_ingredient_id UUID,
  p_location_code TEXT
) RETURNS NUMERIC AS $$
DECLARE v_stock NUMERIC(12,3);
BEGIN
  SELECT COALESCE(SUM(
    CASE 
      WHEN movement_type IN ('in', 'adjustment') AND location_code = p_location_code THEN quantity
      WHEN movement_type = 'transfer' AND from_location_code = p_location_code THEN -quantity
      WHEN movement_type = 'transfer' AND to_location_code = p_location_code THEN quantity
      WHEN movement_type = 'out' AND location_code = p_location_code THEN -quantity
      ELSE 0
    END
  ), 0) INTO v_stock
  FROM public.hotel_ingredient_movements
  WHERE ingredient_id = p_ingredient_id
    AND (
      location_code = p_location_code
      OR from_location_code = p_location_code
      OR to_location_code = p_location_code
    );
  RETURN v_stock;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recalculate all existing total stock values to fix corrupted data
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN SELECT DISTINCT ingredient_id FROM public.hotel_ingredient_movements LOOP
    PERFORM public.update_hotel_ingredient_total_stock(rec.ingredient_id);
  END LOOP;
END $$;

-- Recalculate all location stocks from scratch
DO $$
DECLARE rec RECORD;
  v_main_store NUMERIC;
  v_kitchen NUMERIC;
  v_bar NUMERIC;
BEGIN
  FOR rec IN SELECT DISTINCT ingredient_id FROM public.hotel_ingredient_movements LOOP
    v_main_store := public.recalculate_location_stock(rec.ingredient_id, 'main_store');
    v_kitchen := public.recalculate_location_stock(rec.ingredient_id, 'kitchen');
    v_bar := public.recalculate_location_stock(rec.ingredient_id, 'bar');
    
    -- Upsert main_store
    INSERT INTO public.hotel_inventory_item_locations (ingredient_id, location_code, quantity, updated_at)
    VALUES (rec.ingredient_id, 'main_store', v_main_store, NOW())
    ON CONFLICT (ingredient_id, location_code)
    DO UPDATE SET quantity = v_main_store, updated_at = NOW();
    
    -- Upsert kitchen
    INSERT INTO public.hotel_inventory_item_locations (ingredient_id, location_code, quantity, updated_at)
    VALUES (rec.ingredient_id, 'kitchen', v_kitchen, NOW())
    ON CONFLICT (ingredient_id, location_code)
    DO UPDATE SET quantity = v_kitchen, updated_at = NOW();
    
    -- Upsert bar
    INSERT INTO public.hotel_inventory_item_locations (ingredient_id, location_code, quantity, updated_at)
    VALUES (rec.ingredient_id, 'bar', v_bar, NOW())
    ON CONFLICT (ingredient_id, location_code)
    DO UPDATE SET quantity = v_bar, updated_at = NOW();
  END LOOP;
END $$;

COMMIT;