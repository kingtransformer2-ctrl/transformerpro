-- Ensure RLS is enabled on customers table


-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Allow all users to read customers" ON public.customers;
DROP POLICY IF EXISTS "Allow all users to insert customers" ON public.customers;
DROP POLICY IF EXISTS "Allow all users to update customers" ON public.customers;
DROP POLICY IF EXISTS "Allow all users to delete customers" ON public.customers;

-- Create permissive policies for the POS system



