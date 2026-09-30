-- 097_contencion_caja.sql — parte 2 de 2. Se aplica DESPUÉS de desplegar el
-- frontend que cierra caja con cerrar_caja_ruta (096). Idempotente.
-- La API ya no inserta en cierres_diarios por REST; el contrato del servidor
-- es la única vía (service_role y SQL de confianza conservan su acceso).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON cierres_diarios FROM authenticated;
DO $$
DECLARE v_seq TEXT := pg_get_serial_sequence('public.cierres_diarios', 'id');
BEGIN
  IF v_seq IS NOT NULL THEN
    EXECUTE format('REVOKE USAGE ON SEQUENCE %s FROM authenticated', v_seq);
  END IF;
END $$;
