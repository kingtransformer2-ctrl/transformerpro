-- Migration for Advanced Bar/Bottle Stock Tracking
-- Created: 2026-03-26

-- 1. Enhance hotel_ingredients for advanced bottle tracking
DO $$ 
BEGIN
    -- Track if item is a liquid/spirit sold by volume
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_ingredients' AND column_name='is_liquid') THEN
        ALTER TABLE public.hotel_ingredients ADD COLUMN is_liquid BOOLEAN DEFAULT false;
    END IF;

    -- Standard volume per bottle (e.g., 750 for a 750ml bottle)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_ingredients' AND column_name='volume_per_unit') THEN
        ALTER TABLE public.hotel_ingredients ADD COLUMN volume_per_unit NUMERIC(12,3) DEFAULT 1;
    END IF;

    -- Current volume of the "Open" bottle
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_ingredients' AND column_name='open_unit_volume') THEN
        ALTER TABLE public.hotel_ingredients ADD COLUMN open_unit_volume NUMERIC(12,3) DEFAULT 0;
    END IF;

    -- Track empty bottles for return/recycling
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_ingredients' AND column_name='track_empties') THEN
        ALTER TABLE public.hotel_ingredients ADD COLUMN track_empties BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_ingredients' AND column_name='empty_units_count') THEN
        ALTER TABLE public.hotel_ingredients ADD COLUMN empty_units_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- 2. Create table for Crate/Case management (Physical shells)
CREATE TABLE IF NOT EXISTS public.hotel_bar_crates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, -- e.g., "Primus Crate", "Heineken Crate"
    ingredient_id UUID REFERENCES public.hotel_ingredients(id) ON DELETE SET NULL,
    capacity INTEGER NOT NULL DEFAULT 24, -- bottles per crate
    full_crates_count INTEGER DEFAULT 0,
    empty_crates_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);



DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hotel_bar_crates' AND policyname = 'Authenticated users can manage crates') THEN
        
    END IF;
END $$;

-- 3. Trigger to automatically update "Full Crates" when restocking bottles
-- (This logic will be handled in the application layer for more flexibility, 
-- but we ensure the schema supports it).

-- 4. Add index for performance
CREATE INDEX IF NOT EXISTS idx_crates_ingredient ON public.hotel_bar_crates(ingredient_id);
