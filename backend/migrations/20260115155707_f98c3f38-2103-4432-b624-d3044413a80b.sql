-- Update default currency to RWF
UPDATE public.settings 
SET value = '"RWF"', updated_at = now() 
WHERE category = 'system' AND key = 'currency';

-- Update default timezone to Africa/Kigali
UPDATE public.settings 
SET value = '"Africa/Kigali"', updated_at = now() 
WHERE category = 'system' AND key = 'timezone';