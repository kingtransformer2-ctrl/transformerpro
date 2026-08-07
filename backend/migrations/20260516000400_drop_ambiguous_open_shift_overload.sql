-- Remove the deprecated overload so PostgREST can resolve the RPC unambiguously.
-- The canonical function is open_hotel_staff_shift(uuid, text, text, numeric, text).

DROP FUNCTION IF EXISTS public.open_hotel_staff_shift(text, numeric, text);
