-- Complete reservation check-in and deposit tracking on hotel_orders.
-- Assumption: reservations continue to live in public.hotel_orders so the
-- existing POS, billing, audit, and reporting queries stay on one order table.

ALTER TABLE public.hotel_orders
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_waiter_id UUID,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

UPDATE public.hotel_orders
SET deposit_amount = 0
WHERE deposit_amount IS NULL;

ALTER TABLE public.hotel_orders
  ALTER COLUMN deposit_amount SET DEFAULT 0,
  ALTER COLUMN deposit_amount SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hotel_orders_assigned_waiter_id_fkey'
      AND conrelid = 'public.hotel_orders'::regclass
  ) THEN
    ALTER TABLE public.hotel_orders
      ADD CONSTRAINT hotel_orders_assigned_waiter_id_fkey
      FOREIGN KEY (assigned_waiter_id)
      REFERENCES public.hotel_staff(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_hotel_orders_assigned_waiter_id
  ON public.hotel_orders (assigned_waiter_id);

CREATE INDEX IF NOT EXISTS idx_hotel_orders_checked_in_at
  ON public.hotel_orders (checked_in_at)
  WHERE checked_in_at IS NOT NULL;
