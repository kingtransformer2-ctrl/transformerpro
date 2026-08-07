BEGIN;

-- Allow authenticated users to insert into tables the frontend writes to directly.
-- Each block is defensive so missing tables/policies do not abort the whole migration.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ingredients') THEN
    BEGIN
      DROP POLICY IF EXISTS ingredients_insert ON public.ingredients;
      CREATE POLICY ingredients_insert ON public.ingredients FOR INSERT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchases') THEN
    BEGIN
      DROP POLICY IF EXISTS purchases_insert ON public.purchases;
      CREATE POLICY purchases_insert ON public.purchases FOR INSERT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_items') THEN
    BEGIN
      DROP POLICY IF EXISTS purchase_items_insert ON public.purchase_items;
      CREATE POLICY purchase_items_insert ON public.purchase_items FOR INSERT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_ledger') THEN
    BEGIN
      DROP POLICY IF EXISTS stock_ledger_insert ON public.stock_ledger;
      CREATE POLICY stock_ledger_insert ON public.stock_ledger FOR INSERT TO authenticated USING (true);
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;

COMMIT;