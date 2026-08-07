-- Fix the security definer view issue by creating a regular view instead
DROP VIEW IF EXISTS products_with_calculated_stock;

-- Create a regular view (without SECURITY DEFINER)
CREATE VIEW products_with_calculated_stock AS
SELECT 
    p.*,
    COALESCE(batch_data.calculated_stock, 0) as calculated_stock,
    batch_data.next_expiry_date,
    batch_data.current_selling_price
FROM products p
LEFT JOIN (
    SELECT 
        product_id,
        SUM(quantity) as calculated_stock,
        MIN(expiry_date) as next_expiry_date,
        AVG(selling_price) as current_selling_price
    FROM product_batches 
    WHERE quantity > 0
    GROUP BY product_id
) batch_data ON p.id = batch_data.product_id;

-- Ensure trigger exists for handling new users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update the handle_new_user function to be more robust
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Input validation
  IF NEW.id IS NULL OR NEW.email IS NULL THEN
    RAISE EXCEPTION 'User ID and email are required';
  END IF;
  
  -- Create profile regardless of confirmation status when email confirmation is disabled
  INSERT INTO public.profiles (user_id, email, first_name, last_name)
  VALUES (
    NEW.id, 
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'last_name', '')
  )
  ON CONFLICT (user_id) DO NOTHING;
  
  -- Also ensure there's a user role (default to 'user' if none exists)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Fix existing unconfirmed users by confirming them
-- Only update email_confirmed_at, not the generated confirmed_at column
UPDATE auth.users 
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email_confirmed_at IS NULL AND confirmation_sent_at IS NOT NULL;

-- Ensure profiles and roles exist for all users who might be missing them
INSERT INTO public.profiles (user_id, email, first_name, last_name)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data ->> 'first_name', ''),
  COALESCE(au.raw_user_meta_data ->> 'last_name', '')
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.user_id
WHERE p.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'user'
FROM auth.users au
LEFT JOIN public.user_roles ur ON au.id = ur.user_id
WHERE ur.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;