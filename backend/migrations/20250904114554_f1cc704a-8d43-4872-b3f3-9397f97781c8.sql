-- Check if the auth schema has the required tables and fix any issues
-- First, let's make sure the auth schema is properly set up

-- Ensure the auth.users table has the correct structure
DO $$
BEGIN
  -- Check if instance_id column exists and add it if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'auth' 
    AND table_name = 'users' 
    AND column_name = 'instance_id'
  ) THEN
    ALTER TABLE auth.users ADD COLUMN instance_id uuid;
  END IF;
  
  -- Update any users that might have NULL instance_id
  UPDATE auth.users 
  SET instance_id = '00000000-0000-0000-0000-000000000000' 
  WHERE instance_id IS NULL;
END $$;

-- Fix any potential auth issues by ensuring required fields are populated
UPDATE auth.users 
SET 
  aud = COALESCE(aud, 'authenticated'),
  role = COALESCE(role, 'authenticated'),
  updated_at = COALESCE(updated_at, created_at),
  raw_app_meta_data = COALESCE(raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
  raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
WHERE email IN ('test@example.com', 'krwibutso5@gmail.com', 'admin@system.com');

-- Create a completely fresh test user to ensure it works
DELETE FROM auth.users WHERE email = 'demo@test.com';

INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  phone_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token,
  aud,
  role
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'demo@test.com',
  crypt('demo123', gen_salt('bf')),
  NOW(),
  NULL,
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"first_name":"Demo","last_name":"User","email":"demo@test.com"}'::jsonb,
  NOW(),
  NOW(),
  '',
  '',
  '',
  '',
  'authenticated',
  'authenticated'
);