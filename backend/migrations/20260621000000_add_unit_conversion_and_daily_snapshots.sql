-- Add unit conversion fields to hotel_ingredients
DO $$
BEGIN
  -- Bulk unit configuration
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredients'
      AND column_name = 'bulk_unit'
  ) THEN
    ALTER TABLE public.hotel_ingredients
    ADD COLUMN bulk_unit TEXT DEFAULT 'pcs';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredients'
      AND column_name = 'bulk_to_base_quantity'
  ) THEN
    ALTER TABLE public.hotel_ingredients
    ADD COLUMN bulk_to_base_quantity NUMERIC(12,3) DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredients'
      AND column_name = 'base_unit'
  ) THEN
    ALTER TABLE public.hotel_ingredients
    ADD COLUMN base_unit TEXT DEFAULT 'pcs';
  END IF;

  -- Purchase price per bulk unit
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hotel_ingredients'
      AND column_name = 'purchase_price_per_bulk_unit'
  ) THEN
    ALTER TABLE public.hotel_ingredients
    ADD COLUMN purchase_price_per_bulk_unit NUMERIC(12,2) DEFAULT 0;
  END IF;
END $$;

-- Create daily opening stock snapshot table
CREATE TABLE IF NOT EXISTS public.hotel_inventory_daily_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID NOT NULL REFERENCES public.hotel_ingredients(id) ON DELETE CASCADE,
  location_code TEXT NOT NULL CHECK (location_code IN ('main_store', 'kitchen', 'bar')),
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  opening_quantity NUMERIC(12,3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hotel_inventory_snapshot_unique UNIQUE (ingredient_id, location_code, snapshot_date)
);

-- Enable RLS


-- Create RLS policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'hotel_inventory_daily_snapshots'
      AND policyname = 'Authenticated users can manage inventory snapshots'
  ) THEN
    
  END IF;
END $$;

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_hotel_inventory_snapshots_lookup
  ON public.hotel_inventory_daily_snapshots(ingredient_id, location_code, snapshot_date);

-- Create function to record daily opening stock
CREATE OR REPLACE FUNCTION public.record_daily_opening_stock(
  p_ingredient_id UUID,
  p_location_code TEXT,
  p_snapshot_date DATE DEFAULT CURRENT_DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_quantity NUMERIC(12,3);
BEGIN
  -- Get current stock quantity
  SELECT COALESCE(quantity, 0)
  INTO v_current_quantity
  FROM public.hotel_inventory_item_locations
  WHERE ingredient_id = p_ingredient_id
    AND location_code = p_location_code;

  -- Insert or update snapshot
  INSERT INTO public.hotel_inventory_daily_snapshots (
    ingredient_id,
    location_code,
    snapshot_date,
    opening_quantity
  )
  VALUES (
    p_ingredient_id,
    p_location_code,
    p_snapshot_date,
    v_current_quantity
  )
  ON CONFLICT (ingredient_id, location_code, snapshot_date)
  DO NOTHING;
END;
$$;

-- Create function to calculate cost per base unit
CREATE OR REPLACE FUNCTION public.get_ingredient_cost_per_base_unit(
  p_ingredient_id UUID
)
RETURNS NUMERIC(12,4)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ingredient public.hotel_ingredients%ROWTYPE;
  v_cost_per_base NUMERIC(12,4);
BEGIN
  SELECT *
  INTO v_ingredient
  FROM public.hotel_ingredients
  WHERE id = p_ingredient_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Calculate cost: (purchase price per bulk) / (bulk to base quantity)
  IF COALESCE(v_ingredient.bulk_to_base_quantity, 0) <= 0 THEN
    v_cost_per_base := COALESCE(v_ingredient.purchase_price, 0);
  ELSE
    v_cost_per_base := COALESCE(v_ingredient.purchase_price_per_bulk_unit, v_ingredient.purchase_price, 0)
                        / NULLIF(v_ingredient.bulk_to_base_quantity, 1);
  END IF;

  RETURN COALESCE(v_cost_per_base, 0);
END;
$$;

-- Create function to calculate daily variance
CREATE OR REPLACE FUNCTION public.get_inventory_variance(
  p_ingredient_id UUID,
  p_location_code TEXT,
  p_snapshot_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  opening_quantity NUMERIC(12,3),
  total_in NUMERIC(12,3),
  total_out NUMERIC(12,3),
  expected_closing NUMERIC(12,3),
  actual_closing NUMERIC(12,3),
  variance NUMERIC(12,3)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening_quantity NUMERIC(12,3) := 0;
  v_total_in NUMERIC(12,3) := 0;
  v_total_out NUMERIC(12,3) := 0;
  v_actual_closing NUMERIC(12,3) := 0;
BEGIN
  -- Get opening stock from snapshot
  SELECT COALESCE(opening_quantity, 0)
  INTO v_opening_quantity
  FROM public.hotel_inventory_daily_snapshots
  WHERE ingredient_id = p_ingredient_id
    AND location_code = p_location_code
    AND snapshot_date = p_snapshot_date;

  -- Get total stock in for the day
  SELECT COALESCE(SUM(quantity), 0)
  INTO v_total_in
  FROM public.hotel_ingredient_movements
  WHERE ingredient_id = p_ingredient_id
    AND (location_code = p_location_code OR to_location_code = p_location_code)
    AND movement_type IN ('in', 'transfer')
    AND DATE(created_at) = p_snapshot_date;

  -- Get total stock out for the day
  SELECT COALESCE(SUM(quantity), 0)
  INTO v_total_out
  FROM public.hotel_ingredient_movements
  WHERE ingredient_id = p_ingredient_id
    AND (location_code = p_location_code OR from_location_code = p_location_code)
    AND movement_type IN ('out', 'transfer')
    AND DATE(created_at) = p_snapshot_date;

  -- Get actual closing stock
  SELECT COALESCE(quantity, 0)
  INTO v_actual_closing
  FROM public.hotel_inventory_item_locations
  WHERE ingredient_id = p_ingredient_id
    AND location_code = p_location_code;

  RETURN QUERY SELECT
    v_opening_quantity,
    v_total_in,
    v_total_out,
    v_opening_quantity + v_total_in - v_total_out,
    v_actual_closing,
    v_actual_closing - (v_opening_quantity + v_total_in - v_total_out);
END;
$$;

-- Grant permissions
REVOKE EXECUTE ON FUNCTION public.record_daily_opening_stock(UUID, TEXT, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ingredient_cost_per_base_unit(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_inventory_variance(UUID, TEXT, DATE) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_daily_opening_stock(UUID, TEXT, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ingredient_cost_per_base_unit(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_variance(UUID, TEXT, DATE) TO authenticated, service_role;
