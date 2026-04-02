-- 032: GPS tracking para choferes en tiempo real

CREATE TABLE IF NOT EXISTS chofer_ubicaciones (
  id          BIGSERIAL PRIMARY KEY,
  ruta_id     BIGINT REFERENCES rutas(id) ON DELETE CASCADE,
  chofer_id   BIGINT REFERENCES usuarios(id) ON DELETE CASCADE,
  latitud     DOUBLE PRECISION NOT NULL,
  longitud    DOUBLE PRECISION NOT NULL,
  precision_m DOUBLE PRECISION, -- precisión del GPS en metros
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Solo mantener última ubicación por ruta (limpiar viejas periódicamente)
CREATE INDEX IF NOT EXISTS idx_chofer_ubi_ruta ON chofer_ubicaciones(ruta_id);
CREATE INDEX IF NOT EXISTS idx_chofer_ubi_chofer ON chofer_ubicaciones(chofer_id);
CREATE INDEX IF NOT EXISTS idx_chofer_ubi_created ON chofer_ubicaciones(created_at DESC);

-- RLS: chofer solo escribe sus ubicaciones, admin lee todo
ALTER TABLE chofer_ubicaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_all" ON chofer_ubicaciones FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');
CREATE POLICY "read_all" ON chofer_ubicaciones FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "chofer_insert_own" ON chofer_ubicaciones FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() = 'Chofer' AND chofer_id = get_my_user_id());

-- Vista rápida: última ubicación por ruta activa
CREATE OR REPLACE VIEW chofer_ubicacion_actual AS
SELECT DISTINCT ON (ruta_id)
  ruta_id, chofer_id, latitud, longitud, precision_m, created_at
FROM chofer_ubicaciones
ORDER BY ruta_id, created_at DESC;
