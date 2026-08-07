-- Improve get_hotel_table_session_summary to handle unassigned items.
-- If an item has no seat_id, it will be attributed to the first seat of the session
-- so that it's visible in the split bill view and the total remains correct.

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
    'total_amount', COALESCE((
      SELECT SUM(oi.total_price)
      FROM public.hotel_order_items oi
      JOIN public.hotel_orders o ON o.id = oi.order_id
      WHERE o.session_id = s.id
        AND oi.status <> 'cancelled'
    ), 0),
    'total_paid', COALESCE((
      SELECT SUM(p.amount)
      FROM public.hotel_payments p
      WHERE p.session_id = s.id
        AND COALESCE(p.status, 'posted') NOT IN ('void', 'refunded')
    ), 0),
    'outstanding_amount', GREATEST(
      COALESCE((
        SELECT SUM(oi.total_price)
        FROM public.hotel_order_items oi
        JOIN public.hotel_orders o ON o.id = oi.order_id
        WHERE o.session_id = s.id
          AND oi.status <> 'cancelled'
      ), 0) - COALESCE((
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
          base.id,
          base.seat_no,
          base.guest_name,
          base.status,
          base.payment_status,
          base.item_total,
          LEAST(base.item_total, base.direct_paid + COALESCE(group_alloc.allocated_paid, 0)) AS total_paid,
          base.payment_group_id,
          base.payment_group_name
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
                AND (
                  oi.seat_id = sseat.id 
                  OR (oi.seat_id IS NULL AND sseat.seat_no = 1) -- Assign unassigned items to Seat 1
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
              AND g.status = 'active'
            LIMIT 1
          ) grp ON TRUE
          WHERE sseat.session_id = p_session_id
        ) base
        LEFT JOIN LATERAL (
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
        ) group_alloc ON TRUE
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
