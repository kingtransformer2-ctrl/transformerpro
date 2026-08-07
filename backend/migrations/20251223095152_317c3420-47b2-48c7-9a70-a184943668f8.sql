-- Create hotel service menu table for managing room service items
CREATE TABLE public.hotel_service_menu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  price NUMERIC NOT NULL DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS


-- Create RLS policy for authenticated users

-- Create index for faster queries
CREATE INDEX idx_hotel_service_menu_category ON public.hotel_service_menu(category);
CREATE INDEX idx_hotel_service_menu_available ON public.hotel_service_menu(is_available);

-- Insert default service items
INSERT INTO public.hotel_service_menu (name, category, price, sort_order) VALUES
  -- Food
  ('Breakfast', 'food', 15, 1),
  ('Lunch', 'food', 25, 2),
  ('Dinner', 'food', 35, 3),
  ('Room Service - Snacks', 'food', 12, 4),
  -- Beverages
  ('Coffee', 'beverages', 5, 1),
  ('Tea', 'beverages', 4, 2),
  ('Soft Drinks', 'beverages', 3, 3),
  ('Fresh Juice', 'beverages', 6, 4),
  -- Minibar
  ('Wine', 'minibar', 25, 1),
  ('Beer', 'minibar', 8, 2),
  ('Spirits', 'minibar', 15, 3),
  ('Snacks', 'minibar', 10, 4),
  -- Laundry
  ('Laundry - Regular', 'laundry', 20, 1),
  ('Laundry - Express', 'laundry', 35, 2),
  ('Dry Cleaning', 'laundry', 30, 3),
  ('Ironing', 'laundry', 10, 4),
  -- Other Services
  ('Spa Treatment', 'other', 80, 1),
  ('Gym Access', 'other', 15, 2),
  ('Airport Transfer', 'other', 50, 3),
  ('Tour Booking', 'other', 100, 4);