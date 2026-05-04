-- 055_unique_rfc_nominativos.sql
-- Previene duplicados de RFC en clientes Activos cuando el RFC es
-- nominativo (no genérico SAT). Permite múltiples clientes con
-- XAXX010101000 (público general) y XEXX010101000 (extranjero genérico),
-- que son RFCs reservados del SAT y comparten varios clientes legítimos.
--
-- Antes de este índice no había defensa contra crear 2 veces el mismo
-- cliente con RFC nominativo (ej. "Tienda La Esquina" capturada 2 veces),
-- lo que rompe identidad fiscal: cada timbre apunta a un row distinto y
-- los reportes por cliente quedan partidos.
--
-- Limpieza previa: el cliente id=97 (DAVID ESPINOZA) tenía saldo=$2000
-- en cache desincronizado vs CxC real $0. Verificado por David antes
-- de aplicar la migración. Se resetea a 0 para no dejar deuda fantasma.

UPDATE clientes
   SET saldo = 0
 WHERE id = 97
   AND saldo != 0
   AND NOT EXISTS (
     SELECT 1 FROM cuentas_por_cobrar
      WHERE cliente_id = 97 AND estatus != 'Pagada'
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_rfc_nominativo
  ON clientes(rfc)
  WHERE estatus = 'Activo'
    AND rfc IS NOT NULL
    AND rfc NOT IN ('XAXX010101000', 'XEXX010101000');

COMMENT ON INDEX idx_clientes_rfc_nominativo IS
  'Previene clientes activos con RFC nominativo duplicado. XAXX/XEXX exentos por ser RFCs genéricos SAT.';
