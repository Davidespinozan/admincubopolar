-- 072_mermas_evento_inmutable.sql — Fase B / B1: una merma es un evento de
-- negocio server-authoritative e inmutable.
--
-- Problema (producción, 2026-09-27): `mermas` tenía RLS físicamente
-- deshabilitado y grants completos a anon/authenticated. Cualquier cliente
-- podía leer, crear, modificar o borrar mermas. El reverso desde Admin
-- confiaba en el estado mutable de la fila (cantidad/SKU manipulables se
-- devolvían al stock), buscaba el egreso contable por texto (ILIKE) y
-- borraba en Storage la ruta que viniera en `foto_url`.
--
-- Contrato nuevo:
--   registrar_merma(...)        Admin · Chofer (solo su ruta) · Producción.
--                               Actor, atribución, stock, movimiento de
--                               inventario y egreso contable se derivan en el
--                               servidor y ocurren en UNA transacción.
--   registrar_mermas_ruta(...)  Cierre de ruta: todas las mermas de la ruta o
--                               ninguna. Idempotente por ruta.
--   revertir_merma(...)         Solo Admin activo. Revierte exactamente los
--                               efectos persistidos (mermas_efectos +
--                               mov_contable_id), marca la merma Revertida
--                               (no la borra) y audita. Segunda vez → error
--                               sin cambios.
--   Tabla `mermas`: SELECT por rol; INSERT/UPDATE/DELETE sin acceso cliente.
--   Storage bucket `mermas`: subir/borrar solo en la carpeta propia
--   (auth.uid()) y nunca una foto ya ligada a una merma.
--
-- Filas legacy (2 en producción): quedan intactas. Las columnas nuevas se
-- agregan con default (estatus='Activa', afecta_stock=true) y sin efectos
-- registrados → revertir_merma falla cerrado para ellas en lugar de adivinar.
--
-- Usa el contrato de actor de 071 (erp_*) y fin_actor_permitido de 069.
-- No toca get_my_rol()/get_my_user_id(), las policies legacy de otras
-- tablas, rename_sku ni confirmar_produccion. Idempotente.

-- ═══════════════════════════════════════════════════════════════
-- 1. ESQUEMA ADITIVO
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE mermas ADD COLUMN IF NOT EXISTS estatus        TEXT    NOT NULL DEFAULT 'Activa';
ALTER TABLE mermas ADD COLUMN IF NOT EXISTS afecta_stock   BOOLEAN NOT NULL DEFAULT true;
-- Egreso contable exacto creado junto con la merma. Sin FK a propósito: al
-- revertir se borra ese egreso por id y el valor se conserva como rastro.
ALTER TABLE mermas ADD COLUMN IF NOT EXISTS mov_contable_id BIGINT;
ALTER TABLE mermas ADD COLUMN IF NOT EXISTS revertida_at   TIMESTAMPTZ;
ALTER TABLE mermas ADD COLUMN IF NOT EXISTS revertida_por  BIGINT;
ALTER TABLE mermas ADD COLUMN IF NOT EXISTS motivo_reverso TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mermas_estatus_check') THEN
    ALTER TABLE mermas ADD CONSTRAINT mermas_estatus_check CHECK (estatus IN ('Activa', 'Revertida'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mermas_reverso_consistente') THEN
    ALTER TABLE mermas ADD CONSTRAINT mermas_reverso_consistente CHECK (
      (estatus = 'Activa' AND revertida_at IS NULL) OR (estatus = 'Revertida' AND revertida_at IS NOT NULL));
  END IF;
END $$;

COMMENT ON COLUMN mermas.afecta_stock IS
  'true = la merma descontó stock de cuartos fríos (efectos en mermas_efectos). false = merma de proceso de una transformación: el descuento ya ocurrió en la transformación.';
COMMENT ON COLUMN mermas.mov_contable_id IS
  'Egreso contable (movimientos_contables.id) creado por registrar_merma. Se conserva tras el reverso como rastro.';

-- Efectos exactos de stock de cada merma: un renglón por cuarto frío tocado.
-- El SKU vive en mermas.sku (rename_sku lo mantiene sincronizado junto con
-- las llaves de cuartos_frios.stock). cuarto_id sin FK para no bloquear el
-- CRUD de cuartos; si el cuarto ya no existe el reverso falla cerrado.
CREATE TABLE IF NOT EXISTS mermas_efectos (
  id                 BIGSERIAL PRIMARY KEY,
  merma_id           BIGINT  NOT NULL REFERENCES mermas(id),
  cuarto_id          TEXT    NOT NULL,
  cantidad           INTEGER NOT NULL CHECK (cantidad > 0),
  inv_mov_id         BIGINT  REFERENCES inventario_mov(id) ON DELETE SET NULL,
  reverso_inv_mov_id BIGINT  REFERENCES inventario_mov(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mermas_efectos_merma ON mermas_efectos(merma_id);

-- ═══════════════════════════════════════════════════════════════
-- 2. INMUTABILIDAD (defensa en profundidad; los clientes ya no tienen
--    UPDATE, esto protege también frente a escritores privilegiados)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION mermas_guard_inmutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- sku: solo lo cambia rename_sku (cascada consistente con cuartos_frios.stock).
  IF NEW.id           IS DISTINCT FROM OLD.id
  OR NEW.fecha        IS DISTINCT FROM OLD.fecha
  OR NEW.cantidad     IS DISTINCT FROM OLD.cantidad
  OR NEW.causa        IS DISTINCT FROM OLD.causa
  OR NEW.origen       IS DISTINCT FROM OLD.origen
  OR NEW.foto_url     IS DISTINCT FROM OLD.foto_url
  OR NEW.usuario_id   IS DISTINCT FROM OLD.usuario_id
  OR NEW.afecta_stock IS DISTINCT FROM OLD.afecta_stock
  OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'mermas: el evento es inmutable' USING ERRCODE = '42501';
  END IF;
  -- ruta_id: solo puede quedar NULL (FK ON DELETE SET NULL de rutas).
  IF NEW.ruta_id IS DISTINCT FROM OLD.ruta_id AND NEW.ruta_id IS NOT NULL THEN
    RAISE EXCEPTION 'mermas: ruta_id es inmutable' USING ERRCODE = '42501';
  END IF;
  -- mov_contable_id: se fija una sola vez (NULL → id) durante el registro.
  IF OLD.mov_contable_id IS NOT NULL AND NEW.mov_contable_id IS DISTINCT FROM OLD.mov_contable_id THEN
    RAISE EXCEPTION 'mermas: mov_contable_id es inmutable' USING ERRCODE = '42501';
  END IF;
  -- Revertida es terminal.
  IF OLD.estatus = 'Revertida' AND (
       NEW.estatus <> 'Revertida'
    OR NEW.revertida_at   IS DISTINCT FROM OLD.revertida_at
    OR NEW.revertida_por  IS DISTINCT FROM OLD.revertida_por
    OR NEW.motivo_reverso IS DISTINCT FROM OLD.motivo_reverso) THEN
    RAISE EXCEPTION 'mermas: una merma revertida no cambia' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mermas_inmutable ON mermas;
CREATE TRIGGER trg_mermas_inmutable BEFORE UPDATE ON mermas
  FOR EACH ROW EXECUTE FUNCTION mermas_guard_inmutable();

CREATE OR REPLACE FUNCTION mermas_efectos_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.merma_id IS DISTINCT FROM OLD.merma_id
  OR NEW.cuarto_id IS DISTINCT FROM OLD.cuarto_id OR NEW.cantidad IS DISTINCT FROM OLD.cantidad
  OR NEW.created_at IS DISTINCT FROM OLD.created_at
  -- inv_mov_id / reverso_inv_mov_id: solo NULL por ON DELETE SET NULL, y el
  -- reverso se fija una sola vez.
  OR (NEW.inv_mov_id IS DISTINCT FROM OLD.inv_mov_id AND NEW.inv_mov_id IS NOT NULL)
  OR (OLD.reverso_inv_mov_id IS NOT NULL AND NEW.reverso_inv_mov_id IS DISTINCT FROM OLD.reverso_inv_mov_id AND NEW.reverso_inv_mov_id IS NOT NULL) THEN
    RAISE EXCEPTION 'mermas_efectos: el efecto es inmutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mermas_efectos_guard ON mermas_efectos;
CREATE TRIGGER trg_mermas_efectos_guard BEFORE UPDATE ON mermas_efectos
  FOR EACH ROW EXECUTE FUNCTION mermas_efectos_guard();

REVOKE EXECUTE ON FUNCTION mermas_guard_inmutable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION mermas_efectos_guard()   FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. FOTO: ¿ya está ligada a una merma? (para la policy de Storage)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION erp_foto_merma_en_uso(p_name TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(p_name, '') <> '' AND EXISTS (SELECT 1 FROM mermas WHERE foto_url = p_name)
$$;

-- ═══════════════════════════════════════════════════════════════
-- 4. registrar_merma — registro atómico
-- ═══════════════════════════════════════════════════════════════
-- Roles: Admin, Chofer (solo con p_ruta_id de una ruta propia), Producción.
-- p_afecta_stock = false: merma de proceso de una transformación (Admin /
-- Producción): exige una transformación existente en `produccion`, una sola
-- merma por folio y cantidad ≤ merma_kg; no toca stock ni contabilidad.
-- Nunca se aceptan del cliente: usuario, usuario_id, delta de stock, monto
-- contable ni referencias de movimiento.

CREATE OR REPLACE FUNCTION registrar_merma(
  p_sku          TEXT,
  p_cantidad     INTEGER,
  p_causa        TEXT    DEFAULT NULL,
  p_origen       TEXT    DEFAULT NULL,
  p_foto         TEXT    DEFAULT NULL,
  p_ruta_id      BIGINT  DEFAULT NULL,
  p_afecta_stock BOOLEAN DEFAULT true
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol        TEXT;
  v_usuario_id BIGINT;
  v_etiqueta   TEXT;
  v_uid        UUID := auth.uid();
  v_prod       RECORD;
  v_ruta       RECORD;
  v_prodfolio  RECORD;
  v_sku        TEXT := btrim(COALESCE(p_sku, ''));
  v_causa      TEXT := COALESCE(NULLIF(btrim(COALESCE(p_causa, '')), ''), 'Sin causa');
  v_origen     TEXT;
  v_foto       TEXT := NULLIF(btrim(COALESCE(p_foto, '')), '');
  v_folio      TEXT;
  v_merma_id   BIGINT;
  v_restante   INTEGER;
  v_cf         RECORD;
  v_disp       INTEGER;
  v_toma       INTEGER;
  v_inv_id     BIGINT;
  v_mov_id     BIGINT;
  v_costo      NUMERIC;
  v_efectos    JSONB := '[]'::jsonb;
  v_origen_inv TEXT;
  v_chofer     TEXT;   -- nombre para origen/concepto de ruta (NULL fuera de ruta)
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_merma: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_rol        := erp_rol_activo();      -- NULL para service_role / SQL
  v_usuario_id := erp_usuario_id();
  v_etiqueta   := erp_actor_etiqueta();

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_merma: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  IF p_afecta_stock IS NULL THEN
    RAISE EXCEPTION 'registrar_merma: afecta_stock es obligatorio' USING ERRCODE = '22023';
  END IF;

  SELECT id, sku, nombre, costo_unitario INTO v_prod FROM productos WHERE sku = v_sku ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_merma: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;

  -- Ruta: existe y, para Chofer, es suya. Producción no registra mermas de ruta.
  IF p_ruta_id IS NOT NULL THEN
    SELECT id, folio, chofer_id, chofer_nombre INTO v_ruta FROM rutas WHERE id = p_ruta_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'registrar_merma: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
    END IF;
    IF v_rol = 'Producción' THEN
      RAISE EXCEPTION 'registrar_merma: Producción no registra mermas de ruta' USING ERRCODE = '42501';
    END IF;
    IF v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_usuario_id THEN
      RAISE EXCEPTION 'registrar_merma: la ruta no pertenece al chofer' USING ERRCODE = '42501';
    END IF;
    v_chofer := COALESCE(NULLIF(btrim(COALESCE(v_ruta.chofer_nombre, '')), ''), v_etiqueta);
  ELSIF v_rol = 'Chofer' THEN
    RAISE EXCEPTION 'registrar_merma: el chofer solo registra mermas de su ruta' USING ERRCODE = '42501';
  END IF;

  -- Merma de proceso (transformación): sin efecto de stock propio.
  IF NOT p_afecta_stock THEN
    IF v_rol IS NOT NULL AND v_rol NOT IN ('Admin', 'Producción') THEN
      RAISE EXCEPTION 'registrar_merma: merma de proceso solo Admin/Producción' USING ERRCODE = '42501';
    END IF;
    IF p_ruta_id IS NOT NULL THEN
      RAISE EXCEPTION 'registrar_merma: merma de proceso no lleva ruta' USING ERRCODE = '22023';
    END IF;
    v_folio := substring(COALESCE(p_origen, '') FROM '^Transformación (TR-[0-9]+)$');
    IF v_folio IS NULL THEN
      RAISE EXCEPTION 'registrar_merma: merma de proceso requiere origen "Transformación TR-###"' USING ERRCODE = '22023';
    END IF;
    SELECT folio, input_sku, merma_kg INTO v_prodfolio FROM produccion
     WHERE folio = v_folio AND tipo = 'Transformacion' ORDER BY id LIMIT 1;
    IF NOT FOUND OR v_prodfolio.input_sku IS DISTINCT FROM v_prod.sku THEN
      RAISE EXCEPTION 'registrar_merma: transformación % no encontrada para %', v_folio, v_prod.sku USING ERRCODE = '22023';
    END IF;
    IF p_cantidad > ceil(COALESCE(v_prodfolio.merma_kg, 0)) THEN
      RAISE EXCEPTION 'registrar_merma: cantidad mayor a la merma de la transformación' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM mermas WHERE origen = 'Transformación ' || v_folio AND NOT afecta_stock) THEN
      RAISE EXCEPTION 'registrar_merma: la transformación % ya tiene merma registrada', v_folio USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Foto: data URL (flujo de ruta) o llave de objeto propia en el bucket
  -- `mermas`, existente y no ligada a otra merma. Nunca una URL externa.
  IF v_foto IS NOT NULL THEN
    IF v_foto LIKE 'data:image/%' THEN
      IF length(v_foto) > 3000000 THEN
        RAISE EXCEPTION 'registrar_merma: foto demasiado grande' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF length(v_foto) > 512 OR v_foto !~ '^[^/\\]+(/[^/\\]+)+$' OR v_foto ~ '(^|/)\.\.?(/|$)' THEN
        RAISE EXCEPTION 'registrar_merma: ruta de foto inválida' USING ERRCODE = '22023';
      END IF;
      IF v_uid IS NOT NULL AND split_part(v_foto, '/', 1) <> v_uid::text THEN
        RAISE EXCEPTION 'registrar_merma: la foto no pertenece al actor' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'mermas' AND o.name = v_foto) THEN
        RAISE EXCEPTION 'registrar_merma: la foto no existe en Storage' USING ERRCODE = '22023';
      END IF;
      IF erp_foto_merma_en_uso(v_foto) THEN
        RAISE EXCEPTION 'registrar_merma: la foto ya está ligada a otra merma' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  v_origen := CASE
    WHEN p_ruta_id IS NOT NULL THEN 'Ruta ' || v_chofer
    ELSE COALESCE(NULLIF(btrim(COALESCE(p_origen, '')), ''), v_etiqueta)
  END;

  INSERT INTO mermas (fecha, sku, cantidad, causa, origen, foto_url, usuario_id, ruta_id, afecta_stock, estatus)
  VALUES (fin_hoy(), v_prod.sku, p_cantidad, v_causa, v_origen, COALESCE(v_foto, ''), v_usuario_id, p_ruta_id, p_afecta_stock, 'Activa')
  RETURNING id INTO v_merma_id;

  IF p_afecta_stock THEN
    -- Descuento FIFO por id de cuarto (mismo orden que el cliente legacy).
    -- FOR UPDATE: dos mermas concurrentes del mismo stock se serializan y la
    -- segunda relee el stock ya descontado.
    v_origen_inv := CASE WHEN p_ruta_id IS NOT NULL THEN 'Merma ruta ' || v_chofer ELSE v_causa END;
    v_restante := p_cantidad;
    FOR v_cf IN SELECT id, stock FROM cuartos_frios ORDER BY id FOR UPDATE LOOP
      EXIT WHEN v_restante <= 0;
      v_disp := COALESCE((v_cf.stock ->> v_prod.sku)::INTEGER, 0);
      CONTINUE WHEN v_disp <= 0;
      v_toma := LEAST(v_disp, v_restante);
      UPDATE cuartos_frios
         SET stock = jsonb_set(COALESCE(stock, '{}'::jsonb), ARRAY[v_prod.sku], to_jsonb(v_disp - v_toma)),
             updated_at = now()
       WHERE id = v_cf.id;
      INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia)
      VALUES ('Merma', v_prod.sku, v_toma, v_origen_inv, v_etiqueta, 'MERMA-' || v_merma_id)
      RETURNING id INTO v_inv_id;
      INSERT INTO mermas_efectos (merma_id, cuarto_id, cantidad, inv_mov_id)
      VALUES (v_merma_id, v_cf.id, v_toma, v_inv_id);
      v_efectos := v_efectos || jsonb_build_object('cuarto_id', v_cf.id, 'cantidad', v_toma, 'inv_mov_id', v_inv_id);
      v_restante := v_restante - v_toma;
    END LOOP;
    IF v_restante > 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para registrar merma de %×%: disponible=%', p_cantidad, v_prod.sku, p_cantidad - v_restante
        USING ERRCODE = 'P0001';
    END IF;

    -- Egreso contable por el costo (si el producto tiene costo).
    v_costo := COALESCE(v_prod.costo_unitario, 0);
    IF v_costo > 0 THEN
      INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, usuario_id)
      VALUES (
        fin_hoy(), 'Egreso', 'Mermas',
        CASE WHEN p_ruta_id IS NOT NULL
          THEN 'Merma ruta ' || v_chofer || ': ' || p_cantidad || '× ' || v_prod.sku
          ELSE 'Merma ' || p_cantidad || '× ' || v_prod.sku
        END || COALESCE(' (' || NULLIF(v_prod.nombre, '') || ')', '') || ' — ' || v_causa,
        round(p_cantidad * v_costo, 2),
        'MERMA-' || v_merma_id,
        v_usuario_id)
      RETURNING id INTO v_mov_id;
      UPDATE mermas SET mov_contable_id = v_mov_id WHERE id = v_merma_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_merma_id, 'sku', v_prod.sku, 'cantidad', p_cantidad, 'estatus', 'Activa',
    'afecta_stock', p_afecta_stock, 'efectos', v_efectos, 'mov_contable_id', v_mov_id,
    'ruta_id', p_ruta_id, 'actor', v_etiqueta);
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 5. registrar_mermas_ruta — cierre de ruta: todo o nada, una sola vez
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION registrar_mermas_ruta(p_ruta_id BIGINT, p_mermas JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_m     JSONB;
  v_cant  NUMERIC;
  v_res   JSONB;
  v_out   JSONB := '[]'::jsonb;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'registrar_mermas_ruta: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'registrar_mermas_ruta: ruta requerida' USING ERRCODE = '22023';
  END IF;
  IF p_mermas IS NULL OR jsonb_typeof(p_mermas) <> 'array' THEN
    RAISE EXCEPTION 'registrar_mermas_ruta: p_mermas debe ser un array' USING ERRCODE = '22023';
  END IF;

  -- Serializa cierres concurrentes de la misma ruta.
  PERFORM 1 FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_mermas_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;

  -- Idempotencia: las mermas de una ruta se registran una sola vez (un
  -- reintento del cierre no las duplica).
  IF EXISTS (SELECT 1 FROM mermas WHERE ruta_id = p_ruta_id) THEN
    RETURN jsonb_build_object('skipped', true,
      'existentes', (SELECT jsonb_agg(id ORDER BY id) FROM mermas WHERE ruta_id = p_ruta_id));
  END IF;

  FOR v_m IN SELECT * FROM jsonb_array_elements(p_mermas) LOOP
    v_cant := NULLIF(v_m ->> 'cant', '')::NUMERIC;
    IF v_cant IS NULL OR v_cant <> trunc(v_cant) THEN
      RAISE EXCEPTION 'registrar_mermas_ruta: cantidad inválida para %', v_m ->> 'sku' USING ERRCODE = '22023';
    END IF;
    v_res := registrar_merma(v_m ->> 'sku', v_cant::INTEGER, v_m ->> 'causa', NULL, v_m ->> 'foto', p_ruta_id, true);
    v_out := v_out || jsonb_build_array(v_res);
  END LOOP;

  RETURN jsonb_build_object('skipped', false, 'registradas', v_out);
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 6. revertir_merma — solo Admin, desde los efectos persistidos
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION revertir_merma(p_merma_id BIGINT, p_motivo TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_m        RECORD;
  v_e        RECORD;
  v_n        INTEGER;
  v_cur      INTEGER;
  v_inv_id   BIGINT;
  v_del      INTEGER := 0;
  v_etiqueta TEXT;
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'revertir_merma: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_etiqueta := erp_actor_etiqueta();

  -- El lock de la fila serializa reversos concurrentes: el segundo espera y
  -- después ve estatus = 'Revertida'.
  SELECT * INTO v_m FROM mermas WHERE id = p_merma_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revertir_merma: merma no encontrada: %', p_merma_id USING ERRCODE = 'P0002';
  END IF;
  IF v_m.estatus = 'Revertida' THEN
    RAISE EXCEPTION 'revertir_merma: la merma % ya fue revertida', p_merma_id USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_n FROM mermas_efectos WHERE merma_id = p_merma_id;
  IF v_m.afecta_stock AND v_n = 0 THEN
    RAISE EXCEPTION 'revertir_merma: la merma % es legacy (sin efectos registrados); no se revierte automáticamente', p_merma_id
      USING ERRCODE = '55000';
  END IF;

  FOR v_e IN SELECT * FROM mermas_efectos WHERE merma_id = p_merma_id ORDER BY cuarto_id, id LOOP
    SELECT COALESCE((stock ->> v_m.sku)::INTEGER, 0) INTO v_cur FROM cuartos_frios WHERE id = v_e.cuarto_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'revertir_merma: el cuarto % ya no existe', v_e.cuarto_id USING ERRCODE = '55000';
    END IF;
    UPDATE cuartos_frios
       SET stock = jsonb_set(COALESCE(stock, '{}'::jsonb), ARRAY[v_m.sku], to_jsonb(v_cur + v_e.cantidad)),
           updated_at = now()
     WHERE id = v_e.cuarto_id;
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia)
    VALUES ('Reverso merma', v_m.sku, v_e.cantidad, 'Reverso merma #' || p_merma_id, v_etiqueta, 'MERMA-' || p_merma_id)
    RETURNING id INTO v_inv_id;
    UPDATE mermas_efectos SET reverso_inv_mov_id = v_inv_id WHERE id = v_e.id;
  END LOOP;

  -- Egreso contable: exactamente el ligado por id. Nunca por texto.
  IF v_m.mov_contable_id IS NOT NULL THEN
    DELETE FROM movimientos_contables
     WHERE id = v_m.mov_contable_id AND categoria = 'Mermas' AND tipo = 'Egreso';
    GET DIAGNOSTICS v_del = ROW_COUNT;
  END IF;

  UPDATE mermas
     SET estatus = 'Revertida', revertida_at = now(), revertida_por = erp_usuario_id(), motivo_reverso = v_motivo
   WHERE id = p_merma_id;

  INSERT INTO auditoria (accion, modulo, detalle, usuario, created_at)
  VALUES ('Revertir', 'Mermas',
    format('Merma #%s — %s×%s | efectos=%s | egreso_id=%s borrado=%s | motivo: %s',
      p_merma_id, v_m.cantidad, v_m.sku, v_n, COALESCE(v_m.mov_contable_id::text, '—'), (v_del > 0), COALESCE(v_motivo, '—')),
    v_etiqueta, now());

  -- La foto se conserva como evidencia (no se borra de Storage).
  RETURN jsonb_build_object(
    'id', p_merma_id, 'estatus', 'Revertida', 'sku', v_m.sku, 'cantidad', v_m.cantidad,
    'efectos_revertidos', v_n, 'mov_contable_id', v_m.mov_contable_id, 'egreso_borrado', (v_del > 0),
    'actor', v_etiqueta);
END $$;

REVOKE EXECUTE ON FUNCTION erp_foto_merma_en_uso(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION registrar_merma(TEXT, INTEGER, TEXT, TEXT, TEXT, BIGINT, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION registrar_mermas_ruta(BIGINT, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION revertir_merma(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION erp_foto_merma_en_uso(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION registrar_merma(TEXT, INTEGER, TEXT, TEXT, TEXT, BIGINT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION registrar_mermas_ruta(BIGINT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION revertir_merma(BIGINT, TEXT) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 7. RLS FÍSICO + POLICIES + GRANTS de mermas / mermas_efectos
-- ═══════════════════════════════════════════════════════════════
-- Lectura (evidencia en el código):
--   Admin      → MermasView, ReporteRutaModal, exportReports
--   Producción → ProduccionStandaloneView (mermas de hoy de la planta)
--   Chofer     → solo las propias (App.jsx las acota por dueño)
-- Escritura: solo por los RPC de arriba (SECURITY DEFINER).

ALTER TABLE mermas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mermas_efectos ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE p RECORD; BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies
            WHERE schemaname = 'public' AND tablename IN ('mermas', 'mermas_efectos') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p.policyname, p.tablename);
  END LOOP;
END $$;

CREATE POLICY mermas_select ON mermas FOR SELECT TO authenticated USING (
  erp_rol_activo() IN ('Admin', 'Producción')
  OR (erp_rol_activo() = 'Chofer' AND (
        usuario_id = erp_usuario_id()
     OR ruta_id IN (SELECT r.id FROM rutas r WHERE r.chofer_id = erp_usuario_id())))
);

CREATE POLICY mermas_efectos_select ON mermas_efectos FOR SELECT TO authenticated
  USING (erp_rol_activo() = 'Admin');

REVOKE ALL ON TABLE mermas         FROM PUBLIC, anon;
REVOKE ALL ON TABLE mermas_efectos FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE mermas         FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE mermas_efectos FROM authenticated;
GRANT SELECT ON TABLE mermas, mermas_efectos TO authenticated;
GRANT ALL    ON TABLE mermas, mermas_efectos TO service_role;
REVOKE ALL ON SEQUENCE mermas_id_seq         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE mermas_efectos_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE mermas_id_seq, mermas_efectos_id_seq TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 8. STORAGE — bucket `mermas` únicamente
-- ═══════════════════════════════════════════════════════════════
-- Formato de llave (ProduccionStandaloneView): {auth.uid()}/{fecha}/{ts}-{sku}.{ext}
-- Antes: cualquier authenticated podía leer/subir/sobrescribir/borrar
-- cualquier objeto del bucket. Ahora:
--   subir  → actor activo, solo en su carpeta
--   leer   → Admin/Producción, o el dueño de la carpeta
--   borrar → dueño de la carpeta y solo si la foto NO está ligada a una
--            merma (permite limpiar una subida huérfana; la evidencia de una
--            merma registrada no se borra)
--   actualizar → nadie (upsert: false en el cliente)

DROP POLICY IF EXISTS mermas_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS mermas_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS mermas_authenticated_delete ON storage.objects;
DROP POLICY IF EXISTS mermas_authenticated_read   ON storage.objects;

CREATE POLICY mermas_authenticated_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'mermas' AND public.erp_es_activo()
              AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY mermas_authenticated_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'mermas' AND public.erp_es_activo()
         AND (public.erp_rol_activo() IN ('Admin', 'Producción')
              OR (storage.foldername(name))[1] = auth.uid()::text));

CREATE POLICY mermas_authenticated_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'mermas' AND public.erp_es_activo()
         AND (storage.foldername(name))[1] = auth.uid()::text
         AND NOT public.erp_foto_merma_en_uso(name));
