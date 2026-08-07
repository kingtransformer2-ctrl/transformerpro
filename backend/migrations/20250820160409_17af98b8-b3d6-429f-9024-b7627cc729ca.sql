-- First, ensure the user exists and is confirmed
UPDATE auth.users 
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email = 'krwibutso5@gmail.com' AND email_confirmed_at IS NULL;

-- Ensure the user has a profile
INSERT INTO public.profiles (user_id, email, first_name, last_name)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data ->> 'first_name', ''),
  COALESCE(au.raw_user_meta_data ->> 'last_name', '')
FROM auth.users au
WHERE au.email = 'krwibutso5@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- Make this user an admin
INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'admin'
FROM auth.users au
WHERE au.email = 'krwibutso5@gmail.com'
ON CONFLICT (user_id) 
DO UPDATE SET role = 'admin', updated_at = now();