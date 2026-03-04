-- ════════════════════════════════════════════════════════════
-- MIGRACIÓN 008: Clientes asignados a rutas
-- ════════════════════════════════════════════════════════════
-- Permite asignar clientes específicos a una ruta para que el 
-- chofer sepa quiénes visitar y tenga acceso a su info de contacto
-- ════════════════════════════════════════════════════════════

-- Agregar columna de clientes asignados (array de IDs)
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS clientes_asignados JSONB DEFAULT '[]';
-- Estructura: [{ "clienteId": 1, "orden": 1 }, { "clienteId": 5, "orden": 2 }, ...]

-- Índice para búsqueda eficiente
CREATE INDEX IF NOT EXISTS idx_rutas_clientes_asignados ON rutas USING GIN (clientes_asignados);

-- Comentario descriptivo
COMMENT ON COLUMN rutas.clientes_asignados IS 'Lista de clientes asignados a la ruta con orden de visita [{clienteId, orden}]';
