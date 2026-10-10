-- 132_datos_bancarios_test.sql — solo el Dueño cambia los datos bancarios; CLABE de 18 números; queda en bitácora. Todo en una transacción con ROLLBACK.

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES ('13200000-0000-0000-0000-000000000001','a@t132'),('13200000-0000-0000-0000-000000000002','d@t132');
INSERT INTO usuarios (id, nombre, email, rol, estatus, auth_id, es_dueno) VALUES (13201,'Admin T132','a@t132','Admin','Activo','13200000-0000-0000-0000-000000000001',false),(13202,'Dueño T132','d@t132','Admin','Activo','13200000-0000-0000-0000-000000000002',true);
INSERT INTO configuracion_empresa (id, razon_social, rfc) VALUES (1,'X','XAXX010101000') ON CONFLICT (id) DO NOTHING;
SET LOCAL session_replication_role = origin;
DO $$
DECLARE v TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"13200000-0000-0000-0000-000000000001"}',true);
  BEGIN UPDATE configuracion_empresa SET clabe='002010077777777771', banco='B' WHERE id=1; RAISE EXCEPTION 'FAIL: Admin pudo cambiar la CLABE';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: 132-01 Admin no cambia datos bancarios [%]', SQLERRM; END;
  UPDATE configuracion_empresa SET telefono='6181234567' WHERE id=1;
  RAISE NOTICE 'OK: 132-02 Admin sí cambia los demás datos';
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"13200000-0000-0000-0000-000000000002"}',true);
  UPDATE configuracion_empresa SET clabe='002010077777777771', banco='Banamex' WHERE id=1;
  SELECT clabe INTO v FROM configuracion_empresa WHERE id=1;
  IF v IS DISTINCT FROM '002010077777777771' THEN RAISE EXCEPTION 'FAIL: el Dueño no pudo guardar la CLABE'; END IF;
  RAISE NOTICE 'OK: 132-03 el Dueño guarda la CLABE';
  BEGIN UPDATE configuracion_empresa SET clabe='123' WHERE id=1; RAISE EXCEPTION 'FAIL: CLABE corta aceptada';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK: 132-04 CLABE que no tiene 18 números: rechazada'; END;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM bitacora_cambios WHERE tabla='configuracion_empresa' AND 'clabe' = ANY(cambios)) THEN RAISE EXCEPTION 'FAIL: sin bitácora del cambio de CLABE'; END IF;
  RAISE NOTICE 'OK: 132-05 el cambio de CLABE queda en la bitácora del Dueño';
END $$;
ROLLBACK;
