-- Keep grouped seat payments visible in live table-session billing summaries
-- after a payment group is fully paid and transitions from active -> closed.

CREATE OR REPLACE FUNCTION public.get_hotel_table_session_summary(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.hotel_table_sessions
    WHERE id = p_session_id
  ) THEN
    RETURN NULL;
  END IF;

  WITH seat_base AS (
    SELECT
      sseat.id,
      sseat.seat_no,
      sseat.guest_name,
      sseat.status,
      COALESCE((
        SELECT SUM(oi.total_price)
        FROM public.hotel_order_items oi
        JOIN public.hotel_orders o ON o.id = oi.order_id
        WHERE o.session_id = p_session_id
          AND (
            oi.seat_id = sseat.id
            OR (oi.seat_id IS NULL AND sseat.seat_no = 1)
          )
          AND oi.status <> 'cancelled'
      ), 0) AS item_total,
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments p
        WHERE p.seat_id = sseat.id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0) AS direct_paid,
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
        AND g.status <> 'cancelled'
      ORDER BY
        CASE WHEN g.status = 'active' THEN 0 ELSE 1 END,
        g.updated_at DESC,
        g.created_at DESC
      LIMIT 1
    ) grp ON TRUE
    WHERE sseat.session_id = p_session_id
  ),
  seat_rows AS (
    SELECT
      base.id,
      base.seat_no,
      base.guest_name,
      base.status,
      CASE
        WHEN base.item_total <= 0 THEN 'paid'
        WHEN paid_calc.total_paid >= base.item_total THEN 'paid'
        WHEN paid_calc.total_paid > 0 THEN 'partial'
        ELSE 'pending'
      END AS payment_status,
      base.item_total,
      paid_calc.total_paid,
      GREATEST(base.item_total - paid_calc.total_paid, 0) AS outstanding_amount,
      base.payment_group_id,
      base.payment_group_name
    FROM seat_base base
    LEFT JOIN LATERAL (
      SELECT LEAST(
        base.item_total,
        base.direct_paid + COALESCE(group_alloc.allocated_paid, 0)
      ) AS total_paid
      FROM (
        SELECT CASE
          WHEN base.payment_group_id IS NULL THEN 0
          WHEN totals.group_total <= 0 OR totals.group_paid <= 0 THEN 0
          ELSE ROUND(LEAST(base.item_total, (totals.group_paid * base.item_total) / totals.group_total), 2)
        END AS allocated_paid
        FROM (
          SELECT
            COALESCE((
              SELECT SUM(oi.total_price)
              FROM public.hotel_table_payment_group_seats pgs
              JOIN public.hotel_table_session_seats grouped_seat ON grouped_seat.id = pgs.seat_id
              JOIN public.hotel_order_items oi ON (
                oi.seat_id = grouped_seat.id
                OR (oi.seat_id IS NULL AND grouped_seat.seat_no = 1)
              )
              JOIN public.hotel_orders o ON o.id = oi.order_id
              WHERE pgs.payment_group_id = base.payment_group_id
                AND oi.status <> 'cancelled'
                AND o.session_id = p_session_id
            ), 0) AS group_total,
            COALESCE((
              SELECT SUM(p.amount)
              FROM public.hotel_payments p
              WHERE p.payment_group_id = base.payment_group_id
                AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
            ), 0) AS group_paid
        ) totals
      ) group_alloc
    ) paid_calc ON TRUE
  ),
  group_rows AS (
    SELECT
      g.id,
      g.group_name,
      CASE
        WHEN g.status = 'cancelled' THEN 'cancelled'
        WHEN g.total_amount <= 0 OR g.paid_amount >= g.total_amount THEN 'closed'
        ELSE 'active'
      END AS status,
      CASE
        WHEN g.total_amount <= 0 THEN 'paid'
        WHEN g.paid_amount >= g.total_amount THEN 'paid'
        WHEN g.paid_amount > 0 THEN 'partial'
        ELSE 'pending'
      END AS payment_status,
      g.total_amount,
      g.paid_amount,
      GREATEST(g.total_amount - g.paid_amount, 0) AS outstanding_amount,
      ARRAY_AGG(sseat.id ORDER BY sseat.seat_no) FILTER (WHERE sseat.id IS NOT NULL) AS seat_ids,
      ARRAY_AGG(sseat.seat_no ORDER BY sseat.seat_no) FILTER (WHERE sseat.id IS NOT NULL) AS seat_numbers
    FROM public.hotel_table_payment_groups g
    LEFT JOIN public.hotel_table_payment_group_seats pgs ON pgs.payment_group_id = g.id
    LEFT JOIN public.hotel_table_session_seats sseat ON sseat.id = pgs.seat_id
    WHERE g.session_id = p_session_id
    GROUP BY g.id, g.group_name, g.status, g.total_amount, g.paid_amount
  ),
  session_totals AS (
    SELECT
      COALESCE(SUM(seat.item_total), 0) AS total_amount,
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments p
        WHERE p.session_id = p_session_id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0) AS total_paid,
      COUNT(*) AS seat_count,
      COUNT(*) FILTER (WHERE seat.payment_status = 'paid') AS paid_seat_count,
      COUNT(*) FILTER (WHERE seat.payment_status IN ('partial', 'paid')) AS touched_seat_count
    FROM seat_rows seat
  )
  SELECT jsonb_build_object(
    'session_id', s.id,
    'table_id', s.table_id,
    'table_number', COALESCE(s.table_number, t.table_number),
    'guest_count', s.guest_count,
    'status', CASE
      WHEN st.seat_count > 0 AND st.paid_seat_count = st.seat_count THEN 'closed'
      WHEN st.touched_seat_count > 0 THEN 'partially_paid'
      ELSE 'active'
    END,
    'payment_status', CASE
      WHEN st.seat_count > 0 AND st.paid_seat_count = st.seat_count THEN 'paid'
      WHEN st.touched_seat_count > 0 THEN 'partial'
      ELSE 'pending'
    END,
    'opened_at', s.opened_at,
    'opened_by', s.opened_by,
    'opened_shift_id', s.opened_shift_id,
    'total_amount', st.total_amount,
    'total_paid', st.total_paid,
    'outstanding_amount', GREATEST(st.total_amount - st.total_paid, 0),
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
          'outstanding_amount', seat.outstanding_amount,
          'payment_group_id', seat.payment_group_id,
          'payment_group_name', seat.payment_group_name
        )
        ORDER BY seat.seat_no
      )
      FROM seat_rows seat
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
          'outstanding_amount', grp.outstanding_amount,
          'seat_ids', COALESCE(grp.seat_ids, ARRAY[]::UUID[]),
          'seat_numbers', COALESCE(grp.seat_numbers, ARRAY[]::INTEGER[])
        )
        ORDER BY grp.group_name
      )
      FROM group_rows grp
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.hotel_table_sessions s
  JOIN public.hotel_tables t ON t.id = s.table_id
  CROSS JOIN session_totals st
  WHERE s.id = p_session_id;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_hotel_table_session_summary(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_hotel_table_session_summary(UUID) TO authenticated, service_role;
