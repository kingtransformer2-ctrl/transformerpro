-- Drop existing function overloads and recreate with custom role support
DROP FUNCTION IF EXISTS public.safe_update_user_role(uuid, text);
DROP FUNCTION IF EXISTS public.safe_update_user_role(uuid, text, text, text, text);

-- Recreate function that validates against role_permissions table instead of hardcoded roles
CREATE OR REPLACE FUNCTION public.safe_update_user_role(
  target_user_id uuid, 
  new_role text, 
  reason text DEFAULT NULL::text, 
  ip_address text DEFAULT NULL::text, 
  user_agent text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_user_role text;
  target_current_role text;
  target_user_exists boolean;
  role_exists boolean;
BEGIN
  -- Validate required parameters
  IF target_user_id IS NULL OR new_role IS NULL THEN
    RAISE EXCEPTION 'User ID and role are required';
  END IF;
  
  -- Validate role exists in role_permissions table (supports custom roles)
  SELECT EXISTS(SELECT 1 FROM public.role_permissions WHERE role = LOWER(new_role)) INTO role_exists;
  IF NOT role_exists THEN
    RAISE EXCEPTION 'Invalid role specified. Role "%" does not exist in the system.', new_role;
  END IF;
  
  -- Check if current user is admin
  SELECT role INTO current_user_role 
  FROM public.user_roles 
  WHERE user_id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Only administrators can modify user roles.';
  END IF;
  
  -- Prevent self-modification
  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot modify your own role for security reasons';
  END IF;
  
  -- Verify target user exists
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;
  
  -- Get current role for audit
  SELECT role INTO target_current_role 
  FROM public.user_roles 
  WHERE user_id = target_user_id;
  
  -- Log the role change in audit table
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
    LOWER(new_role), 
    COALESCE(reason, 'No reason provided'),
    ip_address,
    user_agent
  );
  
  -- Update the user role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, LOWER(new_role))
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    role = EXCLUDED.role,
    updated_at = now();
  
  -- Log security event
  PERFORM public.log_security_event(
    'role_changed_successfully',
    auth.uid(),
    jsonb_build_object(
      'target_user_id', target_user_id,
      'old_role', target_current_role,
      'new_role', LOWER(new_role),
      'reason', reason
    )
  );
  
  RETURN true;
END;
$$;