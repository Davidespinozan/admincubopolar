-- MIGRATION TEMPLATE
-- Nombre: 000_template_migration.sql
-- Descripción: Cambia el nombre del archivo y el prefijo numérico por uno nuevo (001, 002, ...)
-- Instrucciones:
-- 1) Revisa el SQL abajo y adáptalo a tu cambio (CREATE TABLE, ALTER TABLE, CREATE POLICY, etc.).
-- 2) En la consola de Supabase pega el contenido y ejecútalo, o usa la CLI (ver MIGRATIONS_README.md).
-- 3) Después de aplicarlo, confirma que las tablas/columnas existen en la consola.

BEGIN;

-- Ejemplo: añadir columna `telefono` a `clientes`
-- ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefono TEXT DEFAULT '';

-- Ejemplo: crear tabla nueva `facturas`
-- CREATE TABLE IF NOT EXISTS facturas (
--   id BIGSERIAL PRIMARY KEY,
--   orden_id BIGINT REFERENCES ordenes(id),
--   folio TEXT,
--   fecha DATE DEFAULT CURRENT_DATE,
--   monto NUMERIC(12,2) NOT NULL
-- );

COMMIT;
