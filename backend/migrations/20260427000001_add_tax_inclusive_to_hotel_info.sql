
-- Add tax_inclusive column to hotel_info table
ALTER TABLE public.hotel_info ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN DEFAULT false;

-- Update existing records to have tax_inclusive as false (defaulting to exclusive for Rwanda VAT)
UPDATE public.hotel_info SET tax_inclusive = false WHERE tax_inclusive IS NULL;
