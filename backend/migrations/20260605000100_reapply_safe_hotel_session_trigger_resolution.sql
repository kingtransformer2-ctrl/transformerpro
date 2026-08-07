-- Re-apply a future-safe session trigger resolver.
-- This must be a new migration because previously applied migrations will not
-- run again on existing databases.
--
-- Goal:
-- 1. Never reference NEW.some_field directly for row types that may not have it.
-- 2. Resolve the table session generically from session_id, order_id, seat_id,
--    or payment_group_id regardless of which table fired the trigger.
-- 3. Keep the recursion guard so refresh_hotel_table_session_state() does not
--    re-enter itself through downstream updates.

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

  -- Resolve from the parent order for child tables like hotel_order_items.
  IF v_session_id IS NULL AND v_order_id IS NOT NULL THEN
    SELECT session_id
    INTO v_session_id
    FROM public.hotel_orders
    WHERE id = v_order_id;
  END IF;

  -- Resolve from the referenced seat for rows that only carry seat_id.
  IF v_session_id IS NULL AND v_seat_id IS NOT NULL THEN
    SELECT session_id
    INTO v_session_id
    FROM public.hotel_table_session_seats
    WHERE id = v_seat_id;
  END IF;

  -- Resolve from the referenced payment group for grouped payment changes.
  IF v_session_id IS NULL AND v_payment_group_id IS NOT NULL THEN
    SELECT session_id
    INTO v_session_id
    FROM public.hotel_table_payment_groups
    WHERE id = v_payment_group_id;
  END IF;

  IF v_session_id IS NOT NULL THEN
    PERFORM public.refresh_hotel_table_session_state(v_session_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
