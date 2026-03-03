-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Supabase Schema (v2 — dependency order fixed)
-- Run this ENTIRE file in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── 1. TIPOS ENUMERADOS ──────────────────────────────────────
CREATE TYPE estatus_cliente AS ENUM ('Activo', 'Inactivo');
CREATE TYPE tipo_cliente AS ENUM ('Tienda', 'Restaurante', 'Cadena', 'Hotel', 'Nevería', 'General', 'Otro');
CREATE TYPE tipo_producto AS ENUM ('Producto Terminado', 'Empaque', 'Materia Prima');
CREATE TYPE estatus_orden AS ENUM ('Creada', 'Asignada', 'Entregada', 'Facturada', 'Cancelada');
CREATE TYPE estatus_ruta AS ENUM ('Programada', 'En progreso', 'Completada', 'Cerrada', 'Cancelada');
CREATE TYPE estatus_produccion AS ENUM ('En proceso', 'Confirmada', 'Cancelada');
CREATE TYPE tipo_movimiento AS ENUM ('Entrada', 'Salida', 'Traspaso', 'Devolución', 'Merma');
CREATE TYPE rol_usuario AS ENUM ('Admin', 'Chofer', 'Ventas', 'Facturación', 'Almacén');

-- ── 2. TABLAS (en orden de dependencia) ──────────────────────

-- USUARIOS (no depende de nada — va primero)
CREATE TABLE usuarios (
  id          BIGSERIAL PRIMARY KEY,
  auth_id     UUID UNIQUE,
  nombre      TEXT NOT NULL,
  rol         rol_usuario NOT NULL DEFAULT 'Chofer',
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CLIENTES
CREATE TABLE clientes (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  rfc         VARCHAR(13) NOT NULL,
  regimen     TEXT NOT NULL DEFAULT 'Régimen General',
  uso_cfdi    VARCHAR(4) NOT NULL DEFAULT 'G03',
  cp          VARCHAR(5),
  correo      TEXT,
  tipo        tipo_cliente NOT NULL DEFAULT 'Tienda',
  contacto    TEXT,
  saldo       NUMERIC(12,2) NOT NULL DEFAULT 0,
  estatus     estatus_cliente NOT NULL DEFAULT 'Activo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_clientes_rfc ON clientes(rfc) WHERE estatus = 'Activo';

-- PRODUCTOS
CREATE TABLE productos (
  id          BIGSERIAL PRIMARY KEY,
  sku         VARCHAR(20) NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  tipo        tipo_producto NOT NULL DEFAULT 'Producto Terminado',
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  ubicacion   TEXT,
  precio      NUMERIC(10,2) NOT NULL DEFAULT 0,
  empaque_sku VARCHAR(20),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE productos ADD CONSTRAINT fk_empaque FOREIGN KEY (empaque_sku) REFERENCES productos(sku);

-- PRECIOS ESPECIALES (depends on: clientes, productos)
CREATE TABLE precios_esp (
  id          BIGSERIAL PRIMARY KEY,
  cliente_id  BIGINT NOT NULL REFERENCES clientes(id),
  sku         VARCHAR(20) NOT NULL REFERENCES productos(sku),
  precio      NUMERIC(10,2) NOT NULL CHECK (precio >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cliente_id, sku)
);

-- RUTAS (depends on: usuarios)
CREATE TABLE rutas (
  id          BIGSERIAL PRIMARY KEY,
  folio       VARCHAR(20) NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  chofer_id   BIGINT REFERENCES usuarios(id),
  estatus     estatus_ruta NOT NULL DEFAULT 'Programada',
  carga       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ORDENES (depends on: clientes, rutas)
CREATE TABLE ordenes (
  id          BIGSERIAL PRIMARY KEY,
  folio       VARCHAR(20) NOT NULL UNIQUE,
  cliente_id  BIGINT NOT NULL REFERENCES clientes(id),
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  estatus     estatus_orden NOT NULL DEFAULT 'Creada',
  ruta_id     BIGINT REFERENCES rutas(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ordenes_cliente ON ordenes(cliente_id);
CREATE INDEX idx_ordenes_estatus ON ordenes(estatus);
CREATE INDEX idx_ordenes_fecha ON ordenes(fecha);

-- LÍNEAS DE ORDEN (depends on: ordenes, productos)
CREATE TABLE orden_lineas (
  id          BIGSERIAL PRIMARY KEY,
  orden_id    BIGINT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  sku         VARCHAR(20) NOT NULL REFERENCES productos(sku),
  cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unit NUMERIC(10,2) NOT NULL,
  subtotal    NUMERIC(12,2) NOT NULL,
  UNIQUE(orden_id, sku)
);
CREATE INDEX idx_orden_lineas_orden ON orden_lineas(orden_id);

-- PRODUCCIÓN (depends on: productos)
CREATE TABLE produccion (
  id          BIGSERIAL PRIMARY KEY,
  folio       VARCHAR(20) NOT NULL UNIQUE,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
  turno       TEXT,
  maquina     TEXT,
  sku         VARCHAR(20) NOT NULL REFERENCES productos(sku),
  cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
  estatus     estatus_produccion NOT NULL DEFAULT 'En proceso',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MOVIMIENTOS DE INVENTARIO — APPEND ONLY
CREATE TABLE inventario_mov (
  id          BIGSERIAL PRIMARY KEY,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo        tipo_movimiento NOT NULL,
  sku         VARCHAR(20) NOT NULL REFERENCES productos(sku),
  cantidad    INTEGER NOT NULL,
  origen      TEXT NOT NULL,
  usuario_id  BIGINT REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inv_mov_sku ON inventario_mov(sku);
CREATE INDEX idx_inv_mov_fecha ON inventario_mov(fecha);

-- PAGOS
CREATE TABLE pagos (
  id            BIGSERIAL PRIMARY KEY,
  cliente_id    BIGINT NOT NULL REFERENCES clientes(id),
  monto         NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  referencia    TEXT NOT NULL,
  saldo_antes   NUMERIC(12,2) NOT NULL,
  saldo_despues NUMERIC(12,2) NOT NULL,
  usuario_id    BIGINT REFERENCES usuarios(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_pagos_ref ON pagos(referencia) WHERE referencia != '';
CREATE INDEX idx_pagos_cliente ON pagos(cliente_id);

-- CUARTOS FRÍOS
CREATE TABLE cuartos_frios (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  temp        NUMERIC(5,1),
  capacidad   INTEGER DEFAULT 0
);

CREATE TABLE cuarto_frio_stock (
  id             BIGSERIAL PRIMARY KEY,
  cuarto_frio_id BIGINT NOT NULL REFERENCES cuartos_frios(id),
  sku            VARCHAR(20) NOT NULL REFERENCES productos(sku),
  cantidad       INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  UNIQUE(cuarto_frio_id, sku)
);

-- AUDITORÍA — APPEND ONLY
CREATE TABLE auditoria (
  id          BIGSERIAL PRIMARY KEY,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id  BIGINT REFERENCES usuarios(id),
  accion      TEXT NOT NULL,
  modulo      TEXT NOT NULL,
  detalle     TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_fecha ON auditoria(fecha);
CREATE INDEX idx_auditoria_modulo ON auditoria(modulo);

-- UMBRALES
CREATE TABLE umbrales (
  id              BIGSERIAL PRIMARY KEY,
  sku             VARCHAR(20) NOT NULL REFERENCES productos(sku) UNIQUE,
  recomendada     INTEGER NOT NULL DEFAULT 0,
  accionable      INTEGER NOT NULL DEFAULT 0,
  critica         INTEGER NOT NULL DEFAULT 0
);

-- SECUENCIAS PARA FOLIOS
CREATE SEQUENCE folio_ov_seq START WITH 42;
CREATE SEQUENCE folio_op_seq START WITH 89;
CREATE SEQUENCE folio_r_seq START WITH 13;


-- ── 3. TRIGGERS ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clientes_updated BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_productos_updated BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_ordenes_updated BEFORE UPDATE ON ordenes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_rutas_updated BEFORE UPDATE ON rutas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_produccion_updated BEFORE UPDATE ON produccion FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- State machine: ordenes
CREATE OR REPLACE FUNCTION check_orden_transition()
RETURNS TRIGGER AS $$
DECLARE valid BOOLEAN;
BEGIN
  IF OLD.estatus = NEW.estatus THEN RETURN NEW; END IF;
  valid := CASE OLD.estatus::text
    WHEN 'Creada'    THEN NEW.estatus IN ('Asignada', 'Cancelada')
    WHEN 'Asignada'  THEN NEW.estatus IN ('Entregada', 'Creada')
    WHEN 'Entregada' THEN NEW.estatus IN ('Facturada')
    ELSE FALSE
  END;
  IF NOT valid THEN RAISE EXCEPTION 'Transición inválida: % → %', OLD.estatus, NEW.estatus; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_orden_state BEFORE UPDATE OF estatus ON ordenes FOR EACH ROW EXECUTE FUNCTION check_orden_transition();

-- State machine: rutas
CREATE OR REPLACE FUNCTION check_ruta_transition()
RETURNS TRIGGER AS $$
DECLARE valid BOOLEAN;
BEGIN
  IF OLD.estatus = NEW.estatus THEN RETURN NEW; END IF;
  valid := CASE OLD.estatus::text
    WHEN 'Programada'   THEN NEW.estatus IN ('En progreso', 'Cancelada')
    WHEN 'En progreso'  THEN NEW.estatus IN ('Completada')
    WHEN 'Completada'   THEN NEW.estatus IN ('Cerrada')
    ELSE FALSE
  END;
  IF NOT valid THEN RAISE EXCEPTION 'Transición inválida de ruta: % → %', OLD.estatus, NEW.estatus; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_ruta_state BEFORE UPDATE OF estatus ON rutas FOR EACH ROW EXECUTE FUNCTION check_ruta_transition();

-- State machine: produccion
CREATE OR REPLACE FUNCTION check_produccion_transition()
RETURNS TRIGGER AS $$
DECLARE valid BOOLEAN;
BEGIN
  IF OLD.estatus = NEW.estatus THEN RETURN NEW; END IF;
  valid := CASE OLD.estatus::text
    WHEN 'En proceso' THEN NEW.estatus IN ('Confirmada', 'Cancelada')
    ELSE FALSE
  END;
  IF NOT valid THEN RAISE EXCEPTION 'Transición inválida de producción: % → %', OLD.estatus, NEW.estatus; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_produccion_state BEFORE UPDATE OF estatus ON produccion FOR EACH ROW EXECUTE FUNCTION check_produccion_transition();

-- Immutability
CREATE OR REPLACE FUNCTION prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Tabla inmutable: no se permite % en %', TG_OP, TG_TABLE_NAME; RETURN NULL; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_inv_mov_immutable BEFORE UPDATE OR DELETE ON inventario_mov FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_auditoria_immutable BEFORE UPDATE OR DELETE ON auditoria FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_pagos_immutable BEFORE UPDATE OR DELETE ON pagos FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- Prevent negative stock
CREATE OR REPLACE FUNCTION check_stock_positive()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stock < 0 THEN RAISE EXCEPTION 'Stock negativo: % stock %', NEW.sku, NEW.stock; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_stock_positive BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION check_stock_positive();


-- ── 4. ATOMIC BUSINESS FUNCTIONS ─────────────────────────────

CREATE OR REPLACE FUNCTION move_stock(
  p_sku VARCHAR(20), p_cantidad INTEGER, p_tipo tipo_movimiento,
  p_origen TEXT, p_usuario_id BIGINT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE v_mov_id BIGINT; v_current_stock INTEGER;
BEGIN
  SELECT stock INTO v_current_stock FROM productos WHERE sku = p_sku FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SKU % no existe', p_sku; END IF;
  IF v_current_stock + p_cantidad < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente: % tiene %, se requieren %', p_sku, v_current_stock, ABS(p_cantidad);
  END IF;
  UPDATE productos SET stock = stock + p_cantidad WHERE sku = p_sku;
  INSERT INTO inventario_mov (tipo, sku, cantidad, origen, usuario_id)
  VALUES (p_tipo, p_sku, p_cantidad, p_origen, p_usuario_id) RETURNING id INTO v_mov_id;
  RETURN v_mov_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION confirmar_produccion(p_produccion_id BIGINT, p_usuario_id BIGINT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE v_op RECORD; v_empaque_sku VARCHAR(20);
BEGIN
  SELECT * INTO v_op FROM produccion WHERE id = p_produccion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producción no encontrada'; END IF;
  IF v_op.estatus != 'En proceso' THEN RAISE EXCEPTION 'Ya confirmada o cancelada'; END IF;
  SELECT empaque_sku INTO v_empaque_sku FROM productos WHERE sku = v_op.sku;
  PERFORM move_stock(v_op.sku, v_op.cantidad, 'Entrada', 'Producción ' || v_op.folio, p_usuario_id);
  IF v_empaque_sku IS NOT NULL THEN
    PERFORM move_stock(v_empaque_sku, -v_op.cantidad, 'Salida', 'Consumo ' || v_op.folio, p_usuario_id);
  END IF;
  UPDATE produccion SET estatus = 'Confirmada' WHERE id = p_produccion_id;
  INSERT INTO auditoria (usuario_id, accion, modulo, detalle)
  VALUES (p_usuario_id, 'Confirmar', 'Producción', v_op.folio || ' — ' || v_op.cantidad || ' ' || v_op.sku);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION asignar_orden(p_orden_id BIGINT, p_ruta_id BIGINT DEFAULT NULL, p_usuario_id BIGINT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE v_ord RECORD; v_linea RECORD;
BEGIN
  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF v_ord.estatus != 'Creada' THEN RAISE EXCEPTION 'Orden no está en Creada'; END IF;
  FOR v_linea IN SELECT * FROM orden_lineas WHERE orden_id = p_orden_id LOOP
    PERFORM move_stock(v_linea.sku, -v_linea.cantidad, 'Salida', 'Reserva ' || v_ord.folio, p_usuario_id);
  END LOOP;
  UPDATE ordenes SET estatus = 'Asignada', ruta_id = p_ruta_id WHERE id = p_orden_id;
  INSERT INTO auditoria (usuario_id, accion, modulo, detalle)
  VALUES (p_usuario_id, 'Asignar', 'Órdenes', v_ord.folio || ' → Asignada');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cancelar_orden_asignada(p_orden_id BIGINT, p_usuario_id BIGINT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE v_ord RECORD; v_linea RECORD;
BEGIN
  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF v_ord.estatus != 'Asignada' THEN RAISE EXCEPTION 'Solo cancelable desde Asignada'; END IF;
  FOR v_linea IN SELECT * FROM orden_lineas WHERE orden_id = p_orden_id LOOP
    PERFORM move_stock(v_linea.sku, v_linea.cantidad, 'Entrada', 'Cancelación ' || v_ord.folio, p_usuario_id);
  END LOOP;
  UPDATE ordenes SET estatus = 'Cancelada', ruta_id = NULL WHERE id = p_orden_id;
  INSERT INTO auditoria (usuario_id, accion, modulo, detalle)
  VALUES (p_usuario_id, 'Cancelar', 'Órdenes', v_ord.folio || ' cancelada — stock restaurado');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION timbrar_orden(p_folio VARCHAR(20), p_usuario_id BIGINT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE v_ord RECORD;
BEGIN
  SELECT * INTO v_ord FROM ordenes WHERE folio = p_folio FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF v_ord.estatus != 'Entregada' THEN RAISE EXCEPTION 'Orden no está Entregada'; END IF;
  UPDATE ordenes SET estatus = 'Facturada' WHERE id = v_ord.id;
  UPDATE clientes SET saldo = saldo + v_ord.total WHERE id = v_ord.cliente_id;
  INSERT INTO auditoria (usuario_id, accion, modulo, detalle)
  VALUES (p_usuario_id, 'Timbrar', 'Facturación', 'CFDI ' || p_folio || ' — $' || v_ord.total);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION registrar_pago(
  p_cliente_id BIGINT, p_monto NUMERIC(12,2), p_referencia TEXT, p_usuario_id BIGINT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE v_cli RECORD; v_pago_efectivo NUMERIC(12,2); v_pago_id BIGINT;
BEGIN
  SELECT * INTO v_cli FROM clientes WHERE id = p_cliente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  IF p_monto <= 0 THEN RAISE EXCEPTION 'Monto debe ser positivo'; END IF;
  v_pago_efectivo := LEAST(p_monto, v_cli.saldo);
  IF v_pago_efectivo <= 0 THEN RAISE EXCEPTION 'Sin saldo pendiente'; END IF;
  INSERT INTO pagos (cliente_id, monto, referencia, saldo_antes, saldo_despues, usuario_id)
  VALUES (p_cliente_id, v_pago_efectivo, p_referencia, v_cli.saldo, v_cli.saldo - v_pago_efectivo, p_usuario_id)
  RETURNING id INTO v_pago_id;
  UPDATE clientes SET saldo = saldo - v_pago_efectivo WHERE id = p_cliente_id;
  INSERT INTO auditoria (usuario_id, accion, modulo, detalle)
  VALUES (p_usuario_id, 'Pago', 'Cobranza', '$' || v_pago_efectivo || ' de ' || v_cli.nombre || ' Ref: ' || p_referencia);
  RETURN v_pago_id;
END;
$$ LANGUAGE plpgsql;


-- ── 5. ROW LEVEL SECURITY (permissive for now) ──────────────

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE precios_esp ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE rutas ENABLE ROW LEVEL SECURITY;
ALTER TABLE produccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_mov ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuartos_frios ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuarto_frio_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE umbrales ENABLE ROW LEVEL SECURITY;

-- Permissive policies: allow all for anon + authenticated
-- (tighten per-role once Supabase Auth is configured)
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'clientes','productos','precios_esp','ordenes','orden_lineas',
    'rutas','produccion','inventario_mov','pagos','cuartos_frios',
    'cuarto_frio_stock','usuarios','auditoria','umbrales'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;
