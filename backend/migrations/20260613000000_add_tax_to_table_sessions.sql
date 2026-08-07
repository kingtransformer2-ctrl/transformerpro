-- Add tax fields to hotel_table_sessions (use IF NOT EXISTS for safety)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hotel_table_sessions' AND column_name = 'subtotal') THEN
    ALTER TABLE public.hotel_table_sessions ADD COLUMN subtotal NUMERIC NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hotel_table_sessions' AND column_name = 'tax_amount') THEN
    ALTER TABLE public.hotel_table_sessions ADD COLUMN tax_amount NUMERIC NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hotel_table_sessions' AND column_name = 'tax_rate') THEN
    ALTER TABLE public.hotel_table_sessions ADD COLUMN tax_rate NUMERIC NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hotel_table_sessions' AND column_name = 'total_amount') THEN
    ALTER TABLE public.hotel_table_sessions ADD COLUMN total_amount NUMERIC NOT NULL DEFAULT 0;
  END IF;
END$$;

-- Update refresh_hotel_table_session_state to calculate tax
CREATE OR REPLACE FUNCTION public.refresh_hotel_table_session_state(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_seat RECORD;
  v_due NUMERIC;
  v_direct_paid NUMERIC;
  v_has_paid_group BOOLEAN;
  v_has_partial_group BOOLEAN;
  v_status TEXT;
  v_all_paid BOOLEAN;
  v_any_paid BOOLEAN;
  v_table_id UUID;
  v_hotel_info RECORD;
  v_subtotal NUMERIC;
  v_tax_amount NUMERIC;
  v_total_amount NUMERIC;
  v_tax_rate NUMERIC;
  v_tax_inclusive BOOLEAN;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN;
  END IF;

  -- Get hotel info for tax calculation
  SELECT hi.tax_rate, hi.tax_inclusive
  INTO v_hotel_info
  FROM public.hotel_info hi
  LIMIT 1;

  v_tax_rate := COALESCE(v_hotel_info.tax_rate, 18);
  v_tax_inclusive := COALESCE(v_hotel_info.tax_inclusive, false);

  -- Calculate subtotal from order items
  SELECT COALESCE(SUM(oi.total_price), 0)
  INTO v_subtotal
  FROM public.hotel_order_items oi
  JOIN public.hotel_orders o ON o.id = oi.order_id
  WHERE o.session_id = p_session_id
    AND oi.status <> 'cancelled';

  -- Calculate tax
  IF v_tax_inclusive THEN
    v_tax_amount := ROUND(v_subtotal * (v_tax_rate / (100 + v_tax_rate)), 2);
    v_total_amount := v_subtotal;
  ELSE
    v_tax_amount := ROUND(v_subtotal * (v_tax_rate / 100), 2);
    v_total_amount := ROUND(v_subtotal + v_tax_amount, 2);
  END IF;

  -- Update payment groups
  UPDATE public.hotel_table_payment_groups AS g
  SET
    total_amount = totals.total_amount,
    paid_amount = totals.paid_amount,
    payment_status = CASE
      WHEN totals.total_amount <= 0 THEN 'paid'
      WHEN totals.paid_amount >= totals.total_amount THEN 'paid'
      WHEN totals.paid_amount > 0 THEN 'partial'
      ELSE 'pending'
    END,
    updated_at = NOW()
  FROM (
    SELECT
      g_inner.id,
      COALESCE((
        SELECT SUM(oi.total_price)
        FROM public.hotel_table_payment_group_seats pgs
        JOIN public.hotel_table_session_seats seats ON seats.id = pgs.seat_id
        JOIN public.hotel_order_items oi ON oi.seat_id = seats.id
        JOIN public.hotel_orders o ON o.id = oi.order_id
        WHERE pgs.payment_group_id = g_inner.id
          AND oi.status <> 'cancelled'
          AND o.session_id = g_inner.session_id
      ), 0) AS total_amount,
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments p
        WHERE p.payment_group_id = g_inner.id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0) AS paid_amount
    FROM public.hotel_table_payment_groups g_inner
    WHERE g_inner.session_id = p_session_id
  ) AS totals
  WHERE g.id = totals.id;

  -- Update seats
  FOR v_seat IN
    SELECT id
    FROM public.hotel_table_session_seats
    WHERE session_id = p_session_id
  LOOP
    SELECT COALESCE(SUM(oi.total_price), 0)
    INTO v_due
    FROM public.hotel_order_items oi
    JOIN public.hotel_orders o ON o.id = oi.order_id
    WHERE o.session_id = p_session_id
      AND oi.seat_id = v_seat.id
      AND oi.status <> 'cancelled';

    SELECT COALESCE(SUM(amount), 0)
    INTO v_direct_paid
    FROM public.hotel_payments
    WHERE seat_id = v_seat.id
      AND COALESCE(status, 'posted') NOT IN ('void', 'refunded');

    SELECT EXISTS (
      SELECT 1
      FROM public.hotel_table_payment_group_seats pgs
      JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
      WHERE pgs.seat_id = v_seat.id
        AND g.session_id = p_session_id
        AND g.payment_status = 'paid'
    )
    INTO v_has_paid_group;

    SELECT EXISTS (
      SELECT 1
      FROM public.hotel_table_payment_group_seats pgs
      JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
      WHERE pgs.seat_id = v_seat.id
        AND g.session_id = p_session_id
        AND g.payment_status = 'partial'
    )
    INTO v_has_partial_group;

    v_status := CASE
      WHEN v_due <= 0 THEN 'paid'
      WHEN v_direct_paid >= v_due OR v_has_paid_group THEN 'paid'
      WHEN v_direct_paid > 0 OR v_has_partial_group THEN 'partial'
      ELSE 'pending'
    END;

    UPDATE public.hotel_table_session_seats
    SET
      payment_status = v_status,
      paid_at = CASE WHEN v_status = 'paid' THEN COALESCE(paid_at, NOW()) ELSE NULL END,
      updated_at = NOW()
    WHERE id = v_seat.id;
  END LOOP;

  -- Check all paid status
  SELECT
    COALESCE(bool_and(payment_status = 'paid'), false),
    COALESCE(bool_or(payment_status IN ('partial', 'paid')), false)
  INTO v_all_paid, v_any_paid
  FROM public.hotel_table_session_seats
  WHERE session_id = p_session_id;

  -- Update table session with tax info
  UPDATE public.hotel_table_sessions
  SET
    payment_status = CASE
      WHEN v_all_paid THEN 'paid'
      WHEN v_any_paid THEN 'partial'
      ELSE 'pending'
    END,
    status = CASE
      WHEN v_all_paid THEN 'closed'
      WHEN v_any_paid THEN 'partially_paid'
      ELSE 'active'
    END,
    closed_at = CASE WHEN v_all_paid THEN COALESCE(closed_at, NOW()) ELSE NULL END,
    subtotal = v_subtotal,
    tax_amount = v_tax_amount,
    tax_rate = v_tax_rate,
    total_amount = v_total_amount,
    updated_at = NOW()
  WHERE id = p_session_id;

  -- Get table id
  SELECT table_id
  INTO v_table_id
  FROM public.hotel_table_sessions
  WHERE id = p_session_id;

  -- Update table status
  IF v_all_paid AND v_table_id IS NOT NULL THEN
    UPDATE public.hotel_tables
    SET status = 'free'
    WHERE id = v_table_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.hotel_table_sessions
        WHERE table_id = v_table_id
          AND status IN ('active', 'partially_paid')
      );
  END IF;
END;
$$;

-- Update get_hotel_table_session_summary to return tax fields
CREATE OR REPLACE FUNCTION public.get_hotel_table_session_summary(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'session_id', s.id,
    'table_id', s.table_id,
    'table_number', COALESCE(s.table_number, t.table_number),
    'guest_count', s.guest_count,
    'status', s.status,
    'payment_status', s.payment_status,
    'opened_at', s.opened_at,
    'opened_by', s.opened_by,
    'opened_shift_id', s.opened_shift_id,
    'subtotal', s.subtotal,
    'tax_amount', s.tax_amount,
    'tax_rate', s.tax_rate,
    'total_amount', s.total_amount,
    'total_paid', COALESCE((
      SELECT SUM(p.amount)
      FROM public.hotel_payments p
      WHERE p.session_id = s.id
        AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
    ), 0),
    'outstanding_amount', GREATEST(
      s.total_amount - COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments p
        WHERE p.session_id = s.id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0),
      0
    ),
    'seats', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'seat_id', seat.id,
          'seat_no', seat.seat_no,
          'guest_name', seat.guest_name,
          'status', seat.status,
          'payment_status', seat.payment_status,
          'item_total', seat.item_total,
          'total_paid', seat.total_paid,
          'outstanding_amount', GREATEST(seat.item_total - seat.total_paid, 0),
          'payment_group_id', seat.payment_group_id,
          'payment_group_name', seat.payment_group_name
        )
        ORDER BY seat.seat_no
      )
      FROM (
        SELECT
          sseat.id,
          sseat.seat_no,
          sseat.guest_name,
          sseat.status,
          sseat.payment_status,
          COALESCE((
            SELECT SUM(oi.total_price)
            FROM public.hotel_order_items oi
            JOIN public.hotel_orders o ON o.id = oi.order_id
            WHERE o.session_id = p_session_id
              AND oi.seat_id = sseat.id
              AND oi.status <> 'cancelled'
          ), 0) AS item_total,
          COALESCE((
            SELECT SUM(p.amount)
            FROM public.hotel_payments p
            WHERE p.seat_id = sseat.id
              AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
          ), 0) + COALESCE((
            SELECT SUM(p.amount)
            FROM public.hotel_table_payment_group_seats pgs
            JOIN public.hotel_payments p ON p.payment_group_id = pgs.payment_group_id
            WHERE pgs.seat_id = sseat.id
              AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
          ), 0) AS total_paid,
          grp.payment_group_id,
          grp.payment_group_name
        FROM public.hotel_table_session_seats sseat
        LEFT JOIN LATERAL (
          SELECT
            g.id AS payment_group_id,
            g.group_name AS payment_group_name
          FROM public.hotel_table_payment_group_seats pgs
          JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
          WHERE pgs.seat_id = sseat.id
            AND g.session_id = p_session_id
            AND g.status = 'active'
          LIMIT 1
        ) grp ON TRUE
        WHERE sseat.session_id = p_session_id
      ) seat
    ), '[]'::jsonb),
    'groups', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'payment_group_id', grp.id,
          'group_name', grp.group_name,
          'status', grp.status,
          'payment_status', grp.payment_status,
          'total_amount', grp.total_amount,
          'paid_amount', grp.paid_amount,
          'outstanding_amount', GREATEST(grp.total_amount - grp.paid_amount, 0),
          'seat_ids', grp.seat_ids,
          'seat_numbers', grp.seat_numbers
        )
        ORDER BY grp.group_name
      )
      FROM (
        SELECT
          g.id,
          g.group_name,
          g.status,
          g.payment_status,
          g.total_amount,
          g.paid_amount,
          ARRAY_AGG(sseat.id ORDER BY sseat.seat_no) AS seat_ids,
          ARRAY_AGG(sseat.seat_no ORDER BY sseat.seat_no) AS seat_numbers
        FROM public.hotel_table_payment_groups g
        LEFT JOIN public.hotel_table_payment_group_seats pgs ON pgs.payment_group_id = g.id
        LEFT JOIN public.hotel_table_session_seats sseat ON sseat.id = pgs.seat_id
        WHERE g.session_id = p_session_id
        GROUP BY g.id, g.group_name, g.status, g.payment_status, g.total_amount, g.paid_amount
      ) grp
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.hotel_table_sessions s
  JOIN public.hotel_tables t ON t.id = s.table_id
  WHERE s.id = p_session_id;

  RETURN v_result;
END;
$$;

-- Update ensure_hotel_table_session_invoice to use tax from table session
CREATE OR REPLACE FUNCTION public.ensure_hotel_table_session_invoice(
  p_session_id UUID,
  p_staff_id UUID,
  p_shift_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id UUID;
  v_customer RECORD;
  v_session public.hotel_table_sessions%ROWTYPE;
  v_payment_method public.hotel_payment_method;
  v_distinct_method_count INTEGER := 0;
  v_hotel_info RECORD;
  v_tax_rate NUMERIC;
  v_tax_inclusive BOOLEAN;
  v_subtotal NUMERIC;
  v_tax_amount NUMERIC;
  v_total_amount NUMERIC;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id is required';
  END IF;

  SELECT id
  INTO v_invoice_id
  FROM public.hotel_invoices
  WHERE session_id = p_session_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN v_invoice_id;
  END IF;

  SELECT *
  INTO v_session
  FROM public.hotel_table_sessions
  WHERE id = p_session_id;

  -- Check if we have tax data in the session, otherwise calculate it
  IF v_session.total_amount > 0 AND v_session.tax_rate > 0 THEN
    v_subtotal := v_session.subtotal;
    v_tax_amount := v_session.tax_amount;
    v_total_amount := v_session.total_amount;
  ELSE
    -- Calculate manually from hotel info
    SELECT hi.tax_rate, hi.tax_inclusive
    INTO v_hotel_info
    FROM public.hotel_info hi
    LIMIT 1;

    v_tax_rate := COALESCE(v_hotel_info.tax_rate, 18);
    v_tax_inclusive := COALESCE(v_hotel_info.tax_inclusive, false);

    SELECT COALESCE(SUM(oi.total_price), 0)
    INTO v_subtotal
    FROM public.hotel_order_items oi
    JOIN public.hotel_orders o ON o.id = oi.order_id
    WHERE o.session_id = p_session_id
      AND oi.status <> 'cancelled';

    IF v_tax_inclusive THEN
      v_tax_amount := ROUND(v_subtotal * (v_tax_rate / (100 + v_tax_rate)), 2);
      v_total_amount := v_subtotal;
    ELSE
      v_tax_amount := ROUND(v_subtotal * (v_tax_rate / 100), 2);
      v_total_amount := ROUND(v_subtotal + v_tax_amount, 2);
    END IF;
  END IF;

  SELECT
    o.customer_id,
    o.customer_name,
    o.customer_phone,
    o.customer_email,
    o.customer_address,
    o.customer_tin
  INTO v_customer
  FROM public.hotel_orders AS o
  WHERE o.session_id = p_session_id
    AND o.status <> 'cancelled'
    AND (
      o.customer_id IS NOT NULL
      OR o.customer_name IS NOT NULL
      OR o.customer_phone IS NOT NULL
      OR o.customer_email IS NOT NULL
      OR o.customer_address IS NOT NULL
      OR o.customer_tin IS NOT NULL
    )
  ORDER BY o.created_at
  LIMIT 1;

  SELECT
    COUNT(DISTINCT p.payment_method),
    MIN(p.payment_method)
  INTO
    v_distinct_method_count,
    v_payment_method
  FROM public.hotel_payments AS p
  WHERE p.session_id = p_session_id
    AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded');

  INSERT INTO public.hotel_invoices (
    session_id,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    customer_address,
    customer_tin,
    shift_id,
    staff_id,
    subtotal,
    tax_amount,
    discount_amount,
    total_amount,
    payment_status,
    payment_method,
    notes,
    created_at,
    updated_at
  )
  VALUES (
    p_session_id,
    v_customer.customer_id,
    v_customer.customer_name,
    v_customer.customer_phone,
    v_customer.customer_email,
    v_customer.customer_address,
    v_customer.customer_tin,
    p_shift_id,
    p_staff_id,
    v_subtotal,
    v_tax_amount,
    0,
    v_total_amount,
    'paid',
    CASE
      WHEN v_distinct_method_count <= 1 THEN v_payment_method
      ELSE 'split'::public.hotel_payment_method
    END,
    'Auto-generated from fully settled table session',
    NOW(),
    NOW()
  )
  RETURNING id
  INTO v_invoice_id;

  INSERT INTO public.hotel_invoice_items (
    invoice_id,
    shift_id,
    description,
    item_type,
    unit_price,
    quantity,
    total_price,
    created_at,
    updated_at
  )
  SELECT
    v_invoice_id,
    COALESCE(oi.shift_id, p_shift_id),
    oi.name,
    COALESCE(oi.item_type, 'order'),
    oi.unit_price,
    oi.quantity,
    oi.total_price,
    NOW(),
    NOW()
  FROM public.hotel_order_items AS oi
  JOIN public.hotel_orders AS o
    ON o.id = oi.order_id
  WHERE o.session_id = p_session_id
    AND o.status <> 'cancelled'
    AND oi.status <> 'cancelled';

  UPDATE public.hotel_orders
  SET
    invoice_id = v_invoice_id,
    is_billed = true,
    updated_at = NOW()
  WHERE session_id = p_session_id
    AND status <> 'cancelled';

  UPDATE public.hotel_payments
  SET invoice_id = v_invoice_id
  WHERE session_id = p_session_id
    AND invoice_id IS NULL
    AND COALESCE(status, 'posted') NOT IN ('void', 'refunded');

  RETURN v_invoice_id;
END;
$$;
