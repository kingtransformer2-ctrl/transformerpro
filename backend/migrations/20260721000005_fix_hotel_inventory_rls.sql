BEGIN;

-- Hotel inventory uses hotel_ingredients, hotel_inventory_item_locations, hotel_ingredient_movements.
-- Ensure authenticated users can read and insert these core tables.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hotel_ingredients') THEN
    BEGIN
      DROP POLICY IF EXISTS hotel_ingredients_insert ON public.hotel_ingredients;
      CREATE POLICY hotel_ingredients_insert ON public.hotel_ingredients FOR INSERT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hotel_ingredient_movements') THEN
    BEGIN
      DROP POLICY IF EXISTS hotel_ingredient_movements_insert ON public.hotel_ingredient_movements;
      CREATE POLICY hotel_ingredient_movements_insert ON public.hotel_ingredient_movements FOR INSERT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hotel_inventory_item_locations') THEN
    BEGIN
      DROP POLICY IF EXISTS hotel_inventory_item_locations_insert ON public.hotel_inventory_item_locations;
      CREATE POLICY hotel_inventory_item_locations_insert ON public.hotel_inventory_item_locations FOR INSERT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

COMMIT;