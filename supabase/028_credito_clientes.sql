-- 028: Crédito autorizado por cliente + tipo de cobro en órdenes

-- Campos de crédito en la tabla clientes
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS credito_autorizado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS limite_credito     NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Tipo de cobro por orden: Contado (cobrar al entregar) o Crédito (se carga a cuenta)
ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS tipo_cobro TEXT NOT NULL DEFAULT 'Contado'
    CHECK (tipo_cobro IN ('Contado', 'Credito'));
