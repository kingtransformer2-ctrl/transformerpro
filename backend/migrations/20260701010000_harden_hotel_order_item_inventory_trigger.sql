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

CREATE OR REPLACE FUNCTION public.process_hotel_order_item_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_code TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    BEGIN
      PERFORM public.consume_hotel_order_item_inventory(NEW.id);
    EXCEPTION
      WHEN OTHERS THEN
        v_location_code := CASE
          WHEN lower(COALESCE(NEW.station, 'kitchen')) = 'bar' THEN 'bar'
          ELSE 'kitchen'
        END;

        BEGIN
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
            NEW.id,
            NEW.order_id,
            NEW.service_item_id,
            NEW.name,
            v_location_code,
            'inventory_processing_error',
            LEFT(COALESCE(SQLSTATE, 'XX000') || ': ' || COALESCE(SQLERRM, 'Unknown inventory trigger failure'), 500)
          )
          ON CONFLICT (order_item_id, flag_reason) DO NOTHING;
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
    END;
  END IF;

  RETURN NEW;
END;
$$;
