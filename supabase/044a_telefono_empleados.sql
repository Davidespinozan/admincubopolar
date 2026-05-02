-- 044a_telefono_empleados.sql
-- Agrega columna telefono a la tabla empleados.
-- Antes de PR A, addEmpleado/updateEmpleado intentaban insertar 'telefono'
-- pero la columna no existía → INSERT/UPDATE rompían silenciosamente.
-- En PR A se quitó del código; aquí la agregamos a la BD para soportarla
-- de nuevo en PR B.

ALTER TABLE empleados ADD COLUMN IF NOT EXISTS telefono TEXT;

COMMENT ON COLUMN empleados.telefono IS 'Telefono de contacto del empleado';
