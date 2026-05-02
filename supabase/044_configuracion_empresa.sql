-- 044_configuracion_empresa.sql
-- Tabla singleton (id = 1) con datos fiscales/contacto de la empresa.
-- Se lee al cargar el store para mostrar en facturas, tickets, headers, etc.
-- Sustituye al hardcoded "Cubo Polar S.A. de C.V." que estaba en
-- FacturacionView.jsx:135.

CREATE TABLE IF NOT EXISTS configuracion_empresa (
  id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  razon_social      TEXT NOT NULL,
  rfc               TEXT NOT NULL,
  direccion_fiscal  TEXT,
  codigo_postal     VARCHAR(10),
  telefono          TEXT,
  correo            TEXT,
  regimen_fiscal    TEXT,
  logo_url          TEXT,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

INSERT INTO configuracion_empresa (id, razon_social, rfc)
VALUES (1, 'Cubo Polar S.A. de C.V.', 'CPO000000XX0')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE configuracion_empresa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin lee/escribe config empresa" ON configuracion_empresa;
CREATE POLICY "Admin lee/escribe config empresa"
  ON configuracion_empresa FOR ALL
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE configuracion_empresa IS
  'Singleton con datos fiscales/contacto de la empresa. id = 1 siempre.';
