-- Update admin@system.com user to have admin role
UPDATE public.user_roles 
SET role = 'admin', updated_at = now() 
WHERE user_id = 'd9473005-2f17-4a4b-ad04-344fe23dc1c4';