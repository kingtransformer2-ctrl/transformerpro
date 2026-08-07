-- Reinforce safe enum handling for hotel table release validation.
-- Some environments can still retain the older trigger body that casts
-- an empty string into the hotel_table_status enum during status updates.

CREATE OR REPLACE FUNCTION public.prevent_hotel_table_release_before_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status public.hotel_table_status;
BEGIN
  v_old_status := COALESCE(OLD.status, 'free'::public.hotel_table_status);

  IF NEW.status = 'free'
     AND v_old_status <> 'free'
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
