-- 051_devoluciones.sql
-- Tabla nueva `devoluciones` para registrar reembolsos/reposiciones
-- post-entrega. Categoría contable canónica para egresos: 'Devoluciones'.
-- cuarto_destino es TEXT porque cuartos_frios.id es TEXT (ver migración 023).

CREATE TABLE IF NOT EXISTS devoluciones (
  id                       BIGSERIAL PRIMARY KEY,
  orden_id                 BIGINT NOT NULL REFERENCES ordenes(id),
  cliente_id               BIGINT REFERENCES clientes(id),
  fecha                    TIMESTAMPTZ DEFAULT NOW(),
  motivo                   TEXT NOT NULL,
  tipo_reembolso           TEXT NOT NULL CHECK (tipo_reembolso IN ('Efectivo','Nota credito','Reposicion')),
  total                    NUMERIC(12,2) NOT NULL CHECK (total > 0),
  items                    JSONB NOT NULL,
  cuarto_destino           TEXT REFERENCES cuartos_frios(id),
  usuario                  TEXT NOT NULL,
  notas                    TEXT,
  requiere_nota_credito    BOOLEAN DEFAULT false,
  cfdi_nota_credito_uuid   TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devoluciones_orden   ON devoluciones(orden_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_cliente ON devoluciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_fecha   ON devoluciones(fecha);

-- RLS por rol (mismo patrón que migraciones 031/045/046)
ALTER TABLE devoluciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_devoluciones" ON devoluciones;
DROP POLICY IF EXISTS "read_all_devoluciones"  ON devoluciones;

CREATE POLICY "admin_all_devoluciones" ON devoluciones FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');

CREATE POLICY "read_all_devoluciones" ON devoluciones FOR SELECT TO authenticated
  USING (true);

-- Flag rápido para evitar JOIN en listados
ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS tiene_devolucion BOOLEAN DEFAULT false;

COMMENT ON TABLE  devoluciones IS 'Devoluciones post-entrega: reembolsos en efectivo, nota crédito (CFDI tipo E pendiente), o reposición física.';
COMMENT ON COLUMN devoluciones.cfdi_nota_credito_uuid IS 'UUID del CFDI tipo E. Queda NULL hasta integrar con Facturama.';
COMMENT ON COLUMN ordenes.tiene_devolucion IS 'Flag para mostrar "Ver devolución" en lugar de "Devolución" en OrdenesView.';
