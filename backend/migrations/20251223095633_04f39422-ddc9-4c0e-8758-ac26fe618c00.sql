-- Create hotel service categories table for custom category management
CREATE TABLE public.hotel_service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  icon TEXT DEFAULT 'sparkles',
  sort_order INTEGER DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS


-- Create RLS policy

-- Insert default system categories
INSERT INTO public.hotel_service_categories (name, label, icon, sort_order, is_system) VALUES
  ('food', 'Food', 'utensils-crossed', 1, true),
  ('beverages', 'Beverages', 'coffee', 2, true),
  ('minibar', 'Minibar', 'wine', 3, true),
  ('laundry', 'Laundry', 'shirt', 4, true),
  ('other', 'Other Services', 'sparkles', 5, true);

-- Add stock tracking columns to hotel_service_menu
ALTER TABLE public.hotel_service_menu 
  ADD COLUMN IF NOT EXISTS track_stock BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock_threshold INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

-- Create hotel stock movements table for tracking hotel-specific stock
CREATE TABLE public.hotel_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id UUID REFERENCES public.hotel_service_menu(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment')),
  quantity INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id UUID,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for hotel stock movements


-- Create RLS policy for hotel stock movements

-- Create indexes
CREATE INDEX idx_hotel_stock_movements_item ON public.hotel_stock_movements(service_item_id);
CREATE INDEX idx_hotel_stock_movements_type ON public.hotel_stock_movements(movement_type);
CREATE INDEX idx_hotel_service_menu_product ON public.hotel_service_menu(product_id);