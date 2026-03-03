-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Migración segura (002)
-- Ejecutar en Supabase SQL Editor
-- Crea tablas faltantes y agrega columnas que faltan
-- SIN borrar datos existentes
-- ═══════════════════════════════════════════════════════════════

-- ── 1. AGREGAR COLUMNAS FALTANTES A TABLAS EXISTENTES ─────────

-- productos: agregar sku si no existe
ALTER TABLE productos ADD COLUMN IF NOT EXISTS sku         VARCHAR(20);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tipo        TEXT        NOT NULL DEFAULT 'Producto Terminado';
ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock       INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS ubicacion   TEXT;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio      NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS empaque_sku VARCHAR(20);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE productos ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- Índice único en sku (solo para filas donde sku no es null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_sku ON productos(sku) WHERE sku IS NOT NULL;

-- clientes: columnas que podrían faltar
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS regimen    TEXT          NOT NULL DEFAULT 'Régimen General';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS uso_cfdi   VARCHAR(4)    NOT NULL DEFAULT 'G03';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cp         VARCHAR(5);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS correo     TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo       TEXT          NOT NULL DEFAULT 'Tienda';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS contacto   TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo      NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS estatus    TEXT          NOT NULL DEFAULT 'Activo';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ   NOT NULL DEFAULT now();
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ   NOT NULL DEFAULT now();

-- usuarios: columnas que podrían faltar
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS auth_id    UUID;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol        TEXT          NOT NULL DEFAULT 'Sin asignar';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estatus    TEXT          NOT NULL DEFAULT 'Activo';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ   NOT NULL DEFAULT now();

-- rutas: columnas que podrían faltar
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS folio      VARCHAR(20);
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS chofer_id  BIGINT;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS estatus    TEXT NOT NULL DEFAULT 'Programada';
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS carga      TEXT;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 2. CREAR TABLAS QUE FALTAN (sin FK constraints para evitar errores) ──

CREATE TABLE IF NOT EXISTS precios_esp (
  id          BIGSERIAL PRIMARY KEY,
  cliente_id  BIGINT        NOT NULL DEFAULT 0,
  sku         VARCHAR(20)   NOT NULL DEFAULT '',
  precio      NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(cliente_id, sku)
);

CREATE TABLE IF NOT EXISTS ordenes (
  id          BIGSERIAL    PRIMARY KEY,
  folio       VARCHAR(20)  NOT NULL DEFAULT '',
  cliente_id  BIGINT       NOT NULL DEFAULT 0,
  fecha       DATE         NOT NULL DEFAULT CURRENT_DATE,
  total       NUMERIC(12,2) NOT NULL DEFAULT 0,
  estatus     TEXT         NOT NULL DEFAULT 'Creada',
  ruta_id     BIGINT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ordenes_cliente ON ordenes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_estatus ON ordenes(estatus);
CREATE INDEX IF NOT EXISTS idx_ordenes_fecha   ON ordenes(fecha);

CREATE TABLE IF NOT EXISTS orden_lineas (
  id          BIGSERIAL    PRIMARY KEY,
  orden_id    BIGINT       NOT NULL DEFAULT 0,
  sku         VARCHAR(20)  NOT NULL DEFAULT '',
  cantidad    INTEGER      NOT NULL DEFAULT 1,
  precio_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal    NUMERIC(12,2) NOT NULL DEFAULT 0,
  UNIQUE(orden_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_orden_lineas_orden ON orden_lineas(orden_id);

CREATE TABLE IF NOT EXISTS produccion (
  id          BIGSERIAL    PRIMARY KEY,
  folio       VARCHAR(20)  NOT NULL DEFAULT '',
  fecha       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  turno       TEXT,
  maquina     TEXT,
  sku         VARCHAR(20)  NOT NULL DEFAULT '',
  cantidad    INTEGER      NOT NULL DEFAULT 1,
  estatus     TEXT         NOT NULL DEFAULT 'En proceso',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventario_mov (
  id          BIGSERIAL   PRIMARY KEY,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo        TEXT        NOT NULL DEFAULT 'Entrada',
  sku         VARCHAR(20) NOT NULL DEFAULT '',
  cantidad    INTEGER     NOT NULL DEFAULT 0,
  origen      TEXT        NOT NULL DEFAULT '',
  usuario_id  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_mov_sku   ON inventario_mov(sku);
CREATE INDEX IF NOT EXISTS idx_inv_mov_fecha ON inventario_mov(fecha);

CREATE TABLE IF NOT EXISTS pagos (
  id            BIGSERIAL    PRIMARY KEY,
  cliente_id    BIGINT       NOT NULL DEFAULT 0,
  monto         NUMERIC(12,2) NOT NULL DEFAULT 0,
  referencia    TEXT         NOT NULL DEFAULT '',
  saldo_antes   NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_despues NUMERIC(12,2) NOT NULL DEFAULT 0,
  usuario_id    BIGINT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pagos_cliente ON pagos(cliente_id);

CREATE TABLE IF NOT EXISTS cuartos_frios (
  id        BIGSERIAL PRIMARY KEY,
  nombre    TEXT      NOT NULL DEFAULT '',
  temp      NUMERIC(5,1),
  capacidad INTEGER   DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cuarto_frio_stock (
  id             BIGSERIAL   PRIMARY KEY,
  cuarto_frio_id BIGINT      NOT NULL DEFAULT 0,
  sku            VARCHAR(20) NOT NULL DEFAULT '',
  cantidad       INTEGER     NOT NULL DEFAULT 0,
  UNIQUE(cuarto_frio_id, sku)
);

CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGSERIAL   PRIMARY KEY,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id  BIGINT,
  accion      TEXT        NOT NULL DEFAULT '',
  modulo      TEXT        NOT NULL DEFAULT '',
  detalle     TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha   ON auditoria(fecha);
CREATE INDEX IF NOT EXISTS idx_auditoria_modulo  ON auditoria(modulo);

CREATE TABLE IF NOT EXISTS umbrales (
  id          BIGSERIAL   PRIMARY KEY,
  sku         VARCHAR(20) NOT NULL DEFAULT '' UNIQUE,
  recomendada INTEGER     NOT NULL DEFAULT 0,
  accionable  INTEGER     NOT NULL DEFAULT 0,
  critica     INTEGER     NOT NULL DEFAULT 0
);

-- ── 3. SECUENCIAS ────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS folio_ov_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS folio_op_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS folio_r_seq  START WITH 1;

-- ── 4. ROW LEVEL SECURITY — habilitar + políticas abiertas ───

ALTER TABLE clientes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE precios_esp       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_lineas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rutas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE produccion        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_mov    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuartos_frios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuarto_frio_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria         ENABLE ROW LEVEL SECURITY;
ALTER TABLE umbrales          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'clientes','productos','precios_esp','ordenes','orden_lineas',
    'rutas','produccion','inventario_mov','pagos','cuartos_frios',
    'cuarto_frio_stock','usuarios','auditoria','umbrales'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;
