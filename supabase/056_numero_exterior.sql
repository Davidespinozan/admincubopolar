-- 056_numero_exterior.sql
-- Agrega numero_exterior y numero_interior a clientes y configuracion_empresa.
-- numero_exterior es obligatorio en el form (validado en UI) para entregas
-- correctas y CFDI 4.0; en BD queda NULL para no romper clientes legacy
-- creados antes de esta migración.
--
-- Decisión: NO migrar `cp` legacy (mig 002) a `codigo_postal` (mig 009)
-- en este PR. Documentado como deuda técnica en
-- docs/PENDIENTES_TECNICOS.md. El UI sigue editando `cp` en clientes.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS numero_exterior TEXT,
  ADD COLUMN IF NOT EXISTS numero_interior TEXT;

COMMENT ON COLUMN clientes.numero_exterior IS
  'Número exterior del domicilio. Obligatorio en form para entregas y CFDI 4.0.';
COMMENT ON COLUMN clientes.numero_interior IS
  'Número interior opcional (depto, local, oficina).';

ALTER TABLE configuracion_empresa
  ADD COLUMN IF NOT EXISTS numero_exterior TEXT,
  ADD COLUMN IF NOT EXISTS numero_interior TEXT;

COMMENT ON COLUMN configuracion_empresa.numero_exterior IS
  'Número exterior del domicilio fiscal del emisor.';
COMMENT ON COLUMN configuracion_empresa.numero_interior IS
  'Número interior opcional del domicilio fiscal del emisor.';
