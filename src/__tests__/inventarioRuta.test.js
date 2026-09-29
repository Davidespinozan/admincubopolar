// inventarioRuta.test.js — 087: lógica pura del inventario canónico de ruta.
// Balance del servidor → vista; conteo físico normalizado; faltante/sobrante
// (vista previa, no autoridad); lote de mermas y finalización con operacion_id
// estable; mensajes; la UI no calcula la devolución.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  interpretarBalance, totalesBalance, conteoInicial, normalizarConteo, diferenciasConteo,
  claveMermasRuta, buildMermasRutaArgs, claveCierreInventario, buildFinalizarInventarioArgs,
  detalleErrorInventario, mensajeErrorInventarioRuta, mensajeNoEntrega, resolverOperacion,
  leerOperacion, guardarOperacion, borrarOperacion, claveStorageMermasRuta, claveStorageCierreInventario,
} from '../data/inventarioRutaLogic';

const filas = [
  { sku: 'HPC-5K', cargado: 20, entregado: 12, merma: 3, devuelto: 0, restante: 5 },
  { sku: 'HIT-25K', cargado: '6', entregado: '2', merma: '0', devuelto: '0', restante: '4' },
];

describe('balance canónico', () => {
  it('interpreta filas del servidor como números, ordenadas por SKU', () => {
    const b = interpretarBalance(filas);
    expect(b.map(r => r.sku)).toEqual(['HIT-25K', 'HPC-5K']);
    expect(b[0]).toEqual({ sku: 'HIT-25K', cargado: 6, entregado: 2, merma: 0, devuelto: 0, restante: 4 });
    expect(interpretarBalance(null)).toEqual([]);
  });
  it('totales y conteo sugerido = restante del servidor', () => {
    const b = interpretarBalance(filas);
    expect(totalesBalance(b)).toEqual({ cargado: 26, entregado: 14, merma: 3, devuelto: 0, restante: 9 });
    expect(conteoInicial(b)).toEqual({ 'HIT-25K': '4', 'HPC-5K': '5' });
  });
});

describe('conteo físico', () => {
  it('normaliza enteros ≥ 0; vacíos y ceros se omiten; inválidos se rechazan', () => {
    expect(normalizarConteo({ A: '8', B: '0', C: '', ' D ': 2 })).toEqual({ conteo: { A: 8, D: 2 } });
    expect(normalizarConteo({ A: '-1' }).error).toMatch(/inválida/);
    expect(normalizarConteo({ A: '1.5' }).error).toMatch(/inválida/);
    expect(normalizarConteo(null)).toEqual({ conteo: {} });
  });
  it('vista previa de faltante/sobrante contra el balance (incluye SKU no cargado)', () => {
    const b = interpretarBalance(filas);
    expect(diferenciasConteo(b, { 'HPC-5K': '3', 'HIT-25K': '4' })).toEqual({ faltante: { 'HPC-5K': 2 }, sobrante: {} });
    expect(diferenciasConteo(b, { 'HPC-5K': '6', 'HIT-25K': '4', OTRO: '1' })).toEqual({ faltante: {}, sobrante: { 'HPC-5K': 1, OTRO: 1 } });
    expect(diferenciasConteo(b, {})).toEqual({ faltante: { 'HPC-5K': 5, 'HIT-25K': 4 }, sobrante: {} });
  });
});

describe('operaciones con UUID estable', () => {
  const storage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };
  it('lote de mermas: misma lista (otro orden) → misma clave; otra lista → otra', () => {
    const a = [{ sku: 'A', cant: 2, causa: 'x', foto: 'data:1' }, { sku: 'B', cant: 1, causa: 'y' }];
    const b = [{ sku: 'B', cantidad: 1, causa: 'y' }, { sku: 'A', cant: '2', causa: 'x', foto: 'data:1' }];
    expect(claveMermasRuta(7, a)).toBe(claveMermasRuta('7', b));
    expect(claveMermasRuta(7, [...a, { sku: 'A', cant: 1, causa: 'x' }])).not.toBe(claveMermasRuta(7, a));
    expect(claveMermasRuta(7, a)).not.toBe(claveMermasRuta(8, a));
  });
  it('lote: nombres exactos de la RPC; lote vacío y cantidades inválidas rechazados', () => {
    const r = buildMermasRutaArgs({ operacionId: 'u', rutaId: '7', mermas: [{ sku: 'A', cant: 2, causa: 'Bolsa rota', foto: 'data:1' }] });
    expect(Object.keys(r.args).sort()).toEqual(['p_mermas', 'p_operacion_id', 'p_ruta_id']);
    expect(r.args.p_ruta_id).toBe(7);
    expect(r.args.p_mermas).toEqual([{ sku: 'A', cant: 2, causa: 'Bolsa rota', foto: 'data:1' }]);
    expect(buildMermasRutaArgs({ operacionId: 'u', rutaId: 7, mermas: [] }).error).toBeTruthy();
    expect(buildMermasRutaArgs({ operacionId: 'u', rutaId: 7, mermas: [{ sku: 'A', cant: 1.5 }] }).error).toMatch(/inválida/);
    expect(buildMermasRutaArgs({ rutaId: 7, mermas: [{ sku: 'A', cant: 1 }] }).error).toMatch(/operación/);
  });
  it('finalización: el conteo normalizado define la clave; nombres exactos de la RPC', () => {
    expect(claveCierreInventario(7, { B: 2, A: 3 })).toBe(claveCierreInventario('7', { A: 3, B: 2 }));
    expect(claveCierreInventario(7, { A: 3 })).not.toBe(claveCierreInventario(7, { A: 2 }));
    const r = buildFinalizarInventarioArgs({ operacionId: 'u', rutaId: 7, conteo: { A: '3', B: '0' } });
    expect(r.args).toEqual({ p_operacion_id: 'u', p_ruta_id: 7, p_conteo: { A: 3 } });
    expect(buildFinalizarInventarioArgs({ operacionId: 'u', rutaId: 7, conteo: { A: 'x' } }).error).toBeTruthy();
  });
  it('ciclo de vida: mismo UUID tras recarga para la misma operación; se borra solo al confirmar', () => {
    const st = storage();
    const key = claveStorageCierreInventario(7);
    const clave = claveCierreInventario(7, { A: 3 });
    const op = resolverOperacion(leerOperacion(st, key), clave);
    guardarOperacion(st, key, op);
    expect(resolverOperacion(leerOperacion(st, key), clave).id).toBe(op.id);
    expect(resolverOperacion(leerOperacion(st, key), claveCierreInventario(7, { A: 2 })).id).not.toBe(op.id);
    borrarOperacion(st, key);
    expect(leerOperacion(st, key)).toBeNull();
    expect(claveStorageMermasRuta(7)).not.toBe(key);
  });
});

describe('errores y mensajes', () => {
  it('lee el faltante/sobrante estructurado del DETAIL', () => {
    const e = { code: '22023', message: 'finalizar_inventario_ruta: faltante sin merma registrada: {"A": 2}', details: '{"faltante": {"A": 2}}' };
    expect(detalleErrorInventario(e)).toEqual({ faltante: { A: 2 }, sobrante: undefined });
    expect(mensajeErrorInventarioRuta(e)).toMatch(/Faltan 2×A[\s\S]*merma/);
    const s2 = { code: '22023', message: 'finalizar_inventario_ruta: el conteo supera el inventario del camión: {"A": 1}', details: '{"sobrante": {"A": 1}}' };
    expect(mensajeErrorInventarioRuta(s2)).toMatch(/supera/);
    expect(detalleErrorInventario({ details: 'no json' })).toEqual({});
  });
  it('mensajes para cada rechazo del servidor', () => {
    expect(mensajeErrorInventarioRuta({ message: 'finalizar_inventario_ruta: la ruta R-1 no tiene cierre financiero registrado' })).toMatch(/ventas y cobros/);
    expect(mensajeErrorInventarioRuta({ message: 'finalizar_inventario_ruta: la ruta R-1 tiene órdenes pendientes: OV-1' })).toMatch(/órdenes sin resolver/);
    expect(mensajeErrorInventarioRuta({ code: 'P0001', message: 'balance_ruta: SKU X de la ruta R-1 no existe en el catálogo' })).toMatch(/no cuadra/);
    expect(mensajeErrorInventarioRuta({ code: '22023', message: 'registrar_merma: la merma de 9×A supera el inventario del camión (disponible=8)' })).toMatch(/supera/);
    expect(mensajeErrorInventarioRuta({ code: '42501', message: 'x' })).toMatch(/permiso/);
    expect(mensajeErrorInventarioRuta({ message: 'Failed to fetch' })).toMatch(/no se duplicará/);
  });
  it('no-entrega: el producto sigue en el camión', () => {
    expect(mensajeNoEntrega(true)).toMatch(/reagendar[\s\S]*sigue en el camión/);
    expect(mensajeNoEntrega(false)).toMatch(/sigue en el camión/);
  });
});

describe('auditoría estática de pantallas (087)', () => {
  const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  it('ChoferView: cierre por servidor (prepararCierreRuta + finalizarInventarioRuta), sin devolución calculada ni carga autorizada como cargado', () => {
    const c = src('../components/ChoferView.jsx');
    expect(c).toMatch(/actions\.prepararCierreRuta\?\.\(/);
    expect(c).toMatch(/actions\.finalizarInventarioRuta\?\.\(miRutaActiva\?\.id, conteoForm\)/);
    expect(c).not.toMatch(/cerrarRutaCompleta/);
    expect(c).not.toMatch(/devuelto\[sku\] = \(cargaTotal/);
    expect(c).toMatch(/t\[sku\] = \(cargaReal\[sku\] \|\| 0\) - \(entregadoTotal\[sku\] \|\| 0\) - \(mermaTotal\[sku\] \|\| 0\)/);
    expect(c).toMatch(/mensajeNoEntrega\(/);
  });
  it('RutasView: el cierre Admin manda conteo al contrato; la ruta cargada no se cancela', () => {
    const r = src('../components/views/RutasView.jsx');
    expect(r).toMatch(/actions\.cerrarRuta\(cierreModal\.id, cierreConteo\)/);
    expect(r).not.toMatch(/devolucionPorProducto/);
    expect(r).toMatch(/disabled=\{cancelando \|\| !cancelarMotivo\.trim\(\) \|\| cargada\}/);
  });
});
