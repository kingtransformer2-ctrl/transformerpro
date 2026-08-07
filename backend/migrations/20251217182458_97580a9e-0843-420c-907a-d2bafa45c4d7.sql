-- Hotel Management System Tables

-- Room Types Enum
CREATE TYPE public.room_type AS ENUM ('single', 'double', 'suite', 'deluxe', 'presidential');

-- Room Status Enum
CREATE TYPE public.room_status AS ENUM ('available', 'occupied', 'reserved', 'maintenance', 'cleaning');

-- Booking Status Enum
CREATE TYPE public.booking_status AS ENUM ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled');

-- Payment Method Enum for Hotel
CREATE TYPE public.hotel_payment_method AS ENUM ('cash', 'card', 'upi', 'bank_transfer');

-- Staff Role Enum
CREATE TYPE public.staff_role AS ENUM ('manager', 'receptionist', 'housekeeping', 'security', 'maintenance');

-- Housekeeping Status Enum
CREATE TYPE public.housekeeping_status AS ENUM ('pending', 'in_progress', 'completed', 'verified');

-- Hotel Information Table
CREATE TABLE public.hotel_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Grand Hotel',
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  tax_rate NUMERIC DEFAULT 18,
  cancellation_policy TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Rooms Table
CREATE TABLE public.hotel_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number TEXT NOT NULL UNIQUE,
  floor INTEGER NOT NULL DEFAULT 1,
  room_type public.room_type NOT NULL DEFAULT 'single',
  status public.room_status NOT NULL DEFAULT 'available',
  price_per_night NUMERIC NOT NULL DEFAULT 100,
  capacity INTEGER NOT NULL DEFAULT 2,
  amenities JSONB DEFAULT '[]'::jsonb,
  description TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Guests Table
CREATE TABLE public.hotel_guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  id_proof_type TEXT,
  id_proof_number TEXT,
  id_proof_url TEXT,
  address TEXT,
  nationality TEXT DEFAULT 'India',
  loyalty_points INTEGER DEFAULT 0,
  preferences JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Bookings Table
CREATE TABLE public.hotel_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference TEXT NOT NULL UNIQUE,
  guest_id UUID REFERENCES public.hotel_guests(id) ON DELETE SET NULL,
  room_id UUID REFERENCES public.hotel_rooms(id) ON DELETE SET NULL,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER DEFAULT 0,
  status public.booking_status NOT NULL DEFAULT 'pending',
  special_requests TEXT,
  total_amount NUMERIC DEFAULT 0,
  paid_amount NUMERIC DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Hotel Staff Table
CREATE TABLE public.hotel_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role public.staff_role NOT NULL DEFAULT 'receptionist',
  shift TEXT DEFAULT 'morning',
  salary NUMERIC DEFAULT 0,
  hire_date DATE DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Staff Attendance Table
CREATE TABLE public.hotel_staff_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES public.hotel_staff(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in_time TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  status TEXT DEFAULT 'present',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Housekeeping Tasks Table
CREATE TABLE public.hotel_housekeeping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.hotel_rooms(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES public.hotel_staff(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL DEFAULT 'cleaning',
  status public.housekeeping_status NOT NULL DEFAULT 'pending',
  priority TEXT DEFAULT 'normal',
  scheduled_date DATE DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Hotel Invoices Table
CREATE TABLE public.hotel_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  booking_id UUID REFERENCES public.hotel_bookings(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES public.hotel_guests(id) ON DELETE SET NULL,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  payment_method public.hotel_payment_method,
  payment_status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Invoice Items Table
CREATE TABLE public.hotel_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES public.hotel_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit_price NUMERIC NOT NULL,
  total_price NUMERIC NOT NULL,
  item_type TEXT DEFAULT 'room',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Guest Feedback Table
CREATE TABLE public.hotel_guest_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID REFERENCES public.hotel_guests(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.hotel_bookings(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  cleanliness_rating INTEGER CHECK (cleanliness_rating >= 1 AND cleanliness_rating <= 5),
  service_rating INTEGER CHECK (service_rating >= 1 AND service_rating <= 5),
  amenities_rating INTEGER CHECK (amenities_rating >= 1 AND amenities_rating <= 5),
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Room Pricing Rules Table
CREATE TABLE public.hotel_pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  room_type public.room_type,
  start_date DATE,
  end_date DATE,
  price_modifier NUMERIC DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on all tables












-- RLS Policies for all tables (authenticated users can access)













-- Function to generate booking reference
CREATE OR REPLACE FUNCTION public.generate_booking_reference()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    ref TEXT;
BEGIN
    ref := 'BK-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((
        SELECT COALESCE(MAX(CAST(RIGHT(booking_reference, 4) AS INTEGER)), 0) + 1
        FROM public.hotel_bookings 
        WHERE booking_reference LIKE 'BK-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%'
    )::TEXT, 4, '0');
    RETURN ref;
END;
$$;

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION public.generate_hotel_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    inv_num TEXT;
BEGIN
    inv_num := 'INV-H-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((
        SELECT COALESCE(MAX(CAST(RIGHT(invoice_number, 4) AS INTEGER)), 0) + 1
        FROM public.hotel_invoices 
        WHERE invoice_number LIKE 'INV-H-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%'
    )::TEXT, 4, '0');
    RETURN inv_num;
END;
$$;

-- Trigger to auto-generate booking reference
CREATE OR REPLACE FUNCTION public.set_booking_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.booking_reference IS NULL OR NEW.booking_reference = '' THEN
        NEW.booking_reference := public.generate_booking_reference();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_booking_reference_trigger
BEFORE INSERT ON public.hotel_bookings
FOR EACH ROW EXECUTE FUNCTION public.set_booking_reference();

-- Trigger to auto-generate invoice number
CREATE OR REPLACE FUNCTION public.set_hotel_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
        NEW.invoice_number := public.generate_hotel_invoice_number();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_hotel_invoice_number_trigger
BEFORE INSERT ON public.hotel_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_hotel_invoice_number();

-- Insert default hotel info
INSERT INTO public.hotel_info (name, address, phone, email, tax_rate)
VALUES ('Grand Hotel', '123 Main Street, City Center', '+1 234 567 8900', 'info@grandhotel.com', 18);

-- Insert sample rooms
INSERT INTO public.hotel_rooms (room_number, floor, room_type, status, price_per_night, capacity, amenities) VALUES
('101', 1, 'single', 'available', 80, 1, '["WiFi", "TV", "AC"]'),
('102', 1, 'single', 'available', 80, 1, '["WiFi", "TV", "AC"]'),
('103', 1, 'double', 'available', 120, 2, '["WiFi", "TV", "AC", "Mini Bar"]'),
('104', 1, 'double', 'occupied', 120, 2, '["WiFi", "TV", "AC", "Mini Bar"]'),
('201', 2, 'suite', 'available', 200, 3, '["WiFi", "TV", "AC", "Mini Bar", "Jacuzzi"]'),
('202', 2, 'suite', 'reserved', 200, 3, '["WiFi", "TV", "AC", "Mini Bar", "Jacuzzi"]'),
('203', 2, 'deluxe', 'available', 300, 4, '["WiFi", "TV", "AC", "Mini Bar", "Jacuzzi", "Balcony"]'),
('301', 3, 'presidential', 'available', 500, 4, '["WiFi", "TV", "AC", "Mini Bar", "Jacuzzi", "Balcony", "Butler Service"]'),
('302', 3, 'deluxe', 'maintenance', 300, 4, '["WiFi", "TV", "AC", "Mini Bar", "Jacuzzi", "Balcony"]'),
('303', 3, 'double', 'cleaning', 120, 2, '["WiFi", "TV", "AC", "Mini Bar"]');

-- Insert sample guests
INSERT INTO public.hotel_guests (first_name, last_name, email, phone, id_proof_type, id_proof_number, nationality, loyalty_points) VALUES
('John', 'Smith', 'john.smith@email.com', '+1 555 123 4567', 'passport', 'AB1234567', 'USA', 500),
('Maria', 'Garcia', 'maria.garcia@email.com', '+1 555 234 5678', 'drivers_license', 'DL98765432', 'Mexico', 250),
('James', 'Wilson', 'james.wilson@email.com', '+1 555 345 6789', 'passport', 'CD5678901', 'UK', 1000),
('Sarah', 'Johnson', 'sarah.j@email.com', '+1 555 456 7890', 'national_id', 'NID123456', 'Canada', 750);

-- Insert sample staff
INSERT INTO public.hotel_staff (first_name, last_name, email, phone, role, shift, salary) VALUES
('Michael', 'Brown', 'michael.b@hotel.com', '+1 555 111 2222', 'manager', 'morning', 5000),
('Emily', 'Davis', 'emily.d@hotel.com', '+1 555 222 3333', 'receptionist', 'morning', 2500),
('David', 'Lee', 'david.l@hotel.com', '+1 555 333 4444', 'receptionist', 'evening', 2500),
('Anna', 'Martinez', 'anna.m@hotel.com', '+1 555 444 5555', 'housekeeping', 'morning', 1800),
('Robert', 'Taylor', 'robert.t@hotel.com', '+1 555 555 6666', 'security', 'night', 2200);