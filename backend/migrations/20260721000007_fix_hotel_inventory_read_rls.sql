BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hotel_ingredients') THEN
    BEGIN
      DROP POLICY IF EXISTS hotel_ingredients_select ON public.hotel_ingredients;
      CREATE POLICY hotel_ingredients_select ON public.hotel_ingredients FOR SELECT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hotel_ingredient_movements') THEN
    BEGIN
      DROP POLICY IF EXISTS hotel_ingredient_movements_select ON public.hotel_ingredient_movements;
      CREATE POLICY hotel_ingredient_movements_select ON public.hotel_ingredient_movements FOR SELECT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hotel_inventory_item_locations') THEN
    BEGIN
      DROP POLICY IF EXISTS hotel_inventory_item_locations_select ON public.hotel_inventory_item_locations;
      CREATE POLICY hotel_inventory_item_locations_select ON public.hotel_inventory_item_locations FOR SELECT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hotel_inventory_daily_snapshots') THEN
    BEGIN
      DROP POLICY IF EXISTS hotel_inventory_daily_snapshots_select ON public.hotel_inventory_daily_snapshots;
      CREATE POLICY hotel_inventory_daily_snapshots_select ON public.hotel_inventory_daily_snapshots FOR SELECT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

COMMIT;