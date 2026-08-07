-- Create product_batches table for batch/lot tracking
CREATE TABLE public.product_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  purchase_price NUMERIC NOT NULL DEFAULT 0,
  selling_price NUMERIC NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  received_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expiry_date DATE,
  supplier TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(product_id, batch_number)
);

-- Enable RLS for product_batches


-- Create RLS policy for product_batches

-- Create index for efficient queries
CREATE INDEX idx_product_batches_product_id ON public.product_batches(product_id);
CREATE INDEX idx_product_batches_expiry_date ON public.product_batches(expiry_date);

-- Create trigger for updated_at
CREATE TRIGGER update_product_batches_updated_at
BEFORE UPDATE ON public.product_batches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update stock_movements table to reference batches
ALTER TABLE public.stock_movements 
ADD COLUMN batch_id UUID REFERENCES public.product_batches(id);

-- Create function to calculate total stock from batches
CREATE OR REPLACE FUNCTION public.calculate_product_stock(product_uuid UUID)
RETURNS INTEGER AS $$
BEGIN
    RETURN COALESCE((
        SELECT SUM(quantity) 
        FROM public.product_batches 
        WHERE product_id = product_uuid
    ), 0);
END;
$$ LANGUAGE plpgsql;

-- Update products table to show calculated stock
CREATE OR REPLACE VIEW public.products_with_calculated_stock AS
SELECT 
    p.*,
    public.calculate_product_stock(p.id) as calculated_stock,
    (
        SELECT MIN(pb.expiry_date) 
        FROM public.product_batches pb 
        WHERE pb.product_id = p.id AND pb.quantity > 0
    ) as next_expiry_date,
    (
        SELECT pb.selling_price 
        FROM public.product_batches pb 
        WHERE pb.product_id = p.id AND pb.quantity > 0
        ORDER BY pb.expiry_date ASC, pb.created_at ASC
        LIMIT 1
    ) as current_selling_price
FROM public.products p;