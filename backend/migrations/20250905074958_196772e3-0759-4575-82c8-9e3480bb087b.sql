-- Add tax_amount column to sales table
ALTER TABLE public.sales ADD COLUMN tax_amount NUMERIC DEFAULT 0;