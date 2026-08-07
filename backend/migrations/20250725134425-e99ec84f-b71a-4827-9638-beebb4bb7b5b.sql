-- Create customers table for customer management
CREATE TABLE public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS


-- Create policies for customers

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add customer_id to sales table to link customers
ALTER TABLE public.sales 
ADD COLUMN customer_id UUID REFERENCES public.customers(id);

-- Create index for better performance
CREATE INDEX idx_customers_phone ON public.customers(phone);
CREATE INDEX idx_sales_customer_id ON public.sales(customer_id);