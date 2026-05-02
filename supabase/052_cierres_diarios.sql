-- 052_cierres_diarios.sql
-- Tabla `cierres_diarios` para cortes de caja por ruta.
-- Captura contado físico vs esperado del sistema.
--
-- Decisión: 3 cubos de método de pago (Efectivo / Transferencia / Crédito).
-- 'Transferencia' agrupa transferencias bancarias + Tarjeta + QR/Link de pago
-- (todo no-efectivo no-crédito). El admin verifica el agregado contra banco.
-- Crédito NO entra en contado: representa CxC generada, no dinero físico.
--
-- Alcance del cierre: solo pagos cuyo orden_id pertenece a la ruta. La
-- cobranza de CxC vieja durante la ruta se ve en histórico de pagos, no aquí.

CREATE TABLE IF NOT EXISTS cierres_diarios (
  id                       BIGSERIAL PRIMARY KEY,
  fecha                    DATE NOT NULL,
  ruta_id                  BIGINT REFERENCES rutas(id),
  chofer_id                BIGINT REFERENCES usuarios(id),

  -- Esperado (calculado del sistema desde pagos.metodo_pago de la ruta)
  esperado_efectivo        NUMERIC(12,2) NOT NULL DEFAULT 0,
  esperado_transferencia   NUMERIC(12,2) NOT NULL DEFAULT 0,
  esperado_credito         NUMERIC(12,2) NOT NULL DEFAULT 0,
  esperado_total           NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Contado (capturado por admin al cerrar)
  contado_efectivo         NUMERIC(12,2) NOT NULL DEFAULT 0,
  contado_transferencia    NUMERIC(12,2) NOT NULL DEFAULT 0,
  contado_total            NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Diferencia (contado_total - (esperado_efectivo + esperado_transferencia))
  diferencia               NUMERIC(12,2) NOT NULL DEFAULT 0,
  motivo_diferencia        TEXT,

  -- Cierre
  cerrado_at               TIMESTAMPTZ DEFAULT NOW(),
  cerrado_por              TEXT NOT NULL,
  notas                    TEXT,

  -- Snapshot: lista de {pago_id, monto, metodo, orden_folio} al momento del cierre
  pagos_snapshot           JSONB,

  created_at               TIMESTAMPTZ DEFAULT NOW(),

  -- Un cierre por ruta por fecha (UNIQUE bloquea segunda invocación)
  UNIQUE(fecha, ruta_id)
);

CREATE INDEX IF NOT EXISTS idx_cierres_fecha  ON cierres_diarios(fecha);
CREATE INDEX IF NOT EXISTS idx_cierres_chofer ON cierres_diarios(chofer_id);

ALTER TABLE cierres_diarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_cierres" ON cierres_diarios;
DROP POLICY IF EXISTS "read_all_cierres"  ON cierres_diarios;

CREATE POLICY "admin_all_cierres" ON cierres_diarios FOR ALL TO authenticated
  USING (get_my_rol() = 'Admin') WITH CHECK (get_my_rol() = 'Admin');

CREATE POLICY "read_all_cierres" ON cierres_diarios FOR SELECT TO authenticated
  USING (true);

COMMENT ON TABLE cierres_diarios IS 'Cortes de caja por ruta. Captura contado físico vs esperado del sistema con motivo de diferencia.';
COMMENT ON COLUMN cierres_diarios.esperado_transferencia IS 'Agrega Transferencia + Tarjeta + QR/Link de pago (todo no-efectivo no-crédito).';
COMMENT ON COLUMN cierres_diarios.diferencia IS 'contado_total - (esperado_efectivo + esperado_transferencia). Positivo = sobrante, negativo = faltante.';
COMMENT ON COLUMN cierres_diarios.pagos_snapshot IS 'Snapshot inmutable de los pagos considerados para el cierre. Usado para auditoría retroactiva.';
