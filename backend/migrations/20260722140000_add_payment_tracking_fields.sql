-- Migration to add payment tracking fields to hotel_orders
-- Supports flexible payment: full / partial / later
-- Date: 2026-07-22

BEGIN;

-- Add payment tracking columns to hotel_orders
ALTER TABLE public.hotel_orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_plan TEXT
    CHECK (payment_plan IN ('full', 'partial', 'later') OR payment_plan IS NULL);

-- Indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_hotel_orders_payment_status ON public.hotel_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_hotel_orders_payment_plan ON public.hotel_orders(payment_plan) WHERE payment_plan IS NOT NULL;

-- Backfill existing orders: any order with status 'paid' or 'settled' gets payment_status='paid'
UPDATE public.hotel_orders
SET payment_status = 'paid'
WHERE status IN ('paid', 'settled') AND payment_status = 'unpaid';

COMMIT;
