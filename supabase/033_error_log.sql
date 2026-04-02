-- 033: Error log para tracking de errores en producción

CREATE TABLE IF NOT EXISTS error_log (
  id          BIGSERIAL PRIMARY KEY,
  tipo        TEXT NOT NULL DEFAULT 'frontend', -- frontend, boundary, supabase, other
  mensaje     TEXT NOT NULL,
  stack       TEXT,
  componente  TEXT,
  url         TEXT,
  usuario_id  BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_tipo ON error_log(tipo);

-- RLS: todos pueden insertar (reportar errores), solo Admin puede leer
ALTER TABLE error_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read" ON error_log FOR SELECT TO authenticated
  USING (get_my_rol() = 'Admin');
CREATE POLICY "insert_all" ON error_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- Limpiar errores viejos (>30 días) — ejecutar manualmente o con cron
-- DELETE FROM error_log WHERE created_at < now() - interval '30 days';
