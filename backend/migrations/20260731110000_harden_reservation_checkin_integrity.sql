-- Enforce reservation check-in integrity at the database layer.
-- This keeps reservation -> waiter -> table session links consistent even if
-- other write paths update hotel_orders outside the current frontend flow.

CREATE OR REPLACE FUNCTION public.validate_hotel_reservation_checkin_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_table_id UUID;
  v_assigned_waiter_role TEXT;
  v_assigned_waiter_is_active BOOLEAN;
BEGIN
  IF NEW.order_type IS DISTINCT FROM 'reservation' THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_waiter_id IS NOT NULL THEN
    SELECT role, is_active
      INTO v_assigned_waiter_role, v_assigned_waiter_is_active
    FROM public.hotel_staff
    WHERE id = NEW.assigned_waiter_id;

    IF v_assigned_waiter_role IS NULL THEN
      RAISE EXCEPTION 'Assigned waiter must reference an existing hotel staff record';
    END IF;

    IF COALESCE(v_assigned_waiter_is_active, FALSE) = FALSE THEN
      RAISE EXCEPTION 'Assigned waiter must be active';
    END IF;

    IF v_assigned_waiter_role NOT IN ('waiter', 'waiter_admin') THEN
      RAISE EXCEPTION 'Assigned waiter must have waiter permissions';
    END IF;
  END IF;

  IF NEW.checked_in_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.session_id IS NULL THEN
    RAISE EXCEPTION 'Checked-in reservation must reference a table session';
  END IF;

  IF NEW.assigned_waiter_id IS NULL THEN
    RAISE EXCEPTION 'Checked-in reservation must have an assigned waiter';
  END IF;

  IF NEW.waiter_id IS NULL OR NEW.staff_id IS NULL THEN
    RAISE EXCEPTION 'Checked-in reservation must keep waiter_id and staff_id populated';
  END IF;

  IF NEW.waiter_id IS DISTINCT FROM NEW.assigned_waiter_id THEN
    RAISE EXCEPTION 'Checked-in reservation waiter_id must match assigned_waiter_id';
  END IF;

  IF NEW.staff_id IS DISTINCT FROM NEW.assigned_waiter_id THEN
    RAISE EXCEPTION 'Checked-in reservation staff_id must match assigned_waiter_id';
  END IF;

  SELECT table_id
    INTO v_session_table_id
  FROM public.hotel_table_sessions
  WHERE id = NEW.session_id;

  IF v_session_table_id IS NULL THEN
    RAISE EXCEPTION 'Checked-in reservation references a missing table session';
  END IF;

  IF NEW.table_id IS NOT NULL AND NEW.table_id IS DISTINCT FROM v_session_table_id THEN
    RAISE EXCEPTION 'Checked-in reservation table_id must match the linked table session';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_hotel_reservation_checkin_integrity ON public.hotel_orders;

CREATE TRIGGER trigger_validate_hotel_reservation_checkin_integrity
  BEFORE INSERT OR UPDATE
  ON public.hotel_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_hotel_reservation_checkin_integrity();
