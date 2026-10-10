-- 127_chofer_alta_cliente.sql — el Chofer da de alta un cliente con datos fiscales completos
-- desde la venta rápida (para poder facturar), por un contrato acotado.
--
-- Contexto: la venta exprés CON factura exige un cliente registrado con RFC nominativo
-- (`ventaExpressLogic.js`). El Chofer no puede escribir en `clientes` (RLS: solo Admin, Ventas
-- y Facturación), así que si el cliente no existía no podía facturar. Esta migración NO abre
-- escritura REST: agrega un único contrato.
--
-- `crear_cliente_chofer(p_datos JSONB)` (SECURITY DEFINER, search_path fijo):
--   · solo rol Chofer activo (o service_role / contexto de contrato, como el resto de contratos);
--   · exige nombre, RFC nominativo válido (no XAXX/XEXX), régimen (3 dígitos SAT), uso de CFDI,
--     CP de 5 dígitos y correo; contacto opcional;
--   · el cliente nace SIN crédito ni saldo (autorizar crédito es solo de Admin);
--   · idempotente por RFC: si ya hay un cliente ACTIVO con ese RFC devuelve el existente
--     (`existente = true`) y no crea nada ni modifica sus datos;
--   · deja rastro en `auditoria`; no edita ni borra clientes existentes.
-- Aditiva e idempotente (CREATE OR REPLACE). Sin cambios en tablas, policies ni grants de tablas.
--
-- Reversión: DROP FUNCTION public.crear_cliente_chofer(JSONB); los clientes ya creados se
-- conservan (son datos de negocio).

CREATE OR REPLACE FUNCTION public.crear_cliente_chofer(p_datos JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre   TEXT;
  v_rfc      TEXT;
  v_regimen  TEXT;
  v_uso      TEXT;
  v_cp       TEXT;
  v_correo   TEXT;
  v_contacto TEXT;
  v_cli      clientes%ROWTYPE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Chofer']) THEN
    RAISE EXCEPTION 'crear_cliente_chofer: solo el Chofer' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();
  IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' THEN
    RAISE EXCEPTION 'crear_cliente_chofer: datos requeridos' USING ERRCODE = '22023';
  END IF;

  v_nombre   := NULLIF(btrim(COALESCE(p_datos ->> 'nombre', '')), '');
  v_rfc      := upper(btrim(COALESCE(p_datos ->> 'rfc', '')));
  v_regimen  := btrim(COALESCE(p_datos ->> 'regimen', ''));
  v_uso      := upper(btrim(COALESCE(p_datos ->> 'uso_cfdi', '')));
  v_cp       := btrim(COALESCE(p_datos ->> 'cp', ''));
  v_correo   := btrim(COALESCE(p_datos ->> 'correo', ''));
  v_contacto := NULLIF(btrim(COALESCE(p_datos ->> 'contacto', '')), '');

  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'crear_cliente_chofer: el nombre es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF v_rfc !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' OR v_rfc IN ('XAXX010101000', 'XEXX010101000') THEN
    RAISE EXCEPTION 'crear_cliente_chofer: RFC nominativo inválido' USING ERRCODE = '22023';
  END IF;
  IF v_regimen !~ '^[0-9]{3}$' THEN
    RAISE EXCEPTION 'crear_cliente_chofer: régimen fiscal inválido (código SAT de 3 dígitos)' USING ERRCODE = '22023';
  END IF;
  IF v_uso !~ '^[A-Z][0-9]{2}$|^CP01$|^CN01$' THEN
    RAISE EXCEPTION 'crear_cliente_chofer: uso de CFDI inválido' USING ERRCODE = '22023';
  END IF;
  IF v_cp !~ '^[0-9]{5}$' THEN
    RAISE EXCEPTION 'crear_cliente_chofer: código postal inválido' USING ERRCODE = '22023';
  END IF;
  IF v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'crear_cliente_chofer: correo inválido' USING ERRCODE = '22023';
  END IF;

  -- Idempotencia por RFC: un cliente activo con ese RFC se reutiliza sin tocarlo.
  SELECT * INTO v_cli FROM clientes WHERE rfc = v_rfc AND estatus = 'Activo' AND fusionado_en IS NULL ORDER BY id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_cli.id, 'nombre', v_cli.nombre, 'rfc', v_cli.rfc, 'existente', true);
  END IF;

  BEGIN
    INSERT INTO clientes (nombre, rfc, regimen, uso_cfdi, cp, correo, contacto, tipo, estatus,
                          saldo, credito_autorizado, limite_credito)
    VALUES (v_nombre, v_rfc, v_regimen, v_uso, v_cp, v_correo, v_contacto, 'Tienda', 'Activo', 0, false, 0)
    RETURNING * INTO v_cli;
  EXCEPTION WHEN unique_violation THEN
    -- Carrera con otra alta del mismo RFC: gana la primera; se devuelve esa.
    SELECT * INTO v_cli FROM clientes WHERE rfc = v_rfc AND estatus = 'Activo' ORDER BY id LIMIT 1;
    IF NOT FOUND THEN RAISE; END IF;
    RETURN jsonb_build_object('id', v_cli.id, 'nombre', v_cli.nombre, 'rfc', v_cli.rfc, 'existente', true);
  END;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), 'Crear cliente (chofer)', 'Clientes',
          v_cli.nombre || ' · ' || v_cli.rfc || ' (#' || v_cli.id || ')');

  RETURN jsonb_build_object('id', v_cli.id, 'nombre', v_cli.nombre, 'rfc', v_cli.rfc, 'existente', false);
END $$;
REVOKE ALL ON FUNCTION public.crear_cliente_chofer(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_cliente_chofer(JSONB) TO authenticated, service_role;
