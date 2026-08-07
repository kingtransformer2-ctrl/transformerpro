-- Keep restaurant tables in cleaning mode briefly after service closes.
-- This prevents instant reuse and supports auto-release back to free.

ALTER TABLE public.hotel_tables
  ADD COLUMN IF NOT EXISTS cleaning_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_hotel_tables_cleaning_started_at
  ON public.hotel_tables(cleaning_started_at)
  WHERE status = 'cleaning';

UPDATE public.hotel_tables
SET cleaning_started_at = COALESCE(cleaning_started_at, updated_at, now())
WHERE status = 'cleaning'
  AND cleaning_started_at IS NULL;

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
      AND status IN ('pending', 'preparing', 'ready', 'served')
  ) INTO has_active_order;

  SELECT status INTO current_status
  FROM public.hotel_tables
  WHERE id = p_table_id;

  IF has_active_order THEN
    UPDATE public.hotel_tables
    SET
      status = 'occupied',
      cleaning_started_at = NULL
    WHERE id = p_table_id
      AND (status <> 'occupied' OR cleaning_started_at IS NOT NULL);
  ELSIF current_status = 'occupied' THEN
    UPDATE public.hotel_tables
    SET
      status = 'cleaning',
      cleaning_started_at = COALESCE(cleaning_started_at, now())
    WHERE id = p_table_id;
  ELSIF current_status = 'cleaning'
    AND EXISTS (
      SELECT 1
      FROM public.hotel_tables
      WHERE id = p_table_id
        AND cleaning_started_at IS NOT NULL
        AND cleaning_started_at <= now() - interval '1 minute'
    ) THEN
    UPDATE public.hotel_tables
    SET
      status = 'free',
      cleaning_started_at = NULL
    WHERE id = p_table_id;
  END IF;
END;
$$;
