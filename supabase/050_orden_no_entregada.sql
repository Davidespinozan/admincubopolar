-- 050_orden_no_entregada.sql
-- Agrega flujo "No entregada" para órdenes que el chofer no pudo
-- completar (cliente cerrado, ausente, rechazó, sin acceso, etc.).
-- También agrega 'En ruta' al ENUM para alinear con el FSM en JS
-- (TRANSICIONES_ORDEN en src/data/ordenLogic.js).
--
-- ⚠️ EJECUTAR EN 2 BLOQUES SEPARADOS en Supabase Studio SQL Editor.
-- Postgres NO permite que ALTER TYPE ... ADD VALUE corra dentro de la
-- misma transacción que use el nuevo valor. Por eso los dos ALTER TYPE
-- van solos en el primer bloque, y el ALTER TABLE va en el segundo.

-- ═══════════════════════════════════════════════════════════
-- BLOQUE 1 — correr primero, esperar a que termine
-- ═══════════════════════════════════════════════════════════

ALTER TYPE estatus_orden ADD VALUE IF NOT EXISTS 'En ruta';
ALTER TYPE estatus_orden ADD VALUE IF NOT EXISTS 'No entregada';

-- ═══════════════════════════════════════════════════════════
-- BLOQUE 2 — correr después del bloque 1
-- ═══════════════════════════════════════════════════════════

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS motivo_no_entrega   TEXT,
  ADD COLUMN IF NOT EXISTS fecha_no_entrega    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reagendada          BOOLEAN DEFAULT false;

COMMENT ON COLUMN ordenes.motivo_no_entrega IS
  'Motivo capturado por el chofer al marcar la orden como No entregada';
COMMENT ON COLUMN ordenes.fecha_no_entrega IS
  'Timestamp del momento de la no-entrega';
COMMENT ON COLUMN ordenes.reagendada IS
  'true si el chofer indicó que debe reagendarse para próxima ruta';
