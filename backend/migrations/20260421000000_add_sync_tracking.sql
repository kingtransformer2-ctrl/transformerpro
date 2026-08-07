-- Migration to add sync tracking to all major tables
-- This allows for silent background sync from Local ProLiant to Supabase Cloud

DO $$
DECLARE
    t text;
    tables_to_sync text[] := ARRAY[
        'products', 
        'sales', 
        'sale_items', 
        'customers', 
        'product_batches', 
        'stock_movements',
        'hotel_bookings',
        'hotel_rooms',
        'hotel_guests',
        'hotel_orders',
        'hotel_order_items',
        'customer_loans',
        'loan_payments',
        'settings'
    ];
BEGIN
    FOREACH t IN ARRAY tables_to_sync
    LOOP
        -- Add is_synced column if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'is_synced') THEN
            EXECUTE format('ALTER TABLE public.%I ADD COLUMN is_synced boolean DEFAULT false', t);
        END IF;

        -- Add last_synced_at column if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'last_synced_at') THEN
            EXECUTE format('ALTER TABLE public.%I ADD COLUMN last_synced_at timestamp with time zone', t);
        END IF;

        -- Add index for performance
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I_sync_idx ON public.%I (is_synced)', t, t);
    END LOOP;
END $$;
