// reversoProduccion.test.js — 093: producción inmutable con reverso.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reversibilidadProduccion } from '../data/produccionLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const BASE = { tipo: 'Produccion', estatus: 'Confirmada', operacionId: 'u-1', cuartoId: 'CF-1', empaqueSku: 'EMP-5', empaqueCantidad: 10 };

describe('reversibilidadProduccion', () => {
  it('producción del contrato con datos completos: reversible', () => {
    expect(reversibilidadProduccion(BASE)).toEqual({ reversible: true, razon: null });
    expect(reversibilidadProduccion({ ...BASE, empaqueSku: null, empaqueCantidad: null }).reversible).toBe(true);
  });
  it('legado sin cuarto u operación: no reversible (no se adivina)', () => {
    expect(reversibilidadProduccion({ ...BASE, cuartoId: null }).reversible).toBe(false);
    expect(reversibilidadProduccion({ ...BASE, operacionId: null }).reversible).toBe(false);
    expect(reversibilidadProduccion({ ...BASE, empaqueCantidad: null }).razon).toMatch(/sin datos suficientes/);
  });
  it('transformación, revertida o no confirmada: no reversible', () => {
    expect(reversibilidadProduccion({ ...BASE, tipo: 'Transformacion' }).razon).toMatch(/transformaciones/);
    expect(reversibilidadProduccion({ ...BASE, estatus: 'Revertida' }).razon).toMatch(/Ya fue revertida/);
    expect(reversibilidadProduccion({ ...BASE, estatus: 'En proceso' }).reversible).toBe(false);
  });
  it('snake_case también', () => {
    expect(reversibilidadProduccion({ tipo: 'Produccion', estatus: 'Confirmada', operacion_id: 'x', cuarto_id: 'CF-2', empaque_sku: null }).reversible).toBe(true);
  });
});

describe('093: sin borrado físico de producción', () => {
  const store = src('../data/supaStore.js');
  it('el store no borra producción y usa el contrato de reverso', () => {
    expect(store).not.toMatch(/deleteProduccion/);
    expect(store).not.toMatch(/from\('produccion'\)\s*\.delete\(/);
    expect(store).toMatch(/revertirProduccion: async/);
    expect(store).toMatch(/rpc\('revertir_produccion'/);
  });
  it('la vista de producción ofrece Revertir con motivo, no Eliminar', () => {
    const v = src('../components/views/ProduccionView.jsx');
    expect(v).not.toMatch(/deleteProduccion/);
    expect(v).toMatch(/actions\.revertirProduccion/);
    expect(v).toMatch(/reversibilidadProduccion/);
    expect(v).not.toMatch(/label="Cantidad \*"/);
    expect(v).not.toMatch(/label="Estatus"/);
  });
  it('editar producto no envía stock; el ajuste usa el contrato', () => {
    expect(store).not.toMatch(/update\.stock = /);
    expect(store).toMatch(/rpc\('ajustar_existencia'/);
    const pv = src('../components/views/ProductosView.jsx');
    expect(pv).toMatch(/modal === "new" \? camposAltaProducto\(\{ tipo: form\.tipo, stock: form\.stock \}\) : \{\}/);
  });
});

describe('095: el frontend no usa salidas por RPC genérico', () => {
  it('ningún llamador de update_productos_stock_atomic ni de update_stocks_atomic (105)', () => {
    const store = src('../data/supaStore.js');
    expect(store).not.toMatch(/rpc\('update_productos_stock_atomic'/);
    expect(store).not.toMatch(/rpc\('update_stocks_atomic'/);
  });
});
