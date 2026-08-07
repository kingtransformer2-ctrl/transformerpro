-- Migration to align pricing names in hotel_service_menu and add cost tracking to stock movements
-- Created: 2026-04-27

-- 1. Rename columns in hotel_service_menu for consistency with products table
DO $$ 
BEGIN
    -- Rename price to selling_price
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_service_menu' AND column_name='price') THEN
        ALTER TABLE public.hotel_service_menu RENAME COLUMN price TO selling_price;
    END IF;

    -- Rename cost_per_portion to purchase_price
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_service_menu' AND column_name='cost_per_portion') THEN
        ALTER TABLE public.hotel_service_menu RENAME COLUMN cost_per_portion TO purchase_price;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_service_menu' AND column_name='purchase_price') THEN
        ALTER TABLE public.hotel_service_menu ADD COLUMN purchase_price NUMERIC(12,2) DEFAULT 0;
    END IF;

    -- 1.1 Add purchase_price to hotel_order_items for historical profit tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_order_items' AND column_name='purchase_price') THEN
        ALTER TABLE public.hotel_order_items ADD COLUMN purchase_price NUMERIC(12,2) DEFAULT 0;
    END IF;
END $$;

-- 2. Add cost tracking to hotel_stock_movements (keep same logic as ingredient movements)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_stock_movements' AND column_name='unit_cost') THEN
        ALTER TABLE public.hotel_stock_movements ADD COLUMN unit_cost NUMERIC(12,2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_stock_movements' AND column_name='total_cost') THEN
        ALTER TABLE public.hotel_stock_movements ADD COLUMN total_cost NUMERIC(12,2) DEFAULT 0;
    END IF;

    -- Also add shift_id if it's missing (though it seemed present in some context)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_stock_movements' AND column_name='shift_id') THEN
        ALTER TABLE public.hotel_stock_movements ADD COLUMN shift_id UUID;
    END IF;
END $$;

-- 3. Update existing records in hotel_stock_movements with current purchase_price
UPDATE public.hotel_stock_movements m
SET unit_cost = s.purchase_price,
    total_cost = m.quantity * s.purchase_price
FROM public.hotel_service_menu s
WHERE m.service_item_id = s.id AND (m.unit_cost = 0 OR m.unit_cost IS NULL);

-- 4. Update the cost recalculation trigger to use new column names
CREATE OR REPLACE FUNCTION public.update_service_item_cost()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.hotel_service_menu
    SET purchase_price = (
        SELECT COALESCE(SUM(
            CASE 
                WHEN r.ingredient_id IS NOT NULL THEN r.quantity_required * i.purchase_price
                WHEN r.product_id IS NOT NULL THEN r.quantity_required * p.purchase_price
                ELSE 0
            END
        ), 0)
        FROM public.hotel_service_item_recipes r
        LEFT JOIN public.hotel_ingredients i ON r.ingredient_id = i.id
        LEFT JOIN public.products p ON r.product_id = p.id
        WHERE r.service_item_id = COALESCE(NEW.service_item_id, OLD.service_item_id)
    )
    WHERE id = COALESCE(NEW.service_item_id, OLD.service_item_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
