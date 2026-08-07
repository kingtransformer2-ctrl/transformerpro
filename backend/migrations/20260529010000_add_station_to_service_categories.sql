ALTER TABLE public.hotel_service_categories
  ADD COLUMN IF NOT EXISTS station TEXT NOT NULL DEFAULT 'kitchen'
  CHECK (station IN ('kitchen', 'bar', 'other'));

UPDATE public.hotel_service_categories
SET station = CASE
  WHEN name IN ('beverages', 'minibar') THEN 'bar'
  WHEN name IN ('other') THEN 'other'
  ELSE 'kitchen'
END
WHERE station IS DISTINCT FROM CASE
  WHEN name IN ('beverages', 'minibar') THEN 'bar'
  WHEN name IN ('other') THEN 'other'
  ELSE 'kitchen'
END;
