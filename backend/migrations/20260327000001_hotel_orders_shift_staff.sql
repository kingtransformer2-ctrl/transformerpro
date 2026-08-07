
-- Migration to add shift_id and staff_id to hotel_orders
-- Created: 2026-03-27

ALTER TABLE public.hotel_orders 
    ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_hotel_orders_shift ON public.hotel_orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_staff ON public.hotel_orders(staff_id);

-- Backfill shift_id and staff_id from waiter_id and existing items if possible
-- This is a best-effort backfill for existing records.
UPDATE public.hotel_orders
SET staff_id = waiter_id
WHERE staff_id IS NULL AND waiter_id IS NOT NULL;

-- Update the column comments
COMMENT ON COLUMN public.hotel_orders.shift_id IS 'The shift during which this order was placed';
COMMENT ON COLUMN public.hotel_orders.staff_id IS 'The staff member (waiter) who placed this order';
