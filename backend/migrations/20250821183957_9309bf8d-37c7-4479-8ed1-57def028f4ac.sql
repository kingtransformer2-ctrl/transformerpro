-- Clean up any duplicate users and reset the password for the correct user
-- First, let's identify and delete any old/duplicate users for this email
DELETE FROM auth.users 
WHERE email = 'krwibutso5@gmail.com' 
AND id != (
    SELECT id FROM auth.users 
    WHERE email = 'krwibutso5@gmail.com' 
    ORDER BY created_at DESC 
    LIMIT 1
);

-- Ensure the latest user has confirmed email
UPDATE auth.users 
SET email_confirmed_at = NOW(),
    confirmed_at = NOW()
WHERE email = 'krwibutso5@gmail.com' 
AND email_confirmed_at IS NULL;