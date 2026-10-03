// costoEmpaquePromedio.test.js — 106: costo de empaque por promedio ponderado (el
// servidor es la autoridad) y memo de empaque estimado en mermas.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { costoEmpaqueEstimado } from '../data/mermasLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('memo: empaque estimado de una merma', () => {
  const productos = [
    { sku: 'EMP-5', tipo: 'Empaque', costoUnitario: 1.545455 },
    { sku: 'HPC-5K', tipo: 'Producto Terminado', empaqueSku: 'EMP-5', costoUnitario: 0 },
    { sku: 'HIB-50K', tipo: 'Producto Terminado', empaqueSku: '', costoUnitario: 0 },
    { sku: 'RARO', tipo: 'Producto Terminado', empaque_sku: 'HPC-5K', costo_unitario: 99 },
  ];
  it('usa el costo promedio actual del empaque del producto, nunca el costo del producto terminado', () => {
    expect(costoEmpaqueEstimado('HPC-5K', productos)).toBe(1.545455);
    expect(costoEmpaqueEstimado('HIB-50K', productos)).toBe(0);   // sin empaque
    expect(costoEmpaqueEstimado('RARO', productos)).toBe(0);      // su "empaque" no es tipo Empaque
    expect(costoEmpaqueEstimado('NOPE', productos)).toBe(0);
    expect(costoEmpaqueEstimado('HPC-5K', null)).toBe(0);
  });
});

describe('106: el catálogo no edita costos', () => {
  const store = src('../data/supaStore.js');
  const vista = src('../components/views/ProductosView.jsx');
  it('updateProducto no envía costo; addProducto solo para Empaque (apertura)', () => {
    const upd = store.slice(store.indexOf('updateProducto: async'), store.indexOf('deleteProducto: async'));
    expect(upd).not.toMatch(/costo_unitario/);
    expect(store).toMatch(/costo_unitario: p\.tipo === 'Empaque' \?/);
  });
  it('la vista muestra el costo promedio como solo lectura al editar', () => {
    expect(vista).toMatch(/Costo promedio actual/);
    expect(vista).toMatch(/modal === "new" && form\.tipo === "Empaque" \? \{ costo_unitario/);
    expect(vista).toMatch(/disabled=\{modal !== "new"\}/);
  });
  it('Mermas: memo etiquetado como estimación, no como gasto', () => {
    const m = src('../components/views/MermasView.jsx');
    expect(m).toMatch(/Empaque estimado en período \(referencia\)/);
    expect(m).toMatch(/costoEmpaqueEstimado\(p\.sku, data\?\.productos\)/);
    expect(m).not.toMatch(/costo: n\(p\.costoUnitario/);
  });
});
