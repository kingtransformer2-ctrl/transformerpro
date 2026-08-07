-- Migration for Professional Hotel Operations (Real-time Posting, Smart Status, Split Payments)
-- Created: 2026-03-26

-- 1. Enhance Hotel Room Statuses
-- Add 'dirty' and 'inspected' to the enum if they don't exist
DO $$ 
BEGIN
    ALTER TYPE public.room_status ADD VALUE IF NOT EXISTS 'dirty';
    ALTER TYPE public.room_status ADD VALUE IF NOT EXISTS 'inspected';
EXCEPTION
    WHEN others THEN NULL;
END $$;

-- 2. Enhance Invoices for Professional Folio
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_invoices' AND column_name='late_checkout_fee') THEN
        ALTER TABLE public.hotel_invoices ADD COLUMN late_checkout_fee NUMERIC DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_invoices' AND column_name='is_split_payment') THEN
        ALTER TABLE public.hotel_invoices ADD COLUMN is_split_payment BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 3. Track POS orders posted to room
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='posted_to_invoice_id') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN posted_to_invoice_id UUID REFERENCES public.hotel_invoices(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 4. Create Hotel Payments table for Split Payments
CREATE TABLE IF NOT EXISTS public.hotel_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES public.hotel_invoices(id) ON DELETE CASCADE,
    payment_method public.hotel_payment_method NOT NULL,
    amount NUMERIC NOT NULL,
    transaction_reference TEXT,
    staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL,
    shift_id UUID, -- References hotel_shifts(id)
    created_at TIMESTAMPTZ DEFAULT now()
);



DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hotel_payments' AND policyname = 'Authenticated users can manage payments') THEN
        
    END IF;
END $$;

-- 5. Automate Room Status on Checkout
-- Trigger to set room to 'dirty' when a booking is checked out
CREATE OR REPLACE FUNCTION public.handle_checkout_room_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'checked_out' AND OLD.status = 'checked_in' THEN
        UPDATE public.hotel_rooms
        SET status = 'dirty'
        WHERE id = NEW.room_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_checkout_room_status ON public.hotel_bookings;
CREATE TRIGGER trigger_checkout_room_status
    AFTER UPDATE OF status ON public.hotel_bookings
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_checkout_room_status();

-- 6. Automate Housekeeping Task on Dirty Status
-- When a room becomes 'dirty', automatically create a housekeeping task
CREATE OR REPLACE FUNCTION public.auto_create_cleaning_task()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'dirty' AND OLD.status != 'dirty' THEN
        INSERT INTO public.hotel_housekeeping (room_id, task_type, status, priority, notes)
        VALUES (NEW.id, 'Full Cleaning (Checkout)', 'pending', 'high', 'Automated task from checkout');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_cleaning_task ON public.hotel_rooms;
CREATE TRIGGER trigger_auto_cleaning_task
    AFTER UPDATE OF status ON public.hotel_rooms
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_create_cleaning_task();
