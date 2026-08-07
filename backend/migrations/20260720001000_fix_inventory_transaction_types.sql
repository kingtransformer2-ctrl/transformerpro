-- ==========================================================
-- Fix: Add STOCK_IN and STOCK_OUT to transaction type enum
-- and create bridge between legacy and hotel inventory systems
-- ==========================================================

BEGIN;

-- 1. Fix the CHECK constraint to include STOCK_IN and STOCK_OUT
ALTER TABLE public.stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_transaction_type_check;
ALTER TABLE public.stock_ledger ADD CONSTRAINT stock_ledger_transaction_type_check 
  CHECK (transaction_type IN (
    'PURCHASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE_DEDUCTION', 
    'WASTAGE', 'ADJUSTMENT', 'RETURN', 'OPENING', 'STOCK_IN', 'STOCK_OUT'
  ));

-- 2. Fix the record_stock_ledger_entry function to accept new types
CREATE OR REPLACE FUNCTION public.record_stock_ledger_entry(
  p_store_id UUID, p_ingredient_id UUID, p_transaction_type TEXT, p_quantity NUMERIC,
  p_performed_by UUID, p_reason TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL, p_approved_by UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_entry_id UUID; v_current_balance NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF p_transaction_type NOT IN ('PURCHASE','TRANSFER_OUT','TRANSFER_IN','SALE_DEDUCTION','WASTAGE','ADJUSTMENT','RETURN','OPENING','STOCK_IN','STOCK_OUT') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_transaction_type;
  END IF;
  -- Only check balance for outgoing transactions
  IF p_transaction_type IN ('TRANSFER_OUT','SALE_DEDUCTION','WASTAGE','STOCK_OUT') THEN
    v_current_balance := public.recalculate_stock_balance(p_store_id, p_ingredient_id);
    IF v_current_balance < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock. Current balance: %, requested: %', v_current_balance, p_quantity;
    END IF;
  END IF;
  INSERT INTO public.stock_ledger (store_id, ingredient_id, transaction_type, quantity, reason, reference_id, performed_by, approved_by, created_at)
  VALUES (p_store_id, p_ingredient_id, p_transaction_type, p_quantity, p_reason, p_reference_id, p_performed_by, p_approved_by, NOW())
  RETURNING id INTO v_entry_id;
  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create a function to sync legacy stock to hotel inventory locations
CREATE OR REPLACE FUNCTION public.sync_legacy_stock_to_hotel(
  p_ingredient_id UUID,
  p_store_name TEXT DEFAULT 'MAIN'
) RETURNS JSONB AS $$
DECLARE
  v_store_id UUID;
  v_legacy_qty NUMERIC(12,3);
  v_location_code TEXT;
  v_hotel_ingredient_id UUID;
BEGIN
  -- Get store ID
  SELECT id INTO v_store_id FROM public.stores WHERE name = p_store_name;
  IF v_store_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Store not found: ' || p_store_name);
  END IF;

  -- Get legacy stock balance
  SELECT COALESCE(qty_on_hand, 0) INTO v_legacy_qty 
  FROM public.stock_balances 
  WHERE store_id = v_store_id AND ingredient_id = p_ingredient_id;

  -- Map store name to location code
  v_location_code := CASE p_store_name
    WHEN 'MAIN' THEN 'main_store'
    WHEN 'KITCHEN' THEN 'kitchen'
    WHEN 'BAR' THEN 'bar'
    ELSE 'main_store'
  END;

  -- Check if there's a matching hotel_ingredients record (by name)
  SELECT hi.id INTO v_hotel_ingredient_id 
  FROM public.hotel_ingredients hi
  JOIN public.ingredients i ON LOWER(TRIM(hi.name)) = LOWER(TRIM(i.name))
  WHERE i.id = p_ingredient_id
  LIMIT 1;

  IF v_hotel_ingredient_id IS NOT NULL THEN
    -- Upsert into hotel_inventory_item_locations
    INSERT INTO public.hotel_inventory_item_locations (ingredient_id, location_code, quantity)
    VALUES (v_hotel_ingredient_id, v_location_code, v_legacy_qty)
    ON CONFLICT (ingredient_id, location_code) 
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW();
  END IF;

  RETURN jsonb_build_object(
    'legacy_ingredient_id', p_ingredient_id,
    'hotel_ingredient_id', v_hotel_ingredient_id,
    'store', p_store_name,
    'location_code', v_location_code,
    'quantity_synced', v_legacy_qty
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create a trigger to auto-sync legacy stock_ledger to hotel inventory
CREATE OR REPLACE FUNCTION public.auto_sync_stock_to_hotel()
RETURNS TRIGGER AS $$
DECLARE
  v_store_name TEXT;
  v_hotel_ingredient_id UUID;
  v_location_code TEXT;
  v_new_balance NUMERIC(12,3);
BEGIN
  -- Get store name
  SELECT name INTO v_store_name FROM public.stores WHERE id = NEW.store_id;
  
  -- Map store name to location code
  v_location_code := CASE v_store_name
    WHEN 'MAIN' THEN 'main_store'
    WHEN 'KITCHEN' THEN 'kitchen'
    WHEN 'BAR' THEN 'bar'
    ELSE 'main_store'
  END;

  -- Find matching hotel ingredient
  SELECT hi.id INTO v_hotel_ingredient_id 
  FROM public.hotel_ingredients hi
  JOIN public.ingredients i ON LOWER(TRIM(hi.name)) = LOWER(TRIM(i.name))
  WHERE i.id = NEW.ingredient_id
  LIMIT 1;

  IF v_hotel_ingredient_id IS NOT NULL THEN
    -- Get new balance after this transaction
    v_new_balance := public.recalculate_stock_balance(NEW.store_id, NEW.ingredient_id);
    
    -- Upsert into hotel_inventory_item_locations
    INSERT INTO public.hotel_inventory_item_locations (ingredient_id, location_code, quantity)
    VALUES (v_hotel_ingredient_id, v_location_code, v_new_balance)
    ON CONFLICT (ingredient_id, location_code) 
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW();

    -- Also update hotel_ingredients total stock
    UPDATE public.hotel_ingredients 
    SET stock_quantity = (
      SELECT COALESCE(SUM(quantity), 0) 
      FROM public.hotel_inventory_item_locations 
      WHERE ingredient_id = v_hotel_ingredient_id
    ), updated_at = NOW()
    WHERE id = v_hotel_ingredient_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_sync_stock_to_hotel ON public.stock_ledger;
CREATE TRIGGER trg_auto_sync_stock_to_hotel
  AFTER INSERT ON public.stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_sync_stock_to_hotel();

-- 5. Create a function to bridge legacy place_order to hotel order system
-- This ensures when a waiter places an order, stock is deducted from BOTH systems
CREATE OR REPLACE FUNCTION public.deduct_hotel_inventory_for_order(
  p_order_id UUID,
  p_items JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB AS $$
DECLARE
  v_item JSONB;
  v_service_item_id UUID;
  v_quantity NUMERIC;
  v_service_item RECORD;
  v_recipe RECORD;
  v_ingredient_name TEXT;
  v_location_code TEXT;
  v_hotel_ingredient_id UUID;
  v_current_qty NUMERIC;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_service_item_id := (v_item->>'service_item_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    
    IF v_service_item_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      CONTINUE;
    END IF;

    -- Get service item details
    SELECT * INTO v_service_item FROM public.hotel_service_menu WHERE id = v_service_item_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- Determine location
    v_location_code := CASE 
      WHEN v_service_item.inventory_source_location = 'bar' THEN 'bar'
      ELSE 'kitchen'
    END;

    -- If use_recipe, deduct each ingredient
    IF v_service_item.use_recipe THEN
      FOR v_recipe IN 
        SELECT r.ingredient_id, r.quantity_required, hi.name as ingredient_name
        FROM public.hotel_service_item_recipes r
        JOIN public.hotel_ingredients hi ON hi.id = r.ingredient_id
        WHERE r.service_item_id = v_service_item_id
      LOOP
        -- Deduct from hotel_inventory_item_locations
        UPDATE public.hotel_inventory_item_locations 
        SET quantity = GREATEST(0, quantity - (v_recipe.quantity_required * v_quantity)),
            updated_at = NOW()
        WHERE ingredient_id = v_recipe.ingredient_id AND location_code = v_location_code;

        -- Log movement
        INSERT INTO public.hotel_ingredient_movements (
          ingredient_id, movement_type, quantity, reason, 
          location_code, movement_scope, reference_id, unit_cost, total_cost
        ) VALUES (
          v_recipe.ingredient_id, 'out', v_recipe.quantity_required * v_quantity,
          'Order deduction: ' || v_service_item.name,
          v_location_code, 'menu', p_order_id::TEXT,
          (SELECT purchase_price FROM public.hotel_ingredients WHERE id = v_recipe.ingredient_id),
          (SELECT purchase_price * (v_recipe.quantity_required * v_quantity) FROM public.hotel_ingredients WHERE id = v_recipe.ingredient_id)
        );
      END LOOP;
    ELSIF v_service_item.direct_ingredient_id IS NOT NULL THEN
      -- Direct ingredient deduction
      UPDATE public.hotel_inventory_item_locations 
      SET quantity = GREATEST(0, quantity - v_quantity),
          updated_at = NOW()
      WHERE ingredient_id = v_service_item.direct_ingredient_id AND location_code = v_location_code;

      -- Log movement
      INSERT INTO public.hotel_ingredient_movements (
        ingredient_id, movement_type, quantity, reason,
        location_code, movement_scope, reference_id, unit_cost, total_cost
      ) VALUES (
        v_service_item.direct_ingredient_id, 'out', v_quantity,
        'Order deduction: ' || v_service_item.name,
        v_location_code, 'menu', p_order_id::TEXT,
        (SELECT purchase_price FROM public.hotel_ingredients WHERE id = v_service_item.direct_ingredient_id),
        (SELECT purchase_price * v_quantity FROM public.hotel_ingredients WHERE id = v_service_item.direct_ingredient_id)
      );
    END IF;

    -- Update service menu item stock_quantity
    UPDATE public.hotel_service_menu 
    SET stock_quantity = GREATEST(0, stock_quantity - v_quantity),
        updated_at = NOW()
    WHERE id = v_service_item_id AND track_stock = true;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.sync_legacy_stock_to_hotel TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_sync_stock_to_hotel TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deduct_hotel_inventory_for_order TO authenticated, service_role;

COMMIT;