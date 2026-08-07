-- Fix the security definer view issue
DROP VIEW IF EXISTS public.products_with_calculated_stock;

-- Create a proper view without security definer
CREATE VIEW public.products_with_calculated_stock AS
SELECT 
    p.*,
    COALESCE(SUM(pb.quantity), 0) AS calculated_stock,
    (
        SELECT MIN(pb2.expiry_date) 
        FROM public.product_batches pb2 
        WHERE pb2.product_id = p.id 
        AND pb2.expiry_date > CURRENT_DATE
        AND pb2.quantity > 0
    ) AS next_expiry_date,
    (
        SELECT pb3.selling_price 
        FROM public.product_batches pb3 
        WHERE pb3.product_id = p.id 
        AND pb3.quantity > 0
        ORDER BY pb3.received_date DESC 
        LIMIT 1
    ) AS current_selling_price
FROM public.products p
LEFT JOIN public.product_batches pb ON p.id = pb.product_id
GROUP BY p.id;

-- Create a secure function to get user by email for admin use
CREATE OR REPLACE FUNCTION public.get_user_by_email(user_email text)
RETURNS TABLE(user_id uuid, email text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Only allow admins to use this function
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;
  
  -- Input validation
  IF user_email IS NULL OR user_email = '' THEN
    RAISE EXCEPTION 'Email address is required';
  END IF;
  
  RETURN QUERY
  SELECT au.id, au.email, au.created_at
  FROM auth.users au
  WHERE au.email = user_email
  LIMIT 1;
END;
$$;

-- Update settings RLS policies to allow authenticated users to manage basic settings
-- while keeping sensitive settings admin-only
DROP POLICY IF EXISTS "Admins can view settings" ON public.settings;
DROP POLICY IF EXISTS "Admins can insert settings" ON public.settings;
DROP POLICY IF EXISTS "Admins can update settings" ON public.settings;
DROP POLICY IF EXISTS "Admins can delete settings" ON public.settings;

-- Create more granular policies




-- Create audit table for user role changes
CREATE TABLE IF NOT EXISTS public.user_role_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    changed_by uuid REFERENCES auth.users(id),
    target_user_id uuid,
    old_role text,
    new_role text,
    reason text,
    ip_address text,
    user_agent text,
    created_at timestamptz DEFAULT now()
);

-- Enable RLS on audit table


-- Only admins can view audit logs

-- System can insert audit records

-- Enhanced safe update user role function with better validation and audit
CREATE OR REPLACE FUNCTION public.safe_update_user_role(
    target_user_id uuid, 
    new_role text, 
    reason text DEFAULT NULL,
    ip_address text DEFAULT NULL,
    user_agent text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  current_user_role text;
  target_current_role text;
  target_user_exists boolean;
BEGIN
  -- Input validation
  IF target_user_id IS NULL OR new_role IS NULL THEN
    RAISE EXCEPTION 'User ID and role are required';
  END IF;
  
  -- Validate role value
  IF new_role NOT IN ('admin', 'manager', 'cashier', 'user') THEN
    RAISE EXCEPTION 'Invalid role specified. Must be: admin, manager, cashier, or user';
  END IF;
  
  -- Check if current user is admin
  SELECT role INTO current_user_role 
  FROM public.user_roles 
  WHERE user_id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Only administrators can modify user roles.';
  END IF;
  
  -- Prevent self-privilege modification (admins can't modify their own roles)
  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot modify your own role for security reasons';
  END IF;
  
  -- Verify target user exists in auth.users
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;
  
  -- Get target user's current role
  SELECT role INTO target_current_role 
  FROM public.user_roles 
  WHERE user_id = target_user_id;
  
  -- Log the role change attempt in audit table
  INSERT INTO public.user_role_audit (
    changed_by, 
    target_user_id, 
    old_role, 
    new_role, 
    reason,
    ip_address,
    user_agent
  ) VALUES (
    auth.uid(), 
    target_user_id, 
    target_current_role, 
    new_role, 
    COALESCE(reason, 'No reason provided'),
    ip_address,
    user_agent
  );
  
  -- Update or insert the role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, new_role)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    role = EXCLUDED.role,
    updated_at = now();
  
  -- Log successful role change in security audit
  PERFORM public.log_security_event(
    'role_changed_successfully',
    auth.uid(),
    jsonb_build_object(
      'target_user_id', target_user_id,
      'old_role', target_current_role,
      'new_role', new_role,
      'reason', reason
    )
  );
  
  RETURN true;
END;
$$;