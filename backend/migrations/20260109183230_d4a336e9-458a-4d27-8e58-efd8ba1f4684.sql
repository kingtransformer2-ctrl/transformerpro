-- Fix remaining functions that need search_path
DROP FUNCTION IF EXISTS public.reset_admin_password();

CREATE FUNCTION public.reset_admin_password()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    admin_user_id UUID;
    result_message TEXT;
BEGIN
    SELECT id INTO admin_user_id 
    FROM auth.users 
    WHERE email = 'krwibutso5@gmail.com';
    
    IF admin_user_id IS NULL THEN
        RETURN 'Admin user not found';
    END IF;
    
    UPDATE auth.users 
    SET encrypted_password = '$2a$10$mZ8T3G5.rR1qjm1BV/pLz.eLzfUU0pMrPwxj3d3Z3Z3Z3Z3Z3Z3Z3.' 
    WHERE id = admin_user_id;
    
    UPDATE auth.users 
    SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        last_sign_in_at = NULL,
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'
    WHERE id = admin_user_id;
    
    RETURN 'Admin password reset successful';
END;
$$;

-- Fix safe_update_user_role functions
DROP FUNCTION IF EXISTS public.safe_update_user_role(uuid, text);
DROP FUNCTION IF EXISTS public.safe_update_user_role(uuid, text, text, text, text);

CREATE FUNCTION public.safe_update_user_role(
  target_user_id uuid, 
  new_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_role text;
  target_current_role text;
BEGIN
  IF target_user_id IS NULL OR new_role IS NULL THEN
    RAISE EXCEPTION 'User ID and role are required';
  END IF;
  
  IF new_role NOT IN ('admin', 'moderator', 'user', 'manager', 'cashier') THEN
    RAISE EXCEPTION 'Invalid role specified';
  END IF;
  
  SELECT role INTO current_user_role 
  FROM public.user_roles 
  WHERE user_id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can modify user roles';
  END IF;
  
  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot modify your own role';
  END IF;
  
  SELECT role INTO target_current_role 
  FROM public.user_roles 
  WHERE user_id = target_user_id;
  
  PERFORM public.log_security_event(
    'role_change_attempt',
    auth.uid(),
    jsonb_build_object(
      'target_user_id', target_user_id,
      'old_role', target_current_role,
      'new_role', new_role
    )
  );
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, new_role)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    role = EXCLUDED.role,
    updated_at = now();
  
  RETURN true;
END;
$$;

CREATE FUNCTION public.safe_update_user_role(
  target_user_id uuid, 
  new_role text,
  reason text DEFAULT NULL,
  ip_address text DEFAULT NULL,
  user_agent text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_role text;
  target_current_role text;
  target_user_exists boolean;
BEGIN
  IF target_user_id IS NULL OR new_role IS NULL THEN
    RAISE EXCEPTION 'User ID and role are required';
  END IF;
  
  IF new_role NOT IN ('admin', 'manager', 'cashier', 'user') THEN
    RAISE EXCEPTION 'Invalid role specified. Must be: admin, manager, cashier, or user';
  END IF;
  
  SELECT role INTO current_user_role 
  FROM public.user_roles 
  WHERE user_id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RAISE EXCEPTION 'Access denied. Only administrators can modify user roles.';
  END IF;
  
  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot modify your own role for security reasons';
  END IF;
  
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = target_user_id) INTO target_user_exists;
  IF NOT target_user_exists THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;
  
  SELECT role INTO target_current_role 
  FROM public.user_roles 
  WHERE user_id = target_user_id;
  
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
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, new_role)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    role = EXCLUDED.role,
    updated_at = now();
  
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