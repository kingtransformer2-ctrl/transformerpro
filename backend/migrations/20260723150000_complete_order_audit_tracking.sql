
-- Complete order audit tracking for all order lifecycle actions

-- Add audit columns for order preparation
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS preparing_started_at TIMESTAMPTZ;
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS preparing_started_by UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;

-- Add audit columns for order readiness
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS ready_by UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;

-- Add audit columns for order service
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS served_at TIMESTAMPTZ;
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS served_by UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;

-- Add audit columns for order billing
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;
ALTER TABLE public.hotel_orders ADD COLUMN IF NOT EXISTS billed_by UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL;

-- Add comments for clarity
COMMENT ON COLUMN public.hotel_orders.preparing_started_at IS 'When the order preparation started';
COMMENT ON COLUMN public.hotel_orders.preparing_started_by IS 'The staff member who started preparing the order';
COMMENT ON COLUMN public.hotel_orders.ready_at IS 'When the order was ready for service';
COMMENT ON COLUMN public.hotel_orders.ready_by IS 'The staff member who marked the order as ready';
COMMENT ON COLUMN public.hotel_orders.served_at IS 'When the order was served to the guest';
COMMENT ON COLUMN public.hotel_orders.served_by IS 'The staff member who served the order';
COMMENT ON COLUMN public.hotel_orders.billed_at IS 'When the order was billed';
COMMENT ON COLUMN public.hotel_orders.billed_by IS 'The staff member who billed the order';
