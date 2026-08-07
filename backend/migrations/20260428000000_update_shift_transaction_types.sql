-- Update hotel_shift_transactions_type_check to include 'refund' and 'void'
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hotel_shift_transactions_type_check'
  ) THEN
    ALTER TABLE public.hotel_shift_transactions DROP CONSTRAINT hotel_shift_transactions_type_check;
  END IF;

  -- Re-add constraint with new types
  ALTER TABLE public.hotel_shift_transactions
    ADD CONSTRAINT hotel_shift_transactions_type_check
    CHECK (type IN ('cash', 'momo', 'card', 'upi', 'bank_transfer', 'refund', 'void'));
END $$;
