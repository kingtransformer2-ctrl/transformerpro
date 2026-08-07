
-- Create order status enum-like check
-- Hotel Orders table - tracks each order placed by a waiter
CREATE TABLE public.hotel_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL DEFAULT '',
  booking_id UUID REFERENCES public.hotel_bookings(id) ON DELETE SET NULL,
  room_id UUID REFERENCES public.hotel_rooms(id) ON DELETE SET NULL,
  table_number TEXT,
  waiter_id UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  is_billed BOOLEAN NOT NULL DEFAULT false,
  invoice_id UUID REFERENCES public.hotel_invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_order_status CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'cancelled', 'billed'))
);

-- Hotel Order Items table
CREATE TABLE public.hotel_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.hotel_orders(id) ON DELETE CASCADE,
  service_item_id UUID REFERENCES public.hotel_service_menu(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_item_status CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'cancelled'))
);

-- Enable RLS



-- RLS Policies


-- Auto-generate order number
CREATE OR REPLACE FUNCTION public.generate_hotel_order_number()
  RETURNS TEXT
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  ord_num TEXT;
BEGIN
  ord_num := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((
    SELECT COALESCE(MAX(CAST(RIGHT(order_number, 4) AS INTEGER)), 0) + 1
    FROM public.hotel_orders
    WHERE order_number LIKE 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%'
  )::TEXT, 4, '0');
  RETURN ord_num;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_hotel_order_number()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    NEW.order_number := public.generate_hotel_order_number();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_hotel_order_number_trigger
  BEFORE INSERT ON public.hotel_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_hotel_order_number();

-- Updated_at trigger
CREATE TRIGGER update_hotel_orders_updated_at
  BEFORE UPDATE ON public.hotel_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
