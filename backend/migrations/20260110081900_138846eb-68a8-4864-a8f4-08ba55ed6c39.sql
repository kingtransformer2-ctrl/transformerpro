-- Create role_permissions table to store customizable permissions per role
CREATE TABLE public.role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL UNIQUE,
    pos_routes TEXT[] NOT NULL DEFAULT '{}',
    hotel_routes TEXT[] NOT NULL DEFAULT '{}',
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS


-- Only admins can manage role permissions

-- All authenticated users can read role permissions (needed for route checking)

-- Insert default permissions for each role
INSERT INTO public.role_permissions (role, pos_routes, hotel_routes, description) VALUES
('admin', 
 ARRAY['/owner', '/settings', '/reports', '/stock', '/products', '/loans', '/', '/pos', '/sales', '/customers', '/scanner', '/notifications'],
 ARRAY['/hotel/settings', '/hotel/staff', '/hotel/reports', '/hotel/billing', '/hotel/service-menu', '/hotel', '/hotel/pos', '/hotel/rooms', '/hotel/bookings', '/hotel/check-in-out', '/hotel/guests', '/hotel/housekeeping'],
 'Full system access'),
('manager',
 ARRAY['/settings', '/reports', '/stock', '/products', '/loans', '/', '/pos', '/sales', '/customers', '/scanner', '/notifications'],
 ARRAY['/hotel/settings', '/hotel/staff', '/hotel/reports', '/hotel/billing', '/hotel/service-menu', '/hotel', '/hotel/pos', '/hotel/rooms', '/hotel/bookings', '/hotel/check-in-out', '/hotel/guests', '/hotel/housekeeping'],
 'Management and operational access'),
('cashier',
 ARRAY['/', '/pos', '/sales', '/customers', '/scanner', '/notifications'],
 ARRAY['/hotel', '/hotel/pos', '/hotel/rooms', '/hotel/bookings', '/hotel/check-in-out', '/hotel/guests', '/hotel/housekeeping'],
 'Point of sale and customer operations'),
('user',
 ARRAY['/', '/notifications'],
 ARRAY['/hotel', '/hotel/housekeeping'],
 'Basic access only');

-- Create trigger for updated_at
CREATE TRIGGER update_role_permissions_updated_at
BEFORE UPDATE ON public.role_permissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();