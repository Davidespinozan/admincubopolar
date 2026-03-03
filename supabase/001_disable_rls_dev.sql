-- Migration 001: Disable RLS temporarily for development
-- Descripción: Desactiva las políticas RLS para permitir que usuarios autenticados lean/escriban sin restricciones.
-- ADVERTENCIA: Esto es solo para desarrollo. En producción, activa RLS y configura políticas por rol.

BEGIN;

-- Desactivar RLS en todas las tablas (permiso total mientras estamos en desarrollo)
ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE clientes DISABLE ROW LEVEL SECURITY;
ALTER TABLE productos DISABLE ROW LEVEL SECURITY;
ALTER TABLE precios_esp DISABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes DISABLE ROW LEVEL SECURITY;
ALTER TABLE rutas DISABLE ROW LEVEL SECURITY;
ALTER TABLE produccion DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_mov DISABLE ROW LEVEL SECURITY;
ALTER TABLE cuartos_frios DISABLE ROW LEVEL SECURITY;
ALTER TABLE comodatos DISABLE ROW LEVEL SECURITY;
ALTER TABLE leads DISABLE ROW LEVEL SECURITY;
ALTER TABLE empleados DISABLE ROW LEVEL SECURITY;
ALTER TABLE nomina_periodos DISABLE ROW LEVEL SECURITY;
ALTER TABLE nomina_recibos DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_contables DISABLE ROW LEVEL SECURITY;
ALTER TABLE mermas DISABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria DISABLE ROW LEVEL SECURITY;

COMMIT;
