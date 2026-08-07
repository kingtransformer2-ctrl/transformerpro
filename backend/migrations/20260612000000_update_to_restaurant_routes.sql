
-- ================================================
-- Update all routes to use /restaurant/ prefix instead of /hotel/
-- ================================================

-- 1. Update all existing role_permissions.hotel_routes from /hotel/... to /restaurant/...
UPDATE public.role_permissions
SET hotel_routes = ARRAY(
  SELECT CASE
    WHEN route = '/hotel/restaurant-dashboard' THEN '/restaurant/dashboard'
    WHEN route = '/hotel/pos' THEN '/restaurant/pos'
    WHEN route = '/hotel/tables' THEN '/restaurant/tables'
    WHEN route = '/hotel/service-menu' THEN '/restaurant/menu'
    WHEN route = '/hotel/kitchen' THEN '/restaurant/kitchen'
    WHEN route = '/hotel/bar' THEN '/restaurant/bar'
    WHEN route = '/hotel/billing' THEN '/restaurant/billing'
    WHEN route = '/hotel/staff' THEN '/restaurant/staff'
    WHEN route = '/hotel/attendance' THEN '/restaurant/attendance'
    WHEN route = '/hotel/shifts' THEN '/restaurant/shifts'
    WHEN route = '/hotel/shift-report' THEN '/restaurant/shift-report'
    WHEN route = '/hotel/finance' THEN '/restaurant/finance'
    WHEN route = '/hotel/reports' THEN '/restaurant/reports'
    WHEN route = '/hotel/settings' THEN '/restaurant/settings'
    WHEN route = '/hotel/customers' THEN '/restaurant/customers'
    WHEN route = '/hotel/products' THEN '/restaurant/products'
    WHEN route = '/hotel/stock' THEN '/restaurant/stock'
    WHEN route = '/hotel/sales' THEN '/restaurant/sales'
    WHEN route = '/hotel/loans' THEN '/restaurant/loans'
    ELSE route
  END
  FROM unnest(hotel_routes) AS route
);

-- 2. Update all existing hotel_staff.allowed_hotel_routes
UPDATE public.hotel_staff
SET allowed_hotel_routes = ARRAY(
  SELECT CASE
    WHEN route = '/hotel/restaurant-dashboard' THEN '/restaurant/dashboard'
    WHEN route = '/hotel/pos' THEN '/restaurant/pos'
    WHEN route = '/hotel/tables' THEN '/restaurant/tables'
    WHEN route = '/hotel/service-menu' THEN '/restaurant/menu'
    WHEN route = '/hotel/kitchen' THEN '/restaurant/kitchen'
    WHEN route = '/hotel/bar' THEN '/restaurant/bar'
    WHEN route = '/hotel/billing' THEN '/restaurant/billing'
    WHEN route = '/hotel/staff' THEN '/restaurant/staff'
    WHEN route = '/hotel/attendance' THEN '/restaurant/attendance'
    WHEN route = '/hotel/shifts' THEN '/restaurant/shifts'
    WHEN route = '/hotel/shift-report' THEN '/restaurant/shift-report'
    WHEN route = '/hotel/finance' THEN '/restaurant/finance'
    WHEN route = '/hotel/reports' THEN '/restaurant/reports'
    WHEN route = '/hotel/settings' THEN '/restaurant/settings'
    WHEN route = '/hotel/customers' THEN '/restaurant/customers'
    WHEN route = '/hotel/products' THEN '/restaurant/products'
    WHEN route = '/hotel/stock' THEN '/restaurant/stock'
    WHEN route = '/hotel/sales' THEN '/restaurant/sales'
    WHEN route = '/hotel/loans' THEN '/restaurant/loans'
    ELSE route
  END
  FROM unnest(allowed_hotel_routes) AS route
);

-- 3. Update enforce_hotel_staff_allowed_routes function to use correct routes
CREATE OR REPLACE FUNCTION public.enforce_hotel_staff_allowed_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_routes text[];
BEGIN
  NEW.role := lower(trim(coalesce(NEW.role, '')));

  CASE NEW.role
    WHEN 'waiter' THEN
      default_routes := ARRAY['/restaurant/pos'];
    WHEN 'waiter_admin' THEN
      default_routes := ARRAY['/restaurant/pos', '/restaurant/tables'];
    WHEN 'chef' THEN
      default_routes := ARRAY['/restaurant/kitchen'];
    WHEN 'barman' THEN
      default_routes := ARRAY['/restaurant/bar'];
    WHEN 'cashier' THEN
      default_routes := ARRAY['/restaurant/billing', '/restaurant/pos'];
    WHEN 'receptionist' THEN
      default_routes := ARRAY['/restaurant/dashboard', '/restaurant/billing', '/restaurant/pos', '/restaurant/tables'];
    WHEN 'housekeeping' THEN
      default_routes := ARRAY['/restaurant/dashboard'];
    WHEN 'security' THEN
      default_routes := ARRAY['/restaurant/dashboard'];
    WHEN 'maintenance' THEN
      default_routes := ARRAY['/restaurant/dashboard'];
    WHEN 'accountant' THEN
      default_routes := ARRAY['/restaurant/finance', '/restaurant/reports'];
    WHEN 'manager' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/tables',
        '/restaurant/menu',
        '/restaurant/kitchen',
        '/restaurant/bar',
        '/restaurant/billing',
        '/restaurant/staff',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/finance',
        '/restaurant/reports',
        '/restaurant/settings',
        '/restaurant/customers',
        '/restaurant/products',
        '/restaurant/stock',
        '/restaurant/sales',
        '/restaurant/loans'
      ];
    WHEN 'owner' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/tables',
        '/restaurant/menu',
        '/restaurant/kitchen',
        '/restaurant/bar',
        '/restaurant/billing',
        '/restaurant/staff',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/finance',
        '/restaurant/reports',
        '/restaurant/settings',
        '/restaurant/customers',
        '/restaurant/products',
        '/restaurant/stock',
        '/restaurant/sales',
        '/restaurant/loans'
      ];
    WHEN 'admin' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/tables',
        '/restaurant/menu',
        '/restaurant/kitchen',
        '/restaurant/bar',
        '/restaurant/billing',
        '/restaurant/staff',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/finance',
        '/restaurant/reports',
        '/restaurant/settings',
        '/restaurant/customers',
        '/restaurant/products',
        '/restaurant/stock',
        '/restaurant/sales',
        '/restaurant/loans'
      ];
    ELSE
      default_routes := ARRAY[]::text[];
  END CASE;

  -- Filter allowed routes: only keep routes present in role's default_routes or custom added (for managers)
  IF NEW.role = 'manager' OR NEW.role = 'owner' OR NEW.role = 'admin' THEN
    NEW.allowed_hotel_routes := ARRAY(
      SELECT DISTINCT route
      FROM unnest(COALESCE(NEW.allowed_hotel_routes, default_routes)) AS route
      WHERE route = ANY(default_routes)
    );
    
    IF COALESCE(array_length(NEW.allowed_hotel_routes, 1), 0) = 0 THEN
      NEW.allowed_hotel_routes := default_routes;
    END IF;
  ELSE
    -- For non-manager roles, enforce only default routes
    NEW.allowed_hotel_routes := default_routes;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Update waiter_admin role's hotel_routes and landing_page
UPDATE public.role_permissions
SET 
  hotel_routes = ARRAY['/restaurant/pos', '/restaurant/tables'],
  landing_page = '/restaurant/pos'
WHERE role = 'waiter_admin';

-- 5. Update all system roles' landing_page and hotel_routes
UPDATE public.role_permissions
SET landing_page = '/restaurant/dashboard'
WHERE role IN ('admin', 'manager', 'cashier', 'owner') AND landing_page IS NULL;

-- 6. Update system roles with complete /restaurant/ routes
-- Admin
UPDATE public.role_permissions
SET hotel_routes = ARRAY[
  '/restaurant/dashboard',
  '/restaurant/pos',
  '/restaurant/tables',
  '/restaurant/menu',
  '/restaurant/kitchen',
  '/restaurant/bar',
  '/restaurant/billing',
  '/restaurant/staff',
  '/restaurant/attendance',
  '/restaurant/shifts',
  '/restaurant/shift-report',
  '/restaurant/finance',
  '/restaurant/reports',
  '/restaurant/settings',
  '/restaurant/customers',
  '/restaurant/products',
  '/restaurant/stock',
  '/restaurant/sales',
  '/restaurant/loans'
]
WHERE role = 'admin' AND is_system = true;

-- Manager
UPDATE public.role_permissions
SET hotel_routes = ARRAY[
  '/restaurant/dashboard',
  '/restaurant/pos',
  '/restaurant/tables',
  '/restaurant/menu',
  '/restaurant/kitchen',
  '/restaurant/bar',
  '/restaurant/billing',
  '/restaurant/staff',
  '/restaurant/attendance',
  '/restaurant/shifts',
  '/restaurant/shift-report',
  '/restaurant/finance',
  '/restaurant/reports',
  '/restaurant/settings',
  '/restaurant/customers',
  '/restaurant/products',
  '/restaurant/stock',
  '/restaurant/sales',
  '/restaurant/loans'
]
WHERE role = 'manager' AND is_system = true;

-- Owner
UPDATE public.role_permissions
SET hotel_routes = ARRAY[
  '/restaurant/dashboard',
  '/restaurant/pos',
  '/restaurant/tables',
  '/restaurant/menu',
  '/restaurant/kitchen',
  '/restaurant/bar',
  '/restaurant/billing',
  '/restaurant/staff',
  '/restaurant/attendance',
  '/restaurant/shifts',
  '/restaurant/shift-report',
  '/restaurant/finance',
  '/restaurant/reports',
  '/restaurant/settings',
  '/restaurant/customers',
  '/restaurant/products',
  '/restaurant/stock',
  '/restaurant/sales',
  '/restaurant/loans'
]
WHERE role = 'owner' AND is_system = true;

-- Cashier
UPDATE public.role_permissions
SET hotel_routes = ARRAY['/restaurant/billing', '/restaurant/pos']
WHERE role = 'cashier' AND is_system = true;

-- Receptionist
UPDATE public.role_permissions
SET hotel_routes = ARRAY['/restaurant/dashboard', '/restaurant/billing', '/restaurant/pos', '/restaurant/tables']
WHERE role = 'receptionist' AND is_system = true;

-- Chef
UPDATE public.role_permissions
SET hotel_routes = ARRAY['/restaurant/kitchen']
WHERE role = 'chef' AND is_system = true;

-- Barman
UPDATE public.role_permissions
SET hotel_routes = ARRAY['/restaurant/bar']
WHERE role = 'barman' AND is_system = true;

-- Housekeeping
UPDATE public.role_permissions
SET hotel_routes = ARRAY['/restaurant/dashboard']
WHERE role = 'housekeeping' AND is_system = true;

-- Security
UPDATE public.role_permissions
SET hotel_routes = ARRAY['/restaurant/dashboard']
WHERE role = 'security' AND is_system = true;

-- Maintenance
UPDATE public.role_permissions
SET hotel_routes = ARRAY['/restaurant/dashboard']
WHERE role = 'maintenance' AND is_system = true;

-- Accountant
UPDATE public.role_permissions
SET hotel_routes = ARRAY['/restaurant/finance', '/restaurant/reports']
WHERE role = 'accountant' AND is_system = true;

-- Waiter
UPDATE public.role_permissions
SET hotel_routes = ARRAY['/restaurant/pos']
WHERE role = 'waiter' AND is_system = true;

-- 7. Add Barista role and update related config
-- Insert or update barista role permissions
INSERT INTO public.role_permissions (
  role, 
  hotel_routes, 
  landing_page, 
  description, 
  is_system, 
  color, 
  icon,
  created_at,
  updated_at
)
VALUES (
  'barista', 
  ARRAY[
    '/restaurant/dashboard',
    '/restaurant/pos',
    '/restaurant/bar',
    '/restaurant/attendance',
    '/restaurant/shifts',
    '/restaurant/shift-report',
    '/restaurant/menu',
    '/restaurant/tables'
  ],
  '/restaurant/bar',
  'Barista role for managing bar operations',
  false,
  'purple',
  'Shield',
  now(),
  now()
)
ON CONFLICT (role)
DO UPDATE SET
  hotel_routes = EXCLUDED.hotel_routes,
  landing_page = EXCLUDED.landing_page,
  description = EXCLUDED.description,
  updated_at = now();

-- Update all barista staff members' allowed routes
UPDATE public.hotel_staff
SET allowed_hotel_routes = ARRAY[
  '/restaurant/dashboard',
  '/restaurant/pos',
  '/restaurant/bar',
  '/restaurant/attendance',
  '/restaurant/shifts',
  '/restaurant/shift-report',
  '/restaurant/menu',
  '/restaurant/tables'
]
WHERE role = 'barista';

-- 8. Update enforce_hotel_staff_allowed_routes function to include barista
CREATE OR REPLACE FUNCTION public.enforce_hotel_staff_allowed_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_routes text[];
BEGIN
  NEW.role := lower(trim(coalesce(NEW.role, '')));

  CASE NEW.role
    WHEN 'waiter' THEN
      default_routes := ARRAY['/restaurant/pos'];
    WHEN 'waiter_admin' THEN
      default_routes := ARRAY['/restaurant/pos', '/restaurant/tables'];
    WHEN 'chef' THEN
      default_routes := ARRAY['/restaurant/kitchen'];
    WHEN 'barman' THEN
      default_routes := ARRAY['/restaurant/bar'];
    WHEN 'barista' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/bar',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/menu',
        '/restaurant/tables'
      ];
    WHEN 'cashier' THEN
      default_routes := ARRAY['/restaurant/billing', '/restaurant/pos'];
    WHEN 'receptionist' THEN
      default_routes := ARRAY['/restaurant/dashboard', '/restaurant/billing', '/restaurant/pos', '/restaurant/tables'];
    WHEN 'housekeeping' THEN
      default_routes := ARRAY['/restaurant/dashboard'];
    WHEN 'security' THEN
      default_routes := ARRAY['/restaurant/dashboard'];
    WHEN 'maintenance' THEN
      default_routes := ARRAY['/restaurant/dashboard'];
    WHEN 'accountant' THEN
      default_routes := ARRAY['/restaurant/finance', '/restaurant/reports'];
    WHEN 'manager' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/tables',
        '/restaurant/menu',
        '/restaurant/kitchen',
        '/restaurant/bar',
        '/restaurant/billing',
        '/restaurant/staff',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/finance',
        '/restaurant/reports',
        '/restaurant/settings',
        '/restaurant/customers',
        '/restaurant/products',
        '/restaurant/stock',
        '/restaurant/sales',
        '/restaurant/loans'
      ];
    WHEN 'owner' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/tables',
        '/restaurant/menu',
        '/restaurant/kitchen',
        '/restaurant/bar',
        '/restaurant/billing',
        '/restaurant/staff',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/finance',
        '/restaurant/reports',
        '/restaurant/settings',
        '/restaurant/customers',
        '/restaurant/products',
        '/restaurant/stock',
        '/restaurant/sales',
        '/restaurant/loans'
      ];
    WHEN 'admin' THEN
      default_routes := ARRAY[
        '/restaurant/dashboard',
        '/restaurant/pos',
        '/restaurant/tables',
        '/restaurant/menu',
        '/restaurant/kitchen',
        '/restaurant/bar',
        '/restaurant/billing',
        '/restaurant/staff',
        '/restaurant/attendance',
        '/restaurant/shifts',
        '/restaurant/shift-report',
        '/restaurant/finance',
        '/restaurant/reports',
        '/restaurant/settings',
        '/restaurant/customers',
        '/restaurant/products',
        '/restaurant/stock',
        '/restaurant/sales',
        '/restaurant/loans'
      ];
    ELSE
      default_routes := ARRAY[]::text[];
  END CASE;

  -- Filter allowed routes: only keep routes present in role's default_routes or custom added (for managers)
  IF NEW.role = 'manager' OR NEW.role = 'owner' OR NEW.role = 'admin' THEN
    NEW.allowed_hotel_routes := ARRAY(
      SELECT DISTINCT route
      FROM unnest(COALESCE(NEW.allowed_hotel_routes, default_routes)) AS route
      WHERE route = ANY(default_routes)
    );
    
    IF COALESCE(array_length(NEW.allowed_hotel_routes, 1), 0) = 0 THEN
      NEW.allowed_hotel_routes := default_routes;
    END IF;
  ELSE
    -- For non-manager roles, enforce only default routes
    NEW.allowed_hotel_routes := default_routes;
  END IF;

  RETURN NEW;
END;
$$;

-- 9. Update delete_custom_role function to check hotel_staff as well as user_roles
CREATE OR REPLACE FUNCTION public.delete_custom_role(role_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_system_role boolean;
  user_count integer;
  staff_count integer;
BEGIN
  -- Check if caller is admin
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only administrators can delete roles';
  END IF;
  
  -- Check if role exists and is not a system role
  SELECT is_system INTO is_system_role
  FROM role_permissions
  WHERE role = role_name;
  
  IF is_system_role IS NULL THEN
    RAISE EXCEPTION 'Role does not exist';
  END IF;
  
  IF is_system_role THEN
    RAISE EXCEPTION 'Cannot delete system roles';
  END IF;
  
  -- Check if any users have this role
  SELECT COUNT(*) INTO user_count
  FROM user_roles
  WHERE role = role_name;
  
  -- Check if any hotel staff have this role
  SELECT COUNT(*) INTO staff_count
  FROM hotel_staff
  WHERE role = role_name;
  
  IF user_count > 0 OR staff_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete role: % users and % staff are assigned. Reassign them first.', user_count, staff_count;
  END IF;
  
  -- Delete the role
  DELETE FROM role_permissions WHERE role = role_name;
  
  RETURN true;
END;
$$;

-- 10. Add RLS policy for hotel_orders to allow authenticated users to update orders
DROP POLICY IF EXISTS "Authenticated users can manage hotel_orders" ON public.hotel_orders;

-- 11. Add RLS policy for hotel_order_items to allow authenticated users to update items
DROP POLICY IF EXISTS "Authenticated users can manage hotel_order_items" ON public.hotel_order_items;

-- 12. Add RLS policy for hotel_invoices to allow authenticated users to update invoices
DROP POLICY IF EXISTS "Authenticated users can manage hotel_invoices" ON public.hotel_invoices;

-- 13. Add RLS policy for hotel_invoice_items to allow authenticated users to update invoice items
DROP POLICY IF EXISTS "Authenticated users can manage hotel_invoice_items" ON public.hotel_invoice_items;

-- 14. Add RLS policy for hotel_payments to allow authenticated users to update payments
DROP POLICY IF EXISTS "Authenticated users can manage hotel_payments" ON public.hotel_payments;

-- 15. Ensure company_profile table exists for receipt printing
CREATE TABLE IF NOT EXISTS public.company_profile (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_name TEXT DEFAULT 'Restaurant',
    address TEXT,
    phone TEXT,
    email TEXT,
    logo_url TEXT,
    tax_id TEXT,
    tax_rate NUMERIC(5, 2) DEFAULT 18.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns if they don't exist
DO $$
BEGIN
    -- Add tax_rate if not exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'company_profile'
        AND column_name = 'tax_rate'
    ) THEN
        ALTER TABLE public.company_profile
        ADD COLUMN tax_rate NUMERIC(5, 2) DEFAULT 18.00;
    END IF;
    
    -- Add address if not exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'company_profile'
        AND column_name = 'address'
    ) THEN
        ALTER TABLE public.company_profile
        ADD COLUMN address TEXT;
    END IF;
    
    -- Add phone if not exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'company_profile'
        AND column_name = 'phone'
    ) THEN
        ALTER TABLE public.company_profile
        ADD COLUMN phone TEXT;
    END IF;
    
    -- Add email if not exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'company_profile'
        AND column_name = 'email'
    ) THEN
        ALTER TABLE public.company_profile
        ADD COLUMN email TEXT;
    END IF;
    
    -- Add logo_url if not exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'company_profile'
        AND column_name = 'logo_url'
    ) THEN
        ALTER TABLE public.company_profile
        ADD COLUMN logo_url TEXT;
    END IF;
    
    -- Add tax_id if not exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'company_profile'
        AND column_name = 'tax_id'
    ) THEN
        ALTER TABLE public.company_profile
        ADD COLUMN tax_id TEXT;
    END IF;
    
    -- Add created_at if not exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'company_profile'
        AND column_name = 'created_at'
    ) THEN
        ALTER TABLE public.company_profile
        ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    
    -- Add updated_at if not exists
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'company_profile'
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE public.company_profile
        ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- Add RLS for company_profile
DROP POLICY IF EXISTS "Authenticated users can view company_profile" ON public.company_profile;

DROP POLICY IF EXISTS "Authenticated users can update company_profile" ON public.company_profile;

-- Insert default company profile if none exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.company_profile) THEN
        INSERT INTO public.company_profile (id, company_name)
        VALUES (gen_random_uuid(), 'Restaurant');
    END IF;
END $$;

-- 16. Add company_profile to realtime
-- Check if table is already in publication first
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'company_profile'
    ) THEN
    END IF;
END $$;




