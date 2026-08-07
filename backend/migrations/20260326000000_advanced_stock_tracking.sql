-- Migration for Advanced Stock Tracking (5-Star Hotel Style)
-- Created: 2026-03-26

-- 1. Support fractional quantities in products and stock movements
-- First check if they are already numeric, if not, alter them.
-- Based on previous schema, they were INTEGER or DECIMAL(10,2). 
-- We want NUMERIC(10,3) for better precision (e.g., 0.005kg = 5g).

DO $$ 
BEGIN
    -- Update products table
    ALTER TABLE public.products ALTER COLUMN stock_quantity TYPE NUMERIC(12,3);
    ALTER TABLE public.products ALTER COLUMN min_stock_threshold TYPE NUMERIC(12,3);
    
    -- Update stock_movements table
    ALTER TABLE public.stock_movements ALTER COLUMN quantity TYPE NUMERIC(12,3);
    
    -- Update hotel_service_menu table
    ALTER TABLE public.hotel_service_menu ALTER COLUMN stock_quantity TYPE NUMERIC(12,3);
    ALTER TABLE public.hotel_service_menu ALTER COLUMN min_stock_threshold TYPE NUMERIC(12,3);
EXCEPTION
    WHEN others THEN NULL;
END $$;

-- 2. Create service item recipes table
CREATE TABLE IF NOT EXISTS public.hotel_service_item_recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_item_id UUID NOT NULL REFERENCES public.hotel_service_menu(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity_required NUMERIC(12,3) NOT NULL, -- Amount used per 1 portion
    unit TEXT NOT NULL DEFAULT 'pcs', -- pcs, g, ml, kg, etc.
    is_extra BOOLEAN DEFAULT false, -- If it's a paid extra or mandatory ingredient
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Add cost tracking to service menu
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_service_menu' AND column_name='cost_per_portion') THEN
        ALTER TABLE public.hotel_service_menu ADD COLUMN cost_per_portion NUMERIC(12,2) DEFAULT 0;
    END IF;
END $$;

-- 4. Create wastage log for advanced tracking
CREATE TABLE IF NOT EXISTS public.hotel_wastage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    service_item_id UUID REFERENCES public.hotel_service_menu(id) ON DELETE SET NULL,
    quantity NUMERIC(12,3) NOT NULL,
    reason TEXT NOT NULL, -- 'expired', 'spoiled', 'prep_error', 'over_used', 'other'
    reported_by UUID, -- Can be linked to staff if needed
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Enable RLS



-- 6. RLS Policies
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hotel_service_item_recipes' AND policyname = 'Authenticated users can manage recipes') THEN
        
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hotel_wastage_log' AND policyname = 'Authenticated users can manage wastage') THEN
        
    END IF;
END $$;

-- 7. Trigger for recipe updates to recalculate cost_per_portion
CREATE OR REPLACE FUNCTION public.update_service_item_cost()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.hotel_service_menu
    SET cost_per_portion = (
        SELECT COALESCE(SUM(r.quantity_required * p.purchase_price), 0)
        FROM public.hotel_service_item_recipes r
        JOIN public.products p ON r.product_id = p.id
        WHERE r.service_item_id = COALESCE(NEW.service_item_id, OLD.service_item_id)
    )
    WHERE id = COALESCE(NEW.service_item_id, OLD.service_item_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_service_item_cost_trigger ON public.hotel_service_item_recipes;
CREATE TRIGGER update_service_item_cost_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.hotel_service_item_recipes
    FOR EACH ROW
    EXECUTE FUNCTION public.update_service_item_cost();

-- 8. Add index for performance
CREATE INDEX IF NOT EXISTS idx_recipes_service_item ON public.hotel_service_item_recipes(service_item_id);
CREATE INDEX IF NOT EXISTS idx_recipes_product ON public.hotel_service_item_recipes(product_id);
