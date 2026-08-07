-- Migration to add service types to hotel_orders
-- Supports: dine_in, reservation, takeaway, delivery
-- Date: 2026-07-22

BEGIN;

-- 1. Add order_type column
ALTER TABLE public.hotel_orders 
  ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'dine_in' 
  CHECK (order_type IN ('dine_in', 'reservation', 'takeaway', 'delivery'));

-- 2. Add reservation-specific fields
ALTER TABLE public.hotel_orders 
  ADD COLUMN IF NOT EXISTS reservation_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS party_size INTEGER,
  ADD COLUMN IF NOT EXISTS special_requests TEXT;

-- 3. Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_hotel_orders_order_type ON public.hotel_orders(order_type);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_reservation_time ON public.hotel_orders(reservation_time) WHERE reservation_time IS NOT NULL;

-- 4. Update the valid_order_status constraint to include all current statuses
ALTER TABLE public.hotel_orders DROP CONSTRAINT IF EXISTS valid_order_status;
ALTER TABLE public.hotel_orders ADD CONSTRAINT valid_order_status
  CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'cancelled', 'billed', 'paid', 'settled', 'awaiting_approval', 'pending_handover'));

-- 5. Add comments
COMMENT ON COLUMN public.hotel_orders.order_type IS 'Type of order: dine_in (table), reservation (booked table), takeaway (pickup), delivery (home delivery)';
COMMENT ON COLUMN public.hotel_orders.reservation_time IS 'For reservation orders: the reserved time slot';
COMMENT ON COLUMN public.hotel_orders.party_size IS 'Number of guests for reservation';
COMMENT ON COLUMN public.hotel_orders.special_requests IS 'Special requests for the order';

-- 6. Backfill existing orders to dine_in
UPDATE public.hotel_orders 
SET order_type = 'dine_in' 
WHERE order_type IS NULL;

COMMIT;