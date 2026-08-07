ALTER TABLE public.hotel_service_categories
  ADD COLUMN IF NOT EXISTS image_url TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'category-images',
      'category-images',
      true,
      1048576,
      ARRAY['image/webp', 'image/png', 'image/jpeg']
    )
    ON CONFLICT (id) DO UPDATE
    SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSE
    RAISE NOTICE 'Skipping storage.buckets bucket registration: not running against Supabase Storage (file_size_limit column not found).';
  END IF;
END
$$;