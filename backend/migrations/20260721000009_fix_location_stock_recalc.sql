BEGIN;

-- Drop and recreate with transfer support
DROP FUNCTION IF EXISTS public.recalculate_location_stock(UUID, TEXT);

CREATE FUNCTION public.recalculate_location_stock(
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

GRANT EXECUTE ON FUNCTION public.recalculate_location_stock(UUID, TEXT) TO authenticated, service_role;

COMMIT;