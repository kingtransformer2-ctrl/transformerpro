-- Migration to add cost tracking to hotel ingredient movements
-- Created: 2026-04-26

-- Add unit_cost and total_cost to hotel_ingredient_movements
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_ingredient_movements' AND column_name='unit_cost') THEN
        ALTER TABLE public.hotel_ingredient_movements ADD COLUMN unit_cost NUMERIC(12,2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_ingredient_movements' AND column_name='total_cost') THEN
        ALTER TABLE public.hotel_ingredient_movements ADD COLUMN total_cost NUMERIC(12,2) DEFAULT 0;
    END IF;
END $$;

-- Update existing records to have a unit_cost based on current purchase_price if possible
UPDATE public.hotel_ingredient_movements m
SET unit_cost = i.purchase_price,
    total_cost = m.quantity * i.purchase_price
FROM public.hotel_ingredients i
WHERE m.ingredient_id = i.id AND (m.unit_cost = 0 OR m.unit_cost IS NULL);
