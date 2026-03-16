-- ═══════════════════════════════════════════════════════════════
-- 014_storage_mermas.sql
-- Bucket y políticas para guardar evidencias de mermas en Supabase Storage
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'mermas',
  'mermas',
  false,
  5242880,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS mermas_anon_read ON storage.objects;
DROP POLICY IF EXISTS mermas_anon_insert ON storage.objects;
DROP POLICY IF EXISTS mermas_anon_update ON storage.objects;
DROP POLICY IF EXISTS mermas_anon_delete ON storage.objects;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'mermas_authenticated_read'
  ) THEN
    CREATE POLICY mermas_authenticated_read
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'mermas');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'mermas_authenticated_insert'
  ) THEN
    CREATE POLICY mermas_authenticated_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'mermas');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'mermas_authenticated_update'
  ) THEN
    CREATE POLICY mermas_authenticated_update
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = 'mermas')
      WITH CHECK (bucket_id = 'mermas');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'mermas_authenticated_delete'
  ) THEN
    CREATE POLICY mermas_authenticated_delete
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'mermas');
  END IF;
END $$;

COMMIT;