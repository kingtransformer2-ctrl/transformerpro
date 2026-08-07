
DO $$
BEGIN
    -- Add unique constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'hotel_staff_pin_key'
    ) THEN
        ALTER TABLE public.hotel_staff 
        ADD CONSTRAINT hotel_staff_pin_key UNIQUE (pin);
    END IF;
END $$;
