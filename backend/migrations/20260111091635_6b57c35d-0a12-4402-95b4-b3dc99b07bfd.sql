-- Add is_system column to role_permissions to distinguish built-in vs custom roles
ALTER TABLE public.role_permissions 
ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT 'default',
ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'Shield';

-- Mark existing roles as system roles
UPDATE public.role_permissions 
SET is_system = true 
WHERE role IN ('admin', 'manager', 'cashier', 'user');

-- Create function to create a custom role
CREATE OR REPLACE FUNCTION public.create_custom_role(
  role_name TEXT,
  role_description TEXT DEFAULT NULL,
  role_color TEXT DEFAULT 'default',
  role_icon TEXT DEFAULT 'Shield',
  pos_routes_arr TEXT[] DEFAULT ARRAY[]::TEXT[],
  hotel_routes_arr TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  -- Only admins can create roles
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied. Only administrators can create custom roles.';
  END IF;
  
  -- Validate role name
  IF role_name IS NULL OR TRIM(role_name) = '' THEN
    RAISE EXCEPTION 'Role name is required';
  END IF;
  
  -- Check for duplicate role names
  IF EXISTS (SELECT 1 FROM public.role_permissions WHERE LOWER(role) = LOWER(TRIM(role_name))) THEN
    RAISE EXCEPTION 'A role with this name already exists';
  END IF;
  
  -- Insert the new role
  INSERT INTO public.role_permissions (role, description, color, icon, pos_routes, hotel_routes, is_system)
  VALUES (LOWER(TRIM(role_name)), role_description, role_color, role_icon, pos_routes_arr, hotel_routes_arr, false)
  RETURNING id INTO new_id;
  
  RETURN new_id;
END;
$$;

-- Create function to delete a custom role
CREATE OR REPLACE FUNCTION public.delete_custom_role(role_name TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins can delete roles
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied. Only administrators can delete custom roles.';
  END IF;
  
  -- Cannot delete system roles
  IF EXISTS (SELECT 1 FROM public.role_permissions WHERE role = role_name AND is_system = true) THEN
    RAISE EXCEPTION 'Cannot delete system roles (admin, manager, cashier, user)';
  END IF;
  
  -- Check if any users have this role
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = role_name) THEN
    RAISE EXCEPTION 'Cannot delete role: users are still assigned to this role. Reassign users first.';
  END IF;
  
  -- Delete the role
  DELETE FROM public.role_permissions WHERE role = role_name AND is_system = false;
  
  RETURN true;
END;
$$;

-- Allow RLS policy for custom role operations
DROP POLICY IF EXISTS "Admins can insert role permissions" ON public.role_permissions;

DROP POLICY IF EXISTS "Admins can delete non-system role permissions" ON public.role_permissions;
