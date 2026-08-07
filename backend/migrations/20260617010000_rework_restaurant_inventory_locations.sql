-- Rework restaurant inventory into store, kitchen, and bar locations.
-- Menu stock is consumed when an item is served, not when it is created.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_service_menu'
      AND column_name = 'inventory_deduction_mode'
  ) THEN
    ALTER TABLE public.hotel_service_menu
      ADD COLUMN inventory_deduction_mode TEXT NOT NULL DEFAULT 'none'
      CHECK (inventory_deduction_mode IN ('none', 'recipe', 'direct'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_service_menu'
      AND column_name = 'inventory_source_location'
  ) THEN
    ALTER TABLE public.hotel_service_menu
      ADD COLUMN inventory_source_location TEXT NOT NULL DEFAULT 'kitchen'
      CHECK (inventory_source_location IN ('main_store', 'kitchen', 'bar'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_service_menu'
      AND column_name = 'direct_ingredient_id'
  ) THEN
    ALTER TABLE public.hotel_service_menu
      ADD COLUMN direct_ingredient_id UUID REFERENCES public.hotel_ingredients(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_order_items'
      AND column_name = 'inventory_consumed_at'
  ) THEN
    ALTER TABLE public.hotel_order_items
      ADD COLUMN inventory_consumed_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_order_items'
      AND column_name = 'inventory_reversed_at'
  ) THEN
    ALTER TABLE public.hotel_order_items
      ADD COLUMN inventory_reversed_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.hotel_inventory_item_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID NOT NULL REFERENCES public.hotel_ingredients(id) ON DELETE CASCADE,
  location_code TEXT NOT NULL CHECK (location_code IN ('main_store', 'kitchen', 'bar')),
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  open_unit_volume NUMERIC(12,3) NOT NULL DEFAULT 0,
  empty_units_count INTEGER NOT NULL DEFAULT 0,
  min_stock_threshold NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hotel_inventory_item_locations_ingredient_location_key UNIQUE (ingredient_id, location_code)
);



DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'hotel_inventory_item_locations'
      AND policyname = 'Authenticated users can manage inventory locations'
  ) THEN
    
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotel_inventory_item_locations_lookup
  ON public.hotel_inventory_item_locations(ingredient_id, location_code);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'location_code'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements
      ADD COLUMN location_code TEXT CHECK (location_code IS NULL OR location_code IN ('main_store', 'kitchen', 'bar'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'from_location_code'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements
      ADD COLUMN from_location_code TEXT CHECK (from_location_code IS NULL OR from_location_code IN ('main_store', 'kitchen', 'bar'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'to_location_code'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements
      ADD COLUMN to_location_code TEXT CHECK (to_location_code IS NULL OR to_location_code IN ('main_store', 'kitchen', 'bar'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'movement_scope'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements
      ADD COLUMN movement_scope TEXT NOT NULL DEFAULT 'manual'
      CHECK (movement_scope IN ('manual', 'purchase', 'transfer', 'menu', 'waste', 'adjustment', 'return'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'service_item_id'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements
      ADD COLUMN service_item_id UUID REFERENCES public.hotel_service_menu(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'order_item_id'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements
      ADD COLUMN order_item_id UUID REFERENCES public.hotel_order_items(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredient_movements'
      AND column_name = 'station'
  ) THEN
    ALTER TABLE public.hotel_ingredient_movements
      ADD COLUMN station TEXT CHECK (station IS NULL OR station IN ('kitchen', 'bar', 'other'));
  END IF;
END $$;

ALTER TABLE public.hotel_ingredient_movements DROP CONSTRAINT IF EXISTS hotel_ingredient_movements_movement_type_check;
ALTER TABLE public.hotel_ingredient_movements
  ADD CONSTRAINT hotel_ingredient_movements_movement_type_check
  CHECK (movement_type IN ('in', 'out', 'adjustment', 'transfer'));

INSERT INTO public.hotel_inventory_item_locations (
  ingredient_id,
  location_code,
  quantity,
  open_unit_volume,
  empty_units_count,
  min_stock_threshold,
  created_at,
  updated_at
)
SELECT
  i.id,
  'main_store',
  0,
  0,
  0,
  0,
  COALESCE(i.created_at, now()),
  COALESCE(i.updated_at, now())
FROM public.hotel_ingredients i
ON CONFLICT (ingredient_id, location_code) DO NOTHING;

INSERT INTO public.hotel_inventory_item_locations (
  ingredient_id,
  location_code,
  quantity,
  open_unit_volume,
  empty_units_count,
  min_stock_threshold,
  created_at,
  updated_at
)
SELECT
  i.id,
  'kitchen',
  CASE WHEN lower(COALESCE(i.category, 'kitchen')) = 'bar' THEN 0 ELSE COALESCE(i.stock_quantity, 0) END,
  CASE WHEN lower(COALESCE(i.category, 'kitchen')) = 'bar' THEN 0 ELSE COALESCE(i.open_unit_volume, 0) END,
  CASE WHEN lower(COALESCE(i.category, 'kitchen')) = 'bar' THEN 0 ELSE COALESCE(i.empty_units_count, 0) END,
  COALESCE(i.min_stock_threshold, 0),
  COALESCE(i.created_at, now()),
  COALESCE(i.updated_at, now())
FROM public.hotel_ingredients i
ON CONFLICT (ingredient_id, location_code) DO NOTHING;

INSERT INTO public.hotel_inventory_item_locations (
  ingredient_id,
  location_code,
  quantity,
  open_unit_volume,
  empty_units_count,
  min_stock_threshold,
  created_at,
  updated_at
)
SELECT
  i.id,
  'bar',
  CASE WHEN lower(COALESCE(i.category, 'kitchen')) = 'bar' THEN COALESCE(i.stock_quantity, 0) ELSE 0 END,
  CASE WHEN lower(COALESCE(i.category, 'kitchen')) = 'bar' THEN COALESCE(i.open_unit_volume, 0) ELSE 0 END,
  CASE WHEN lower(COALESCE(i.category, 'kitchen')) = 'bar' THEN COALESCE(i.empty_units_count, 0) ELSE 0 END,
  COALESCE(i.min_stock_threshold, 0),
  COALESCE(i.created_at, now()),
  COALESCE(i.updated_at, now())
FROM public.hotel_ingredients i
ON CONFLICT (ingredient_id, location_code) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_service_categories'
      AND column_name = 'station'
  ) THEN
    UPDATE public.hotel_service_menu m
    SET inventory_source_location = COALESCE(
      (
        SELECT CASE
          WHEN lower(COALESCE(c.station, 'kitchen')) = 'bar' THEN 'bar'
          WHEN lower(COALESCE(c.station, 'kitchen')) = 'other' THEN 'main_store'
          ELSE 'kitchen'
        END
        FROM public.hotel_service_categories c
        WHERE lower(COALESCE(c.name, '')) = lower(COALESCE(m.category, ''))
        LIMIT 1
      ),
      CASE
        WHEN lower(COALESCE(m.category, '')) IN ('bar', 'beverages', 'minibar', 'drinks', 'cocktails') THEN 'bar'
        WHEN lower(COALESCE(m.category, '')) IN ('other', 'services') THEN 'main_store'
        ELSE 'kitchen'
      END
    );
  ELSE
    UPDATE public.hotel_service_menu m
    SET inventory_source_location = CASE
      WHEN lower(COALESCE(m.category, '')) IN ('bar', 'beverages', 'minibar', 'drinks', 'cocktails') THEN 'bar'
      WHEN lower(COALESCE(m.category, '')) IN ('other', 'services') THEN 'main_store'
      ELSE 'kitchen'
    END;
  END IF;
END $$;

UPDATE public.hotel_service_menu m
SET inventory_deduction_mode = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.hotel_service_item_recipes r
    WHERE r.service_item_id = m.id
  ) THEN 'recipe'
  WHEN m.direct_ingredient_id IS NOT NULL OR m.product_id IS NOT NULL OR COALESCE(m.track_stock, FALSE) THEN 'direct'
  ELSE 'none'
END;

CREATE OR REPLACE FUNCTION public.touch_hotel_inventory_location_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_hotel_inventory_item_locations_updated_at ON public.hotel_inventory_item_locations;
CREATE TRIGGER touch_hotel_inventory_item_locations_updated_at
BEFORE UPDATE ON public.hotel_inventory_item_locations
FOR EACH ROW
EXECUTE FUNCTION public.touch_hotel_inventory_location_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_hotel_inventory_location(
  p_ingredient_id UUID,
  p_location_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_location_code NOT IN ('main_store', 'kitchen', 'bar') THEN
    RAISE EXCEPTION 'Invalid inventory location: %', p_location_code;
  END IF;

  INSERT INTO public.hotel_inventory_item_locations (
    ingredient_id,
    location_code,
    quantity,
    open_unit_volume,
    empty_units_count,
    min_stock_threshold
  )
  VALUES (
    p_ingredient_id,
    p_location_code,
    0,
    0,
    0,
    0
  )
  ON CONFLICT (ingredient_id, location_code) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_hotel_ingredient_stock_totals(
  p_ingredient_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.hotel_ingredients i
  SET
    stock_quantity = COALESCE((
      SELECT SUM(l.quantity)
      FROM public.hotel_inventory_item_locations l
      WHERE l.ingredient_id = p_ingredient_id
    ), 0),
    open_unit_volume = COALESCE((
      SELECT SUM(l.open_unit_volume)
      FROM public.hotel_inventory_item_locations l
      WHERE l.ingredient_id = p_ingredient_id
    ), 0),
    empty_units_count = COALESCE((
      SELECT SUM(l.empty_units_count)
      FROM public.hotel_inventory_item_locations l
      WHERE l.ingredient_id = p_ingredient_id
    ), 0),
    updated_at = now()
  WHERE i.id = p_ingredient_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_hotel_inventory_location_stock(
  p_ingredient_id UUID,
  p_location_code TEXT,
  p_quantity NUMERIC,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_shift_id UUID DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_movement_scope TEXT DEFAULT 'manual',
  p_service_item_id UUID DEFAULT NULL,
  p_order_item_id UUID DEFAULT NULL,
  p_station TEXT DEFAULT NULL
)
RETURNS public.hotel_ingredient_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ingredient public.hotel_ingredients%ROWTYPE;
  v_location public.hotel_inventory_item_locations%ROWTYPE;
  v_unit_cost NUMERIC(12,2);
  v_requested_quantity NUMERIC(12,3);
  v_remaining_quantity NUMERIC(12,3);
  v_open_volume NUMERIC(12,3);
  v_movement public.hotel_ingredient_movements%ROWTYPE;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_location_code NOT IN ('main_store', 'kitchen', 'bar') THEN
    RAISE EXCEPTION 'Invalid inventory location: %', p_location_code;
  END IF;

  SELECT *
  INTO v_ingredient
  FROM public.hotel_ingredients
  WHERE id = p_ingredient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found';
  END IF;

  PERFORM public.ensure_hotel_inventory_location(p_ingredient_id, p_location_code);

  SELECT *
  INTO v_location
  FROM public.hotel_inventory_item_locations
  WHERE ingredient_id = p_ingredient_id
    AND location_code = p_location_code
  FOR UPDATE;

  v_unit_cost := COALESCE(p_unit_cost, v_ingredient.purchase_price, 0);
  v_requested_quantity := p_quantity;
  v_remaining_quantity := p_quantity;

  IF COALESCE(v_ingredient.is_liquid, FALSE) AND COALESCE(v_ingredient.volume_per_unit, 0) > 0 THEN
    v_open_volume := COALESCE(v_location.open_unit_volume, 0);

    IF v_open_volume > 0 THEN
      IF v_open_volume > v_remaining_quantity THEN
        v_open_volume := v_open_volume - v_remaining_quantity;
        v_remaining_quantity := 0;
      ELSE
        v_remaining_quantity := v_remaining_quantity - v_open_volume;
        v_open_volume := 0;
        IF COALESCE(v_ingredient.track_empties, FALSE) THEN
          v_location.empty_units_count := COALESCE(v_location.empty_units_count, 0) + 1;
        END IF;
      END IF;
    END IF;

    WHILE v_remaining_quantity > 0 AND COALESCE(v_location.quantity, 0) > 0 LOOP
      v_location.quantity := v_location.quantity - 1;
      v_open_volume := COALESCE(v_ingredient.volume_per_unit, 0);

      IF v_open_volume > v_remaining_quantity THEN
        v_open_volume := v_open_volume - v_remaining_quantity;
        v_remaining_quantity := 0;
      ELSE
        v_remaining_quantity := v_remaining_quantity - v_open_volume;
        v_open_volume := 0;
        IF COALESCE(v_ingredient.track_empties, FALSE) THEN
          v_location.empty_units_count := COALESCE(v_location.empty_units_count, 0) + 1;
        END IF;
      END IF;
    END LOOP;

    IF v_remaining_quantity > 0 THEN
      RAISE EXCEPTION 'Insufficient stock for ingredient % in %', v_ingredient.name, p_location_code;
    END IF;

    v_location.open_unit_volume := v_open_volume;
  ELSE
    IF COALESCE(v_location.quantity, 0) < v_requested_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for ingredient % in %', v_ingredient.name, p_location_code;
    END IF;

    v_location.quantity := COALESCE(v_location.quantity, 0) - v_requested_quantity;
  END IF;

  UPDATE public.hotel_inventory_item_locations
  SET
    quantity = COALESCE(v_location.quantity, 0),
    open_unit_volume = COALESCE(v_location.open_unit_volume, 0),
    empty_units_count = COALESCE(v_location.empty_units_count, 0),
    updated_at = now()
  WHERE id = v_location.id;

  PERFORM public.sync_hotel_ingredient_stock_totals(p_ingredient_id);

  INSERT INTO public.hotel_ingredient_movements (
    ingredient_id,
    movement_type,
    quantity,
    reason,
    reference_id,
    notes,
    unit_cost,
    total_cost,
    location_code,
    from_location_code,
    to_location_code,
    movement_scope,
    service_item_id,
    order_item_id,
    station,
    shift_id,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    p_ingredient_id,
    'out',
    v_requested_quantity,
    btrim(p_reason),
    p_reference_id,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_unit_cost,
    ROUND((v_unit_cost * v_requested_quantity)::numeric, 2),
    p_location_code,
    p_location_code,
    NULL,
    p_movement_scope,
    p_service_item_id,
    p_order_item_id,
    p_station,
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

CREATE OR REPLACE FUNCTION public.restore_hotel_inventory_location_stock(
  p_ingredient_id UUID,
  p_location_code TEXT,
  p_quantity NUMERIC,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_shift_id UUID DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_movement_scope TEXT DEFAULT 'manual',
  p_service_item_id UUID DEFAULT NULL,
  p_order_item_id UUID DEFAULT NULL,
  p_station TEXT DEFAULT NULL
)
RETURNS public.hotel_ingredient_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ingredient public.hotel_ingredients%ROWTYPE;
  v_location public.hotel_inventory_item_locations%ROWTYPE;
  v_unit_cost NUMERIC(12,2);
  v_movement public.hotel_ingredient_movements%ROWTYPE;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_location_code NOT IN ('main_store', 'kitchen', 'bar') THEN
    RAISE EXCEPTION 'Invalid inventory location: %', p_location_code;
  END IF;

  SELECT *
  INTO v_ingredient
  FROM public.hotel_ingredients
  WHERE id = p_ingredient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found';
  END IF;

  PERFORM public.ensure_hotel_inventory_location(p_ingredient_id, p_location_code);

  SELECT *
  INTO v_location
  FROM public.hotel_inventory_item_locations
  WHERE ingredient_id = p_ingredient_id
    AND location_code = p_location_code
  FOR UPDATE;

  v_unit_cost := COALESCE(p_unit_cost, v_ingredient.purchase_price, 0);

  IF COALESCE(v_ingredient.is_liquid, FALSE) AND COALESCE(v_ingredient.volume_per_unit, 0) > 0 THEN
    v_location.open_unit_volume := COALESCE(v_location.open_unit_volume, 0) + p_quantity;

    WHILE v_location.open_unit_volume >= COALESCE(v_ingredient.volume_per_unit, 0)
      AND COALESCE(v_ingredient.volume_per_unit, 0) > 0
    LOOP
      v_location.quantity := COALESCE(v_location.quantity, 0) + 1;
      v_location.open_unit_volume := v_location.open_unit_volume - COALESCE(v_ingredient.volume_per_unit, 0);
      IF COALESCE(v_ingredient.track_empties, FALSE) AND COALESCE(v_location.empty_units_count, 0) > 0 THEN
        v_location.empty_units_count := v_location.empty_units_count - 1;
      END IF;
    END LOOP;
  ELSE
    v_location.quantity := COALESCE(v_location.quantity, 0) + p_quantity;
  END IF;

  UPDATE public.hotel_inventory_item_locations
  SET
    quantity = COALESCE(v_location.quantity, 0),
    open_unit_volume = COALESCE(v_location.open_unit_volume, 0),
    empty_units_count = COALESCE(v_location.empty_units_count, 0),
    updated_at = now()
  WHERE id = v_location.id;

  PERFORM public.sync_hotel_ingredient_stock_totals(p_ingredient_id);

  INSERT INTO public.hotel_ingredient_movements (
    ingredient_id,
    movement_type,
    quantity,
    reason,
    reference_id,
    notes,
    unit_cost,
    total_cost,
    location_code,
    from_location_code,
    to_location_code,
    movement_scope,
    service_item_id,
    order_item_id,
    station,
    shift_id,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    p_ingredient_id,
    'in',
    p_quantity,
    btrim(p_reason),
    p_reference_id,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_unit_cost,
    ROUND((v_unit_cost * p_quantity)::numeric, 2),
    p_location_code,
    NULL,
    p_location_code,
    p_movement_scope,
    p_service_item_id,
    p_order_item_id,
    p_station,
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

CREATE OR REPLACE FUNCTION public.record_hotel_inventory_movement(
  p_ingredient_id UUID,
  p_movement_type TEXT,
  p_quantity NUMERIC,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_shift_id UUID DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_location_code TEXT DEFAULT NULL,
  p_from_location_code TEXT DEFAULT NULL,
  p_to_location_code TEXT DEFAULT NULL,
  p_movement_scope TEXT DEFAULT 'manual',
  p_service_item_id UUID DEFAULT NULL,
  p_order_item_id UUID DEFAULT NULL,
  p_station TEXT DEFAULT NULL
)
RETURNS public.hotel_ingredient_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ingredient public.hotel_ingredients%ROWTYPE;
  v_source_location TEXT;
  v_target_location TEXT;
  v_from_location public.hotel_inventory_item_locations%ROWTYPE;
  v_to_location public.hotel_inventory_item_locations%ROWTYPE;
  v_unit_cost NUMERIC(12,2);
  v_movement public.hotel_ingredient_movements%ROWTYPE;
BEGIN
  IF p_ingredient_id IS NULL THEN
    RAISE EXCEPTION 'Ingredient is required';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Movement reason is required';
  END IF;

  IF p_movement_type NOT IN ('in', 'out', 'adjustment', 'transfer') THEN
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

  v_unit_cost := COALESCE(p_unit_cost, v_ingredient.purchase_price, 0);

  IF p_movement_type = 'in' THEN
    v_target_location := COALESCE(p_to_location_code, p_location_code, 'main_store');
    RETURN public.restore_hotel_inventory_location_stock(
      p_ingredient_id,
      v_target_location,
      p_quantity,
      p_reason,
      p_notes,
      v_unit_cost,
      p_reference_id,
      p_shift_id,
      p_created_by,
      COALESCE(p_movement_scope, 'purchase'),
      p_service_item_id,
      p_order_item_id,
      p_station
    );
  ELSIF p_movement_type = 'out' THEN
    v_source_location := COALESCE(p_from_location_code, p_location_code, 'main_store');
    RETURN public.consume_hotel_inventory_location_stock(
      p_ingredient_id,
      v_source_location,
      p_quantity,
      p_reason,
      p_notes,
      v_unit_cost,
      p_reference_id,
      p_shift_id,
      p_created_by,
      COALESCE(p_movement_scope, 'manual'),
      p_service_item_id,
      p_order_item_id,
      p_station
    );
  ELSIF p_movement_type = 'adjustment' THEN
    v_target_location := COALESCE(p_location_code, p_to_location_code, p_from_location_code, 'main_store');

    PERFORM public.ensure_hotel_inventory_location(p_ingredient_id, v_target_location);

    UPDATE public.hotel_inventory_item_locations
    SET
      quantity = p_quantity,
      updated_at = now()
    WHERE ingredient_id = p_ingredient_id
      AND location_code = v_target_location;

    PERFORM public.sync_hotel_ingredient_stock_totals(p_ingredient_id);

    INSERT INTO public.hotel_ingredient_movements (
      ingredient_id,
      movement_type,
      quantity,
      reason,
      reference_id,
      notes,
      unit_cost,
      total_cost,
      location_code,
      from_location_code,
      to_location_code,
      movement_scope,
      service_item_id,
      order_item_id,
      station,
      shift_id,
      created_by,
      created_at,
      updated_at
    )
    VALUES (
      p_ingredient_id,
      'adjustment',
      p_quantity,
      btrim(p_reason),
      p_reference_id,
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      v_unit_cost,
      ROUND((v_unit_cost * p_quantity)::numeric, 2),
      v_target_location,
      NULL,
      v_target_location,
      COALESCE(p_movement_scope, 'adjustment'),
      p_service_item_id,
      p_order_item_id,
      p_station,
      p_shift_id,
      p_created_by,
      now(),
      now()
    )
    RETURNING *
    INTO v_movement;

    RETURN v_movement;
  ELSE
    v_source_location := COALESCE(p_from_location_code, 'main_store');
    v_target_location := COALESCE(
      p_to_location_code,
      p_location_code,
      CASE
        WHEN lower(COALESCE(v_ingredient.category, 'kitchen')) = 'bar' THEN 'bar'
        ELSE 'kitchen'
      END
    );

    IF v_source_location = v_target_location THEN
      RAISE EXCEPTION 'Transfer source and destination must be different';
    END IF;

    PERFORM public.ensure_hotel_inventory_location(p_ingredient_id, v_source_location);
    PERFORM public.ensure_hotel_inventory_location(p_ingredient_id, v_target_location);

    SELECT *
    INTO v_from_location
    FROM public.hotel_inventory_item_locations
    WHERE ingredient_id = p_ingredient_id
      AND location_code = v_source_location
    FOR UPDATE;

    SELECT *
    INTO v_to_location
    FROM public.hotel_inventory_item_locations
    WHERE ingredient_id = p_ingredient_id
      AND location_code = v_target_location
    FOR UPDATE;

    IF COALESCE(v_from_location.quantity, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock to transfer ingredient % from %', v_ingredient.name, v_source_location;
    END IF;

    UPDATE public.hotel_inventory_item_locations
    SET
      quantity = COALESCE(v_from_location.quantity, 0) - p_quantity,
      updated_at = now()
    WHERE id = v_from_location.id;

    UPDATE public.hotel_inventory_item_locations
    SET
      quantity = COALESCE(v_to_location.quantity, 0) + p_quantity,
      updated_at = now()
    WHERE id = v_to_location.id;

    PERFORM public.sync_hotel_ingredient_stock_totals(p_ingredient_id);

    INSERT INTO public.hotel_ingredient_movements (
      ingredient_id,
      movement_type,
      quantity,
      reason,
      reference_id,
      notes,
      unit_cost,
      total_cost,
      location_code,
      from_location_code,
      to_location_code,
      movement_scope,
      service_item_id,
      order_item_id,
      station,
      shift_id,
      created_by,
      created_at,
      updated_at
    )
    VALUES (
      p_ingredient_id,
      'transfer',
      p_quantity,
      btrim(p_reason),
      p_reference_id,
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      v_unit_cost,
      ROUND((v_unit_cost * p_quantity)::numeric, 2),
      v_target_location,
      v_source_location,
      v_target_location,
      COALESCE(p_movement_scope, 'transfer'),
      p_service_item_id,
      p_order_item_id,
      p_station,
      p_shift_id,
      p_created_by,
      now(),
      now()
    )
    RETURNING *
    INTO v_movement;

    RETURN v_movement;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_hotel_order_item_inventory(
  p_order_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_recipe RECORD;
  v_location_code TEXT;
  v_total_quantity NUMERIC(12,3);
BEGIN
  SELECT
    oi.id,
    oi.order_id,
    oi.service_item_id,
    oi.name,
    oi.quantity,
    oi.status,
    oi.station,
    oi.inventory_consumed_at,
    sm.track_stock,
    sm.stock_quantity,
    sm.product_id,
    sm.direct_ingredient_id,
    sm.inventory_deduction_mode,
    sm.inventory_source_location,
    sm.purchase_price
  INTO v_item
  FROM public.hotel_order_items oi
  LEFT JOIN public.hotel_service_menu sm ON sm.id = oi.service_item_id
  WHERE oi.id = p_order_item_id
  FOR UPDATE;

  IF NOT FOUND OR v_item.service_item_id IS NULL THEN
    RETURN;
  END IF;

  IF v_item.status <> 'served' OR v_item.inventory_consumed_at IS NOT NULL THEN
    RETURN;
  END IF;

  v_location_code := COALESCE(v_item.inventory_source_location, CASE
    WHEN COALESCE(v_item.station, 'kitchen') = 'bar' THEN 'bar'
    WHEN COALESCE(v_item.station, 'kitchen') = 'other' THEN 'main_store'
    ELSE 'kitchen'
  END);

  IF COALESCE(v_item.inventory_deduction_mode, 'none') = 'recipe'
     OR EXISTS (
       SELECT 1
       FROM public.hotel_service_item_recipes r
       WHERE r.service_item_id = v_item.service_item_id
     ) THEN
    FOR v_recipe IN
      SELECT ingredient_id, product_id, quantity_required
      FROM public.hotel_service_item_recipes
      WHERE service_item_id = v_item.service_item_id
    LOOP
      v_total_quantity := COALESCE(v_recipe.quantity_required, 0) * COALESCE(v_item.quantity, 0);

      IF v_total_quantity <= 0 THEN
        CONTINUE;
      END IF;

      IF v_recipe.ingredient_id IS NOT NULL THEN
        PERFORM public.consume_hotel_inventory_location_stock(
          v_recipe.ingredient_id,
          v_location_code,
          v_total_quantity,
          'Order served: ' || v_item.name,
          'Automatic menu consumption',
          NULL,
          v_item.order_id,
          NULL,
          NULL,
          'menu',
          v_item.service_item_id,
          v_item.id,
          v_item.station
        );
      ELSIF v_recipe.product_id IS NOT NULL THEN
        UPDATE public.products
        SET
          stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) - v_total_quantity),
          updated_at = now()
        WHERE id = v_recipe.product_id;

        INSERT INTO public.stock_movements (
          product_id,
          movement_type,
          quantity,
          reason,
          reference_id,
          notes,
          created_at
        )
        VALUES (
          v_recipe.product_id,
          'out',
          v_total_quantity,
          'Order served: ' || v_item.name,
          v_item.order_id,
          'Automatic menu consumption',
          now()
        );
      END IF;
    END LOOP;
  ELSIF COALESCE(v_item.inventory_deduction_mode, 'none') = 'direct' THEN
    IF v_item.direct_ingredient_id IS NOT NULL THEN
      PERFORM public.consume_hotel_inventory_location_stock(
        v_item.direct_ingredient_id,
        v_location_code,
        COALESCE(v_item.quantity, 0),
        'Order served: ' || v_item.name,
        'Automatic direct stock consumption',
        NULL,
        v_item.order_id,
        NULL,
        NULL,
        'menu',
        v_item.service_item_id,
        v_item.id,
        v_item.station
      );
    ELSIF v_item.product_id IS NOT NULL THEN
      UPDATE public.products
      SET
        stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) - COALESCE(v_item.quantity, 0)),
        updated_at = now()
      WHERE id = v_item.product_id;

      INSERT INTO public.stock_movements (
        product_id,
        movement_type,
        quantity,
        reason,
        reference_id,
        notes,
        created_at
      )
      VALUES (
        v_item.product_id,
        'out',
        COALESCE(v_item.quantity, 0),
        'Order served: ' || v_item.name,
        v_item.order_id,
        'Automatic direct stock consumption',
        now()
      );
    ELSIF COALESCE(v_item.track_stock, FALSE) THEN
      UPDATE public.hotel_service_menu
      SET
        stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) - COALESCE(v_item.quantity, 0)),
        updated_at = now()
      WHERE id = v_item.service_item_id;

      INSERT INTO public.hotel_stock_movements (
        service_item_id,
        movement_type,
        quantity,
        reason,
        reference_id,
        unit_cost,
        total_cost,
        created_at
      )
      VALUES (
        v_item.service_item_id,
        'out',
        COALESCE(v_item.quantity, 0),
        'Order served: ' || v_item.name,
        v_item.order_id,
        COALESCE(v_item.purchase_price, 0),
        ROUND((COALESCE(v_item.purchase_price, 0) * COALESCE(v_item.quantity, 0))::numeric, 2),
        now()
      );
    END IF;
  END IF;

  UPDATE public.hotel_order_items
  SET
    inventory_consumed_at = now(),
    inventory_reversed_at = NULL
  WHERE id = p_order_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_hotel_order_item_inventory(
  p_order_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_recipe RECORD;
  v_location_code TEXT;
  v_total_quantity NUMERIC(12,3);
BEGIN
  SELECT
    oi.id,
    oi.order_id,
    oi.service_item_id,
    oi.name,
    oi.quantity,
    oi.status,
    oi.station,
    oi.inventory_consumed_at,
    oi.inventory_reversed_at,
    sm.track_stock,
    sm.product_id,
    sm.direct_ingredient_id,
    sm.inventory_deduction_mode,
    sm.inventory_source_location,
    sm.purchase_price
  INTO v_item
  FROM public.hotel_order_items oi
  LEFT JOIN public.hotel_service_menu sm ON sm.id = oi.service_item_id
  WHERE oi.id = p_order_item_id
  FOR UPDATE;

  IF NOT FOUND OR v_item.service_item_id IS NULL THEN
    RETURN;
  END IF;

  IF v_item.status <> 'cancelled' OR v_item.inventory_consumed_at IS NULL OR v_item.inventory_reversed_at IS NOT NULL THEN
    RETURN;
  END IF;

  v_location_code := COALESCE(v_item.inventory_source_location, CASE
    WHEN COALESCE(v_item.station, 'kitchen') = 'bar' THEN 'bar'
    WHEN COALESCE(v_item.station, 'kitchen') = 'other' THEN 'main_store'
    ELSE 'kitchen'
  END);

  IF COALESCE(v_item.inventory_deduction_mode, 'none') = 'recipe'
     OR EXISTS (
       SELECT 1
       FROM public.hotel_service_item_recipes r
       WHERE r.service_item_id = v_item.service_item_id
     ) THEN
    FOR v_recipe IN
      SELECT ingredient_id, product_id, quantity_required
      FROM public.hotel_service_item_recipes
      WHERE service_item_id = v_item.service_item_id
    LOOP
      v_total_quantity := COALESCE(v_recipe.quantity_required, 0) * COALESCE(v_item.quantity, 0);

      IF v_total_quantity <= 0 THEN
        CONTINUE;
      END IF;

      IF v_recipe.ingredient_id IS NOT NULL THEN
        PERFORM public.restore_hotel_inventory_location_stock(
          v_recipe.ingredient_id,
          v_location_code,
          v_total_quantity,
          'Order cancelled: ' || v_item.name,
          'Automatic menu restoration',
          NULL,
          v_item.order_id,
          NULL,
          NULL,
          'return',
          v_item.service_item_id,
          v_item.id,
          v_item.station
        );
      ELSIF v_recipe.product_id IS NOT NULL THEN
        UPDATE public.products
        SET
          stock_quantity = COALESCE(stock_quantity, 0) + v_total_quantity,
          updated_at = now()
        WHERE id = v_recipe.product_id;

        INSERT INTO public.stock_movements (
          product_id,
          movement_type,
          quantity,
          reason,
          reference_id,
          notes,
          created_at
        )
        VALUES (
          v_recipe.product_id,
          'in',
          v_total_quantity,
          'Order cancelled: ' || v_item.name,
          v_item.order_id,
          'Automatic menu restoration',
          now()
        );
      END IF;
    END LOOP;
  ELSIF COALESCE(v_item.inventory_deduction_mode, 'none') = 'direct' THEN
    IF v_item.direct_ingredient_id IS NOT NULL THEN
      PERFORM public.restore_hotel_inventory_location_stock(
        v_item.direct_ingredient_id,
        v_location_code,
        COALESCE(v_item.quantity, 0),
        'Order cancelled: ' || v_item.name,
        'Automatic direct stock restoration',
        NULL,
        v_item.order_id,
        NULL,
        NULL,
        'return',
        v_item.service_item_id,
        v_item.id,
        v_item.station
      );
    ELSIF v_item.product_id IS NOT NULL THEN
      UPDATE public.products
      SET
        stock_quantity = COALESCE(stock_quantity, 0) + COALESCE(v_item.quantity, 0),
        updated_at = now()
      WHERE id = v_item.product_id;

      INSERT INTO public.stock_movements (
        product_id,
        movement_type,
        quantity,
        reason,
        reference_id,
        notes,
        created_at
      )
      VALUES (
        v_item.product_id,
        'in',
        COALESCE(v_item.quantity, 0),
        'Order cancelled: ' || v_item.name,
        v_item.order_id,
        'Automatic direct stock restoration',
        now()
      );
    ELSIF COALESCE(v_item.track_stock, FALSE) THEN
      UPDATE public.hotel_service_menu
      SET
        stock_quantity = COALESCE(stock_quantity, 0) + COALESCE(v_item.quantity, 0),
        updated_at = now()
      WHERE id = v_item.service_item_id;

      INSERT INTO public.hotel_stock_movements (
        service_item_id,
        movement_type,
        quantity,
        reason,
        reference_id,
        unit_cost,
        total_cost,
        created_at
      )
      VALUES (
        v_item.service_item_id,
        'in',
        COALESCE(v_item.quantity, 0),
        'Order cancelled: ' || v_item.name,
        v_item.order_id,
        COALESCE(v_item.purchase_price, 0),
        ROUND((COALESCE(v_item.purchase_price, 0) * COALESCE(v_item.quantity, 0))::numeric, 2),
        now()
      );
    END IF;
  END IF;

  UPDATE public.hotel_order_items
  SET inventory_reversed_at = now()
  WHERE id = p_order_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_hotel_order_item_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'served' THEN
    PERFORM public.consume_hotel_order_item_inventory(NEW.id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'served' AND COALESCE(OLD.status, '') <> 'served' THEN
      PERFORM public.consume_hotel_order_item_inventory(NEW.id);
    ELSIF NEW.status = 'cancelled' AND COALESCE(OLD.status, '') <> 'cancelled' THEN
      PERFORM public.restore_hotel_order_item_inventory(NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_process_hotel_order_item_inventory ON public.hotel_order_items;
CREATE TRIGGER trig_process_hotel_order_item_inventory
AFTER INSERT OR UPDATE OF status ON public.hotel_order_items
FOR EACH ROW
EXECUTE FUNCTION public.process_hotel_order_item_inventory();

UPDATE public.hotel_ingredients i
SET
  stock_quantity = COALESCE((
    SELECT SUM(l.quantity)
    FROM public.hotel_inventory_item_locations l
    WHERE l.ingredient_id = i.id
  ), 0),
  open_unit_volume = COALESCE((
    SELECT SUM(l.open_unit_volume)
    FROM public.hotel_inventory_item_locations l
    WHERE l.ingredient_id = i.id
  ), 0),
  empty_units_count = COALESCE((
    SELECT SUM(l.empty_units_count)
    FROM public.hotel_inventory_item_locations l
    WHERE l.ingredient_id = i.id
  ), 0),
  updated_at = now();

REVOKE EXECUTE ON FUNCTION public.ensure_hotel_inventory_location(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_hotel_ingredient_stock_totals(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_hotel_inventory_location_stock(UUID, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_hotel_inventory_location_stock(UUID, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_hotel_order_item_inventory(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_hotel_order_item_inventory(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_hotel_inventory_movement(UUID, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_hotel_inventory_movement(UUID, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT) TO authenticated, service_role;
