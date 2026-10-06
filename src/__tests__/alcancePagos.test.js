// alcancePagos.test.js — OL-02C.1: un vendedor ve los pagos de SUS órdenes
// (orden_id → órdenes propias) además de los que ya coincidían por quién los
// registró. usuario_id es procedencia; no se modifica ni se reasigna.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pagosVisiblesVendedor, idsDeOrdenes } from '../data/alcancePagosLogic';
import { linkPagadoCompleto } from '../data/ventaDirectaLogic';
import { TABLAS_SLICE_RT } from '../data/realtimeLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const VENDEDOR = 5, OTRO = 6, ADMIN = 1, CHOFER = 9;
// Regla existente (matchOwner): el pago lo registró el vendedor.
const registradoPorVendedor = (p) => p.usuario_id != null && String(p.usuario_id) === String(VENDEDOR);
const ordenesPropias = [
  { id: 101, estatus: 'Creada', ruta_id: null, total: 80, vendedor_id: VENDEDOR },
  { id: '102', estatus: 'Creada', ruta_id: null, total: 50, vendedor_id: VENDEDOR },   // id en texto
];
const PAGOS = [
  { id: 1, ordenId: 101, usuario_id: null, monto: 80, metodoPago: 'QR / Link de pago' },     // webhook, orden propia
  { id: 2, ordenId: 201, usuario_id: null, monto: 80, metodoPago: 'QR / Link de pago' },     // webhook, orden de otro vendedor
  { id: 3, ordenId: 102, usuario_id: ADMIN, monto: 20, metodoPago: 'Efectivo' },              // Admin, orden propia (id numérico vs '102')
  { id: 4, orden_id: '102', usuario_id: CHOFER, monto: 10, metodoPago: 'Efectivo' },          // chofer, orden propia (snake_case)
  { id: 5, ordenId: null, usuario_id: VENDEDOR, monto: 30, metodoPago: 'Efectivo' },          // registrado por el vendedor, sin orden
  { id: 6, ordenId: null, usuario_id: ADMIN, monto: 40, metodoPago: 'Efectivo' },             // sin orden, registrado por otro
  { id: 7, ordenId: 202, usuario_id: ADMIN, monto: 90, metodoPago: 'Efectivo' },              // Admin, orden de otro vendedor
  { id: 8, ordenId: 203, usuario_id: CHOFER, monto: 60, metodoPago: 'Efectivo' },             // chofer, orden de otro vendedor
  { id: 9, ordenId: 204, usuario_id: OTRO, monto: 70, metodoPago: 'Efectivo' },               // otro vendedor
  { id: 10, ordenId: 999, usuario_id: VENDEDOR, monto: 15, metodoPago: 'Efectivo' },          // lo registró el vendedor en otra orden (regla existente)
];
const visibles = () => pagosVisiblesVendedor(PAGOS, ordenesPropias, registradoPorVendedor).map(p => p.id).sort((a, b) => a - b);

describe('pagosVisiblesVendedor: el pago es de la orden; usuario_id es procedencia', () => {
  it('A/E/I: pago del webhook (usuario_id NULL) de una orden propia: visible', () => {
    expect(visibles()).toContain(1);
  });
  it('B: pago del webhook de la orden de otro vendedor: excluido', () => {
    expect(visibles()).not.toContain(2);
  });
  it('C/D: pagos registrados por Admin y por el chofer en órdenes propias: visibles (ids número/texto y orden_id/ordenId)', () => {
    expect(visibles()).toEqual(expect.arrayContaining([3, 4]));
  });
  it('E: lo que ya coincidía por la regla existente se conserva (incluso sin orden o en otra orden)', () => {
    expect(visibles()).toEqual(expect.arrayContaining([5, 10]));
  });
  it('F/G: sin orden registrado por otro, Admin/chofer/otro vendedor en órdenes ajenas: excluidos', () => {
    for (const id of [6, 7, 8, 9]) expect(visibles()).not.toContain(id);
    expect(visibles()).toEqual([1, 3, 4, 5, 10]);
  });
  it('no muta los pagos; entradas inválidas toleradas; sin regla = solo órdenes propias', () => {
    const copia = JSON.parse(JSON.stringify(PAGOS));
    pagosVisiblesVendedor(PAGOS, ordenesPropias, registradoPorVendedor);
    expect(PAGOS).toEqual(copia);
    expect(pagosVisiblesVendedor(null, ordenesPropias, registradoPorVendedor)).toEqual([]);
    expect(pagosVisiblesVendedor([null, 3, { ordenId: '' }], ordenesPropias, registradoPorVendedor)).toEqual([]);
    expect(pagosVisiblesVendedor(PAGOS, ordenesPropias).map(p => p.id)).toEqual([1, 3, 4]);
    expect(pagosVisiblesVendedor(PAGOS, [], () => false)).toEqual([]);
  });
  it('ids de órdenes: texto normalizado, sin vacíos (no amplía coincidencias)', () => {
    expect([...idsDeOrdenes([{ id: 1 }, { id: ' 2 ' }, { id: null }, { id: '' }, {}])]).toEqual(['1', '2']);
  });
});

describe('detección de link pagado con los pagos del alcance del vendedor', () => {
  const alcance = (pagos) => pagosVisiblesVendedor(pagos, ordenesPropias, registradoPorVendedor);
  it('I: orden propia + pago del webhook que cubre el total → Entregar pedido pagado', () => {
    expect(linkPagadoCompleto(ordenesPropias[0], alcance(PAGOS))).toBe(true);
  });
  it('H: pago parcial del link → no se habilita', () => {
    expect(linkPagadoCompleto(ordenesPropias[0], alcance([{ ordenId: 101, usuario_id: null, monto: 79.99 }]))).toBe(false);
  });
  it('la orden pagada de otro vendedor nunca llega al alcance del vendedor', () => {
    const otra = { id: 201, estatus: 'Creada', ruta_id: null, total: 80 };
    expect(alcance(PAGOS).some(p => String(p.ordenId ?? p.orden_id) === '201')).toBe(false);
    expect(linkPagadoCompleto(otra, alcance(PAGOS))).toBe(false);
  });
  it('antes de OL-02C.1 (solo la regla de registro) el pago del webhook se perdía', () => {
    const antes = PAGOS.filter(registradoPorVendedor);
    expect(linkPagadoCompleto(ordenesPropias[0], antes)).toBe(false);
  });
});

describe('App.jsx: solo cambia el alcance de pagos de Ventas', () => {
  const app = src('../App.jsx');
  const scoped = app.slice(app.indexOf('const scopedData = useMemo'), app.indexOf('}, [data, user?.rol, usuarioActualId'));
  const chofer = scoped.slice(scoped.indexOf("if (user?.rol === 'Chofer')"), scoped.indexOf("if (user?.rol === 'Ventas')"));
  const ventas = scoped.slice(scoped.indexOf("if (user?.rol === 'Ventas')"));
  it('L: Ventas usa el helper con sus órdenes propias y la regla existente', () => {
    expect(ventas).toMatch(/const pagosPropios = pagosVisiblesVendedor\(data\.pagos, ordenesPropias, p => matchOwner\(p, usuarioActualId, authUserId, usuarioActual\?\.nombre\)\)/);
    expect(ventas).toMatch(/const ordenesPropias = \(data\.ordenes \|\| \[\]\)\.filter\(o => matchOwner\(o, usuarioActualId, authUserId, usuarioActual\?\.nombre\)\)/);   // órdenes: sin cambio
    expect((app.match(/pagosVisiblesVendedor\(/g) || []).length).toBe(1);
  });
  it('J: Admin y la vista previa siguen recibiendo los datos completos (sin alcance)', () => {
    expect(scoped).toMatch(/if \(user\?\.rol === 'Admin' \|\| adminViewAs\) return data/);
  });
  it('K: Chofer sin cambio (pagos por la regla de registro)', () => {
    expect(chofer).toMatch(/const pagosPropios = \(data\.pagos \|\| \[\]\)\.filter\(p => matchOwner\(p, usuarioActualId, authUserId, usuarioActual\?\.nombre\)\)/);
    expect(chofer).not.toMatch(/pagosVisiblesVendedor/);
  });
  it('helper puro: sin Supabase, consultas ni escrituras', () => {
    expect(src('../data/alcancePagosLogic.js')).not.toMatch(/supabase|rpc|fetch\(|import /);
  });
});

describe('realtime: el camino existente lleva el pago nuevo al alcance del vendedor', () => {
  it('pagos es una tabla con suscripción; un evento recarga su slice; scopedData depende de data', () => {
    expect(TABLAS_SLICE_RT).toContain('pagos');
    const store = src('../data/supaStore.js');
    expect(store).toMatch(/\.\.\.TABLAS_SLICE_RT\.map\(table =>\s*supabase\.channel\(`rt_\$\{table\}`\)\s*\.on\('postgres_changes', \{ event: '\*', schema: 'public', table \}, \(\) => disparar\(table, \(\) => fetchSlice\(table\), 300\)\)/);
    expect(store).toMatch(/case 'pagos': \{\s*const pag = await safeRows\(supabase\.from\('pagos'\)\.select\('\*'\)\.order\('id', \{ ascending: false \}\)\.limit\(200\)\);/);
    expect(src('../App.jsx')).toMatch(/\}, \[data, user\?\.rol, usuarioActualId, authUserId, usuarioActual\?\.nombre, adminViewAs\]\)/);
    expect(store).not.toMatch(/setInterval\([^)]*pagos/);
  });
});
