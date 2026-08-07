-- Hotel tables management and attendance automation

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'hotel_table_status'
  ) THEN
    CREATE TYPE public.hotel_table_status AS ENUM ('free', 'reserved', 'occupied', 'cleaning');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.hotel_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number TEXT NOT NULL UNIQUE,
  name TEXT,
  area TEXT,
  capacity INTEGER NOT NULL DEFAULT 4,
  status public.hotel_table_status NOT NULL DEFAULT 'free',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);



DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'hotel_tables'
      AND policyname = 'Authenticated users can manage hotel tables'
  ) THEN
    
  END IF;
END $$;

ALTER TABLE public.hotel_orders
  ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES public.hotel_tables(id) ON DELETE SET NULL;

ALTER TABLE public.hotel_staff_attendance
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.hotel_staff_shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worked_hours NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_hotel_orders_table_id ON public.hotel_orders(table_id);
CREATE INDEX IF NOT EXISTS idx_hotel_tables_status ON public.hotel_tables(status);
CREATE INDEX IF NOT EXISTS idx_hotel_staff_attendance_shift_id ON public.hotel_staff_attendance(shift_id);
CREATE INDEX IF NOT EXISTS idx_hotel_staff_attendance_staff_date ON public.hotel_staff_attendance(staff_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_staff_attendance_unique_shift
  ON public.hotel_staff_attendance(shift_id)
  WHERE shift_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_hotel_tables_updated_at ON public.hotel_tables;
CREATE TRIGGER trigger_hotel_tables_updated_at
  BEFORE UPDATE ON public.hotel_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.sync_hotel_table_status(p_table_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_active_order BOOLEAN := false;
  current_status public.hotel_table_status;
BEGIN
  IF p_table_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.hotel_orders
    WHERE table_id = p_table_id
      AND status IN ('pending', 'preparing', 'ready', 'served', 'awaiting_approval', 'pending_handover', 'confirmed', 'billed', 'paid')
  ) INTO has_active_order;

  SELECT status INTO current_status
  FROM public.hotel_tables
  WHERE id = p_table_id;

  IF has_active_order THEN
    UPDATE public.hotel_tables
    SET status = 'occupied'
    WHERE id = p_table_id
      AND status <> 'occupied';
  ELSIF current_status = 'occupied' THEN
    UPDATE public.hotel_tables
    SET status = 'free'
    WHERE id = p_table_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_hotel_order_table_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_hotel_table_status(OLD.table_id);
    RETURN OLD;
  END IF;

  IF NEW.table_id IS DISTINCT FROM OLD.table_id THEN
    PERFORM public.sync_hotel_table_status(OLD.table_id);
  END IF;

  PERFORM public.sync_hotel_table_status(NEW.table_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_hotel_order_table_sync ON public.hotel_orders;
CREATE TRIGGER trigger_hotel_order_table_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.hotel_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_hotel_order_table_sync();

CREATE OR REPLACE FUNCTION public.sync_attendance_from_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attendance_id UUID;
  started_at_ts TIMESTAMPTZ;
  ended_at_ts TIMESTAMPTZ;
  worked NUMERIC := 0;
BEGIN
  started_at_ts := COALESCE(NEW.started_at, NEW.opened_at, now());
  ended_at_ts := COALESCE(NEW.ended_at, NEW.closed_at);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.hotel_staff_attendance (
      staff_id,
      shift_id,
      date,
      check_in_time,
      status,
      notes,
      is_active,
      source
    )
    VALUES (
      NEW.staff_id,
      NEW.id,
      timezone('UTC', started_at_ts)::date,
      started_at_ts,
      'active',
      COALESCE(NEW.opening_notes, 'Auto created from shift opening'),
      true,
      'shift'
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
  END IF;

  SELECT id INTO attendance_id
  FROM public.hotel_staff_attendance
  WHERE shift_id = NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF attendance_id IS NULL THEN
    INSERT INTO public.hotel_staff_attendance (
      staff_id,
      shift_id,
      date,
      check_in_time,
      check_out_time,
      status,
      notes,
      worked_hours,
      is_active,
      source
    )
    VALUES (
      NEW.staff_id,
      NEW.id,
      timezone('UTC', started_at_ts)::date,
      started_at_ts,
      ended_at_ts,
      CASE WHEN ended_at_ts IS NULL THEN 'active' ELSE 'completed' END,
      COALESCE(NEW.closing_notes, NEW.opening_notes, 'Auto created from shift sync'),
      CASE
        WHEN ended_at_ts IS NULL THEN 0
        ELSE ROUND(EXTRACT(EPOCH FROM (ended_at_ts - started_at_ts)) / 3600.0, 2)
      END,
      ended_at_ts IS NULL,
      'shift'
    );
    RETURN NEW;
  END IF;

  IF ended_at_ts IS NOT NULL THEN
    worked := ROUND(EXTRACT(EPOCH FROM (ended_at_ts - started_at_ts)) / 3600.0, 2);
  END IF;

  UPDATE public.hotel_staff_attendance
  SET
    check_in_time = COALESCE(check_in_time, started_at_ts),
    check_out_time = ended_at_ts,
    status = CASE WHEN ended_at_ts IS NULL THEN 'active' ELSE 'completed' END,
    notes = COALESCE(NEW.closing_notes, NEW.opening_notes, notes),
    worked_hours = CASE WHEN ended_at_ts IS NULL THEN worked_hours ELSE worked END,
    is_active = ended_at_ts IS NULL,
    source = 'shift'
  WHERE id = attendance_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_attendance_from_shift ON public.hotel_staff_shifts;
CREATE TRIGGER trigger_sync_attendance_from_shift
  AFTER INSERT OR UPDATE OF closed_at, ended_at, opening_notes, closing_notes, status ON public.hotel_staff_shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_attendance_from_shift();
