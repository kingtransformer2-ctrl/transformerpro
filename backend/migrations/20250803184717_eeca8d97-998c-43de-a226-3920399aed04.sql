-- Add batch_id to sale_items table to track which batch was sold from
ALTER TABLE public.sale_items 
ADD COLUMN batch_id uuid REFERENCES public.product_batches(id) ON DELETE SET NULL;

-- Update the existing trigger to handle batch-based stock deduction
DROP TRIGGER IF EXISTS update_stock_after_sale ON public.sale_items;

-- Create new function for batch-based stock deduction
CREATE OR REPLACE FUNCTION public.update_batch_stock_after_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    -- Input validation
    IF NEW.product_id IS NULL OR NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
        RAISE EXCEPTION 'Invalid product ID or quantity';
    END IF;
    
    -- If batch_id is provided, deduct from that specific batch
    IF NEW.batch_id IS NOT NULL THEN
        UPDATE public.product_batches 
        SET quantity = quantity - NEW.quantity
        WHERE id = NEW.batch_id;
        
        -- Ensure we don't go negative
        IF (SELECT quantity FROM public.product_batches WHERE id = NEW.batch_id) < 0 THEN
            RAISE EXCEPTION 'Insufficient stock in batch';
        END IF;
    END IF;
    
    -- Create stock movement record
    INSERT INTO public.stock_movements (product_id, batch_id, movement_type, quantity, reason, reference_id)
    VALUES (NEW.product_id, NEW.batch_id, 'out', NEW.quantity, 'Sale', NEW.sale_id);
    
    RETURN NEW;
END;
$function$;

-- Create new trigger for batch-based stock updates
CREATE TRIGGER update_batch_stock_after_sale
    AFTER INSERT ON public.sale_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_batch_stock_after_sale();