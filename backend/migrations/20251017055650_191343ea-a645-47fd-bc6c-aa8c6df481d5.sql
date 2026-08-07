-- Add foreign key constraint between customer_loans and customers
ALTER TABLE public.customer_loans
ADD CONSTRAINT customer_loans_customer_id_fkey
FOREIGN KEY (customer_id)
REFERENCES public.customers(id)
ON DELETE CASCADE;