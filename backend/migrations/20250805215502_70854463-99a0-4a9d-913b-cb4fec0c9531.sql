-- Assign admin role to the current user
INSERT INTO user_roles (user_id, role) 
VALUES ('33c81791-ebbb-4927-a886-6529f0611f4c', 'admin')
ON CONFLICT (user_id) 
DO UPDATE SET role = 'admin', updated_at = now();