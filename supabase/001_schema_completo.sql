-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Schema Completo
-- ═══════════════════════════════════════════════════════════════

-- Utility: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── USUARIOS (login al sistema) ────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  rol         TEXT NOT NULL DEFAULT 'Ventas',
  pass        TEXT NOT NULL DEFAULT '1234',
  estatus     TEXT NOT NULL DEFAULT 'Activo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_usuarios_upd ON usuarios;
CREATE TRIGGER trg_usuarios_upd BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── CLIENTES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  rfc         VARCHAR(13) DEFAULT 'XAXX010101000',
  regimen     TEXT DEFAULT 'Sin obligaciones',
  uso_cfdi    TEXT DEFAULT 'S01',
  cp          VARCHAR(5) DEFAULT '34000',
  correo      TEXT DEFAULT '',
  tipo        TEXT DEFAULT 'Tienda',
  contacto    TEXT DEFAULT '',
  direccion   TEXT DEFAULT '',
  saldo       NUMERIC(12,2) NOT NULL DEFAULT 0,
  estatus     TEXT NOT NULL DEFAULT 'Activo',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_clientes_upd ON clientes;
CREATE TRIGGER trg_clientes_upd BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── PRODUCTOS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos (
  id          BIGSERIAL PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'Producto Terminado',
  stock       INTEGER NOT NULL DEFAULT 0,
  ubicacion   TEXT DEFAULT '',
  precio      NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_productos_upd ON productos;
CREATE TRIGGER trg_productos_upd BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── PRECIOS ESPECIALES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS precios_esp (
  id          BIGSERIAL PRIMARY KEY,
  cliente_id  BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  sku         TEXT NOT NULL,
  precio      NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_precios_esp_cli ON precios_esp(cliente_id);

-- ── ÓRDENES (ventas) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes (
  id              BIGSERIAL PRIMARY KEY,
  folio           TEXT,
  cliente_id      BIGINT REFERENCES clientes(id),
  cliente_nombre  TEXT NOT NULL,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  productos       TEXT NOT NULL,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  estatus         TEXT NOT NULL DEFAULT 'Creada',
  ruta_id         BIGINT,
  requiere_factura BOOLEAN DEFAULT false,
  metodo_pago     TEXT,
  referencia_pago TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_ordenes_upd ON ordenes;
CREATE TRIGGER trg_ordenes_upd BEFORE UPDATE ON ordenes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_ordenes_fecha ON ordenes(fecha);
CREATE INDEX idx_ordenes_estatus ON ordenes(estatus);

-- ── RUTAS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rutas (
  id          BIGSERIAL PRIMARY KEY,
  folio       TEXT,
  nombre      TEXT NOT NULL,
  chofer_id   BIGINT REFERENCES usuarios(id),
  chofer_nombre TEXT,
  estatus     TEXT NOT NULL DEFAULT 'Pendiente',
  carga       JSONB DEFAULT '{}',
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_rutas_upd ON rutas;
CREATE TRIGGER trg_rutas_upd BEFORE UPDATE ON rutas FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── PRODUCCIÓN ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS produccion (
  id          BIGSERIAL PRIMARY KEY,
  folio       TEXT,
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  turno       TEXT NOT NULL,
  maquina     TEXT NOT NULL,
  sku         TEXT NOT NULL,
  cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
  destino     TEXT,
  estatus     TEXT NOT NULL DEFAULT 'Confirmada',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_produccion_fecha ON produccion(fecha);

-- ── MOVIMIENTOS INVENTARIO ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario_mov (
  id          BIGSERIAL PRIMARY KEY,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo        TEXT NOT NULL,
  producto    TEXT NOT NULL,
  cantidad    INTEGER NOT NULL,
  origen      TEXT,
  destino     TEXT,
  usuario     TEXT,
  referencia  TEXT
);
CREATE INDEX idx_inv_mov_fecha ON inventario_mov(fecha);

-- ── CUARTOS FRÍOS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuartos_frios (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  temp        NUMERIC(4,1) DEFAULT -8,
  capacidad   INTEGER NOT NULL DEFAULT 100,
  stock       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_cf_upd ON cuartos_frios;
CREATE TRIGGER trg_cf_upd BEFORE UPDATE ON cuartos_frios FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── COMODATOS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comodatos (
  id              BIGSERIAL PRIMARY KEY,
  negocio         TEXT NOT NULL,
  direccion       TEXT,
  contacto        TEXT,
  congelador_modelo TEXT,
  capacidad       INTEGER DEFAULT 60,
  stock_actual    INTEGER DEFAULT 0,
  stock_maximo    INTEGER DEFAULT 60,
  productos       JSONB DEFAULT '{}',
  estatus         TEXT NOT NULL DEFAULT 'Activo',
  frecuencia      TEXT DEFAULT 'Diario',
  ultimo_resurtido DATE,
  cliente_id      BIGINT REFERENCES clientes(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_comodatos_upd ON comodatos;
CREATE TRIGGER trg_comodatos_upd BEFORE UPDATE ON comodatos FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── LEADS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  telefono    TEXT,
  correo      TEXT,
  mensaje     TEXT,
  origen      TEXT DEFAULT 'Landing page',
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  estatus     TEXT NOT NULL DEFAULT 'Nuevo',
  asignado_a  BIGINT REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_leads_upd ON leads;
CREATE TRIGGER trg_leads_upd BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── EMPLEADOS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empleados (
  id              BIGSERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  rfc             VARCHAR(13),
  curp            VARCHAR(18),
  nss             VARCHAR(15),
  puesto          TEXT NOT NULL,
  depto           TEXT NOT NULL,
  salario_diario  NUMERIC(10,2) NOT NULL,
  fecha_ingreso   DATE NOT NULL,
  jornada         TEXT DEFAULT 'Diurna',
  estatus         TEXT NOT NULL DEFAULT 'Activo',
  usuario_id      BIGINT REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_empleados_upd ON empleados;
CREATE TRIGGER trg_empleados_upd BEFORE UPDATE ON empleados FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── NÓMINA PERIODOS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nomina_periodos (
  id              BIGSERIAL PRIMARY KEY,
  periodo         TEXT NOT NULL,
  fecha_pago      DATE NOT NULL,
  total_ventas    NUMERIC(12,2) DEFAULT 0,
  total_produccion NUMERIC(12,2) DEFAULT 0,
  total_admin     NUMERIC(12,2) DEFAULT 0,
  total_general   NUMERIC(12,2) DEFAULT 0,
  estatus         TEXT NOT NULL DEFAULT 'Borrador',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── NÓMINA RECIBOS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nomina_recibos (
  id              BIGSERIAL PRIMARY KEY,
  periodo_id      BIGINT NOT NULL REFERENCES nomina_periodos(id),
  empleado_id     BIGINT NOT NULL REFERENCES empleados(id),
  dias_pagados    INTEGER DEFAULT 7,
  sueldo          NUMERIC(10,2) DEFAULT 0,
  septimo_dia     NUMERIC(10,2) DEFAULT 0,
  comisiones      NUMERIC(10,2) DEFAULT 0,
  prima_dominical NUMERIC(10,2) DEFAULT 0,
  bono_puntualidad NUMERIC(10,2) DEFAULT 0,
  bono_productividad NUMERIC(10,2) DEFAULT 0,
  otras_percepciones NUMERIC(10,2) DEFAULT 0,
  total_percepciones NUMERIC(12,2) DEFAULT 0,
  neto_a_pagar    NUMERIC(12,2) DEFAULT 0,
  estatus         TEXT DEFAULT 'Pendiente',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── MOVIMIENTOS CONTABLES ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS movimientos_contables (
  id          BIGSERIAL PRIMARY KEY,
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('Ingreso', 'Egreso')),
  categoria   TEXT NOT NULL,
  concepto    TEXT NOT NULL,
  monto       NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  referencia  TEXT,
  orden_id    BIGINT REFERENCES ordenes(id),
  usuario_id  BIGINT REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mov_cont_fecha ON movimientos_contables(fecha);
CREATE INDEX idx_mov_cont_tipo ON movimientos_contables(tipo);

-- ── MERMAS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mermas (
  id          BIGSERIAL PRIMARY KEY,
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  sku         TEXT NOT NULL,
  cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
  causa       TEXT NOT NULL,
  origen      TEXT NOT NULL,
  foto_url    TEXT,
  usuario_id  BIGINT REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── AUDITORÍA ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGSERIAL PRIMARY KEY,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario     TEXT NOT NULL,
  accion      TEXT NOT NULL,
  modulo      TEXT NOT NULL,
  detalle     TEXT
);
CREATE INDEX idx_audit_fecha ON auditoria(fecha);

-- ── RLS: Disable for now (enable when auth is ready) ───────────
-- All tables accessible to anon for now
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE precios_esp ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rutas ENABLE ROW LEVEL SECURITY;
ALTER TABLE produccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_mov ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuartos_frios ENABLE ROW LEVEL SECURITY;
ALTER TABLE comodatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE nomina_periodos ENABLE ROW LEVEL SECURITY;
ALTER TABLE nomina_recibos ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE mermas ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;

-- Allow anon full access for now (restrict later with auth)
CREATE POLICY "anon_all" ON usuarios FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON clientes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON productos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON precios_esp FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON ordenes FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON rutas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON produccion FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON inventario_mov FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON cuartos_frios FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON comodatos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON leads FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON empleados FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON nomina_periodos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON nomina_recibos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON movimientos_contables FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON mermas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON auditoria FOR ALL TO anon USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- SEED: Solo usuarios del sistema (sin datos fake)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO usuarios (nombre, email, rol, pass) VALUES
  ('Administrador', 'admin@cubopolar.com', 'Admin', 'admin'),
  ('Laura García', 'laura@cubopolar.com', 'Ventas', 'ventas'),
  ('Carlos Mendoza', 'carlos@cubopolar.com', 'Chofer', 'chofer'),
  ('Roberto Díaz', 'roberto@cubopolar.com', 'Almacén Bolsas', 'almacen'),
  ('Mario Herrera', 'mario@cubopolar.com', 'Producción', 'prod');

-- Productos base (estos sí son reales del negocio)
INSERT INTO productos (sku, nombre, tipo, stock, precio) VALUES
  ('HC-25K', 'Hielo Cubo 25kg', 'Producto Terminado', 0, 80),
  ('HC-5K', 'Hielo Cubo 5kg', 'Producto Terminado', 0, 25),
  ('HT-25K', 'Hielo Triturado 25kg', 'Producto Terminado', 0, 75),
  ('BH-50K', 'Barra de Hielo 50kg', 'Producto Terminado', 0, 120),
  ('EMP-25', 'Bolsa empaque 25kg', 'Empaque', 0, 0),
  ('EMP-5', 'Bolsa empaque 5kg', 'Empaque', 0, 0);

-- Cuartos fríos vacíos (listos para recibir producción)
INSERT INTO cuartos_frios (id, nombre, temp, capacidad, stock) VALUES
  ('CF-1', 'Cuarto Frío 1', -8, 72, '{}'),
  ('CF-2', 'Cuarto Frío 2', -10, 85, '{}'),
  ('CF-3', 'Cuarto Frío 3', -6, 45, '{}');

-- Cliente genérico
INSERT INTO clientes (nombre, rfc, tipo) VALUES
  ('Público en general', 'XAXX010101000', 'General');

-- Empleados reales (de NOMINA08.xlsx)
INSERT INTO empleados (nombre, rfc, curp, nss, puesto, depto, salario_diario, fecha_ingreso) VALUES
  ('Ángel Guadalupe Hernández Barrios', 'HEBA760803IS9', 'HEBA760803HDGRRN05', '31927643648', 'Chofer Vendedor', 'Ventas y Distribución', 318.93, '2025-11-22'),
  ('Martín Gallegos López', 'GALM770712QV2', 'GALM770712HDGLPR06', '31067600861', 'Ayudante de Chofer', 'Ventas y Distribución', 315.04, '2025-11-23'),
  ('José Cruz Calzada Gaucín', 'CAGC7105033X4', 'CAGC710503HDGLSR07', '31997103796', 'Chofer Vendedor', 'Ventas y Distribución', 315.04, '2025-11-24'),
  ('Julio César Gallardo', 'GAJU871010MA5', 'GAJU871010HDGLXL01', '31088701730', 'Ayudante de Chofer', 'Ventas y Distribución', 315.04, '2025-11-24'),
  ('Martín Edilberto Graciano Reyes', 'GARM940103N43', 'GARM940103HDGRYR01', '31109400197', 'Supervisor de Producción', 'Producción', 315.04, '2025-11-29'),
  ('Marcela Guadalupe Martínez Macías', 'MAMM901008R30', 'MAMM901008MDGRCR07', '31089022987', 'Ayudante General Producción', 'Producción', 315.04, '2025-11-29'),
  ('Adolfo Ángel Santillán Cabada', 'SACA0203034S2', 'SACA020303HDGNBDA9', '28160285715', 'Ayudante General Producción', 'Producción', 315.04, '2025-11-29'),
  ('María de Jesús Ibarra Fernández', 'IAFJ750409LU4', 'IAFJ750409MDGBRS06', '31957634996', 'Cajera', 'Administración', 400.08, '2025-11-29'),
  ('Jorge Luis Ávila Candia', 'AICJ690411718', 'AICJ690411HDGVNR04', '3190692480-3', 'Supervisor de Producción', 'Producción', 315.04, '2026-02-23'),
  ('Daniela Guadalupe Candia González', 'CAGD010731SD6', 'CAGD010731MDG3NA5', '73160142060', 'Auxiliar Administrativo', 'Administración', 500.00, '2025-11-28'),
  ('Jessica Muñoz Gurrola', 'MUGJ870710SU5', 'MUGJ870710MDGXRS04', '31038702499', 'Jefe Administrativo', 'Staff', 857.14, '2025-11-28');
