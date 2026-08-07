CREATE OR REPLACE FUNCTION public.calculate_hotel_session_seat_totals(p_session_id UUID)
RETURNS TABLE (
  seat_id UUID,
  seat_no INTEGER,
  total_amount NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH first_seat AS (
    SELECT s.id, s.seat_no
    FROM public.hotel_table_session_seats AS s
    WHERE s.session_id = p_session_id
    ORDER BY s.seat_no
    LIMIT 1
  ),
  seat_item_subtotals AS (
    SELECT
      o.id AS order_id,
      COALESCE(oi.seat_id, o.seat_id, seat_by_item_no.id, seat_by_order_no.id, fs.id) AS seat_id,
      COALESCE(
        seat_direct.seat_no,
        order_seat_direct.seat_no,
        seat_by_item_no.seat_no,
        seat_by_order_no.seat_no,
        fs.seat_no,
        1
      ) AS seat_no,
      ROUND(SUM(COALESCE(oi.total_price, 0)), 2) AS seat_subtotal
    FROM public.hotel_orders AS o
    JOIN public.hotel_order_items AS oi
      ON oi.order_id = o.id
    LEFT JOIN public.hotel_table_session_seats AS seat_direct
      ON seat_direct.id = oi.seat_id
    LEFT JOIN public.hotel_table_session_seats AS order_seat_direct
      ON order_seat_direct.id = o.seat_id
    LEFT JOIN public.hotel_table_session_seats AS seat_by_item_no
      ON seat_by_item_no.session_id = p_session_id
     AND COALESCE(oi.seat_no, 0) > 0
     AND seat_by_item_no.seat_no = oi.seat_no
    LEFT JOIN public.hotel_table_session_seats AS seat_by_order_no
      ON seat_by_order_no.session_id = p_session_id
     AND COALESCE(0, 0) > 0
    LEFT JOIN first_seat AS fs
      ON TRUE
    WHERE o.session_id = p_session_id
      AND o.status <> 'cancelled'
      AND oi.status <> 'cancelled'
    GROUP BY
      o.id,
      COALESCE(oi.seat_id, o.seat_id, seat_by_item_no.id, seat_by_order_no.id, fs.id),
      COALESCE(
        seat_direct.seat_no,
        order_seat_direct.seat_no,
        seat_by_item_no.seat_no,
        seat_by_order_no.seat_no,
        fs.seat_no,
        1
      )
  ),
  ranked_allocations AS (
    SELECT
      ss.order_id,
      ss.seat_id,
      ss.seat_no,
      ss.seat_subtotal,
      ROUND(COALESCE(o.total_amount, ss.seat_subtotal), 2) AS order_total_amount,
      COALESCE(NULLIF(ROUND(COALESCE(o.subtotal, 0), 2), 0), NULLIF(ss.seat_subtotal, 0), 0) AS order_subtotal,
      ROW_NUMBER() OVER (PARTITION BY ss.order_id ORDER BY ss.seat_no, ss.seat_id) AS seat_rank,
      COUNT(*) OVER (PARTITION BY ss.order_id) AS seat_count
    FROM seat_item_subtotals AS ss
    JOIN public.hotel_orders AS o
      ON o.id = ss.order_id
  ),
  rounded_allocations AS (
    SELECT
      ra.*,
      ROUND(
        CASE
          WHEN ra.order_subtotal <= 0 THEN 0
          ELSE ra.order_total_amount * (ra.seat_subtotal / ra.order_subtotal)
        END,
        2
      ) AS rounded_share
    FROM ranked_allocations AS ra
  ),
  final_allocations AS (
    SELECT
      seat_id,
      seat_no,
      GREATEST(
        CASE
          WHEN seat_rank < seat_count THEN rounded_share
          ELSE ROUND(
            order_total_amount - COALESCE(
              SUM(rounded_share) OVER (
                PARTITION BY order_id
                ORDER BY seat_rank
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ),
              0
            ),
            2
          )
        END,
        0
      ) AS allocated_total
    FROM rounded_allocations
  )
  SELECT
    s.id AS seat_id,
    s.seat_no,
    ROUND(COALESCE(SUM(fa.allocated_total), 0), 2) AS total_amount
  FROM public.hotel_table_session_seats AS s
  LEFT JOIN final_allocations AS fa
    ON fa.seat_id = s.id
  WHERE s.session_id = p_session_id
  GROUP BY s.id, s.seat_no
  ORDER BY s.seat_no;
$$;

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
BEGIN
  IF p_session_id IS NULL THEN
    RETURN;
  END IF;

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
    updated_at = now()
  FROM (
    SELECT
      g_inner.id,
      COALESCE((
        SELECT SUM(st.total_amount)
        FROM public.hotel_table_payment_group_seats AS pgs
        JOIN public.calculate_hotel_session_seat_totals(p_session_id) AS st
          ON st.seat_id = pgs.seat_id
        WHERE pgs.payment_group_id = g_inner.id
      ), 0) AS total_amount,
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments AS p
        WHERE p.payment_group_id = g_inner.id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0) AS paid_amount
    FROM public.hotel_table_payment_groups AS g_inner
    WHERE g_inner.session_id = p_session_id
  ) AS totals
  WHERE g.id = totals.id;

  FOR v_seat IN
    SELECT id
    FROM public.hotel_table_session_seats
    WHERE session_id = p_session_id
  LOOP
    SELECT COALESCE(st.total_amount, 0)
    INTO v_due
    FROM public.calculate_hotel_session_seat_totals(p_session_id) AS st
    WHERE st.seat_id = v_seat.id;

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
      paid_at = CASE WHEN v_status = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END,
      updated_at = now()
    WHERE id = v_seat.id;
  END LOOP;

  SELECT
    COALESCE(bool_and(payment_status = 'paid'), false),
    COALESCE(bool_or(payment_status IN ('partial', 'paid')), false)
  INTO v_all_paid, v_any_paid
  FROM public.hotel_table_session_seats
  WHERE session_id = p_session_id;

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
    closed_at = CASE WHEN v_all_paid THEN COALESCE(closed_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = p_session_id;

  SELECT table_id
  INTO v_table_id
  FROM public.hotel_table_sessions
  WHERE id = p_session_id;

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

    SELECT GREATEST(
      COALESCE((
        SELECT SUM(st.total_amount)
        FROM public.hotel_table_payment_group_seats AS pgs
        JOIN public.calculate_hotel_session_seat_totals(p_session_id) AS st
          ON st.seat_id = pgs.seat_id
        WHERE pgs.payment_group_id = p_payment_group_id
      ), 0) - COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments AS p
        WHERE p.payment_group_id = p_payment_group_id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0),
      0
    )
    INTO v_group_due;

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
    SELECT session_id
    INTO v_seat_session_id
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
        SELECT st.total_amount
        FROM public.calculate_hotel_session_seat_totals(p_session_id) AS st
        WHERE st.seat_id = p_seat_id
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
        GREATEST(
          COALESCE((
            SELECT SUM(st.total_amount)
            FROM public.hotel_table_payment_group_seats AS pgs
            JOIN public.calculate_hotel_session_seat_totals(p_session_id) AS st
              ON st.seat_id = pgs.seat_id
            WHERE pgs.payment_group_id = g.id
          ), 0) - COALESCE(g.paid_amount, 0),
          0
        ) AS outstanding_amount
      FROM public.hotel_table_payment_groups AS g
      WHERE g.session_id = p_session_id
        AND g.status = 'active'
      ORDER BY g.group_name
      FOR UPDATE OF g
    LOOP
      IF v_group.outstanding_amount <= 0 THEN
        CONTINUE;
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
        st.seat_id AS id,
        st.seat_no,
        GREATEST(
          st.total_amount - COALESCE((
            SELECT SUM(p.amount)
            FROM public.hotel_payments AS p
            WHERE p.seat_id = st.seat_id
              AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
          ), 0),
          0
        ) AS outstanding_amount
      FROM public.calculate_hotel_session_seat_totals(p_session_id) AS st
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.hotel_table_payment_group_seats AS pgs
        JOIN public.hotel_table_payment_groups AS g
          ON g.id = pgs.payment_group_id
        WHERE pgs.seat_id = st.seat_id
          AND g.session_id = p_session_id
          AND g.status = 'active'
      )
      ORDER BY st.seat_no
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
