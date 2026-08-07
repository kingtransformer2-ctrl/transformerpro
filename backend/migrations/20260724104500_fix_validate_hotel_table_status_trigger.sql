-- Fix enum-safe validation for hotel_tables.status.
-- The previous trigger compared the enum value to an empty string, which can
-- itself raise "invalid input value for enum hotel_table_status: """ when
-- hotel_orders inserts cascade into hotel_tables updates.

CREATE OR REPLACE FUNCTION public.validate_hotel_table_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NULL
     OR NEW.status::text NOT IN ('free', 'reserved', 'occupied', 'cleaning') THEN
    NEW.status := 'free'::public.hotel_table_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_hotel_table_status ON public.hotel_tables;
CREATE TRIGGER trg_validate_hotel_table_status
  BEFORE INSERT OR UPDATE ON public.hotel_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_hotel_table_status();
