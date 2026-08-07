-- Add item_type column to hotel_order_items to track which station (kitchen/bar) each item belongs to
ALTER TABLE public.hotel_order_items ADD COLUMN IF NOT EXISTS item_type text DEFAULT 'food';

-- Update the column comment
COMMENT ON COLUMN public.hotel_order_items.item_type IS 'Category of the item for station routing (food, beverages, minibar, etc.)';