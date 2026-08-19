-- 066: Habilitar realtime para notificaciones y chofer_ubicaciones
-- (Tanda 23 suscribió estas dos tablas nuevas: campana instantánea y
-- GPS del chofer en vivo. Sin esto, los canales se suscriben pero
-- nunca reciben eventos.)
--
-- Idempotente: si la publicación ya incluye la tabla (o es FOR ALL
-- TABLES), no hace nada. Correr en el SQL Editor de Supabase.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notificaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chofer_ubicaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chofer_ubicaciones;
  END IF;
END $$;

-- Verificación: debe listar notificaciones y chofer_ubicaciones junto
-- con las demás tablas suscritas (clientes, ordenes, rutas, etc.)
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
ORDER BY tablename;
