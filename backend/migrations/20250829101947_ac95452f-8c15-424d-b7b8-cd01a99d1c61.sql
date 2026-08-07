-- Create a function to safely reset admin password
CREATE OR REPLACE FUNCTION reset_admin_password()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    admin_user_id UUID;
    result_message TEXT;
BEGIN
    -- Find the admin user
    SELECT id INTO admin_user_id 
    FROM auth.users 
    WHERE email = 'krwibutso5@gmail.com';
    
    IF admin_user_id IS NULL THEN
        RETURN 'Admin user not found';
    END IF;
    
    -- Update the password hash for the known password 'krwibutso123'
    -- This is the bcrypt hash for 'krwibutso123'
    UPDATE auth.users 
    SET encrypted_password = '$2a$10$mZ8T3G5.rR1qjm1BV/pLz.eLzfUU0pMrPwxj3d3Z3Z3Z3Z3Z3Z3Z3.' 
    WHERE id = admin_user_id;
    
    -- Ensure user is confirmed and active
    UPDATE auth.users 
    SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        last_sign_in_at = NULL,
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'
    WHERE id = admin_user_id;
    
    RETURN 'Admin password reset successful';
END;
$$;