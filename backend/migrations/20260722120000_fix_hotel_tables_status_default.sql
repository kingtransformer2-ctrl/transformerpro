-- Fix hotel_tables status column to have a database default
-- This prevents 500 errors when frontend sends empty/invalid status
ALTER TABLE IF EXISTS public.hotel_tables 
  ALTER COLUMN status SET DEFAULT 'free';

-- Note: Existing rows with invalid status are handled by application-level
-- sanitization. The database default will apply on next INSERT/UPDATE.

COMMENT ON COLUMN public.hotel_tables.status IS 'Table status: free, reserved, occupied, cleaning. Defaults to free.';
