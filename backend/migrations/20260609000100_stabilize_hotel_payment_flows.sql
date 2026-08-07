-- Stabilize existing hotel payment/session model without introducing a new ledger.
-- This migration hardens payment mutations, removes duplicate-settlement races,
-- ensures table-session final settlement produces exactly one invoice, and keeps
-- table release blocked until final settlement is complete.

ALTER TABLE public.hotel_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE public.hotel_invoices
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.hotel_table_sessions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_payments_idempotency_key
  ON public.hotel_payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_invoices_one_per_session
  ON public.hotel_invoices(session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hotel_invoices_session_id
  ON public.hotel_invoices(session_id);

DROP POLICY IF EXISTS "Authenticated users can manage payments" ON public.hotel_payments;
DROP POLICY IF EXISTS "Users can view payments" ON public.hotel_payments;
DROP POLICY IF EXISTS "Users can insert payments" ON public.hotel_payments;
DROP POLICY IF EXISTS "Users can update payments" ON public.hotel_payments;
DROP POLICY IF EXISTS "Users can delete payments" ON public.hotel_payments;


CREATE OR REPLACE FUNCTION public.current_authenticated_staff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hs.id
  FROM public.hotel_staff AS hs
  WHERE hs.user_id = auth.uid()
    AND hs.is_active = true
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.resolve_hotel_payment_staff_id(
  p_staff_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_staff_id UUID;
  v_context_staff_id UUID;
BEGIN
  v_auth_staff_id := public.current_authenticated_staff_id();
  v_context_staff_id := public.current_staff_id();

  IF v_context_staff_id IS NOT NULL THEN
    IF v_auth_staff_id IS NOT NULL
       AND v_context_staff_id <> v_auth_staff_id
       AND NOT public.is_manager_or_owner() THEN
      RAISE EXCEPTION 'Staff context is not authorized for this user'
        USING ERRCODE = '42501';
    END IF;

    IF p_staff_id IS NOT NULL
       AND p_staff_id <> v_context_staff_id
       AND NOT public.is_manager_or_owner() THEN
      RAISE EXCEPTION 'Payment staff does not match the verified staff session'
        USING ERRCODE = '42501';
    END IF;

    RETURN COALESCE(p_staff_id, v_context_staff_id);
  END IF;

  IF v_auth_staff_id IS NOT NULL THEN
    IF p_staff_id IS NOT NULL
       AND p_staff_id <> v_auth_staff_id
       AND NOT public.is_manager_or_owner() THEN
      RAISE EXCEPTION 'Payment staff does not match the authenticated staff member'
        USING ERRCODE = '42501';
    END IF;

    RETURN COALESCE(p_staff_id, v_auth_staff_id);
  END IF;

  RAISE EXCEPTION 'No verified staff context is available for this payment operation'
    USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_hotel_payment_shift_id(
  p_shift_id UUID,
  p_staff_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.hotel_staff_shifts%ROWTYPE;
BEGIN
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'An active shift is required to record payment'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_shift
  FROM public.hotel_staff_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift % not found', p_shift_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_shift.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Shift % is already closed', p_shift_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_shift.staff_id IS DISTINCT FROM p_staff_id AND NOT public.is_manager_or_owner() THEN
    RAISE EXCEPTION 'You can only record payments into your own active shift'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_shift.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_hotel_payment_shift_audit(
  p_payment_id UUID,
  p_invoice_id UUID,
  p_session_id UUID,
  p_shift_id UUID,
  p_staff_id UUID,
  p_payment_method public.hotel_payment_method,
  p_amount NUMERIC,
  p_log_action_type TEXT,
  p_log_description TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.hotel_shift_transactions (
    shift_id,
    staff_id,
    type,
    amount,
    reference_id,
    created_at
  )
  VALUES (
    p_shift_id,
    p_staff_id,
    p_payment_method::text,
    p_amount,
    COALESCE(p_invoice_id, p_payment_id),
    now()
  );

  INSERT INTO public.hotel_shift_logs (
    shift_id,
    staff_id,
    action_type,
    description,
    amount,
    reference_id,
    created_at
  )
  VALUES (
    p_shift_id,
    p_staff_id,
    p_log_action_type,
    p_log_description,
    p_amount,
    COALESCE(p_invoice_id, p_session_id, p_payment_id),
    now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_hotel_invoice_payment_snapshot(
  p_invoice_id UUID
)
RETURNS TABLE (
  payment_status TEXT,
  total_paid NUMERIC,
  outstanding_amount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.hotel_invoices%ROWTYPE;
  v_total_paid NUMERIC := 0;
  v_distinct_method_count INTEGER := 0;
  v_single_method public.hotel_payment_method;
  v_payment_status TEXT;
BEGIN
  SELECT *
  INTO v_invoice
  FROM public.hotel_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    COALESCE(SUM(p.amount), 0),
    COUNT(DISTINCT p.payment_method),
    MIN(p.payment_method)
  INTO
    v_total_paid,
    v_distinct_method_count,
    v_single_method
  FROM public.hotel_payments AS p
  WHERE p.invoice_id = p_invoice_id
    AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded');

  v_payment_status := CASE
    WHEN v_total_paid >= COALESCE(v_invoice.total_amount, 0) THEN 'paid'
    WHEN v_total_paid > 0 THEN 'partial'
    ELSE 'pending'
  END;

  UPDATE public.hotel_invoices
  SET
    payment_status = v_payment_status,
    payment_method = CASE
      WHEN v_distinct_method_count = 0 THEN payment_method
      WHEN v_distinct_method_count = 1 THEN v_single_method
      ELSE 'split'::public.hotel_payment_method
    END,
    updated_at = now()
  WHERE id = p_invoice_id;

  UPDATE public.hotel_bookings
  SET paid_amount = v_total_paid
  WHERE id = v_invoice.booking_id;

  RETURN QUERY
  SELECT
    v_payment_status,
    v_total_paid,
    GREATEST(COALESCE(v_invoice.total_amount, 0) - v_total_paid, 0);
END;
$$;

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
  v_totals RECORD;
  v_payment_method public.hotel_payment_method;
  v_distinct_method_count INTEGER := 0;
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
    COALESCE(SUM(o.subtotal), 0) AS subtotal,
    COALESCE(SUM(o.tax_amount), 0) AS tax_amount,
    COALESCE(SUM(o.discount_amount), 0) AS discount_amount,
    COALESCE(SUM(o.total_amount), 0) AS total_amount
  INTO v_totals
  FROM public.hotel_orders AS o
  WHERE o.session_id = p_session_id
    AND o.status <> 'cancelled';

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
    COALESCE(v_totals.subtotal, 0),
    COALESCE(v_totals.tax_amount, 0),
    COALESCE(v_totals.discount_amount, 0),
    COALESCE(v_totals.total_amount, 0),
    'paid',
    CASE
      WHEN v_distinct_method_count <= 1 THEN v_payment_method
      ELSE 'split'::public.hotel_payment_method
    END,
    'Auto-generated from fully settled table session',
    now(),
    now()
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
    now(),
    now()
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
    updated_at = now()
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

CREATE OR REPLACE FUNCTION public.record_hotel_invoice_payment(
  p_invoice_id UUID,
  p_payment_method TEXT,
  p_amount NUMERIC,
  p_transaction_reference TEXT DEFAULT NULL,
  p_staff_id UUID DEFAULT NULL,
  p_shift_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.hotel_invoices%ROWTYPE;
  v_payment_id UUID;
  v_payment_method public.hotel_payment_method;
  v_resolved_staff_id UUID;
  v_resolved_shift_id UUID;
  v_total_paid NUMERIC;
  v_outstanding_amount NUMERIC;
  v_payment_status TEXT;
  v_existing_payment RECORD;
BEGIN
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'invoice_id is required';
  END IF;

  IF COALESCE(NULLIF(trim(p_payment_method), ''), '') = '' THEN
    RAISE EXCEPTION 'payment method is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'payment amount must be greater than zero';
  END IF;

  BEGIN
    v_payment_method := p_payment_method::public.hotel_payment_method;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Unsupported payment method: %', p_payment_method;
  END;

  v_resolved_staff_id := public.resolve_hotel_payment_staff_id(p_staff_id);
  v_resolved_shift_id := public.resolve_hotel_payment_shift_id(p_shift_id, v_resolved_staff_id);

  IF COALESCE(NULLIF(trim(COALESCE(p_idempotency_key, '')), ''), '') <> '' THEN
    SELECT
      p.id,
      p.invoice_id,
      p.amount
    INTO v_existing_payment
    FROM public.hotel_payments AS p
    WHERE p.idempotency_key = p_idempotency_key
       OR p.idempotency_key LIKE p_idempotency_key || ':%'
    LIMIT 1;

    IF FOUND THEN
      SELECT payment_status, total_paid, outstanding_amount
      INTO v_payment_status, v_total_paid, v_outstanding_amount
      FROM public.update_hotel_invoice_payment_snapshot(v_existing_payment.invoice_id);

      RETURN jsonb_build_object(
        'success', true,
        'invoice_id', v_existing_payment.invoice_id,
        'payment_id', v_existing_payment.id,
        'payment_amount', v_existing_payment.amount,
        'payment_status', v_payment_status,
        'total_paid', v_total_paid,
        'outstanding_amount', v_outstanding_amount,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.hotel_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    COALESCE(SUM(p.amount), 0)
  INTO v_total_paid
  FROM public.hotel_payments AS p
  WHERE p.invoice_id = p_invoice_id
    AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded');

  v_outstanding_amount := GREATEST(COALESCE(v_invoice.total_amount, 0) - v_total_paid, 0);

  IF v_outstanding_amount <= 0 THEN
    RAISE EXCEPTION 'This invoice is already fully settled';
  END IF;

  IF p_amount > v_outstanding_amount THEN
    RAISE EXCEPTION 'Payment amount exceeds outstanding invoice balance';
  END IF;

  INSERT INTO public.hotel_payments (
    invoice_id,
    amount,
    payment_method,
    transaction_reference,
    shift_id,
    staff_id,
    status,
    notes,
    idempotency_key,
    created_at
  )
  VALUES (
    p_invoice_id,
    p_amount,
    v_payment_method,
    NULLIF(trim(COALESCE(p_transaction_reference, '')), ''),
    v_resolved_shift_id,
    v_resolved_staff_id,
    'posted',
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    NULLIF(trim(COALESCE(p_idempotency_key, '')), ''),
    now()
  )
  RETURNING id
  INTO v_payment_id;

  SELECT payment_status, total_paid, outstanding_amount
  INTO v_payment_status, v_total_paid, v_outstanding_amount
  FROM public.update_hotel_invoice_payment_snapshot(p_invoice_id);

  PERFORM public.apply_hotel_payment_shift_audit(
    v_payment_id,
    p_invoice_id,
    v_invoice.session_id,
    v_resolved_shift_id,
    v_resolved_staff_id,
    v_payment_method,
    p_amount,
    CASE
      WHEN v_payment_status = 'paid' THEN 'invoice_paid'
      ELSE 'invoice_payment_recorded'
    END,
    CASE
      WHEN v_payment_status = 'paid' THEN format('Invoice %s fully settled', COALESCE(v_invoice.invoice_number, v_invoice.id::text))
      ELSE format('Payment recorded against invoice %s', COALESCE(v_invoice.invoice_number, v_invoice.id::text))
    END
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'payment_id', v_payment_id,
    'payment_status', v_payment_status,
    'total_paid', v_total_paid,
    'outstanding_amount', v_outstanding_amount,
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_hotel_table_payment(
  p_session_id UUID,
  p_payment_method TEXT,
  p_staff_id UUID DEFAULT NULL,
  p_shift_id UUID DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_seat_id UUID DEFAULT NULL,
  p_payment_group_id UUID DEFAULT NULL,
  p_receipt_no TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_payment_ids UUID[] := ARRAY[]::UUID[];
  v_inserted_payment_id UUID;
  v_group RECORD;
  v_seat RECORD;
  v_target_amount NUMERIC;
  v_group_due NUMERIC;
  v_seat_due NUMERIC;
  v_group_session_id UUID;
  v_seat_session_id UUID;
  v_seat_no INTEGER;
  v_session public.hotel_table_sessions%ROWTYPE;
  v_table_status TEXT;
  v_invoice_id UUID;
  v_payment_method public.hotel_payment_method;
  v_resolved_staff_id UUID;
  v_resolved_shift_id UUID;
  v_existing_payment RECORD;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id is required';
  END IF;

  IF COALESCE(NULLIF(trim(p_payment_method), ''), '') = '' THEN
    RAISE EXCEPTION 'payment method is required';
  END IF;

  BEGIN
    v_payment_method := p_payment_method::public.hotel_payment_method;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Unsupported payment method: %', p_payment_method;
  END;

  v_resolved_staff_id := public.resolve_hotel_payment_staff_id(p_staff_id);
  v_resolved_shift_id := public.resolve_hotel_payment_shift_id(p_shift_id, v_resolved_staff_id);

  IF COALESCE(NULLIF(trim(COALESCE(p_idempotency_key, '')), ''), '') <> '' THEN
    SELECT
      p.id,
      p.session_id,
      p.invoice_id
    INTO v_existing_payment
    FROM public.hotel_payments AS p
    WHERE p.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      SELECT *
      INTO v_session
      FROM public.hotel_table_sessions
      WHERE id = v_existing_payment.session_id;

      SELECT t.status
      INTO v_table_status
      FROM public.hotel_tables AS t
      WHERE t.id = v_session.table_id;

      RETURN jsonb_build_object(
        'success', true,
        'session_id', v_existing_payment.session_id,
        'payment_ids', jsonb_build_array(v_existing_payment.id),
        'invoice_id', v_existing_payment.invoice_id,
        'session_status', v_session.status,
        'session_payment_status', v_session.payment_status,
        'table_status', v_table_status,
        'session_fully_paid', v_session.payment_status = 'paid',
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT *
  INTO v_session
  FROM public.hotel_table_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table session % not found', p_session_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled table sessions cannot receive payments';
  END IF;

  IF v_session.payment_status = 'paid' THEN
    RAISE EXCEPTION 'This table session is already fully settled';
  END IF;

  IF p_seat_id IS NOT NULL AND p_payment_group_id IS NOT NULL THEN
    RAISE EXCEPTION 'Choose either seat payment or group payment, not both';
  END IF;

  IF p_payment_group_id IS NOT NULL THEN
    SELECT session_id
    INTO v_group_session_id
    FROM public.hotel_table_payment_groups
    WHERE id = p_payment_group_id
    FOR UPDATE;

    IF v_group_session_id IS DISTINCT FROM p_session_id THEN
      RAISE EXCEPTION 'Payment group does not belong to this session';
    END IF;

    SELECT GREATEST(g.total_amount - g.paid_amount, 0)
    INTO v_group_due
    FROM public.hotel_table_payment_groups AS g
    WHERE g.id = p_payment_group_id;

    v_target_amount := COALESCE(p_amount, v_group_due);

    IF v_target_amount <= 0 OR v_target_amount > v_group_due THEN
      RAISE EXCEPTION 'Payment amount must be between 0 and the outstanding group balance';
    END IF;

    INSERT INTO public.hotel_payments (
      invoice_id,
      session_id,
      payment_group_id,
      amount,
      payment_method,
      shift_id,
      staff_id,
      status,
      receipt_no,
      notes,
      idempotency_key,
      created_at
    )
    VALUES (
      NULL,
      p_session_id,
      p_payment_group_id,
      v_target_amount,
      v_payment_method,
      v_resolved_shift_id,
      v_resolved_staff_id,
      'posted',
      p_receipt_no,
      COALESCE(p_notes, 'Grouped table payment'),
      NULLIF(trim(COALESCE(p_idempotency_key, '')), ''),
      now()
    )
    RETURNING id
    INTO v_inserted_payment_id;

    v_inserted_payment_ids := array_append(v_inserted_payment_ids, v_inserted_payment_id);

    PERFORM public.apply_hotel_payment_shift_audit(
      v_inserted_payment_id,
      NULL,
      p_session_id,
      v_resolved_shift_id,
      v_resolved_staff_id,
      v_payment_method,
      v_target_amount,
      'table_payment_recorded',
      format('Grouped payment recorded for table session %s', p_session_id)
    );
  ELSIF p_seat_id IS NOT NULL THEN
    SELECT session_id, seat_no
    INTO v_seat_session_id, v_seat_no
    FROM public.hotel_table_session_seats
    WHERE id = p_seat_id
    FOR UPDATE;

    IF v_seat_session_id IS DISTINCT FROM p_session_id THEN
      RAISE EXCEPTION 'Seat does not belong to this session';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.hotel_table_payment_group_seats AS pgs
      JOIN public.hotel_table_payment_groups AS g
        ON g.id = pgs.payment_group_id
      WHERE pgs.seat_id = p_seat_id
        AND g.session_id = p_session_id
        AND g.status = 'active'
    ) THEN
      RAISE EXCEPTION 'This seat belongs to an active payment group. Please pay the group instead.';
    END IF;

    SELECT GREATEST(
      COALESCE((
        SELECT SUM(oi.total_price)
        FROM public.hotel_order_items AS oi
        JOIN public.hotel_orders AS o
          ON o.id = oi.order_id
        WHERE o.session_id = p_session_id
          AND (
            oi.seat_id = p_seat_id
            OR (oi.seat_id IS NULL AND v_seat_no = 1)
          )
          AND oi.status <> 'cancelled'
      ), 0) - COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments AS p
        WHERE p.seat_id = p_seat_id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0),
      0
    )
    INTO v_seat_due;

    v_target_amount := COALESCE(p_amount, v_seat_due);

    IF v_target_amount <= 0 OR v_target_amount > v_seat_due THEN
      RAISE EXCEPTION 'Payment amount must be between 0 and the outstanding seat balance';
    END IF;

    INSERT INTO public.hotel_payments (
      invoice_id,
      session_id,
      seat_id,
      amount,
      payment_method,
      shift_id,
      staff_id,
      status,
      receipt_no,
      notes,
      idempotency_key,
      created_at
    )
    VALUES (
      NULL,
      p_session_id,
      p_seat_id,
      v_target_amount,
      v_payment_method,
      v_resolved_shift_id,
      v_resolved_staff_id,
      'posted',
      p_receipt_no,
      COALESCE(p_notes, 'Seat payment'),
      NULLIF(trim(COALESCE(p_idempotency_key, '')), ''),
      now()
    )
    RETURNING id
    INTO v_inserted_payment_id;

    v_inserted_payment_ids := array_append(v_inserted_payment_ids, v_inserted_payment_id);

    PERFORM public.apply_hotel_payment_shift_audit(
      v_inserted_payment_id,
      NULL,
      p_session_id,
      v_resolved_shift_id,
      v_resolved_staff_id,
      v_payment_method,
      v_target_amount,
      'table_payment_recorded',
      format('Seat payment recorded for table session %s', p_session_id)
    );
  ELSE
    FOR v_group IN
      SELECT
        g.id,
        GREATEST(g.total_amount - g.paid_amount, 0) AS outstanding_amount
      FROM public.hotel_table_payment_groups AS g
      WHERE g.session_id = p_session_id
        AND g.status = 'active'
        AND GREATEST(g.total_amount - g.paid_amount, 0) > 0
      ORDER BY g.group_name
      FOR UPDATE OF g
    LOOP
      INSERT INTO public.hotel_payments (
        invoice_id,
        session_id,
        payment_group_id,
        amount,
        payment_method,
        shift_id,
        staff_id,
        status,
        receipt_no,
        notes,
        idempotency_key,
        created_at
      )
      VALUES (
        NULL,
        p_session_id,
        v_group.id,
        v_group.outstanding_amount,
        v_payment_method,
        v_resolved_shift_id,
        v_resolved_staff_id,
        'posted',
        p_receipt_no,
        COALESCE(p_notes, 'Full table settlement'),
        CASE
          WHEN NULLIF(trim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN NULL
          ELSE p_idempotency_key || ':group:' || v_group.id::text
        END,
        now()
      )
      RETURNING id
      INTO v_inserted_payment_id;

      v_inserted_payment_ids := array_append(v_inserted_payment_ids, v_inserted_payment_id);

      PERFORM public.apply_hotel_payment_shift_audit(
        v_inserted_payment_id,
        NULL,
        p_session_id,
        v_resolved_shift_id,
        v_resolved_staff_id,
        v_payment_method,
        v_group.outstanding_amount,
        'table_payment_recorded',
        format('Grouped settlement recorded for table session %s', p_session_id)
      );
    END LOOP;

    FOR v_seat IN
      SELECT
        s.id,
        s.seat_no,
        GREATEST(
          COALESCE((
            SELECT SUM(oi.total_price)
            FROM public.hotel_order_items AS oi
            JOIN public.hotel_orders AS o
              ON o.id = oi.order_id
            WHERE o.session_id = p_session_id
              AND (
                oi.seat_id = s.id
                OR (oi.seat_id IS NULL AND s.seat_no = 1)
              )
              AND oi.status <> 'cancelled'
          ), 0) - COALESCE((
            SELECT SUM(p.amount)
            FROM public.hotel_payments AS p
            WHERE p.seat_id = s.id
              AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
          ), 0),
          0
        ) AS outstanding_amount
      FROM public.hotel_table_session_seats AS s
      WHERE s.session_id = p_session_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.hotel_table_payment_group_seats AS pgs
          JOIN public.hotel_table_payment_groups AS g
            ON g.id = pgs.payment_group_id
          WHERE pgs.seat_id = s.id
            AND g.session_id = p_session_id
            AND g.status = 'active'
        )
      ORDER BY s.seat_no
      FOR UPDATE OF s
    LOOP
      IF v_seat.outstanding_amount <= 0 THEN
        CONTINUE;
      END IF;

      INSERT INTO public.hotel_payments (
        invoice_id,
        session_id,
        seat_id,
        amount,
        payment_method,
        shift_id,
        staff_id,
        status,
        receipt_no,
        notes,
        idempotency_key,
        created_at
      )
      VALUES (
        NULL,
        p_session_id,
        v_seat.id,
        v_seat.outstanding_amount,
        v_payment_method,
        v_resolved_shift_id,
        v_resolved_staff_id,
        'posted',
        p_receipt_no,
        COALESCE(p_notes, 'Full table settlement'),
        CASE
          WHEN NULLIF(trim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN NULL
          ELSE p_idempotency_key || ':seat:' || v_seat.id::text
        END,
        now()
      )
      RETURNING id
      INTO v_inserted_payment_id;

      v_inserted_payment_ids := array_append(v_inserted_payment_ids, v_inserted_payment_id);

      PERFORM public.apply_hotel_payment_shift_audit(
        v_inserted_payment_id,
        NULL,
        p_session_id,
        v_resolved_shift_id,
        v_resolved_staff_id,
        v_payment_method,
        v_seat.outstanding_amount,
        'table_payment_recorded',
        format('Seat settlement recorded for table session %s', p_session_id)
      );
    END LOOP;

    IF COALESCE(array_length(v_inserted_payment_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION 'This table session has no outstanding balance';
    END IF;
  END IF;

  PERFORM public.refresh_hotel_table_session_state(p_session_id);

  SELECT *
  INTO v_session
  FROM public.hotel_table_sessions
  WHERE id = p_session_id;

  IF v_session.payment_status = 'paid' THEN
    v_invoice_id := public.ensure_hotel_table_session_invoice(
      p_session_id,
      v_resolved_staff_id,
      v_resolved_shift_id
    );

    UPDATE public.hotel_orders
    SET
      status = 'settled',
      payment_method = CASE
        WHEN public.hotel_orders.payment_method IS NULL
          OR public.hotel_orders.payment_method::text = 'split'
        THEN v_payment_method::text
        ELSE public.hotel_orders.payment_method
      END,
      payment_received_at = COALESCE(public.hotel_orders.payment_received_at, now()),
      settled_at = COALESCE(public.hotel_orders.settled_at, now()),
      settled_by = COALESCE(v_resolved_staff_id, public.hotel_orders.settled_by),
      is_billed = true,
      invoice_id = COALESCE(public.hotel_orders.invoice_id, v_invoice_id),
      updated_at = now()
    WHERE session_id = p_session_id
      AND status NOT IN ('settled', 'cancelled');

    UPDATE public.hotel_payments
    SET invoice_id = v_invoice_id
    WHERE id = ANY (v_inserted_payment_ids)
      AND invoice_id IS NULL;
  END IF;

  SELECT t.status
  INTO v_table_status
  FROM public.hotel_tables AS t
  WHERE t.id = v_session.table_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'payment_ids', v_inserted_payment_ids,
    'invoice_id', v_invoice_id,
    'session_status', v_session.status,
    'session_payment_status', v_session.payment_status,
    'table_status', v_table_status,
    'session_fully_paid', v_session.payment_status = 'paid',
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_hotel_table_release_before_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'free'
     AND COALESCE(OLD.status, '') <> 'free'
     AND EXISTS (
       SELECT 1
       FROM public.hotel_table_sessions AS s
       WHERE s.table_id = NEW.id
         AND s.status IN ('active', 'partially_paid')
         AND COALESCE(s.payment_status, 'pending') <> 'paid'
     ) THEN
    RAISE EXCEPTION 'Table % cannot be released before final settlement', COALESCE(NEW.table_number, NEW.id::text)
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_prevent_hotel_table_release_before_settlement ON public.hotel_tables;
CREATE TRIGGER trigger_prevent_hotel_table_release_before_settlement
  BEFORE UPDATE OF status ON public.hotel_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_hotel_table_release_before_settlement();

REVOKE EXECUTE ON FUNCTION public.current_authenticated_staff_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.resolve_hotel_payment_staff_id(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.resolve_hotel_payment_shift_id(UUID, UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.apply_hotel_payment_shift_audit(UUID, UUID, UUID, UUID, UUID, public.hotel_payment_method, NUMERIC, TEXT, TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.update_hotel_invoice_payment_snapshot(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ensure_hotel_table_session_invoice(UUID, UUID, UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_hotel_invoice_payment(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, TEXT, TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_hotel_table_payment(UUID, TEXT, UUID, UUID, NUMERIC, UUID, UUID, TEXT, TEXT, TEXT) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.current_authenticated_staff_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_hotel_payment_staff_id(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_hotel_payment_shift_id(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_hotel_payment_shift_audit(UUID, UUID, UUID, UUID, UUID, public.hotel_payment_method, NUMERIC, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_hotel_invoice_payment_snapshot(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_hotel_table_session_invoice(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_hotel_invoice_payment(UUID, TEXT, NUMERIC, TEXT, UUID, UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_hotel_table_payment(UUID, TEXT, UUID, UUID, NUMERIC, UUID, UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;
