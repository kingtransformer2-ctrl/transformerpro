-- Migration for Dedicated Hotel Ingredient Stock
-- Created: 2026-03-26

-- 1. Create dedicated hotel ingredients table (independent from main POS)
CREATE TABLE IF NOT EXISTS public.hotel_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    min_stock_threshold NUMERIC(12,3) NOT NULL DEFAULT 5,
    unit TEXT NOT NULL DEFAULT 'pcs', -- Default unit for this ingredient
    category TEXT DEFAULT 'kitchen',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Update service item recipes to reference hotel_ingredients OR products
-- This allows flexibility: link to hotel-only stock OR general POS stock.
-- Since we want hotel-only for this request, we'll favor hotel_ingredients.
DO $$ 
BEGIN
    -- Add ingredient_id column to recipes
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_service_item_recipes' AND column_name='ingredient_id') THEN
        ALTER TABLE public.hotel_service_item_recipes ADD COLUMN ingredient_id UUID REFERENCES public.hotel_ingredients(id) ON DELETE CASCADE;
        -- Make product_id nullable since we might use ingredient_id instead
        ALTER TABLE public.hotel_service_item_recipes ALTER COLUMN product_id DROP NOT NULL;
    END IF;

    -- Add ingredient_id to wastage log
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_wastage_log' AND column_name='ingredient_id') THEN
        ALTER TABLE public.hotel_wastage_log ADD COLUMN ingredient_id UUID REFERENCES public.hotel_ingredients(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 3. Enable RLS


-- 4. RLS Policies
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hotel_ingredients' AND policyname = 'Authenticated users can manage ingredients') THEN
        
    END IF;
END $$;

-- 5. Create stock movement table for hotel ingredients specifically
CREATE TABLE IF NOT EXISTS public.hotel_ingredient_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id UUID NOT NULL REFERENCES public.hotel_ingredients(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment')),
    quantity NUMERIC(12,3) NOT NULL,
    reason TEXT NOT NULL,
    reference_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);



DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hotel_ingredient_movements' AND policyname = 'Authenticated users can manage ingredient movements') THEN
        
    END IF;
END $$;

-- 6. Update cost recalculation trigger to support both sources
CREATE OR REPLACE FUNCTION public.update_service_item_cost()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.hotel_service_menu
    SET cost_per_portion = (
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

-- 7. Add index for performance
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON public.hotel_ingredients(category);
CREATE INDEX IF NOT EXISTS idx_recipes_ingredient ON public.hotel_service_item_recipes(ingredient_id);
