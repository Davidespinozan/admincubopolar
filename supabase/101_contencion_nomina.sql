-- 101_contencion_nomina.sql — parte 2 de 2. Se aplica DESPUÉS de desplegar el
-- frontend que usa los contratos de nómina (100). Idempotente.
-- La API ya no escribe periodos ni recibos de nómina por REST: crear,
-- generar recibos, editar un Borrador y pagar van por contrato. SELECT se
-- conserva (Admin, por RLS). service_role y SQL de confianza conservan su
-- acceso (las guardas de 100 siguen protegiendo los periodos Pagado).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON nomina_periodos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON nomina_recibos FROM authenticated;
DO $$
DECLARE v_seq TEXT;
BEGIN
  FOREACH v_seq IN ARRAY ARRAY[pg_get_serial_sequence('public.nomina_periodos', 'id'), pg_get_serial_sequence('public.nomina_recibos', 'id')] LOOP
    IF v_seq IS NOT NULL THEN
      EXECUTE format('REVOKE USAGE ON SEQUENCE %s FROM authenticated', v_seq);
    END IF;
  END LOOP;
END $$;
