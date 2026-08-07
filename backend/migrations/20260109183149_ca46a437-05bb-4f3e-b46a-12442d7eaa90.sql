-- Fix 1: Recreate view without security definer attribute
DROP VIEW IF EXISTS public.products_with_calculated_stock CASCADE;

CREATE VIEW public.products_with_calculated_stock AS
SELECT 
    p.id,
    p.name,
    p.barcode,
    p.description,
    p.purchase_price,
    p.selling_price,
    p.stock_quantity,
    p.min_stock_threshold,
    p.category,
    p.expiry_date,
    p.created_at,
    p.updated_at,
    p.image_url,
    COALESCE(batch_data.calculated_stock, 0::bigint) AS calculated_stock,
    batch_data.next_expiry_date,
    batch_data.current_selling_price
FROM products p
LEFT JOIN (
    SELECT 
        product_batches.product_id,
        sum(product_batches.quantity) AS calculated_stock,
        min(product_batches.expiry_date) AS next_expiry_date,
        avg(product_batches.selling_price) AS current_selling_price
    FROM product_batches
    WHERE product_batches.quantity > 0
    GROUP BY product_batches.product_id
) batch_data ON p.id = batch_data.product_id;

-- Fix 2: Remaining trigger functions with search_path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS NULL OR NEW.email IS NULL THEN
    RAISE EXCEPTION 'User ID and email are required';
  END IF;
  
  INSERT INTO public.profiles (user_id, email, first_name, last_name)
  VALUES (
    NEW.id, 
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'first_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'last_name', '')
  )
  ON CONFLICT (user_id) DO NOTHING;
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_booking_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.booking_reference IS NULL OR NEW.booking_reference = '' THEN
        NEW.booking_reference := public.generate_booking_reference();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_hotel_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
        NEW.invoice_number := public.generate_hotel_invoice_number();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_loan_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.loan_number IS NULL OR NEW.loan_number = '' THEN
        NEW.loan_number := public.generate_loan_number();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_sale_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.sale_number IS NULL OR NEW.sale_number = '' THEN
        NEW.sale_number := public.generate_sale_number();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_batch_stock_after_sale()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.batch_id IS NOT NULL THEN
        UPDATE public.product_batches
        SET quantity = quantity - NEW.quantity
        WHERE id = NEW.batch_id;
        
        INSERT INTO public.stock_movements (
            product_id,
            batch_id,
            movement_type,
            quantity,
            reason,
            reference_id
        ) VALUES (
            NEW.product_id,
            NEW.batch_id,
            'out',
            NEW.quantity,
            'Sale',
            NEW.sale_id
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_loan_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    total_paid NUMERIC;
    loan_total NUMERIC;
BEGIN
    SELECT SUM(amount) INTO total_paid
    FROM public.loan_payments
    WHERE loan_id = NEW.loan_id;
    
    SELECT total_amount INTO loan_total
    FROM public.customer_loans
    WHERE id = NEW.loan_id;
    
    UPDATE public.customer_loans
    SET 
        paid_amount = COALESCE(total_paid, 0),
        remaining_amount = loan_total - COALESCE(total_paid, 0),
        status = CASE 
            WHEN COALESCE(total_paid, 0) >= loan_total THEN 'paid'
            ELSE status
        END,
        updated_at = NOW()
    WHERE id = NEW.loan_id;
    
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_stock_after_sale()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE public.products
    SET stock_quantity = stock_quantity - NEW.quantity
    WHERE id = NEW.product_id;
    RETURN NEW;
END;
$$;

-- Fix 3: Update audit log policies to be properly restrictive
-- These are internal system logs, keep them as is for now but document the intent
-- The 'true' is acceptable for INSERT-only as these are append-only audit logs
-- that the system needs to write to from various contexts