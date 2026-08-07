-- Drop and recreate get_user_by_email with correct signature
DROP FUNCTION IF EXISTS public.get_user_by_email(text);

CREATE FUNCTION public.get_user_by_email(user_email text)
RETURNS TABLE(created_at timestamp with time zone, email text, user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;
  
  IF user_email IS NULL OR user_email = '' THEN
    RAISE EXCEPTION 'Email address is required';
  END IF;
  
  RETURN QUERY
  SELECT au.created_at, au.email::text, au.id
  FROM auth.users au
  WHERE au.email = user_email
  LIMIT 1;
END;
$$;

-- Fix other functions with search_path
CREATE OR REPLACE FUNCTION public.get_user_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer FROM auth.users;
$$;

CREATE OR REPLACE FUNCTION public.log_security_event(event_type text, user_id_param uuid DEFAULT NULL, details jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF event_type IS NULL OR event_type = '' THEN
    RAISE EXCEPTION 'Event type is required';
  END IF;
  
  INSERT INTO public.security_audit_log (
    event_type,
    user_id,
    details,
    created_at
  ) VALUES (
    event_type,
    user_id_param,
    details,
    now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_vehicle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Fix overly permissive RLS policies
DROP POLICY IF EXISTS "Edge functions can update listings" ON public.listings;
DROP POLICY IF EXISTS "Edge functions can update payments" ON public.payments;


