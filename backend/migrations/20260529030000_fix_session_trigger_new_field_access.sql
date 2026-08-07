-- Fix trigger function to safely read optional fields across different table row types.
-- Previous versions referenced NEW.session_id directly, which crashes for hotel_order_items
-- because that table does not have a session_id column.

CREATE OR REPLACE FUNCTION public.handle_hotel_session_related_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_new JSONB := '{}'::jsonb;
  v_old JSONB := '{}'::jsonb;
  v_order_id UUID;
  v_seat_id UUID;
  v_payment_group_id UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new := to_jsonb(NEW);
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old := to_jsonb(OLD);
  END IF;

  v_session_id := COALESCE(
    NULLIF(v_new ->> 'session_id', '')::uuid,
    NULLIF(v_old ->> 'session_id', '')::uuid
  );

  v_order_id := COALESCE(
    NULLIF(v_new ->> 'order_id', '')::uuid,
    NULLIF(v_old ->> 'order_id', '')::uuid
  );

  v_seat_id := COALESCE(
    NULLIF(v_new ->> 'seat_id', '')::uuid,
    NULLIF(v_old ->> 'seat_id', '')::uuid
  );

  v_payment_group_id := COALESCE(
    NULLIF(v_new ->> 'payment_group_id', '')::uuid,
    NULLIF(v_old ->> 'payment_group_id', '')::uuid
  );

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_order_items' THEN
    SELECT session_id
    INTO v_session_id
    FROM public.hotel_orders
    WHERE id = v_order_id;
  END IF;

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_table_session_seats' THEN
    v_session_id := COALESCE(
      NULLIF(v_new ->> 'session_id', '')::uuid,
      NULLIF(v_old ->> 'session_id', '')::uuid
    );
  END IF;

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_table_payment_groups' THEN
    v_session_id := COALESCE(
      NULLIF(v_new ->> 'session_id', '')::uuid,
      NULLIF(v_old ->> 'session_id', '')::uuid
    );
  END IF;

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_table_payment_group_seats' THEN
    SELECT g.session_id
    INTO v_session_id
    FROM public.hotel_table_payment_groups g
    WHERE g.id = v_payment_group_id;
  END IF;

  IF v_session_id IS NULL AND TG_TABLE_NAME = 'hotel_payments' THEN
    v_session_id := COALESCE(
      NULLIF(v_new ->> 'session_id', '')::uuid,
      NULLIF(v_old ->> 'session_id', '')::uuid
    );

    IF v_session_id IS NULL AND v_seat_id IS NOT NULL THEN
      SELECT session_id
      INTO v_session_id
      FROM public.hotel_table_session_seats
      WHERE id = v_seat_id;
    END IF;

    IF v_session_id IS NULL AND v_payment_group_id IS NOT NULL THEN
      SELECT session_id
      INTO v_session_id
      FROM public.hotel_table_payment_groups
      WHERE id = v_payment_group_id;
    END IF;
  END IF;

  IF v_session_id IS NOT NULL THEN
    PERFORM public.refresh_hotel_table_session_state(v_session_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
