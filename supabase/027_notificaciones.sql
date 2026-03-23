-- 027: Sistema de notificaciones
-- Almacena notificaciones generadas por eventos del sistema.

CREATE TABLE IF NOT EXISTS notificaciones (
  id          BIGSERIAL PRIMARY KEY,
  tipo        TEXT NOT NULL,          -- 'venta', 'credito', 'factura', 'complemento', 'produccion', 'cobro', 'alerta'
  titulo      TEXT NOT NULL,
  mensaje     TEXT NOT NULL,
  icono       TEXT DEFAULT '🔔',
  leida       BOOLEAN DEFAULT FALSE,
  referencia  TEXT,                    -- folio, ID, etc. for deep linking
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notificaciones_auth" ON notificaciones
  FOR ALL USING (auth.role() = 'authenticated');

-- Índice para consultas de no leídas
CREATE INDEX IF NOT EXISTS idx_notif_leida ON notificaciones (leida, created_at DESC);
