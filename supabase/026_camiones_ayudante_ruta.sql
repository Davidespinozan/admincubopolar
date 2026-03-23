-- 026: Tabla camiones + ayudante y camión en rutas
-- Para rastrear qué camión y ayudante salen en cada ruta.

CREATE TABLE IF NOT EXISTS camiones (
  id BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,              -- "Camión 1", "Ford F-350 blanca"
  placas      TEXT NOT NULL DEFAULT '',
  modelo      TEXT NOT NULL DEFAULT '',
  estatus     TEXT NOT NULL DEFAULT 'Activo'
    CHECK (estatus IN ('Activo','En taller','Inactivo')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Columnas nuevas en rutas
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS ayudante_id BIGINT REFERENCES empleados(id);
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS camion_id   BIGINT REFERENCES camiones(id);

-- RLS: acceso para usuarios autenticados
ALTER TABLE camiones ENABLE ROW LEVEL SECURITY;
CREATE POLICY camiones_auth ON camiones FOR ALL USING (auth.role() = 'authenticated');
