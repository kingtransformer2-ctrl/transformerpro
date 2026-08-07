-- Migration to support independent Kitchen and Bar display logic
-- Created: 2026-03-26

-- 1. Add station-specific status to hotel_orders
-- This allows Kitchen and Bar to track their own progress on the same order.
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='kitchen_status') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT 'pending' CHECK (kitchen_status IN ('pending', 'preparing', 'ready', 'served', 'cancelled'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='bar_status') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN bar_status TEXT NOT NULL DEFAULT 'pending' CHECK (bar_status IN ('pending', 'preparing', 'ready', 'served', 'cancelled'));
    END IF;
END $$;

-- 2. Add station_id to hotel_order_items to explicitly route items
-- This is better than relying on item_type which might be ambiguous
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_order_items' AND column_name='station') THEN
        ALTER TABLE public.hotel_order_items ADD COLUMN station TEXT NOT NULL DEFAULT 'kitchen' CHECK (station IN ('kitchen', 'bar', 'other'));
    END IF;
END $$;

-- 3. Update existing order items based on their item_type
UPDATE public.hotel_order_items 
SET station = 'bar' 
WHERE item_type IN ('beverages', 'minibar');

UPDATE public.hotel_order_items 
SET station = 'kitchen' 
WHERE item_type IN ('food', 'hotel', 'laundry') OR item_type IS NULL;

-- 4. Create a function to automatically sync order status when items are updated
CREATE OR REPLACE FUNCTION public.sync_order_station_status()
RETURNS TRIGGER AS $$
DECLARE
    v_order_id UUID;
    v_station TEXT;
    v_all_ready BOOLEAN;
    v_any_preparing BOOLEAN;
    v_new_status TEXT;
BEGIN
    v_order_id := COALESCE(NEW.order_id, OLD.order_id);
    v_station := COALESCE(NEW.station, OLD.station);

    -- If the station is 'other', we don't track it independently for now
    IF v_station = 'other' THEN
        RETURN NEW;
    END IF;

    -- Check if all items for this station in this order are ready
    SELECT 
        bool_and(status = 'ready'),
        bool_or(status = 'preparing')
    INTO v_all_ready, v_any_preparing
    FROM public.hotel_order_items
    WHERE order_id = v_order_id AND station = v_station;

    IF v_all_ready THEN
        v_new_status := 'ready';
    ELSIF v_any_preparing THEN
        v_new_status := 'preparing';
    ELSE
        v_new_status := 'pending';
    END IF;

    -- Update the station-specific status on the main order
    IF v_station = 'kitchen' THEN
        UPDATE public.hotel_orders SET kitchen_status = v_new_status WHERE id = v_order_id;
    ELSIF v_station = 'bar' THEN
        UPDATE public.hotel_orders SET bar_status = v_new_status WHERE id = v_order_id;
    END IF;

    -- Update global order status
    -- If all items (across all stations) are ready, set global status to 'ready'
    -- If any station is 'preparing', set global status to 'preparing'
    UPDATE public.hotel_orders
    SET status = CASE
        WHEN (SELECT bool_and(status = 'ready') FROM public.hotel_order_items WHERE order_id = v_order_id) THEN 'ready'
        WHEN (SELECT bool_or(status = 'preparing') FROM public.hotel_order_items WHERE order_id = v_order_id) THEN 'preparing'
        ELSE status -- Keep current status if neither
    END
    WHERE id = v_order_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Trigger for status sync
DROP TRIGGER IF EXISTS trigger_sync_order_station_status ON public.hotel_order_items;
CREATE TRIGGER trigger_sync_order_station_status
    AFTER INSERT OR UPDATE OF status ON public.hotel_order_items
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_order_station_status();
