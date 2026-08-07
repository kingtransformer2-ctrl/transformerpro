-- Create settings table for system-wide configuration
CREATE TABLE public.settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(category, key)
);

-- Enable RLS


-- Create policies for settings

-- Create user roles table
CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'user',
  permissions jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS


-- Create policies for user roles

-- Create company profiles table
CREATE TABLE public.company_profile (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name text NOT NULL,
  address text,
  phone text,
  email text,
  tax_number text,
  logo_url text,
  business_hours jsonb DEFAULT '{}'::jsonb,
  tax_rates jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS


-- Create policies for company profile

-- Add trigger for updating timestamps
CREATE TRIGGER update_settings_updated_at
BEFORE UPDATE ON public.settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_roles_updated_at
BEFORE UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_company_profile_updated_at
BEFORE UPDATE ON public.company_profile
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings
INSERT INTO public.settings (category, key, value, description) VALUES
-- System Settings
('system', 'currency', '"USD"', 'Default currency for the system'),
('system', 'timezone', '"UTC"', 'System timezone'),
('system', 'date_format', '"DD/MM/YYYY"', 'Date display format'),
('system', 'language', '"en"', 'System language'),

-- Stock Settings
('stock', 'low_stock_threshold', '10', 'Default low stock threshold'),
('stock', 'enable_expiry_alerts', 'true', 'Enable expiry date alerts'),
('stock', 'expiry_alert_days', '30', 'Days before expiry to alert'),
('stock', 'auto_calculate_stock', 'true', 'Auto calculate stock from batches'),

-- POS Settings
('pos', 'default_payment_method', '"cash"', 'Default payment method'),
('pos', 'enable_discounts', 'true', 'Enable discount functionality'),
('pos', 'max_discount_percent', '50', 'Maximum discount percentage'),
('pos', 'enable_customer_display', 'true', 'Show customer display'),

-- Receipt Settings
('receipt', 'header_text', '"Thank you for your purchase!"', 'Receipt header text'),
('receipt', 'footer_text', '"Visit us again!"', 'Receipt footer text'),
('receipt', 'show_logo', 'true', 'Show company logo on receipt'),
('receipt', 'paper_size', '"80mm"', 'Receipt paper size'),

-- Theme Settings
('theme', 'primary_color', '"hsl(221.2, 83.2%, 53.3%)"', 'Primary theme color'),
('theme', 'dark_mode', 'false', 'Enable dark mode by default'),
('theme', 'font_size', '"medium"', 'Default font size'),

-- Notification Settings
('notifications', 'enable_email', 'false', 'Enable email notifications'),
('notifications', 'enable_low_stock_alerts', 'true', 'Enable low stock notifications'),
('notifications', 'enable_expiry_alerts', 'true', 'Enable expiry notifications'),

-- Backup Settings
('backup', 'auto_backup', 'false', 'Enable automatic backups'),
('backup', 'backup_frequency', '"daily"', 'Backup frequency'),
('backup', 'retention_days', '30', 'Backup retention in days');

-- Insert default company profile
INSERT INTO public.company_profile (company_name, address, phone, email, business_hours, tax_rates) VALUES
('StockFlow Store', '123 Main Street, City, Country', '+1234567890', 'info@stockflow.com', 
'{"monday": {"open": "09:00", "close": "18:00"}, "tuesday": {"open": "09:00", "close": "18:00"}, "wednesday": {"open": "09:00", "close": "18:00"}, "thursday": {"open": "09:00", "close": "18:00"}, "friday": {"open": "09:00", "close": "18:00"}, "saturday": {"open": "10:00", "close": "16:00"}, "sunday": {"closed": true}}',
'{"vat": 10, "service_tax": 5}');