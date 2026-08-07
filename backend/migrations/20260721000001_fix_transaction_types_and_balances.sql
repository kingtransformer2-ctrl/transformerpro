BEGIN;

-- 1. Drop old CHECK constraint and add new one including STOCK_IN/STOCK_OUT
ALTER TABLE public.stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_transaction_type_check;

ALTER TABLE public.stock_ledger ADD CONSTRAINT stock_ledger_transaction_type_check
  CHECK (transaction_type IN (
    'PURCHASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE_DEDUCTION',
    'WASTAGE', 'ADJUSTMENT', 'RETURN', 'OPENING', 'STOCK_IN', 'STOCK_OUT'
  ));

-- 2. Update balance recalculation to include new types
CREATE OR REPLACE FUNCTION public.recalculate_stock_balance(
  p_store_id UUID, p_ingredient_id UUID
) RETURNS NUMERIC AS $$
DECLARE v_balance NUMERIC(12,3);
BEGIN
  SELECT COALESCE(SUM(CASE
    WHEN transaction_type IN ('PURCHASE','TRANSFER_IN','RETURN','OPENING','STOCK_IN') THEN quantity
    ELSE -quantity
  END), 0)
  INTO v_balance FROM public.stock_ledger
  WHERE store_id = p_store_id AND ingredient_id = p_ingredient_id;
  RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update trigger function to handle new types
CREATE OR REPLACE FUNCTION public.update_stock_balance()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.stock_balances (store_id, ingredient_id, qty_on_hand, last_updated)
  VALUES (NEW.store_id, NEW.ingredient_id,
          public.recalculate_stock_balance(NEW.store_id, NEW.ingredient_id), NOW())
  ON CONFLICT (store_id, ingredient_id) DO UPDATE SET
    qty_on_hand = public.recalculate_stock_balance(NEW.store_id, NEW.ingredient_id),
    last_updated = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Update record_stock_ledger_entry to accept new types and validate stock_out/adjustment
CREATE OR REPLACE FUNCTION public.record_stock_ledger_entry(
  p_store_id UUID, p_ingredient_id UUID, p_transaction_type TEXT, p_quantity NUMERIC,
  p_performed_by UUID, p_reason TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL, p_approved_by UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_entry_id UUID; v_current_balance NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;
  IF p_transaction_type NOT IN (
    'PURCHASE','TRANSFER_OUT','TRANSFER_IN','SALE_DEDUCTION','WASTAGE',
    'ADJUSTMENT','RETURN','OPENING','STOCK_IN','STOCK_OUT'
  ) THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_transaction_type;
  END IF;
  -- Only validate balance for outgoing types
  IF p_transaction_type IN ('TRANSFER_OUT','SALE_DEDUCTION','WASTAGE','ADJUSTMENT','OPENING','STOCK_OUT') THEN
    v_current_balance := public.recalculate_stock_balance(p_store_id, p_ingredient_id);
    IF v_current_balance < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock. Current balance: %, requested: %', v_current_balance, p_quantity;
    END IF;
  END IF;
  INSERT INTO public.stock_ledger (
    store_id, ingredient_id, transaction_type, quantity, reason,
    reference_id, performed_by, approved_by, created_at
  ) VALUES (
    p_store_id, p_ingredient_id, p_transaction_type, p_quantity, p_reason,
    p_reference_id, p_performed_by, p_approved_by, NOW()
  )
  RETURNING id INTO v_entry_id;
  RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Recreate trigger if missing
DROP TRIGGER IF EXISTS trg_update_stock_balance ON public.stock_ledger;
CREATE TRIGGER trg_update_stock_balance
  AFTER INSERT ON public.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_stock_balance();

-- 6. Grant execute on updated functions
GRANT EXECUTE ON FUNCTION public.recalculate_stock_balance(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_stock_balance() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_stock_ledger_entry(UUID, UUID, TEXT, NUMERIC, UUID, TEXT, UUID, UUID) TO authenticated, service_role;

COMMIT;