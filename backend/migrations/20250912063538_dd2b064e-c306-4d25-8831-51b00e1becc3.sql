-- Create customer loans table
CREATE TABLE public.customer_loans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL,
  loan_number TEXT NOT NULL UNIQUE,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  remaining_amount NUMERIC NOT NULL DEFAULT 0,
  interest_rate NUMERIC DEFAULT 0,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'overdue', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create loan items table
CREATE TABLE public.loan_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id UUID NOT NULL,
  product_id UUID NOT NULL,
  batch_id UUID,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC NOT NULL,
  total_price NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create loan payments table
CREATE TABLE public.loan_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id UUID NOT NULL,
  amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reference_number TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS




-- Create RLS policies for customer_loans




-- Create RLS policies for loan_items




-- Create RLS policies for loan_payments




-- Create function to generate loan number
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

-- Create trigger to set loan number
CREATE OR REPLACE FUNCTION public.set_loan_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.loan_number IS NULL OR NEW.loan_number = '' THEN
        NEW.loan_number := public.generate_loan_number();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_loan_number_trigger
BEFORE INSERT ON public.customer_loans
FOR EACH ROW
EXECUTE FUNCTION public.set_loan_number();

-- Create trigger to update remaining amount when payments are made
CREATE OR REPLACE FUNCTION public.update_loan_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Update the loan's paid amount and remaining amount
    UPDATE public.customer_loans 
    SET 
        paid_amount = (
            SELECT COALESCE(SUM(amount), 0) 
            FROM public.loan_payments 
            WHERE loan_id = NEW.loan_id
        ),
        remaining_amount = total_amount - (
            SELECT COALESCE(SUM(amount), 0) 
            FROM public.loan_payments 
            WHERE loan_id = NEW.loan_id
        ),
        status = CASE 
            WHEN total_amount <= (
                SELECT COALESCE(SUM(amount), 0) 
                FROM public.loan_payments 
                WHERE loan_id = NEW.loan_id
            ) THEN 'completed'
            ELSE status
        END,
        updated_at = now()
    WHERE id = NEW.loan_id;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER update_loan_balance_trigger
AFTER INSERT ON public.loan_payments
FOR EACH ROW
EXECUTE FUNCTION public.update_loan_balance();

-- Create trigger for updated_at
CREATE TRIGGER update_customer_loans_updated_at
BEFORE UPDATE ON public.customer_loans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();