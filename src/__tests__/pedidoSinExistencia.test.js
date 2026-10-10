// 137: un pedido que se surte después se levanta aunque no haya existencia;
// en mostrador sin existencia no se vende.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pedidoPorSku, faltantesDePedido, revisarExistencia, textoFaltantes } from '../data/pedidoStockLogic';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const stock = (m) => (sku) => m[sku] || 0;

describe('existencia al levantar una venta', () => {
  it('suma las líneas por producto e ignora las vacías', () => {
    expect(pedidoPorSku([{ sku: 'HPC-5K', qty: 40 }, { sku: 'HPC-5K', qty: 2 }, { sku: '', qty: 5 }, { sku: 'HPC-25K', qty: 0 }, { sku: 'HPC-25K', cantidad: 3 }]))
      .toEqual({ 'HPC-5K': 42, 'HPC-25K': 3 });
    expect(pedidoPorSku(null)).toEqual({});
  });
  it('faltantes por producto (la barra se revisa aparte)', () => {
    expect(faltantesDePedido({ 'HPC-5K': 42, 'HPC-25K': 3, 'HPT-5K': 1, 'HIP-25K': 9 }, stock({ 'HPC-5K': 15, 'HPT-5K': 1 })))
      .toEqual([{ sku: 'HPC-25K', pedido: 3, disponible: 0, falta: 3 }, { sku: 'HPC-5K', pedido: 42, disponible: 15, falta: 27 }]);
  });
  it('con existencia: ni bloqueo ni aviso, en cualquier canal', () => {
    for (const mostrador of [true, false]) {
      expect(revisarExistencia({ pedido: { 'HPC-5K': 15 }, getStock: stock({ 'HPC-5K': 15 }), mostrador }))
        .toEqual({ hayFaltante: false, faltan: [], barra: null, bloqueo: null, permitirSinStock: false });
    }
  });
  it('MOSTRADOR sin existencia: bloquea y sugiere pasarlo a domicilio; nunca pide permiso al servidor', () => {
    const r = revisarExistencia({ pedido: { 'HPC-5K': 42 }, getStock: stock({ 'HPC-5K': 15 }), mostrador: true });
    expect(r.bloqueo).toMatch(/Stock insuficiente de HPC-5K \(disp: 15\)/);
    expect(r.bloqueo).toMatch(/A domicilio/);
    expect(r.permitirSinStock).toBe(false);
  });
  it('A DOMICILIO sin existencia: se permite, con lo que falta producir', () => {
    const r = revisarExistencia({ pedido: { 'HPC-5K': 42, 'HPC-25K': 3 }, getStock: stock({ 'HPC-5K': 15 }), mostrador: false });
    expect(r).toMatchObject({ hayFaltante: true, bloqueo: null, permitirSinStock: true });
    expect(textoFaltantes(r.faltan)).toBe('3 de HPC-25K, 27 de HPC-5K');
    expect(textoFaltantes(r.faltan, (sku) => `[${sku}]`)).toBe('3 de [HPC-25K], 27 de [HPC-5K]');
  });
  it('barra (picada / triturada / media) sin barra entera: mismo criterio por canal', () => {
    const pedido = { 'HIP-25K': 3 };
    const dom = revisarExistencia({ pedido, getStock: stock({ 'HIB-50K': 1 }), mostrador: false });
    expect(dom.faltan).toEqual([]);
    expect(dom.barra).toMatch(/No hay barra suficiente/);
    expect(dom.permitirSinStock).toBe(true);
    const mos = revisarExistencia({ pedido, getStock: stock({ 'HIB-50K': 1 }), mostrador: true });
    expect(mos.bloqueo).toMatch(/No hay barra suficiente/);
    expect(revisarExistencia({ pedido, getStock: stock({ 'HIB-50K': 2 }), mostrador: true }).bloqueo).toBeNull();
  });
});

describe('pantallas y contrato', () => {
  it('Nueva venta: avisa, cambia el botón y manda la bandera solo cuando hace falta', () => {
    const src = leer('../components/NuevaVentaModal.jsx');
    expect(src).toMatch(/revisarExistencia\(\{ pedido: pedidoPorSku\(lines\), getStock, mostrador: form\.canal === 'mostrador' \}\)/);
    expect(src).toMatch(/if \(!e\.productos && existencia\.bloqueo\) e\.productos = existencia\.bloqueo;/);
    expect(src).toMatch(/permitirSinStock: existencia\.permitirSinStock/);
    expect(src).toMatch(/data-testid="aviso-sin-existencia"/);
    expect(src).toMatch(/Crear pedido por surtir/);
  });
  it('el store manda permitir_sin_stock solo si la pantalla lo pidió', () => {
    const src = leer('../data/supaStore.js');
    expect(src).toMatch(/\.\.\.\(o\.permitirSinStock === true \? \{ permitir_sin_stock: true \} : \{\}\)/);
  });
  it('Editar venta ya no se bloquea por existencia (solo avisa)', () => {
    const src = leer('../components/EditarVentaModal.jsx');
    expect(src).not.toMatch(/toast\?\.error\(`Stock insuficiente/);
    expect(src).toMatch(/Queda como pedido por surtir/);
  });
  it('la migración conserva el rechazo sin la bandera y no toca la entrega', () => {
    const sql = leer('../../supabase/137_pedido_sin_existencia.sql');
    expect(sql).toMatch(/IF NOT v_sin_stock THEN/);
    expect(sql).toMatch(/Stock insuficiente para % \(disponible: %, pedido: %\)/);
    expect(sql).toMatch(/'Pedido sin existencia'/);
    expect(sql).not.toMatch(/FUNCTION public\.completar_venta_directa/);
  });
});
