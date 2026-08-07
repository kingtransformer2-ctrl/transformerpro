BEGIN;

-- Drop existing objects from previous failed migrations
DROP TABLE IF EXISTS public.wastage_log CASCADE;
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

-- 2.1 Stores
CREATE TABLE public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (name IN ('MAIN', 'KITCHEN', 'BAR')),
  type TEXT NOT NULL CHECK (type IN ('central', 'consumption')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.2 Ingredients
CREATE TABLE public.ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  base_unit TEXT NOT NULL CHECK (base_unit IN ('kg', 'g', 'litre', 'ml', 'piece', 'leg', 'bottle', 'crate', 'bag')),
  reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0,
  reorder_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ingredients_name ON public.ingredients(name);
CREATE INDEX idx_ingredients_active ON public.ingredients(is_active);

-- 2.3 Stock Ledger
CREATE TABLE public.stock_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'PURCHASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE_DEDUCTION', 
    'WASTAGE', 'ADJUSTMENT', 'RETURN', 'OPENING'
  )),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  reference_id UUID NULL,
  reason TEXT NULL,
  performed_by UUID NOT NULL,
  approved_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_ledger_store_ingredient ON public.stock_ledger(store_id, ingredient_id, created_at DESC);
CREATE INDEX idx_stock_ledger_reference ON public.stock_ledger(reference_id);
CREATE INDEX idx_stock_ledger_type ON public.stock_ledger(transaction_type);

ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_immutable ON public.stock_ledger
  FOR ALL USING (false) WITH CHECK (false);

-- 2.4 Stock Balances
CREATE TABLE public.stock_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  qty_on_hand NUMERIC(12,3) NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, ingredient_id)
);

CREATE INDEX idx_stock_balances_store ON public.stock_balances(store_id);
CREATE INDEX idx_stock_balances_ingredient ON public.stock_balances(ingredient_id);

ALTER TABLE public.stock_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY balances_read_only ON public.stock_balances
  FOR ALL USING (false) WITH CHECK (false);

-- 2.5 Menu Items
CREATE TABLE public.menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'food',
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.6 Recipes
CREATE TABLE public.recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  qty_per_unit NUMERIC(12,3) NOT NULL CHECK (qty_per_unit > 0),
  consumed_from_store TEXT NOT NULL CHECK (consumed_from_store IN ('KITCHEN', 'BAR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(menu_item_id, ingredient_id, consumed_from_store)
);

-- 2.7 Purchases
CREATE TABLE public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name TEXT NOT NULL,
  purchased_by UUID NOT NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.8 Transfers
CREATE TABLE public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  to_store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL,
  approved_by UUID NULL,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_store_id != to_store_id)
);

CREATE TABLE public.transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.transfers(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  CHECK (quantity > 0)
);

-- 2.9 Orders
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_or_channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.10 Wastage Log
CREATE TABLE public.wastage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  reference_id UUID NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.stores (name, type) VALUES
  ('MAIN', 'central'),
  ('KITCHEN', 'consumption'),
  ('BAR', 'consumption');

-- 3. Helper Functions

CREATE OR REPLACE FUNCTION public.recalculate_stock_balance(
  p_store_id UUID, p_ingredient_id UUID
) RETURNS NUMERIC AS $$
DECLARE v_balance NUMERIC(12,3);
BEGIN
  SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('PURCHASE','TRANSFER_IN','RETURN','OPENING') THEN quantity ELSE -quantity END), 0)
  INTO v_balance FROM public.stock_ledger WHERE store_id = p_store_id AND ingredient_id = p_ingredient_id;
  RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.update_stock_balance()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.stock_balances (store_id, ingredient_id, qty_on_hand, last_updated)
  VALUES (NEW.store_id, NEW.ingredient_id, public.recalculate_stock_balance(NEW.store_id, NEW.ingredient_id), NOW())
  ON CONFLICT (store_id, ingredient_id) DO UPDATE SET 
    qty_on_hand = public.recalculate_stock_balance(NEW.store_id, NEW.ingredient_id),
    last_updated = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_stock_balance
  AFTER INSERT ON public.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_stock_balance();

CREATE OR REPLACE FUNCTION public.record_stock_ledger_entry(
  p_store_id UUID, p_ingredient_id UUID, p_transaction_type TEXT, p_quantity NUMERIC,
  p_performed_by UUID, p_reason TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL, p_approved_by UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_entry_id UUID; v_current_balance NUMERIC;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF p_transaction_type NOT IN ('PURCHASE','TRANSFER_OUT','TRANSFER_IN','SALE_DEDUCTION','WASTAGE','ADJUSTMENT','RETURN','OPENING') THEN
    RAISE EXCEPTION 'Invalid transaction type: %', p_transaction_type;
  END IF;
  IF p_transaction_type IN ('TRANSFER_OUT','SALE_DEDUCTION','WASTAGE','ADJUSTMENT','OPENING') THEN
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

CREATE OR REPLACE FUNCTION public.place_order(
  p_created_by UUID, p_table_or_channel TEXT, p_items JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB AS $$
DECLARE v_order_id UUID; v_reference_id UUID := gen_random_uuid(); v_item JSONB; v_menu_item_id UUID; v_quantity NUMERIC(12,3);
  v_recipe RECORD; v_required_qty NUMERIC(12,3); v_current_stock NUMERIC; v_short_ingredient TEXT;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Order must contain at least one item'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_menu_item_id := (v_item->>'menu_item_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN RAISE EXCEPTION 'Invalid quantity for menu item: %', v_menu_item_id; END IF;
    FOR v_recipe IN SELECT r.ingredient_id, r.qty_per_unit, r.consumed_from_store, i.name, s.id as store_id
      FROM public.recipes r JOIN public.ingredients i ON i.id = r.ingredient_id JOIN public.stores s ON s.name = r.consumed_from_store
      WHERE r.menu_item_id = v_menu_item_id LOOP
      v_required_qty := v_recipe.qty_per_unit * v_quantity;
      SELECT COALESCE(SUM(qty_on_hand), 0) INTO v_current_stock FROM public.stock_balances
       WHERE ingredient_id = v_recipe.ingredient_id AND store_id = v_recipe.store_id;
      IF v_current_stock < v_required_qty THEN
        v_short_ingredient := v_recipe.name || ' (needs ' || v_required_qty || ' ' || (SELECT base_unit FROM public.ingredients WHERE id = v_recipe.ingredient_id) || ', available: ' || v_current_stock || ')';
        RAISE EXCEPTION 'Insufficient stock: %', v_short_ingredient;
      END IF;
    END LOOP;
  END LOOP;
  INSERT INTO public.orders (table_or_channel, status, created_by, created_at) VALUES (p_table_or_channel, 'confirmed', p_created_by, NOW()) RETURNING id INTO v_order_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_menu_item_id := (v_item->>'menu_item_id')::UUID; v_quantity := (v_item->>'quantity')::NUMERIC;
    INSERT INTO public.order_items (order_id, menu_item_id, quantity, unit_price, total_price, created_at)
     VALUES (v_order_id, v_menu_item_id, v_quantity, COALESCE((SELECT price FROM public.menu_items WHERE id = v_menu_item_id), 0),
       COALESCE((SELECT price FROM public.menu_items WHERE id = v_menu_item_id), 0) * v_quantity, NOW());
    FOR v_recipe IN SELECT r.ingredient_id, r.qty_per_unit, r.consumed_from_store, s.id as store_id
      FROM public.recipes r JOIN public.stores s ON s.name = r.consumed_from_store WHERE r.menu_item_id = v_menu_item_id LOOP
      v_required_qty := v_recipe.qty_per_unit * v_quantity;
      PERFORM public.record_stock_ledger_entry(v_recipe.store_id, v_recipe.ingredient_id, 'SALE_DEDUCTION', v_required_qty, p_created_by, 'Order ' || v_order_id::TEXT, v_reference_id, NULL);
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('order_id', v_order_id, 'reference_id', v_reference_id, 'status', 'confirmed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.record_purchase(
  p_purchased_by UUID, p_items JSONB DEFAULT '[]'::jsonb, p_supplier_name TEXT DEFAULT NULL, p_purchase_date DATE DEFAULT CURRENT_DATE
) RETURNS UUID AS $$
DECLARE v_purchase_id UUID; v_main_store_id UUID; v_item JSONB; v_total_amount NUMERIC(12,2) := 0;
  v_item_qty NUMERIC; v_item_cost NUMERIC; v_ingredient_id UUID;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Purchase must contain at least one item'; END IF;
  SELECT id INTO v_main_store_id FROM public.stores WHERE name = 'MAIN' LIMIT 1;
  IF v_main_store_id IS NULL THEN RAISE EXCEPTION 'MAIN store not found'; END IF;
  INSERT INTO public.purchases (supplier_name, purchased_by, purchase_date, total_amount, created_at)
   VALUES (p_supplier_name, p_purchased_by, p_purchase_date, 0, NOW()) RETURNING id INTO v_purchase_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ingredient_id := (v_item->>'ingredient_id')::UUID; v_item_qty := (v_item->>'quantity')::NUMERIC;
    v_item_cost := COALESCE((v_item->>'unit_cost')::NUMERIC, 0);
    IF v_ingredient_id IS NULL OR v_item_qty IS NULL OR v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid purchase item: ingredient_id and positive quantity required';
    END IF;
    INSERT INTO public.purchase_items (purchase_id, ingredient_id, quantity, unit_cost, created_at)
     VALUES (v_purchase_id, v_ingredient_id, v_item_qty, v_item_cost, NOW());
    v_total_amount := v_total_amount + (v_item_qty * v_item_cost);
    PERFORM public.record_stock_ledger_entry(v_main_store_id, v_ingredient_id, 'PURCHASE', v_item_qty, p_purchased_by, 'Purchase ' || v_purchase_id::TEXT, v_purchase_id, NULL);
  END LOOP;
  UPDATE public.purchases SET total_amount = v_total_amount WHERE id = v_purchase_id;
  RETURN v_purchase_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.create_transfer(
  p_requested_by UUID, p_from_store_id UUID, p_to_store_id UUID, p_items JSONB DEFAULT '[]'::jsonb, p_approved_by UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_transfer_id UUID; v_item JSONB; v_ingredient_id UUID; v_item_qty NUMERIC;
  v_current_balance NUMERIC; v_short_ingredient TEXT;
BEGIN
  IF p_from_store_id = p_to_store_id THEN RAISE EXCEPTION 'Source and destination stores must be different'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Transfer must contain at least one item'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ingredient_id := (v_item->>'ingredient_id')::UUID;
    v_item_qty := (v_item->>'quantity')::NUMERIC;
    IF v_ingredient_id IS NULL OR v_item_qty IS NULL OR v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid transfer item: ingredient_id and positive quantity required';
    END IF;
    v_current_balance := public.recalculate_stock_balance(p_from_store_id, v_ingredient_id);
    IF v_current_balance < v_item_qty THEN
      SELECT name INTO v_short_ingredient FROM public.ingredients WHERE id = v_ingredient_id;
      RAISE EXCEPTION 'Insufficient stock in source store for %: requested %, available %', v_short_ingredient, v_item_qty, v_current_balance;
    END IF;
  END LOOP;

  INSERT INTO public.transfers (from_store_id, to_store_id, requested_by, approved_by, created_at)
   VALUES (p_from_store_id, p_to_store_id, p_requested_by, p_approved_by, NOW()) RETURNING id INTO v_transfer_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ingredient_id := (v_item->>'ingredient_id')::UUID; v_item_qty := (v_item->>'quantity')::NUMERIC;
    INSERT INTO public.transfer_items (transfer_id, ingredient_id, quantity, created_at) VALUES (v_transfer_id, v_ingredient_id, v_item_qty, NOW());
    PERFORM public.record_stock_ledger_entry(p_from_store_id, v_ingredient_id, 'TRANSFER_OUT', v_item_qty, p_requested_by, 'Transfer ' || v_transfer_id::TEXT, v_transfer_id, p_approved_by);
    PERFORM public.record_stock_ledger_entry(p_to_store_id, v_ingredient_id, 'TRANSFER_IN', v_item_qty, p_requested_by, 'Transfer ' || v_transfer_id::TEXT, v_transfer_id, p_approved_by);
  END LOOP;
  RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.record_wastage(
  p_created_by UUID, p_store_id UUID, p_ingredient_id UUID, p_quantity NUMERIC, p_reason TEXT
) RETURNS UUID AS $$
DECLARE v_wastage_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Reason is required for wastage'; END IF;
  INSERT INTO public.wastage_log (store_id, ingredient_id, quantity, reason, created_by, created_at)
   VALUES (p_store_id, p_ingredient_id, p_quantity, p_reason, p_created_by, NOW()) RETURNING id INTO v_wastage_id;
  PERFORM public.record_stock_ledger_entry(p_store_id, p_ingredient_id, 'WASTAGE', p_quantity, p_created_by, 'Wastage: ' || p_reason, v_wastage_id, NULL);
  RETURN v_wastage_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Enable RLS and Basic Policies
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wastage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingredients_read ON public.ingredients;
DROP POLICY IF EXISTS menu_items_read ON public.menu_items;
DROP POLICY IF EXISTS recipes_read ON public.recipes;
DROP POLICY IF EXISTS stock_ledger_read ON public.stock_ledger;
DROP POLICY IF EXISTS stock_balances_read ON public.stock_balances;
DROP POLICY IF EXISTS purchases_read ON public.purchases;
DROP POLICY IF EXISTS purchase_items_read ON public.purchase_items;
DROP POLICY IF EXISTS transfers_read ON public.transfers;
DROP POLICY IF EXISTS transfer_items_read ON public.transfer_items;
DROP POLICY IF EXISTS orders_read ON public.orders;
DROP POLICY IF EXISTS order_items_read ON public.order_items;
DROP POLICY IF EXISTS wastage_read ON public.wastage_log;
DROP POLICY IF EXISTS stores_read ON public.stores;

CREATE POLICY ingredients_read ON public.ingredients FOR SELECT TO authenticated USING (true);
CREATE POLICY menu_items_read ON public.menu_items FOR SELECT TO authenticated USING (true);
CREATE POLICY recipes_read ON public.recipes FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_ledger_read ON public.stock_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_balances_read ON public.stock_balances FOR SELECT TO authenticated USING (true);
CREATE POLICY purchases_read ON public.purchases FOR SELECT TO authenticated USING (true);
CREATE POLICY purchase_items_read ON public.purchase_items FOR SELECT TO authenticated USING (true);
CREATE POLICY transfers_read ON public.transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY transfer_items_read ON public.transfer_items FOR SELECT TO authenticated USING (true);
CREATE POLICY orders_read ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY order_items_read ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY wastage_read ON public.wastage_log FOR SELECT TO authenticated USING (true);
CREATE POLICY stores_read ON public.stores FOR SELECT TO authenticated USING (true);

GRANT EXECUTE ON FUNCTION public.recalculate_stock_balance(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_stock_balance() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_stock_ledger_entry(UUID, UUID, TEXT, NUMERIC, UUID, TEXT, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_order(UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_purchase(UUID, JSONB, TEXT, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_transfer(UUID, UUID, UUID, JSONB, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_wastage(UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated, service_role;

COMMIT;