
-- Update hotel_payment_method ENUM to include momo and split
-- This ensures consistency between orders and invoices

ALTER TYPE public.hotel_payment_method ADD VALUE IF NOT EXISTS 'momo';
ALTER TYPE public.hotel_payment_method ADD VALUE IF NOT EXISTS 'split';

-- Ensure hotel_invoices has staff_id and shift_id if they were missing
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_invoices' AND column_name='shift_id') THEN
        ALTER TABLE public.hotel_invoices ADD COLUMN shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_invoices' AND column_name='staff_id') THEN
        ALTER TABLE public.hotel_invoices ADD COLUMN staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;
    END IF;
END $$;
