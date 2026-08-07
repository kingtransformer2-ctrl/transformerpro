-- Enforce single-path hotel menu inventory deduction on order item insert.
-- Removes legacy product-linked menu stock handling and cancel-time restoration.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_service_menu'
      AND column_name = 'use_recipe'
  ) THEN
    ALTER TABLE public.hotel_service_menu
      ADD COLUMN use_recipe BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_order_items'
      AND column_name = 'inventory_deducted'
  ) THEN
    ALTER TABLE public.hotel_order_items
      ADD COLUMN inventory_deducted BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

ALTER TABLE public.hotel_service_menu
  ALTER COLUMN inventory_source_location SET DEFAULT 'kitchen';

UPDATE public.hotel_service_menu
SET
  inventory_source_location = CASE
    WHEN lower(COALESCE(inventory_source_location, '')) = 'bar' THEN 'bar'
    WHEN lower(COALESCE(category, '')) IN ('bar', 'beverages', 'minibar', 'drinks', 'cocktails') THEN 'bar'
    ELSE 'kitchen'
  END;

DO $$
DECLARE
  v_constraint RECORD;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.hotel_service_menu'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%inventory_source_location%'
  LOOP
    EXECUTE format('ALTER TABLE public.hotel_service_menu DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.hotel_service_menu'::regclass
      AND conname = 'hotel_service_menu_inventory_source_location_check'
  ) THEN
    ALTER TABLE public.hotel_service_menu
      ADD CONSTRAINT hotel_service_menu_inventory_source_location_check
      CHECK (inventory_source_location IN ('kitchen', 'bar'));
  END IF;
END $$;

ALTER TABLE public.hotel_service_menu
  DROP CONSTRAINT IF EXISTS hotel_service_menu_product_id_fkey;

ALTER TABLE public.hotel_service_menu
  DROP COLUMN IF EXISTS product_id;

UPDATE public.hotel_service_menu m
SET
  use_recipe = EXISTS (
    SELECT 1
    FROM public.hotel_service_item_recipes r
    WHERE r.service_item_id = m.id
      AND r.ingredient_id IS NOT NULL
  ),
  track_stock = COALESCE(m.track_stock, FALSE)
    OR m.direct_ingredient_id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.hotel_service_item_recipes r
      WHERE r.service_item_id = m.id
        AND r.ingredient_id IS NOT NULL
    );

UPDATE public.hotel_order_items
SET inventory_deducted = TRUE
WHERE inventory_consumed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.hotel_unlinked_order_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES public.hotel_order_items(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.hotel_orders(id) ON DELETE CASCADE,
  service_item_id UUID NULL REFERENCES public.hotel_service_menu(id) ON DELETE SET NULL,
  service_item_name TEXT NOT NULL,
  inventory_source_location TEXT NULL CHECK (inventory_source_location IS NULL OR inventory_source_location IN ('kitchen', 'bar')),
  flag_reason TEXT NOT NULL DEFAULT 'missing_inventory_link',
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID NULL,
  CONSTRAINT hotel_unlinked_order_flags_order_item_reason_key UNIQUE (order_item_id, flag_reason)
);



DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'hotel_unlinked_order_flags'
      AND policyname = 'Authenticated users can manage unlinked hotel order flags'
  ) THEN
    
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hotel_unlinked_order_flags_order_item
  ON public.hotel_unlinked_order_flags(order_item_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.sync_hotel_service_menu_display_stock(
  p_service_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_display_stock NUMERIC(12,3) := 0;
BEGIN
  SELECT
    id,
    track_stock,
    use_recipe,
    direct_ingredient_id,
    inventory_source_location
  INTO v_item
  FROM public.hotel_service_menu
  WHERE id = p_service_item_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT COALESCE(v_item.track_stock, FALSE) THEN
    UPDATE public.hotel_service_menu
    SET
      stock_quantity = 0,
      updated_at = now()
    WHERE id = p_service_item_id;
    RETURN;
  END IF;

  IF COALESCE(v_item.use_recipe, FALSE) THEN
    SELECT COALESCE(MIN(
      FLOOR(
        COALESCE(loc.quantity, 0) / NULLIF(recipe.quantity_required, 0)
      )
    ), 0)
    INTO v_display_stock
    FROM public.hotel_service_item_recipes recipe
    LEFT JOIN public.hotel_inventory_item_locations loc
      ON loc.ingredient_id = recipe.ingredient_id
     AND loc.location_code = v_item.inventory_source_location
    WHERE recipe.service_item_id = p_service_item_id
      AND recipe.ingredient_id IS NOT NULL
      AND COALESCE(recipe.quantity_required, 0) > 0;
  ELSIF v_item.direct_ingredient_id IS NOT NULL THEN
    SELECT COALESCE(loc.quantity, 0)
    INTO v_display_stock
    FROM public.hotel_inventory_item_locations loc
    WHERE loc.ingredient_id = v_item.direct_ingredient_id
      AND loc.location_code = v_item.inventory_source_location;
  ELSE
    v_display_stock := 0;
  END IF;

  UPDATE public.hotel_service_menu
  SET
    stock_quantity = COALESCE(v_display_stock, 0),
    updated_at = now()
  WHERE id = p_service_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_hotel_service_menu_display_stock_by_ingredient(
  p_ingredient_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_item RECORD;
BEGIN
  FOR v_service_item IN
    SELECT DISTINCT m.id
    FROM public.hotel_service_menu m
    LEFT JOIN public.hotel_service_item_recipes r
      ON r.service_item_id = m.id
    WHERE m.direct_ingredient_id = p_ingredient_id
       OR r.ingredient_id = p_ingredient_id
  LOOP
    PERFORM public.sync_hotel_service_menu_display_stock(v_service_item.id);
  END LOOP;
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

  PERFORM public.sync_hotel_service_menu_display_stock_by_ingredient(p_ingredient_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_service_item_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_service_item_id UUID := COALESCE(NEW.service_item_id, OLD.service_item_id);
BEGIN
  UPDATE public.hotel_service_menu sm
  SET
    purchase_price = CASE
      WHEN COALESCE(sm.use_recipe, FALSE) THEN COALESCE((
        SELECT SUM(COALESCE(r.quantity_required, 0) * COALESCE(i.purchase_price, 0))
        FROM public.hotel_service_item_recipes r
        JOIN public.hotel_ingredients i
          ON i.id = r.ingredient_id
        WHERE r.service_item_id = v_service_item_id
          AND r.ingredient_id IS NOT NULL
      ), 0)
      WHEN sm.direct_ingredient_id IS NOT NULL THEN COALESCE((
        SELECT i.purchase_price
        FROM public.hotel_ingredients i
        WHERE i.id = sm.direct_ingredient_id
      ), 0)
      ELSE COALESCE(sm.purchase_price, 0)
    END,
    updated_at = now()
  WHERE sm.id = v_service_item_id;

  PERFORM public.sync_hotel_service_menu_display_stock(v_service_item_id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_hotel_service_menu_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.hotel_service_menu sm
  SET
    purchase_price = CASE
      WHEN COALESCE(sm.use_recipe, FALSE) THEN COALESCE((
        SELECT SUM(COALESCE(r.quantity_required, 0) * COALESCE(i.purchase_price, 0))
        FROM public.hotel_service_item_recipes r
        JOIN public.hotel_ingredients i
          ON i.id = r.ingredient_id
        WHERE r.service_item_id = sm.id
          AND r.ingredient_id IS NOT NULL
      ), 0)
      WHEN sm.direct_ingredient_id IS NOT NULL THEN COALESCE((
        SELECT i.purchase_price
        FROM public.hotel_ingredients i
        WHERE i.id = sm.direct_ingredient_id
      ), 0)
      ELSE COALESCE(sm.purchase_price, 0)
    END,
    updated_at = now()
  WHERE sm.id = NEW.id;

  PERFORM public.sync_hotel_service_menu_display_stock(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_refresh_hotel_service_menu_metrics ON public.hotel_service_menu;
CREATE TRIGGER trig_refresh_hotel_service_menu_metrics
AFTER INSERT OR UPDATE OF track_stock, use_recipe, direct_ingredient_id, inventory_source_location
ON public.hotel_service_menu
FOR EACH ROW
EXECUTE FUNCTION public.refresh_hotel_service_menu_metrics();

CREATE OR REPLACE FUNCTION public.consume_hotel_inventory_location_stock_for_order(
  p_ingredient_id UUID,
  p_location_code TEXT,
  p_quantity NUMERIC,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
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
  v_movement public.hotel_ingredient_movements%ROWTYPE;
BEGIN
  BEGIN
    RETURN public.consume_hotel_inventory_location_stock(
      p_ingredient_id,
      p_location_code,
      p_quantity,
      p_reason,
      p_notes,
      NULL,
      p_reference_id,
      NULL,
      NULL,
      'menu',
      p_service_item_id,
      p_order_item_id,
      p_station
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE 'Insufficient stock%' THEN
        RAISE;
      END IF;
  END;

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

  UPDATE public.hotel_inventory_item_locations
  SET
    quantity = COALESCE(v_location.quantity, 0) - COALESCE(p_quantity, 0),
    open_unit_volume = CASE
      WHEN COALESCE(v_ingredient.is_liquid, FALSE) THEN 0
      ELSE COALESCE(v_location.open_unit_volume, 0)
    END,
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
    created_at,
    updated_at
  )
  VALUES (
    p_ingredient_id,
    'out',
    COALESCE(p_quantity, 0),
    btrim(p_reason),
    p_reference_id,
    COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''), 'Negative stock allowed on hotel order placement'),
    COALESCE(v_ingredient.purchase_price, 0),
    ROUND((COALESCE(v_ingredient.purchase_price, 0) * COALESCE(p_quantity, 0))::numeric, 2),
    p_location_code,
    p_location_code,
    NULL,
    'menu',
    p_service_item_id,
    p_order_item_id,
    p_station,
    now(),
    now()
  )
  RETURNING *
  INTO v_movement;

  RETURN v_movement;
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
  v_order_item RECORD;
  v_service_menu RECORD;
  v_recipe RECORD;
  v_location_code TEXT;
  v_total_quantity NUMERIC(12,3);
  v_deducted_any BOOLEAN := FALSE;
BEGIN
  -- First select only the order item FOR UPDATE (no joins!)
  SELECT
    id,
    order_id,
    service_item_id,
    name,
    quantity,
    station,
    inventory_deducted
  INTO v_order_item
  FROM public.hotel_order_items
  WHERE id = p_order_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Initialize service menu fields as NULL
  v_service_menu.track_stock := NULL;
  v_service_menu.use_recipe := NULL;
  v_service_menu.direct_ingredient_id := NULL;
  v_service_menu.inventory_source_location := NULL;

  -- Now get service menu details if service_item_id exists
  IF v_order_item.service_item_id IS NOT NULL THEN
    SELECT
      track_stock,
      use_recipe,
      direct_ingredient_id,
      inventory_source_location
    INTO v_service_menu
    FROM public.hotel_service_menu
    WHERE id = v_order_item.service_item_id;
  END IF;

  IF COALESCE(v_order_item.inventory_deducted, FALSE) THEN
    RETURN;
  END IF;

  v_location_code := CASE
    WHEN COALESCE(v_service_menu.inventory_source_location, '') = 'bar' THEN 'bar'
    ELSE 'kitchen'
  END;

  IF COALESCE(v_service_menu.use_recipe, FALSE)
     OR EXISTS (
       SELECT 1
       FROM public.hotel_service_item_recipes r
       WHERE r.service_item_id = v_order_item.service_item_id
         AND r.ingredient_id IS NOT NULL
     ) THEN
    FOR v_recipe IN
      SELECT ingredient_id, quantity_required
      FROM public.hotel_service_item_recipes
      WHERE service_item_id = v_order_item.service_item_id
        AND ingredient_id IS NOT NULL
    LOOP
      v_total_quantity := COALESCE(v_recipe.quantity_required, 0) * COALESCE(v_order_item.quantity, 0);

      IF v_total_quantity <= 0 THEN
        CONTINUE;
      END IF;

      v_deducted_any := TRUE;

      PERFORM public.consume_hotel_inventory_location_stock_for_order(
        v_recipe.ingredient_id,
        v_location_code,
        v_total_quantity,
        'Order placed: ' || v_order_item.name,
        'Automatic recipe deduction on order item insert',
        v_order_item.order_id,
        v_order_item.service_item_id,
        v_order_item.id,
        v_order_item.station
      );
    END LOOP;
  ELSIF v_service_menu.direct_ingredient_id IS NOT NULL THEN
    v_deducted_any := TRUE;

    PERFORM public.consume_hotel_inventory_location_stock_for_order(
      v_service_menu.direct_ingredient_id,
      v_location_code,
      COALESCE(v_order_item.quantity, 0),
      'Order placed: ' || v_order_item.name,
      'Automatic direct ingredient deduction on order item insert',
      v_order_item.order_id,
      v_order_item.service_item_id,
      v_order_item.id,
      v_order_item.station
    );
  END IF;

  IF NOT v_deducted_any THEN
    INSERT INTO public.hotel_unlinked_order_flags (
      order_item_id,
      order_id,
      service_item_id,
      service_item_name,
      inventory_source_location,
      flag_reason,
      notes
    )
    VALUES (
      v_order_item.id,
      v_order_item.order_id,
      v_order_item.service_item_id,
      v_order_item.name,
      v_location_code,
      'missing_inventory_link',
      'Order item has no recipe ingredients and no direct ingredient link. Order allowed without stock deduction.'
    )
    ON CONFLICT (order_item_id, flag_reason) DO NOTHING;
  END IF;

  UPDATE public.hotel_order_items
  SET
    inventory_deducted = TRUE,
    inventory_consumed_at = COALESCE(inventory_consumed_at, now()),
    inventory_reversed_at = NULL
  WHERE id = p_order_item_id;

  IF v_order_item.service_item_id IS NOT NULL THEN
    PERFORM public.sync_hotel_service_menu_display_stock(v_order_item.service_item_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_hotel_order_item_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.consume_hotel_order_item_inventory(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_process_hotel_order_item_inventory ON public.hotel_order_items;
CREATE TRIGGER trig_process_hotel_order_item_inventory
AFTER INSERT ON public.hotel_order_items
FOR EACH ROW
EXECUTE FUNCTION public.process_hotel_order_item_inventory();

DROP FUNCTION IF EXISTS public.restore_hotel_order_item_inventory(UUID);

DO $$
DECLARE
  v_item RECORD;
BEGIN
  FOR v_item IN
    SELECT id
    FROM public.hotel_service_menu
  LOOP
    PERFORM public.sync_hotel_service_menu_display_stock(v_item.id);
  END LOOP;
END $$;
