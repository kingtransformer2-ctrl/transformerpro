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

  WITH session_seats AS (
    SELECT
      sseat.id,
      sseat.seat_no,
      sseat.guest_name,
      sseat.status
    FROM public.hotel_table_session_seats sseat
    WHERE sseat.session_id = p_session_id
  ),
  first_seat AS (
    SELECT ss.id
    FROM session_seats ss
    WHERE ss.seat_no = 1
    ORDER BY ss.seat_no
    LIMIT 1
  ),
  session_items AS (
    SELECT
      oi.id,
      COALESCE(
        oi.seat_id,
        (
          SELECT ss_by_no.id
          FROM session_seats ss_by_no
          WHERE ss_by_no.seat_no = oi.seat_no
          ORDER BY ss_by_no.seat_no
          LIMIT 1
        ),
        fs.id
      ) AS resolved_seat_id,
      oi.total_price
    FROM public.hotel_order_items oi
    JOIN public.hotel_orders o ON o.id = oi.order_id
    LEFT JOIN first_seat fs ON TRUE
    WHERE o.session_id = p_session_id
      AND oi.status <> 'cancelled'
  ),
  item_totals_by_seat AS (
    SELECT
      si.resolved_seat_id AS seat_id,
      COALESCE(SUM(si.total_price), 0) AS item_total
    FROM session_items si
    WHERE si.resolved_seat_id IS NOT NULL
    GROUP BY si.resolved_seat_id
  ),
  direct_payments_by_seat AS (
    SELECT
      p.seat_id,
      COALESCE(SUM(p.amount), 0) AS direct_paid
    FROM public.hotel_payments p
    JOIN session_seats ss ON ss.id = p.seat_id
    WHERE COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
    GROUP BY p.seat_id
  ),
  seat_group_candidates AS (
    SELECT
      pgs.seat_id,
      g.id AS payment_group_id,
      g.group_name AS payment_group_name,
      ROW_NUMBER() OVER (
        PARTITION BY pgs.seat_id
        ORDER BY
          CASE WHEN g.status = 'active' THEN 0 ELSE 1 END,
          g.updated_at DESC,
          g.created_at DESC,
          g.id DESC
      ) AS rn
    FROM public.hotel_table_payment_group_seats pgs
    JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
    JOIN session_seats ss ON ss.id = pgs.seat_id
    WHERE g.session_id = p_session_id
      AND g.status <> 'cancelled'
  ),
  preferred_seat_group AS (
    SELECT
      sgc.seat_id,
      sgc.payment_group_id,
      sgc.payment_group_name
    FROM seat_group_candidates sgc
    WHERE sgc.rn = 1
  ),
  group_totals AS (
    SELECT
      pgs.payment_group_id,
      COALESCE(SUM(COALESCE(its.item_total, 0)), 0) AS group_total
    FROM public.hotel_table_payment_group_seats pgs
    JOIN public.hotel_table_payment_groups g ON g.id = pgs.payment_group_id
    JOIN session_seats ss ON ss.id = pgs.seat_id
    LEFT JOIN item_totals_by_seat its ON its.seat_id = pgs.seat_id
    WHERE g.session_id = p_session_id
      AND g.status <> 'cancelled'
    GROUP BY pgs.payment_group_id
  ),
  group_payments AS (
    SELECT
      p.payment_group_id,
      COALESCE(SUM(p.amount), 0) AS group_paid
    FROM public.hotel_payments p
    JOIN public.hotel_table_payment_groups g ON g.id = p.payment_group_id
    WHERE g.session_id = p_session_id
      AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
    GROUP BY p.payment_group_id
  ),
  seat_group_paid AS (
    SELECT
      psg.seat_id,
      psg.payment_group_id,
      psg.payment_group_name,
      CASE
        WHEN COALESCE(gt.group_total, 0) <= 0
          OR COALESCE(gp.group_paid, 0) <= 0
          OR COALESCE(its.item_total, 0) <= 0
        THEN 0
        ELSE ROUND(
          LEAST(
            COALESCE(its.item_total, 0),
            (COALESCE(gp.group_paid, 0) * COALESCE(its.item_total, 0)) / NULLIF(gt.group_total, 0)
          ),
          2
        )
      END AS grouped_paid
    FROM preferred_seat_group psg
    LEFT JOIN item_totals_by_seat its ON its.seat_id = psg.seat_id
    LEFT JOIN group_totals gt ON gt.payment_group_id = psg.payment_group_id
    LEFT JOIN group_payments gp ON gp.payment_group_id = psg.payment_group_id
  ),
  seat_rows AS (
    SELECT
      ss.id,
      ss.seat_no,
      ss.guest_name,
      ss.status,
      CASE
        WHEN COALESCE(its.item_total, 0) <= 0 THEN 'paid'
        WHEN LEAST(
          COALESCE(its.item_total, 0),
          COALESCE(dps.direct_paid, 0) + COALESCE(sgp.grouped_paid, 0)
        ) >= COALESCE(its.item_total, 0) THEN 'paid'
        WHEN LEAST(
          COALESCE(its.item_total, 0),
          COALESCE(dps.direct_paid, 0) + COALESCE(sgp.grouped_paid, 0)
        ) > 0 THEN 'partial'
        ELSE 'pending'
      END AS payment_status,
      COALESCE(its.item_total, 0) AS item_total,
      LEAST(
        COALESCE(its.item_total, 0),
        COALESCE(dps.direct_paid, 0) + COALESCE(sgp.grouped_paid, 0)
      ) AS total_paid,
      GREATEST(
        COALESCE(its.item_total, 0) - LEAST(
          COALESCE(its.item_total, 0),
          COALESCE(dps.direct_paid, 0) + COALESCE(sgp.grouped_paid, 0)
        ),
        0
      ) AS outstanding_amount,
      sgp.payment_group_id,
      sgp.payment_group_name
    FROM session_seats ss
    LEFT JOIN item_totals_by_seat its ON its.seat_id = ss.id
    LEFT JOIN direct_payments_by_seat dps ON dps.seat_id = ss.id
    LEFT JOIN seat_group_paid sgp ON sgp.seat_id = ss.id
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
      ARRAY_AGG(ss.id ORDER BY ss.seat_no) FILTER (WHERE ss.id IS NOT NULL) AS seat_ids,
      ARRAY_AGG(ss.seat_no ORDER BY ss.seat_no) FILTER (WHERE ss.id IS NOT NULL) AS seat_numbers
    FROM public.hotel_table_payment_groups g
    LEFT JOIN public.hotel_table_payment_group_seats pgs ON pgs.payment_group_id = g.id
    LEFT JOIN session_seats ss ON ss.id = pgs.seat_id
    WHERE g.session_id = p_session_id
    GROUP BY g.id, g.group_name, g.status, g.total_amount, g.paid_amount
  ),
  session_totals AS (
    SELECT
      COALESCE(SUM(sr.item_total), 0) AS total_amount,
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.hotel_payments p
        WHERE p.session_id = p_session_id
          AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
      ), 0) AS total_paid,
      COUNT(*) AS seat_count,
      COUNT(*) FILTER (WHERE sr.payment_status = 'paid') AS paid_seat_count,
      COUNT(*) FILTER (WHERE sr.payment_status IN ('partial', 'paid')) AS touched_seat_count
    FROM seat_rows sr
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
          'seat_id', sr.id,
          'seat_no', sr.seat_no,
          'guest_name', sr.guest_name,
          'status', sr.status,
          'payment_status', sr.payment_status,
          'item_total', sr.item_total,
          'total_paid', sr.total_paid,
          'outstanding_amount', sr.outstanding_amount,
          'payment_group_id', sr.payment_group_id,
          'payment_group_name', sr.payment_group_name
        )
        ORDER BY sr.seat_no
      )
      FROM seat_rows sr
    ), '[]'::jsonb),
    'groups', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'payment_group_id', gr.id,
          'group_name', gr.group_name,
          'status', gr.status,
          'payment_status', gr.payment_status,
          'total_amount', gr.total_amount,
          'paid_amount', gr.paid_amount,
          'outstanding_amount', gr.outstanding_amount,
          'seat_ids', COALESCE(gr.seat_ids, ARRAY[]::UUID[]),
          'seat_numbers', COALESCE(gr.seat_numbers, ARRAY[]::INTEGER[])
        )
        ORDER BY gr.group_name
      )
      FROM group_rows gr
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
