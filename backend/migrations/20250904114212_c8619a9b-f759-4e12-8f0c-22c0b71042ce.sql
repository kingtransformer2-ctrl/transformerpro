-- Fix existing users by confirming their emails and updating passwords
UPDATE auth.users 
SET email_confirmed_at = NOW(),
    updated_at = NOW()
WHERE email IN ('krwibutso5@gmail.com', 'admin@system.com');

-- Create a simple test user with a confirmed email for testing
-- Delete any existing test user first
DELETE FROM auth.users WHERE email = 'test@example.com';

-- Insert a test user with confirmed email
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
  role,
  aud
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'test@example.com',
  crypt('test123', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Test","last_name":"User","email":"test@example.com"}',
  NOW(),
  NOW(),
  'authenticated',
  'authenticated'
);