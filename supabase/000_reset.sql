-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Reset completo
-- ⚠️  BORRA TODOS LOS DATOS Y TABLAS
-- Ejecutar PRIMERO este archivo, luego 001_schema.sql
-- ═══════════════════════════════════════════════════════════════

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO anon;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON SCHEMA public TO service_role;
