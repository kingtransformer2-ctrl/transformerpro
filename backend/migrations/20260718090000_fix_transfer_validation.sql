-- ==========================================================
-- Fix Transfer Validation
-- Date: 2026-07-18
-- Description: Ensures transfers validate stock BEFORE creating
-- transfer records to prevent orphaned/fake transfers.
-- ==========================================================

BEGIN;

-- Drop and recreate create_transfer with proper validation
DROP FUNCTION IF EXISTS public.create_transfer(UUID, UUID, UUID, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.create_transfer(
  p_requested_by UUID,
  p_from_store_id UUID,
  p_to_store_id UUID,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_approved_by UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_transfer_id UUID;
  v_item JSONB;
  v_ingredient_id UUID;
  v_item_qty NUMERIC;
  v_current_balance NUMERIC;
  v_short_ingredient TEXT;
BEGIN
  -- Validate inputs
  IF p_from_store_id = p_to_store_id THEN
    RAISE EXCEPTION 'Source and destination stores must be different';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Transfer must contain at least one item';
  END IF;

  -- FIRST: Validate all items have sufficient stock BEFORE creating transfer
  -- This prevents orphaned transfer records
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_ingredient_id := (v_item->>'ingredient_id')::UUID;
    v_item_qty := (v_item->>'quantity')::NUMERIC;

    IF v_ingredient_id IS NULL OR v_item_qty IS NULL OR v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid transfer item: ingredient_id and positive quantity required';
    END IF;

    -- Check current stock balance
    v_current_balance := public.recalculate_stock_balance(p_from_store_id, v_ingredient_id);
    
    IF v_current_balance < v_item_qty THEN
      -- Get ingredient name for error message
      SELECT name INTO v_short_ingredient 
      FROM public.ingredients 
      WHERE id = v_ingredient_id;
      
      RAISE EXCEPTION 'Insufficient stock in source store for %: requested %, available %', 
        v_short_ingredient, v_item_qty, v_current_balance;
    END IF;
  END LOOP;

  -- SECOND: All validations passed, now create the transfer
  INSERT INTO public.transfers (from_store_id, to_store_id, requested_by, approved_by, created_at)
  VALUES (p_from_store_id, p_to_store_id, p_requested_by, p_approved_by, NOW())
  RETURNING id INTO v_transfer_id;

  -- THIRD: Create transfer items and ledger entries
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_ingredient_id := (v_item->>'ingredient_id')::UUID;
    v_item_qty := (v_item->>'quantity')::NUMERIC;

    -- Insert transfer item
    INSERT INTO public.transfer_items (transfer_id, ingredient_id, quantity, created_at)
    VALUES (v_transfer_id, v_ingredient_id, v_item_qty, NOW());

    -- Create TRANSFER_OUT ledger entry (from source store)
    PERFORM public.record_stock_ledger_entry(
      p_from_store_id,
      v_ingredient_id,
      'TRANSFER_OUT',
      v_item_qty,
      p_requested_by,
      'Transfer ' || v_transfer_id::TEXT,
      v_transfer_id,
      p_approved_by
    );

    -- Create TRANSFER_IN ledger entry (to destination store)
    PERFORM public.record_stock_ledger_entry(
      p_to_store_id,
      v_ingredient_id,
      'TRANSFER_IN',
      v_item_qty,
      p_requested_by,
      'Transfer ' || v_transfer_id::TEXT,
      v_transfer_id,
      p_approved_by
    );
  END LOOP;

  RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.create_transfer(UUID, UUID, UUID, JSONB, UUID) TO authenticated, service_role;

COMMIT;