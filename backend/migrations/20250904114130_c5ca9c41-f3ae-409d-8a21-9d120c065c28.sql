-- First, let's disable email confirmation for easier testing

-- Create a test user that can login immediately
-- First remove any existing test user
DELETE FROM auth.users WHERE email = 'test@example.com';

-- Insert a confirmed test user
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  last_sign_in_at,
  role,
  aud
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'test@example.com',
  crypt('test123', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Test","last_name":"User"}',
  NOW(),
  NOW(),
  NULL,
  'authenticated',
  'authenticated'
);

-- Also fix the original admin user by confirming their email
UPDATE auth.users 
SET email_confirmed_at = NOW(),
    updated_at = NOW()
WHERE email = 'krwibutso5@gmail.com';

-- And confirm the admin@system.com user
UPDATE auth.users 
SET email_confirmed_at = NOW(),
    updated_at = NOW()
WHERE email = 'admin@system.com';