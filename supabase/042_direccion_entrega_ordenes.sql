-- 042_direccion_entrega_ordenes.sql
-- Permite override de la dirección de entrega por orden (vs. usar la
-- del cliente). Útil cuando un cliente recurrente pide entrega a otra
-- dirección puntualmente, o cuando el operador captura un domicilio
-- distinto al fiscal.
--
-- NULL en estas columnas = el chofer usa la dirección del cliente
-- (calle/colonia/ciudad de la tabla clientes). Si tiene valor, override.

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS direccion_entrega   TEXT;

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS referencia_entrega  TEXT;

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS latitud_entrega     NUMERIC(10, 7);

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS longitud_entrega    NUMERIC(10, 7);

COMMENT ON COLUMN ordenes.direccion_entrega IS
  'Direccion custom de entrega (override del cliente). NULL = usar direccion del cliente.';

COMMENT ON COLUMN ordenes.referencia_entrega IS
  'Referencias para el chofer (color de casa, esquina, etc.). Visible en la card de entrega.';

COMMENT ON COLUMN ordenes.latitud_entrega IS
  'Latitud GPS de la direccion custom (si difiere del cliente).';

COMMENT ON COLUMN ordenes.longitud_entrega IS
  'Longitud GPS de la direccion custom.';
