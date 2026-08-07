ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS tin_number text;

ALTER TABLE public.hotel_invoices
ADD COLUMN IF NOT EXISTS customer_tin text;

ALTER TABLE public.hotel_orders
ADD COLUMN IF NOT EXISTS customer_tin text;
