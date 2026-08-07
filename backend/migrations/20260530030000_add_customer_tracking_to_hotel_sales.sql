ALTER TABLE public.hotel_invoices
ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS customer_name text,
ADD COLUMN IF NOT EXISTS customer_phone text,
ADD COLUMN IF NOT EXISTS customer_email text,
ADD COLUMN IF NOT EXISTS customer_address text;

ALTER TABLE public.hotel_orders
ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS customer_name text,
ADD COLUMN IF NOT EXISTS customer_phone text,
ADD COLUMN IF NOT EXISTS customer_email text,
ADD COLUMN IF NOT EXISTS customer_address text;

CREATE INDEX IF NOT EXISTS idx_hotel_invoices_customer_id
  ON public.hotel_invoices(customer_id);

CREATE INDEX IF NOT EXISTS idx_hotel_orders_customer_id
  ON public.hotel_orders(customer_id);

UPDATE public.hotel_invoices hi
SET
  customer_name = COALESCE(hi.customer_name, NULLIF(trim(concat_ws(' ', hg.first_name, hg.last_name)), '')),
  customer_phone = COALESCE(hi.customer_phone, hg.phone),
  customer_email = COALESCE(hi.customer_email, hg.email),
  customer_address = COALESCE(hi.customer_address, hg.address)
FROM public.hotel_guests hg
WHERE hi.guest_id = hg.id
  AND (
    hi.customer_name IS NULL
    OR hi.customer_phone IS NULL
    OR hi.customer_email IS NULL
    OR hi.customer_address IS NULL
  );

UPDATE public.hotel_orders ho
SET
  customer_name = COALESCE(ho.customer_name, NULLIF(trim(concat_ws(' ', hg.first_name, hg.last_name)), '')),
  customer_phone = COALESCE(ho.customer_phone, hg.phone),
  customer_email = COALESCE(ho.customer_email, hg.email),
  customer_address = COALESCE(ho.customer_address, hg.address)
FROM public.hotel_bookings hb
JOIN public.hotel_guests hg ON hb.guest_id = hg.id
WHERE ho.booking_id = hb.id
  AND (
    ho.customer_name IS NULL
    OR ho.customer_phone IS NULL
    OR ho.customer_email IS NULL
    OR ho.customer_address IS NULL
  );
