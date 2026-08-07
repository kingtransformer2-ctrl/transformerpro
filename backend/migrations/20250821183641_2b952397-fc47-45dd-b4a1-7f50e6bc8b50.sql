-- Drop the security definer view and recreate as regular view
DROP VIEW IF EXISTS public.products_with_calculated_stock;

-- Recreate as regular view (without SECURITY DEFINER)
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
        product_id,
        SUM(quantity) AS calculated_stock,
        MIN(expiry_date) AS next_expiry_date,
        AVG(selling_price) AS current_selling_price
    FROM product_batches
    WHERE quantity > 0
    GROUP BY product_id
) batch_data ON p.id = batch_data.product_id;