-- Secure table session billing RPCs for authenticated POS users.
-- Fixes 403 errors on upsert_hotel_table_payment_group and ensures
-- related session billing RPCs are executable via Supabase PostgREST.

ALTER FUNCTION public.upsert_hotel_table_payment_group(UUID, TEXT, UUID[], UUID)
  SECURITY DEFINER;

ALTER FUNCTION public.upsert_hotel_table_payment_group(UUID, TEXT, UUID[], UUID)
  SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.upsert_hotel_table_payment_group(UUID, TEXT, UUID[], UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.upsert_hotel_table_payment_group(UUID, TEXT, UUID[], UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.open_hotel_table_session(UUID, INTEGER, UUID, UUID, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.open_hotel_table_session(UUID, INTEGER, UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_hotel_table_session_summary(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_hotel_table_session_summary(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.record_hotel_table_payment(UUID, TEXT, UUID, UUID, NUMERIC, UUID, UUID, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_hotel_table_payment(UUID, TEXT, UUID, UUID, NUMERIC, UUID, UUID, TEXT, TEXT) TO authenticated, service_role;
