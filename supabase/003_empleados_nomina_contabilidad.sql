-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Migration 003: Empleados, Nómina, Contabilidad
-- Run AFTER 001_schema.sql and 002_seed.sql
-- ═══════════════════════════════════════════════════════════════

-- ── TIPOS ENUMERADOS NUEVOS ────────────────────────────────────
CREATE TYPE estatus_empleado AS ENUM ('Activo', 'Inactivo', 'Baja');
CREATE TYPE tipo_jornada AS ENUM ('Diurna', 'Nocturna', 'Mixta');
CREATE TYPE tipo_movimiento_contable AS ENUM ('Ingreso', 'Egreso');
CREATE TYPE estatus_nomina AS ENUM ('Borrador', 'Calculada', 'Pagado');

-- ── DEPARTAMENTOS ──────────────────────────────────────────────
CREATE TABLE departamentos (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO departamentos (nombre) VALUES
  ('Ventas y Distribución'),
  ('Producción'),
  ('Administración'),
  ('Staff');

-- ── EMPLEADOS ──────────────────────────────────────────────────
CREATE TABLE empleados (
  id              BIGSERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  rfc             VARCHAR(13) NOT NULL,
  curp            VARCHAR(18) NOT NULL,
  nss             VARCHAR(15),
  puesto          TEXT NOT NULL,
  departamento_id BIGINT NOT NULL REFERENCES departamentos(id),
  salario_diario  NUMERIC(10,2) NOT NULL CHECK (salario_diario > 0),
  salario_imss    NUMERIC(10,2),  -- base para IMSS si difiere del SD
  fecha_ingreso   DATE NOT NULL,
  fecha_baja      DATE,
  jornada         tipo_jornada NOT NULL DEFAULT 'Diurna',
  tipo_salario    TEXT NOT NULL DEFAULT 'Fijo',
  regimen_fiscal  TEXT NOT NULL DEFAULT '605 Sueldos y Salarios e Ingresos Asimilados a Salarios',
  estatus         estatus_empleado NOT NULL DEFAULT 'Activo',
  -- Vinculación a usuario del sistema (opcional)
  usuario_id      BIGINT REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_empleados_rfc ON empleados(rfc) WHERE estatus = 'Activo';
CREATE UNIQUE INDEX idx_empleados_curp ON empleados(curp) WHERE estatus = 'Activo';
CREATE INDEX idx_empleados_depto ON empleados(departamento_id);

CREATE TRIGGER trg_empleados_updated BEFORE UPDATE ON empleados
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── PERIODOS DE NÓMINA ─────────────────────────────────────────
CREATE TABLE nomina_periodos (
  id              BIGSERIAL PRIMARY KEY,
  numero_semana   INTEGER NOT NULL,
  ejercicio       INTEGER NOT NULL,
  fecha_inicio    DATE NOT NULL,
  fecha_fin       DATE NOT NULL,
  fecha_pago      DATE NOT NULL,
  dias_pago       INTEGER NOT NULL DEFAULT 7,
  total_percepciones NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deducciones  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_neto      NUMERIC(12,2) NOT NULL DEFAULT 0,
  estatus         estatus_nomina NOT NULL DEFAULT 'Borrador',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(numero_semana, ejercicio)
);

CREATE TRIGGER trg_nomina_periodos_updated BEFORE UPDATE ON nomina_periodos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RECIBOS DE NÓMINA (uno por empleado por periodo) ───────────
CREATE TABLE nomina_recibos (
  id              BIGSERIAL PRIMARY KEY,
  periodo_id      BIGINT NOT NULL REFERENCES nomina_periodos(id),
  empleado_id     BIGINT NOT NULL REFERENCES empleados(id),
  dias_pagados    INTEGER NOT NULL DEFAULT 7,
  -- Percepciones
  sueldo          NUMERIC(10,2) NOT NULL DEFAULT 0,
  septimo_dia     NUMERIC(10,2) NOT NULL DEFAULT 0,
  comisiones      NUMERIC(10,2) NOT NULL DEFAULT 0,
  prima_dominical NUMERIC(10,2) NOT NULL DEFAULT 0,
  descanso_trabajado NUMERIC(10,2) NOT NULL DEFAULT 0,
  dia_festivo     NUMERIC(10,2) NOT NULL DEFAULT 0,
  bono_puntualidad NUMERIC(10,2) NOT NULL DEFAULT 0,
  bono_productividad NUMERIC(10,2) NOT NULL DEFAULT 0,
  otras_percepciones NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_percepciones NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Deducciones
  isr             NUMERIC(10,2) NOT NULL DEFAULT 0,
  imss            NUMERIC(10,2) NOT NULL DEFAULT 0,
  infonavit       NUMERIC(10,2) NOT NULL DEFAULT 0,
  prestamos       NUMERIC(10,2) NOT NULL DEFAULT 0,
  otras_deducciones NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_deducciones NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Neto
  neto_a_pagar    NUMERIC(12,2) NOT NULL DEFAULT 0,
  estatus         TEXT NOT NULL DEFAULT 'Pendiente',  -- Pendiente, Pagado
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(periodo_id, empleado_id)
);
CREATE INDEX idx_nomina_recibos_periodo ON nomina_recibos(periodo_id);
CREATE INDEX idx_nomina_recibos_empleado ON nomina_recibos(empleado_id);

-- ── CATEGORÍAS CONTABLES ───────────────────────────────────────
CREATE TABLE categorias_contables (
  id          BIGSERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE,
  tipo        tipo_movimiento_contable NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO categorias_contables (nombre, tipo) VALUES
  ('Ventas', 'Ingreso'),
  ('Cobranza', 'Ingreso'),
  ('Otros ingresos', 'Ingreso'),
  ('Nómina', 'Egreso'),
  ('Proveedores', 'Egreso'),
  ('Combustible', 'Egreso'),
  ('Servicios', 'Egreso'),
  ('Mantenimiento', 'Egreso'),
  ('Impuestos', 'Egreso'),
  ('Otros egresos', 'Egreso');

-- ── MOVIMIENTOS CONTABLES ──────────────────────────────────────
CREATE TABLE movimientos_contables (
  id              BIGSERIAL PRIMARY KEY,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo            tipo_movimiento_contable NOT NULL,
  categoria_id    BIGINT NOT NULL REFERENCES categorias_contables(id),
  concepto        TEXT NOT NULL,
  monto           NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  referencia      TEXT,  -- factura, recibo, transferencia, etc.
  comprobante_url TEXT,  -- link a foto/PDF del comprobante
  usuario_id      BIGINT REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mov_contables_fecha ON movimientos_contables(fecha);
CREATE INDEX idx_mov_contables_tipo ON movimientos_contables(tipo);
CREATE INDEX idx_mov_contables_cat ON movimientos_contables(categoria_id);

-- ── CUENTAS POR COBRAR (complementa saldo en clientes) ────────
CREATE TABLE cuentas_por_cobrar (
  id              BIGSERIAL PRIMARY KEY,
  cliente_id      BIGINT NOT NULL REFERENCES clientes(id),
  orden_id        BIGINT REFERENCES ordenes(id),
  fecha_venta     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  monto_original  NUMERIC(12,2) NOT NULL CHECK (monto_original > 0),
  monto_pagado    NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_pendiente NUMERIC(12,2) NOT NULL,
  estatus         TEXT NOT NULL DEFAULT 'Pendiente', -- Pendiente, Parcial, Pagada, Vencida
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cxc_cliente ON cuentas_por_cobrar(cliente_id);
CREATE INDEX idx_cxc_estatus ON cuentas_por_cobrar(estatus);

CREATE TRIGGER trg_cxc_updated BEFORE UPDATE ON cuentas_por_cobrar
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────
ALTER TABLE departamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE nomina_periodos ENABLE ROW LEVEL SECURITY;
ALTER TABLE nomina_recibos ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_por_cobrar ENABLE ROW LEVEL SECURITY;

-- Read: all authenticated
CREATE POLICY "read_all" ON departamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_all" ON empleados FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_all" ON nomina_periodos FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_all" ON nomina_recibos FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_all" ON categorias_contables FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_all" ON movimientos_contables FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_all" ON cuentas_por_cobrar FOR SELECT TO authenticated USING (true);

-- Write: Admin only for sensitive tables
CREATE POLICY "admin_write" ON empleados FOR ALL TO authenticated
  USING (get_user_rol() = 'Admin') WITH CHECK (get_user_rol() = 'Admin');
CREATE POLICY "admin_write" ON nomina_periodos FOR ALL TO authenticated
  USING (get_user_rol() = 'Admin') WITH CHECK (get_user_rol() = 'Admin');
CREATE POLICY "admin_write" ON nomina_recibos FOR ALL TO authenticated
  USING (get_user_rol() = 'Admin') WITH CHECK (get_user_rol() = 'Admin');
CREATE POLICY "admin_write" ON movimientos_contables FOR ALL TO authenticated
  USING (get_user_rol() = 'Admin') WITH CHECK (get_user_rol() = 'Admin');
CREATE POLICY "admin_write" ON cuentas_por_cobrar FOR ALL TO authenticated
  USING (get_user_rol() IN ('Admin', 'Ventas')) WITH CHECK (get_user_rol() IN ('Admin', 'Ventas'));


-- ═══════════════════════════════════════════════════════════════
-- SEED: Datos reales de NOMINA08.xlsx
-- ═══════════════════════════════════════════════════════════════

-- Empleados (datos de nómina semana 08)
INSERT INTO empleados (id, nombre, rfc, curp, nss, puesto, departamento_id, salario_diario, fecha_ingreso) VALUES
  (1, 'Ángel Guadalupe Hernández Barrios', 'HEBA760803IS9', 'HEBA760803HDGRRN05', '31927643648', 'Chofer Vendedor', 1, 318.93, '2025-11-22'),
  (2, 'Martín Gallegos López', 'GALM770712QV2', 'GALM770712HDGLPR06', '31067600861', 'Ayudante de Chofer', 1, 315.04, '2025-11-23'),
  (3, 'José Cruz Calzada Gaucín', 'CAGC7105033X4', 'CAGC710503HDGLSR07', '31997103796', 'Chofer Vendedor', 1, 315.04, '2025-11-24'),
  (4, 'Julio César Gallardo', 'GAJU871010MA5', 'GAJU871010HDGLXL01', '31088701730', 'Ayudante de Chofer', 1, 315.04, '2025-11-24'),
  (5, 'Martín Edilberto Graciano Reyes', 'GARM940103N43', 'GARM940103HDGRYR01', '31109400197', 'Supervisor de Producción', 2, 315.04, '2025-11-29'),
  (6, 'Marcela Guadalupe Martínez Macías', 'MAMM901008R30', 'MAMM901008MDGRCR07', '31089022987', 'Ayudante General Producción', 2, 315.04, '2025-11-29'),
  (7, 'Adolfo Ángel Santillán Cabada', 'SACA0203034S2', 'SACA020303HDGNBDA9', '28160285715', 'Ayudante General Producción', 2, 315.04, '2025-11-29'),
  (8, 'María de Jesús Ibarra Fernández', 'IAFJ750409LU4', 'IAFJ750409MDGBRS06', '31957634996', 'Cajera', 3, 400.08, '2025-11-29'),
  (9, 'Jorge Luis Ávila Candia', 'AICJ690411718', 'AICJ690411HDGVNR04', '3190692480-3', 'Supervisor de Producción', 2, 315.04, '2026-02-23'),
  (10, 'Daniela Guadalupe Candia González', 'CAGD010731SD6', 'CAGD010731MDG3NA5', '73160142060', 'Auxiliar Administrativo', 3, 500.00, '2025-11-28'),
  (11, 'Jessica Muñoz Gurrola', 'MUGJ870710SU5', 'MUGJ870710MDGXRS04', '31038702499', 'Jefe Administrativo', 4, 857.14, '2025-11-28');
SELECT setval('empleados_id_seq', 11);

-- Periodo de nómina semana 08
INSERT INTO nomina_periodos (id, numero_semana, ejercicio, fecha_inicio, fecha_fin, fecha_pago, dias_pago, total_percepciones, total_deducciones, total_neto, estatus) VALUES
  (1, 8, 2026, '2026-02-21', '2026-02-27', '2026-02-27', 7, 39040.99, 0, 39040.99, 'Pagado');
SELECT setval('nomina_periodos_id_seq', 1);

-- Recibos individuales semana 08
INSERT INTO nomina_recibos (periodo_id, empleado_id, dias_pagados, sueldo, septimo_dia, comisiones, prima_dominical, bono_puntualidad, total_percepciones, neto_a_pagar, estatus) VALUES
  (1, 1, 6, 1913.58, 318.93, 2465.00, 79.73, 213.00, 4990.24, 4990.24, 'Pagado'),
  (1, 2, 7, 1890.24, 315.04, 1957.50, 74.75, 213.00, 4450.53, 4450.53, 'Pagado'),
  (1, 3, 7, 1890.24, 315.04, 541.10, 0, 213.00, 3274.42, 3274.42, 'Pagado'),
  (1, 4, 7, 1890.24, 315.04, 1676.19, 74.75, 213.00, 4169.22, 4169.22, 'Pagado'),
  (1, 5, 7, 1890.24, 315.04, 0, 0, 213.00, 2718.28, 2718.28, 'Pagado'),
  (1, 6, 6, 1890.24, 315.04, 0, 0, 213.00, 2418.28, 2418.28, 'Pagado'),
  (1, 7, 7, 1890.24, 315.04, 0, 0, 213.00, 2418.28, 2418.28, 'Pagado'),
  (1, 8, 7, 2400.48, 400.08, 0, 0, 213.00, 3013.56, 3013.56, 'Pagado'),
  (1, 9, 5, 1575.20, 0, 0, 0, 213.00, 2088.20, 2088.20, 'Pagado'),
  (1, 10, 7, 3000.00, 500.00, 0, 0, 0, 3500.00, 3500.00, 'Pagado'),
  (1, 11, 7, 5142.84, 857.14, 0, 0, 0, 5999.98, 5999.98, 'Pagado');
