-- First, ensure all roles in user_roles exist in role_permissions
-- Insert missing roles as custom roles with no permissions
INSERT INTO role_permissions (role, pos_routes, hotel_routes, is_system, description)
SELECT DISTINCT ur.role, ARRAY[]::text[], ARRAY[]::text[], false, 'Auto-created role'
FROM user_roles ur
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions rp WHERE rp.role = ur.role
);

-- Drop the redundant permissions column from user_roles
ALTER TABLE user_roles DROP COLUMN IF EXISTS permissions;

-- Add unique constraint on role_permissions.role if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'role_permissions_role_unique'
  ) THEN
    ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_unique UNIQUE (role);
  END IF;
END $$;

-- Add foreign key from user_roles.role to role_permissions.role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'user_roles_role_fkey'
  ) THEN
    ALTER TABLE user_roles 
    ADD CONSTRAINT user_roles_role_fkey 
    FOREIGN KEY (role) REFERENCES role_permissions(role) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

-- Update delete_custom_role function to check FK constraint
CREATE OR REPLACE FUNCTION delete_custom_role(role_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_system_role boolean;
  user_count integer;
BEGIN
  -- Check if caller is admin
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only administrators can delete roles';
  END IF;
  
  -- Check if role exists and is not a system role
  SELECT is_system INTO is_system_role
  FROM role_permissions
  WHERE role = role_name;
  
  IF is_system_role IS NULL THEN
    RAISE EXCEPTION 'Role does not exist';
  END IF;
  
  IF is_system_role THEN
    RAISE EXCEPTION 'Cannot delete system roles';
  END IF;
  
  -- Check if any users have this role (FK will prevent delete anyway, but give better error)
  SELECT COUNT(*) INTO user_count
  FROM user_roles
  WHERE role = role_name;
  
  IF user_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete role: % users are assigned to this role. Reassign them first.', user_count;
  END IF;
  
  -- Delete the role
  DELETE FROM role_permissions WHERE role = role_name;
  
  RETURN true;
END;
$$;

