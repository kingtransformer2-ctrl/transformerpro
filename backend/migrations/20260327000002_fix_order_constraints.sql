
-- Comprehensive fix for hotel_orders status and columns
-- Run this in Supabase SQL Editor if you see "new row violation" errors

DO $$ 
BEGIN
    -- 1. Ensure all required columns exist in hotel_orders
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='payment_received_at') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN payment_received_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='settled_at') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN settled_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='settled_by') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN settled_by UUID REFERENCES public.hotel_staff(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='payment_method') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN payment_method TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='shift_id') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='hotel_orders' AND column_name='staff_id') THEN
        ALTER TABLE public.hotel_orders ADD COLUMN staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;
    END IF;

    -- 2. Update the status check constraint to include new lifecycle statuses
    -- We drop it first to ensure we can recreate it with all needed values
    ALTER TABLE public.hotel_orders DROP CONSTRAINT IF EXISTS valid_order_status;
    ALTER TABLE public.hotel_orders ADD CONSTRAINT valid_order_status 
        CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'cancelled', 'billed', 'paid', 'settled', 'awaiting_approval'));

    -- 3. Also update kitchen_status and bar_status constraints just in case
    ALTER TABLE public.hotel_orders DROP CONSTRAINT IF EXISTS hotel_orders_kitchen_status_check;
    ALTER TABLE public.hotel_orders ADD CONSTRAINT hotel_orders_kitchen_status_check 
        CHECK (kitchen_status IN ('pending', 'preparing', 'ready', 'served', 'cancelled', 'awaiting_approval', 'paid', 'settled'));

    ALTER TABLE public.hotel_orders DROP CONSTRAINT IF EXISTS hotel_orders_bar_status_check;
    ALTER TABLE public.hotel_orders ADD CONSTRAINT hotel_orders_bar_status_check 
        CHECK (bar_status IN ('pending', 'preparing', 'ready', 'served', 'cancelled', 'awaiting_approval', 'paid', 'settled'));

END $$;
