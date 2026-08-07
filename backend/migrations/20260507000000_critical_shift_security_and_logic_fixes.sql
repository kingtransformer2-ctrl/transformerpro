-- 1. Extend shift transaction types and payment methods
ALTER TABLE public.hotel_shift_transactions DROP CONSTRAINT IF EXISTS hotel_shift_transactions_type_check;
ALTER TABLE public.hotel_shift_transactions ADD CONSTRAINT hotel_shift_transactions_type_check 
  CHECK (type IN ('cash', 'momo', 'card', 'upi', 'bank_transfer', 'refund', 'void', 'room_charge', 'handover', 'split'));

-- Safely extend the payment method enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'hotel_payment_method' AND e.enumlabel = 'momo') THEN
    ALTER TYPE public.hotel_payment_method ADD VALUE 'momo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'hotel_payment_method' AND e.enumlabel = 'room_charge') THEN
    ALTER TYPE public.hotel_payment_method ADD VALUE 'room_charge';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'hotel_payment_method' AND e.enumlabel = 'split') THEN
    ALTER TYPE public.hotel_payment_method ADD VALUE 'split';
  END IF;
END $$;

-- 2. Secure shift opening: Derive staff identity server-side
CREATE OR REPLACE FUNCTION public.open_hotel_staff_shift(
  p_shift_label text DEFAULT NULL,
  p_opening_cash numeric DEFAULT 0,
  p_opening_notes text DEFAULT NULL
)
RETURNS public.hotel_staff_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_staff_id uuid;
  v_staff_role public.staff_role;
  existing_shift public.hotel_staff_shifts;
  created_shift public.hotel_staff_shifts;
BEGIN
  -- Derive staff identity from authenticated user
  SELECT id, role INTO v_staff_id, v_staff_role
  FROM public.hotel_staff
  WHERE user_id = v_auth_uid AND is_active = true
  LIMIT 1;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User is not mapped to an active staff member.'
      USING ERRCODE = '42501';
  END IF;

  -- Match the database unique constraint exactly
  SELECT * INTO existing_shift FROM public.hotel_staff_shifts
  WHERE staff_id = v_staff_id AND closed_at IS NULL 
  ORDER BY opened_at DESC LIMIT 1;

  -- If an open shift exists, return it
  IF FOUND THEN 
    IF existing_shift.status NOT IN ('ACTIVE', 'PENDING') THEN
      UPDATE public.hotel_staff_shifts SET status = 'ACTIVE' WHERE id = existing_shift.id;
      existing_shift.status := 'ACTIVE';
    END IF;
    RETURN existing_shift; 
  END IF;

  -- Otherwise create a new one
  INSERT INTO public.hotel_staff_shifts (
    staff_id, staff_role, shift_label, status, 
    opening_cash, opening_notes, opened_at, started_at
  )
  VALUES (
    v_staff_id, v_staff_role, COALESCE(NULLIF(BTRIM(p_shift_label), ''), 'general'),
    'ACTIVE', COALESCE(p_opening_cash, 0), NULLIF(BTRIM(COALESCE(p_opening_notes, '')), ''),
    now(), now()
  )
  RETURNING * INTO created_shift;

  RETURN created_shift;
END;
$$;

-- Revoke anon access to shift opening
REVOKE EXECUTE ON FUNCTION public.open_hotel_staff_shift(text, numeric, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.open_hotel_staff_shift(text, numeric, text) TO authenticated, service_role;

-- 3. Implement atomic server-side shift closing
CREATE OR REPLACE FUNCTION public.close_hotel_staff_shift(
  p_shift_id uuid,
  p_closing_cash numeric,
  p_closing_notes text DEFAULT NULL,
  p_force_close boolean DEFAULT false
)
RETURNS public.hotel_staff_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_staff_id uuid;
  v_is_manager boolean;
  v_shift public.hotel_staff_shifts;
  v_total_sales numeric := 0;
  v_billed_sales numeric := 0;
  v_cash_sales numeric := 0;
  v_refunds_voids numeric := 0;
  v_expected_cash numeric := 0;
  v_pending_orders_count int := 0;
  v_unpaid_orders_count int := 0;
  v_summary jsonb;
BEGIN
  -- 1. Identify caller
  SELECT id, (role IN ('manager', 'admin', 'owner')) INTO v_staff_id, v_is_manager
  FROM public.hotel_staff
  WHERE user_id = v_auth_uid AND is_active = true;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 2. Lock and load shift
  SELECT * INTO v_shift FROM public.hotel_staff_shifts WHERE id = p_shift_id FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_shift.closed_at IS NOT NULL THEN
    RETURN v_shift; -- Already closed
  END IF;

  -- 3. Ownership check
  IF v_shift.staff_id != v_staff_id AND NOT v_is_manager THEN
    RAISE EXCEPTION 'Unauthorized: You can only close your own shifts.' USING ERRCODE = '42501';
  END IF;

  -- 4. Check for blocking orders
  SELECT count(*) INTO v_pending_orders_count 
  FROM public.hotel_orders 
  WHERE shift_id = p_shift_id AND status IN ('pending', 'preparing', 'ready', 'served');

  SELECT count(*) INTO v_unpaid_orders_count
  FROM public.hotel_orders
  WHERE shift_id = p_shift_id AND status = 'billed';

  IF (v_pending_orders_count > 0 OR v_unpaid_orders_count > 0) AND NOT p_force_close THEN
    RAISE EXCEPTION 'Cannot close shift: % pending and % unpaid orders exist. Resolve them or use manager override.', 
      v_pending_orders_count, v_unpaid_orders_count
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Calculate totals server-side (Safe against client-side tampering)
  SELECT COALESCE(sum(total_amount), 0) INTO v_total_sales FROM public.hotel_orders WHERE shift_id = p_shift_id AND status = 'settled';
  SELECT COALESCE(sum(total_amount), 0) INTO v_billed_sales FROM public.hotel_orders WHERE shift_id = p_shift_id AND status IN ('settled', 'billed');
  
  SELECT COALESCE(sum(amount), 0) INTO v_cash_sales 
  FROM public.hotel_shift_transactions 
  WHERE shift_id = p_shift_id AND type = 'cash';

  SELECT COALESCE(sum(amount), 0) INTO v_refunds_voids 
  FROM public.hotel_shift_transactions 
  WHERE shift_id = p_shift_id AND type IN ('refund', 'void', 'handover');

  v_expected_cash := COALESCE(v_shift.opening_cash, 0) + v_cash_sales + v_refunds_voids;

  -- 6. Build Comprehensive Summary for Self-Reporting
   v_summary := jsonb_build_object(
     'financial', jsonb_build_object(
        'opening_cash', v_shift.opening_cash,
        'total_sales', (SELECT COALESCE(sum(amount), 0) FROM public.hotel_shift_transactions WHERE shift_id = p_shift_id AND type NOT IN ('refund', 'void', 'handover')),
        'cash_sales', v_cash_sales,
        'momo_sales', (SELECT COALESCE(sum(amount), 0) FROM public.hotel_shift_transactions WHERE shift_id = p_shift_id AND type = 'momo'),
        'card_sales', (SELECT COALESCE(sum(amount), 0) FROM public.hotel_shift_transactions WHERE shift_id = p_shift_id AND type IN ('card', 'upi', 'bank_transfer')),
        'room_charges', (SELECT COALESCE(sum(amount), 0) FROM public.hotel_shift_transactions WHERE shift_id = p_shift_id AND type = 'room_charge'),
        'refunds_voids', (SELECT COALESCE(sum(amount), 0) FROM public.hotel_shift_transactions WHERE shift_id = p_shift_id AND type IN ('refund', 'void')),
        'handovers', (SELECT COALESCE(sum(amount), 0) FROM public.hotel_shift_transactions WHERE shift_id = p_shift_id AND type = 'handover'),
        'expected_cash', v_expected_cash,
        'closing_cash', p_closing_cash,
        'difference', p_closing_cash - v_expected_cash
      ),
     'orders', jsonb_build_object(
       'total_orders', (SELECT count(*) FROM public.hotel_orders WHERE shift_id = p_shift_id),
       'completed_orders', (SELECT count(*) FROM public.hotel_orders WHERE shift_id = p_shift_id AND status = 'settled'),
       'cancelled_orders', (SELECT count(*) FROM public.hotel_orders WHERE shift_id = p_shift_id AND status = 'cancelled'),
       'pending_orders', v_pending_orders_count,
       'unpaid_orders', v_unpaid_orders_count,
       'cancelled_details', (
         SELECT COALESCE(jsonb_agg(jsonb_build_object('order_number', order_number, 'amount', total_amount, 'reason', cancel_reason)), '[]'::jsonb)
         FROM public.hotel_orders 
         WHERE shift_id = p_shift_id AND status = 'cancelled'
       )
     ),
     'stations', (
       SELECT COALESCE(jsonb_object_agg(COALESCE(station, 'other'), stats), '{}'::jsonb) FROM (
         SELECT 
           station, 
           jsonb_build_object('qty', sum(quantity), 'total', sum(total_price)) as stats
         FROM public.hotel_order_items 
         WHERE shift_id = p_shift_id AND status != 'cancelled'
         GROUP BY station
       ) s
     ),
     'hotel_activity', jsonb_build_object(
       'rooms_booked', (SELECT count(*) FROM public.hotel_shift_logs WHERE shift_id = p_shift_id AND action_type IN ('booking_created', 'reservation_created')),
       'check_ins', (SELECT count(*) FROM public.hotel_shift_logs WHERE shift_id = p_shift_id AND action_type = 'check_in'),
       'check_outs', (SELECT count(*) FROM public.hotel_shift_logs WHERE shift_id = p_shift_id AND action_type = 'check_out'),
       'payments_processed', (SELECT count(*) FROM public.hotel_shift_logs WHERE shift_id = p_shift_id AND action_type IN ('payment_approved', 'direct_payment'))
     ),
     'issues', (
       SELECT COALESCE(jsonb_agg(issue), '[]'::jsonb) FROM (
         SELECT 'Unpaid orders exist' as issue WHERE v_unpaid_orders_count > 0
         UNION ALL
         SELECT 'Pending orders exist' as issue WHERE v_pending_orders_count > 0
         UNION ALL
         SELECT 'Cash discrepancy detected' as issue WHERE ABS(p_closing_cash - v_expected_cash) > 0.01
       ) i
     )
   );

  -- 7. Update and close
  UPDATE public.hotel_staff_shifts SET
    status = 'CLOSED',
    closed_at = now(),
    ended_at = now(),
    closing_cash = p_closing_cash,
    expected_cash = v_expected_cash,
    difference = p_closing_cash - v_expected_cash,
    closing_notes = p_closing_notes,
    total_sales = v_total_sales,
    billed_sales = v_billed_sales,
    summary = v_summary
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  -- Log the closing
  INSERT INTO public.hotel_shift_logs (shift_id, staff_id, action_type, description, amount)
  VALUES (p_shift_id, v_staff_id, 'shift_closed', 'Shift closed via secure RPC', p_closing_cash);

  RETURN v_shift;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_hotel_staff_shift(uuid, numeric, text, boolean) TO authenticated, service_role;

-- 4. Safety net: Trigger to ensure hotel_order_items always have the parent order's shift_id
CREATE OR REPLACE FUNCTION public.sync_order_item_shift_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.shift_id IS NULL THEN
    SELECT shift_id INTO NEW.shift_id FROM public.hotel_orders WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Fix for 'hotel_order_items', 'hotel_invoice_items' and 'hotel_orders' missing columns and 'crypt' function
-- Add missing columns to ensure sync consistency
ALTER TABLE public.hotel_order_items 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE public.hotel_invoice_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.hotel_orders
  ADD COLUMN IF NOT EXISTS preparing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;

-- Add updated_at trigger for hotel_order_items and invoice tables
DROP TRIGGER IF EXISTS update_hotel_order_items_updated_at ON public.hotel_order_items;
CREATE TRIGGER update_hotel_order_items_updated_at
  BEFORE UPDATE ON public.hotel_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_hotel_invoice_items_updated_at ON public.hotel_invoice_items;
CREATE TRIGGER update_hotel_invoice_items_updated_at
  BEFORE UPDATE ON public.hotel_invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_hotel_invoices_updated_at ON public.hotel_invoices;
CREATE TRIGGER update_hotel_invoices_updated_at
  BEFORE UPDATE ON public.hotel_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Ensure pgcrypto is available in the extensions schema (idempotent, works from any starting state)
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
DECLARE
  cur_schema text;
BEGIN
  SELECT extnamespace::regnamespace::text INTO cur_schema FROM pg_extension WHERE extname = 'pgcrypto';
  IF cur_schema IS NULL THEN
    EXECUTE 'CREATE EXTENSION pgcrypto SCHEMA extensions';
  ELSIF cur_schema <> 'extensions' THEN
    EXECUTE 'ALTER EXTENSION pgcrypto SET SCHEMA extensions';
  END IF;
END
$$;

 -- CRITICAL REPAIR:
 -- 1. Unlock all staff members who were accidentally locked
 -- 2. Hash any plain-text PINs that were manually entered into the database
 UPDATE public.hotel_staff 
 SET pin_failed_attempts = 0, 
     pin_locked_until = NULL,
     pin = CASE 
       WHEN pin IS NOT NULL AND pin !~ '^\$2[ayb]\$.*' THEN extensions.crypt(pin, extensions.gen_salt('bf', 10))
       ELSE pin
     END
 WHERE pin_failed_attempts > 0 
    OR pin_locked_until IS NOT NULL 
    OR (pin IS NOT NULL AND pin !~ '^\$2[ayb]\$.*');
 
 -- Update verify_staff_pin to include extensions in search_path and fix locking logic
 CREATE OR REPLACE FUNCTION public.verify_staff_pin(staff_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
 AS $$
 DECLARE
   staff_record record;
   v_now timestamptz := now();
   v_is_match boolean := false;
 BEGIN
   -- Basic validation
   IF staff_pin IS NULL OR staff_pin = '' THEN
     RETURN json_build_object('success', false, 'error', 'PIN is required');
   END IF;
   
   -- Find the staff member
   -- Since PINs are unique but we don't have the ID yet, we must iterate through active staff.
   FOR staff_record IN 
     SELECT id, first_name, last_name, role, is_active, allowed_hotel_routes, pin, pin_failed_attempts, pin_locked_until
     FROM public.hotel_staff
     WHERE is_active = true AND pin IS NOT NULL
   LOOP
     -- Check if this specific account is locked
     IF staff_record.pin_locked_until IS NOT NULL AND staff_record.pin_locked_until > v_now THEN
       -- Check if PIN matches even if locked (to provide better feedback)
       IF staff_record.pin ~ '^\$2[ayb]\$.*' THEN
         v_is_match := (staff_record.pin = extensions.crypt(staff_pin, staff_record.pin));
       ELSE
         v_is_match := (staff_record.pin = staff_pin);
       END IF;

       IF v_is_match THEN
         RETURN json_build_object('success', false, 'error', 'Account is temporarily locked. Please try again in 15 minutes.');
       END IF;
       CONTINUE;
     END IF;
 
     -- Verify PIN (Handle both hashed and plain text for extreme robustness)
     IF staff_record.pin ~ '^\$2[ayb]\$.*' THEN
       v_is_match := (staff_record.pin = extensions.crypt(staff_pin, staff_record.pin));
     ELSE
       -- Fallback for plain text PINs (should be fixed by the repair update above, but here for safety)
       v_is_match := (staff_record.pin = staff_pin);
     END IF;

     IF v_is_match THEN
       -- Success: Reset failed attempts for THIS user
       UPDATE public.hotel_staff 
       SET pin_failed_attempts = 0, 
           pin_locked_until = NULL 
       WHERE id = staff_record.id;
 
       RETURN json_build_object(
         'success', true,
         'staff_id', staff_record.id,
         'first_name', staff_record.first_name,
         'last_name', staff_record.last_name,
         'role', staff_record.role,
         'allowed_hotel_routes', staff_record.allowed_hotel_routes
       );
     END IF;
   END LOOP;
   
   -- If we reach here, no active staff member matched the PIN (or they were locked)
   RETURN json_build_object('success', false, 'error', 'Invalid PIN');
 END;
 $$;

-- Ensure the function is accessible
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(text) TO anon, authenticated, service_role;

-- Update hash_hotel_staff_pin to be secure and include extensions in search_path
CREATE OR REPLACE FUNCTION public.hash_hotel_staff_pin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.pin IS NOT NULL AND (OLD.pin IS NULL OR NEW.pin <> OLD.pin) THEN
    -- Only hash if it's not already a crypt hash
    IF NEW.pin !~ '^\$2[ayb]\$.*' THEN
      NEW.pin := extensions.crypt(NEW.pin, extensions.gen_salt('bf', 10));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_order_item_shift_id ON public.hotel_order_items;
CREATE TRIGGER trigger_sync_order_item_shift_id
  BEFORE INSERT ON public.hotel_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_order_item_shift_id();