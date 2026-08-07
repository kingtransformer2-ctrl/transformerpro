-- Hotel and restaurant inventory management hardening
-- Adds richer ingredient metadata, crate logistics support,
-- and a single atomic movement RPC for stock adjustments.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredients'
      AND column_name = 'sku'
  ) THEN
    ALTER TABLE public.hotel_ingredients ADD COLUMN sku TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredients'
      AND column_name = 'supplier_name'
  ) THEN
    ALTER TABLE public.hotel_ingredients ADD COLUMN supplier_name TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredients'
      AND column_name = 'storage_area'
  ) THEN
    ALTER TABLE public.hotel_ingredients ADD COLUMN storage_area TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredients'
      AND column_name = 'reorder_quantity'
  ) THEN
    ALTER TABLE public.hotel_ingredients ADD COLUMN reorder_quantity NUMERIC(12,3) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredients'
      AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.hotel_ingredients ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'unit_cost'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements ADD COLUMN unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'total_cost'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements ADD COLUMN total_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'shift_id'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements
      ADD COLUMN shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements
      ADD COLUMN created_by UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_bar_crates'
      AND column_name = 'notes'
  ) THEN
    ALTER TABLE public.hotel_bar_crates ADD COLUMN notes TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_bar_crates'
      AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.hotel_bar_crates ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_bar_crates'
      AND column_name = 'min_full_threshold'
  ) THEN
    ALTER TABLE public.hotel_bar_crates ADD COLUMN min_full_threshold INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_bar_crates'
      AND column_name = 'min_empty_threshold'
  ) THEN
    ALTER TABLE public.hotel_bar_crates ADD COLUMN min_empty_threshold INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

UPDATE public.hotel_ingredient_movements m
SET
  unit_cost = COALESCE(m.unit_cost, i.purchase_price, 0),
  total_cost = CASE
    WHEN COALESCE(m.total_cost, 0) = 0 THEN COALESCE(m.quantity, 0) * COALESCE(m.unit_cost, i.purchase_price, 0)
    ELSE m.total_cost
  END,
  updated_at = COALESCE(m.updated_at, m.created_at, now())
FROM public.hotel_ingredients i
WHERE i.id = m.ingredient_id;

CREATE INDEX IF NOT EXISTS idx_hotel_ingredients_category_active
  ON public.hotel_ingredients(category, is_active);

CREATE INDEX IF NOT EXISTS idx_hotel_ingredients_supplier_name
  ON public.hotel_ingredients(supplier_name);

CREATE INDEX IF NOT EXISTS idx_hotel_ingredient_movements_ingredient_created
  ON public.hotel_ingredient_movements(ingredient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hotel_ingredient_movements_shift_id
  ON public.hotel_ingredient_movements(shift_id);

CREATE INDEX IF NOT EXISTS idx_hotel_bar_crates_ingredient_active
  ON public.hotel_bar_crates(ingredient_id, is_active);

CREATE OR REPLACE FUNCTION public.touch_hotel_inventory_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_hotel_ingredients_updated_at ON public.hotel_ingredients;
CREATE TRIGGER touch_hotel_ingredients_updated_at
BEFORE UPDATE ON public.hotel_ingredients
FOR EACH ROW
EXECUTE FUNCTION public.touch_hotel_inventory_updated_at();

DROP TRIGGER IF EXISTS touch_hotel_ingredient_movements_updated_at ON public.hotel_ingredient_movements;
CREATE TRIGGER touch_hotel_ingredient_movements_updated_at
BEFORE UPDATE ON public.hotel_ingredient_movements
FOR EACH ROW
EXECUTE FUNCTION public.touch_hotel_inventory_updated_at();

DROP TRIGGER IF EXISTS touch_hotel_bar_crates_updated_at ON public.hotel_bar_crates;
CREATE TRIGGER touch_hotel_bar_crates_updated_at
BEFORE UPDATE ON public.hotel_bar_crates
FOR EACH ROW
EXECUTE FUNCTION public.touch_hotel_inventory_updated_at();

CREATE OR REPLACE FUNCTION public.record_hotel_inventory_movement(
  p_ingredient_id UUID,
  p_movement_type TEXT,
  p_quantity NUMERIC,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_shift_id UUID DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS public.hotel_ingredient_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ingredient public.hotel_ingredients%ROWTYPE;
  v_effective_cost NUMERIC(12,2);
  v_new_stock NUMERIC(12,3);
  v_movement public.hotel_ingredient_movements%ROWTYPE;
BEGIN
  IF p_ingredient_id IS NULL THEN
    RAISE EXCEPTION 'Ingredient is required';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Movement reason is required';
  END IF;

  IF p_movement_type NOT IN ('in', 'out', 'adjustment') THEN
    RAISE EXCEPTION 'Invalid movement type: %', p_movement_type;
  END IF;

  IF p_quantity IS NULL OR p_quantity < 0 THEN
    RAISE EXCEPTION 'Quantity must be zero or greater';
  END IF;

  SELECT *
  INTO v_ingredient
  FROM public.hotel_ingredients
  WHERE id = p_ingredient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found';
  END IF;

  IF COALESCE(v_ingredient.is_active, TRUE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Inactive ingredients cannot receive stock movements';
  END IF;

  v_effective_cost := COALESCE(p_unit_cost, v_ingredient.purchase_price, 0);

  IF p_movement_type = 'in' THEN
    v_new_stock := COALESCE(v_ingredient.stock_quantity, 0) + p_quantity;
  ELSIF p_movement_type = 'out' THEN
    IF COALESCE(v_ingredient.stock_quantity, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for ingredient %', v_ingredient.name;
    END IF;

    v_new_stock := COALESCE(v_ingredient.stock_quantity, 0) - p_quantity;
  ELSE
    v_new_stock := p_quantity;
  END IF;

  UPDATE public.hotel_ingredients
  SET
    stock_quantity = v_new_stock,
    purchase_price = CASE
      WHEN p_movement_type = 'in' AND p_unit_cost IS NOT NULL THEN p_unit_cost
      ELSE purchase_price
    END,
    updated_at = now()
  WHERE id = p_ingredient_id;

  INSERT INTO public.hotel_ingredient_movements (
    ingredient_id,
    movement_type,
    quantity,
    reason,
    reference_id,
    notes,
    unit_cost,
    total_cost,
    shift_id,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    p_ingredient_id,
    p_movement_type,
    p_quantity,
    btrim(p_reason),
    p_reference_id,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_effective_cost,
    ROUND((v_effective_cost * p_quantity)::numeric, 2),
    p_shift_id,
    p_created_by,
    now(),
    now()
  )
  RETURNING *
  INTO v_movement;

  RETURN v_movement;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_hotel_inventory_movement(UUID, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_hotel_inventory_movement(UUID, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, UUID, UUID, UUID) TO authenticated, service_role;
