-- Add tin_number column to company_profile and hotel_info tables
ALTER TABLE public.company_profile ADD COLUMN IF NOT EXISTS tin_number TEXT;
ALTER TABLE public.hotel_info ADD COLUMN IF NOT EXISTS tin_number TEXT;

-- Sync existing tax_number to tin_number if applicable
UPDATE public.company_profile SET tin_number = tax_number WHERE tin_number IS NULL AND tax_number IS NOT NULL;

