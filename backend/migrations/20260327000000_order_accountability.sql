
-- Update hotel_orders status constraint to include paid and settled
ALTER TABLE public.hotel_orders DROP CONSTRAINT IF EXISTS valid_order_status;
ALTER TABLE public.hotel_orders ADD CONSTRAINT valid_order_status CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'cancelled', 'billed', 'paid', 'settled'));

-- Add columns for financial handoff tracking
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS payment_received_at TIMESTAMPTZ;
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS settled_by UUID REFERENCES public.hotel_staff(id);
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Add comments for clarity
COMMENT ON COLUMN public.hotel_orders.payment_received_at IS 'When the waiter collected money from the guest';
COMMENT ON COLUMN public.hotel_orders.settled_at IS 'When the waiter handed the money to the cashier';
COMMENT ON COLUMN public.hotel_orders.settled_by IS 'The cashier who received and verified the money';
COMMENT ON COLUMN public.hotel_orders.payment_method IS 'The method used by guest (cash, card, upi, etc.)';
