-- Allow waiter_admin to manage shifts (open/close, including others')
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
  SELECT id, (role IN ('manager', 'admin', 'owner', 'waiter_admin')) INTO v_staff_id, v_is_manager
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
