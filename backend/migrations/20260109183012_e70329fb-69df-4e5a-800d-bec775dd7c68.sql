-- Fix 1: Drop and recreate calculate_product_stock with proper return type
DROP FUNCTION IF EXISTS public.calculate_product_stock(uuid);

CREATE FUNCTION public.calculate_product_stock(product_uuid uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF product_uuid IS NULL THEN
        RAISE EXCEPTION 'Product UUID cannot be NULL';
    END IF;
    
    RETURN COALESCE((
        SELECT SUM(quantity) 
        FROM public.product_batches 
        WHERE product_id = product_uuid
    ), 0);
END;
$$;

-- Fix 2: Set search_path on other critical functions
CREATE OR REPLACE FUNCTION public.generate_booking_reference()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    ref TEXT;
BEGIN
    ref := 'BK-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((
        SELECT COALESCE(MAX(CAST(RIGHT(booking_reference, 4) AS INTEGER)), 0) + 1
        FROM public.hotel_bookings 
        WHERE booking_reference LIKE 'BK-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%'
    )::TEXT, 4, '0');
    RETURN ref;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_hotel_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    inv_num TEXT;
BEGIN
    inv_num := 'INV-H-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((
        SELECT COALESCE(MAX(CAST(RIGHT(invoice_number, 4) AS INTEGER)), 0) + 1
        FROM public.hotel_invoices 
        WHERE invoice_number LIKE 'INV-H-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%'
    )::TEXT, 4, '0');
    RETURN inv_num;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_loan_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    loan_num TEXT;
BEGIN
    loan_num := 'LOAN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((
        SELECT COALESCE(MAX(CAST(RIGHT(loan_number, 4) AS INTEGER)), 0) + 1
        FROM public.customer_loans 
        WHERE loan_number LIKE 'LOAN-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%'
    )::TEXT, 4, '0');
    RETURN loan_num;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_sale_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    sale_num TEXT;
BEGIN
    sale_num := 'INV-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((
        SELECT COALESCE(MAX(CAST(RIGHT(sale_number, 4) AS INTEGER)), 0) + 1
        FROM public.sales 
        WHERE sale_number LIKE 'INV-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%'
    )::TEXT, 4, '0');
    RETURN sale_num;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;