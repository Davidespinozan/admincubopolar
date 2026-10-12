// t5d2RecuperacionRutas.test.jsx — T5-D2 (mig 142): cierre de ruta por Administración.
// La autoridad vive en la base (suite 142 y concurrencia C142); aquí se prueban la lógica pura
// de la conciliación, lo que muestra el diálogo, que el store cierra con UN contrato (sin
// "forzar" ni marca financiera suelta), la recuperación del chofer, las operaciones sin señal
// que llegan tarde y los avisos de cobros pendientes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MOTIVO_MINIMO, TIPO_CIERRE, modoCierreAdmin, resumenConciliacion, diferenciasDelConteo, faltantesParaServidor, motivoNoCerrar,
  claveCierreAdmin, buildCerrarRutaAdminArgs, buildIniciarRutaAdminArgs, rechazoCierreAdmin, resumenCobrosPendientes, filaCobroPendiente,
} from '../data/conciliacionRutaLogic';
import {
  TIPOS_REVISABLES, registroRevisionOperacion, colasDeOtrasRutas, tituloRevision, leerRevision, agregarRevision, guardarRevision,
  nuevaVentaRapida, payloadCola, CLAVE_REVISION,
} from '../data/ventaRapidaLogic';
import { TIPOS_MUTACION, encolar, claveColaRuta, esFalloDeRed } from '../data/colaOfflineLogic';
import { construirBandeja } from '../data/bandejaLogic';
import { PanelConciliacion } from '../components/CierreRutaAdminModal';
import { AvisoVentasRevision } from '../components/ChoferView';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const accion = (store, nombre) => { const i = store.indexOf(`      ${nombre}: async`); if (i < 0) return null; const j = store.indexOf('\n      },\n', i); return store.slice(i, j); };
const OP = '11111111-1111-4111-8111-111111111111';
const AHORA = new Date('2026-10-12T18:30:00Z');
const MOTIVO = 'El chofer no regresó a cerrar la ruta';
const fakeStorage = (inicial = {}) => {
  const m = new Map(Object.entries(inicial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
};
// Lo que devuelve `conciliacion_ruta` para una ruta En progreso con de todo.
const CRUDO = {
  ruta_id: 7, folio: 'R-007', estatus: 'En progreso', chofer: 'Chofer Uno', carga_confirmada: true, cierre_financiero: false, consistente: true, pendientes: 1,
  inventario: [{ sku: 'HPC-5K', cargado: 20, entregado: 9, merma: 1, devuelto: 0, restante: 10, exceso: 0 }, { sku: 'HPC-25K', cargado: 4, entregado: 0, merma: 0, devuelto: 0, restante: 4, exceso: 0 }],
  ordenes: [
    { id: 1, folio: 'OV-0001', cliente: 'Abarrotes', estatus: 'Entregada', total: 120, metodo_pago: 'Efectivo', cobrado: 120, cxc_saldo: null, lineas: [] },
    { id: 2, folio: 'OV-0002', cliente: 'Tienda', estatus: 'Entregada', total: 90, metodo_pago: 'Crédito', cobrado: 0, cxc_saldo: 90, lineas: [] },
    { id: 3, folio: 'OV-0003', cliente: 'Bar', estatus: 'Entregada', total: 60, metodo_pago: 'QR / Link de pago', cobrado: 0, cxc_saldo: null, lineas: [] },
    { id: 4, folio: 'OV-0004', cliente: 'Fonda', estatus: 'No entregada', total: 30, metodo_pago: 'Efectivo', cobrado: 0, cxc_saldo: null, lineas: [] },
    { id: 5, folio: 'OV-0005', cliente: 'Kiosco', estatus: 'Asignada', total: 30, metodo_pago: 'Efectivo', cobrado: 0, cxc_saldo: null, lineas: [] },
  ],
  revertidas: [{ orden_id: 9, folio: 'OV-0009', motivo: 'error' }],
  cobros_por_metodo: [{ metodo: 'Efectivo', pagos: 2, monto: 180 }, { metodo: 'Tarjeta', pagos: 1, monto: 31 }],
  credito: { cuentas: 1, monto: 90, saldo: 90 },
  cobros_pendientes: [{ orden_id: 3, folio: 'OV-0003', cliente: 'Bar', ruta_id: 7, ruta_folio: 'R-007', ruta_estatus: 'En progreso', metodo: 'QR / Link de pago', total: 60, cobrado: 0, falta: 60, tipo: 'link' }],
  mermas: [{ id: 5, sku: 'HPC-5K', cantidad: 1, causa: 'Bolsa rota', con_foto: true, faltante: false, motivo: null, actor: null }],
  ventas_rapidas: { ventas: 1, total: 60 }, cierre_caja: null, intervenciones: [],
};
const conc = (extra = {}) => resumenConciliacion({ ...CRUDO, ...extra });
const SIN_PEND = { ordenes: CRUDO.ordenes.filter(o => o.estatus !== 'Asignada'), pendientes: 0 };

describe('qué puede hacer Administración según el estado', () => {
  it('En progreso: cerrar; Cargada con carga: elegir; lo demás: nada', () => {
    expect(modoCierreAdmin({ estatus: 'En progreso', carga_confirmada_at: '2026-10-12' })).toBe('cerrar');
    expect(modoCierreAdmin({ estatus: 'Cargada', cargaConfirmadaAt: '2026-10-12' })).toBe('cargada');
    for (const estatus of ['Programada', 'Pendiente firma', 'Cerrada', 'Cancelada', 'Completada', '']) expect(modoCierreAdmin({ estatus, carga_confirmada_at: 'x' })).toBeNull();
    expect(modoCierreAdmin({ estatus: 'Cargada' })).toBeNull();
  });
  it('la pantalla de rutas ofrece el cierre también con el camión cargado sin iniciar', () => {
    const v = leer('../components/views/RutasView.jsx');
    expect(v).toMatch(/\{modoCierreAdmin\(r\) && \(\s*<button onClick=\{\(e\) => \{ e\.currentTarget\.closest\('details'\)\.open = false; abrirCierre\(r\); \}\}/);
  });
});

describe('conciliación: solo lo que el servidor sabe', () => {
  const r = conc();
  it('separa entregadas, no entregadas, sin resolver y revertidas', () => {
    expect([r.entregadas.length, r.noEntregadas.length, r.pendientes.length, r.revertidas.length]).toEqual([3, 1, 1, 1]);
    expect(r.pendientes[0]).toMatchObject({ folio: 'OV-0005', estatus: 'Asignada' });
  });
  it('dinero por forma de pago REGISTRADA, crédito aparte y efectivo sin conciliar', () => {
    expect(r.cobros).toEqual([{ metodo: 'Efectivo', pagos: 2, monto: 180 }, { metodo: 'Tarjeta', pagos: 1, monto: 31 }]);
    expect([r.cobradoTotal, r.efectivo]).toEqual([211, 180]);
    expect(r.credito).toEqual({ cuentas: 1, monto: 90, saldo: 90 });
    expect(r.cierreCaja).toBeNull();
  });
  it('un link pendiente NO es cobro ni crédito: va en su propia lista', () => {
    expect(r.links).toHaveLength(1);
    expect(r.links[0]).toMatchObject({ folio: 'OV-0003', tipo: 'link', falta: 60, cobrado: 0 });
    expect(r.sinRegistro).toHaveLength(0);
    expect(r.cobradoTotal).toBe(211);
  });
  it('mermas justificadas y faltantes no justificados nunca se mezclan', () => {
    const x = conc({ mermas: [...CRUDO.mermas, { id: 6, sku: 'HPC-5K', cantidad: 2, causa: 'FALTANTE NO JUSTIFICADO — x', con_foto: false, faltante: true, motivo: 'no contó', actor: 'Admin' }] });
    expect(x.mermas.map(m => m.id)).toEqual([5]);
    expect(x.faltantes).toEqual([{ id: 6, sku: 'HPC-5K', cantidad: 2, causa: 'FALTANTE NO JUSTIFICADO — x', conFoto: false, faltante: true, motivo: 'no contó', actor: 'Admin' }]);
    // Aunque la causa DIGA faltante, sin la marca estructural es una merma ordinaria.
    expect(conc({ mermas: [{ id: 7, sku: 'HPC-5K', cantidad: 1, causa: 'FALTANTE NO JUSTIFICADO — texto', faltante: false }] }).faltantes).toHaveLength(0);
  });
  it('respuesta vacía o incompleta no inventa datos', () => {
    const v = resumenConciliacion({});
    expect(v).toMatchObject({ inventario: [], ordenes: [], cobros: [], links: [], sinRegistro: [], mermas: [], faltantes: [], cobradoTotal: 0, cierreCaja: null });
    expect(resumenConciliacion(null).estatus).toBe('');
  });
  it('cierre de caja registrado se muestra como tal', () => {
    expect(conc({ cierre_caja: { esperado_efectivo: 180, contado_efectivo: 170, diferencia: -10, motivo_diferencia: 'cambio', cerrado_por: 'Admin' } }).cierreCaja)
      .toEqual({ esperadoEfectivo: 180, contadoEfectivo: 170, diferencia: -10, motivo: 'cambio', cerradoPor: 'Admin' });
  });
});

describe('conteo y faltantes', () => {
  const inv = conc().inventario;
  it('faltante y sobrante por producto; lo no contado cuenta como 0', () => {
    expect(diferenciasDelConteo(inv, { 'HPC-5K': '8', 'HPC-25K': '4' })).toEqual({ faltante: { 'HPC-5K': 2 }, sobrante: {} });
    expect(diferenciasDelConteo(inv, { 'HPC-5K': '11', 'HPC-25K': '4' })).toEqual({ faltante: {}, sobrante: { 'HPC-5K': 1 } });
    expect(diferenciasDelConteo(inv, {})).toEqual({ faltante: { 'HPC-5K': 10, 'HPC-25K': 4 }, sobrante: {} });
  });
  it('el faltante viaja como lista ordenada [{sku, cantidad}]', () => {
    expect(faltantesParaServidor({ 'HPC-5K': 2, 'HPC-25K': 1, X: 0 })).toEqual([{ sku: 'HPC-25K', cantidad: 1 }, { sku: 'HPC-5K', cantidad: 2 }]);
    expect(faltantesParaServidor({})).toEqual([]);
  });
});

describe('qué impide cerrar (antes de preguntar al servidor)', () => {
  const ok = { 'HPC-5K': '10', 'HPC-25K': '4' };
  const base = (extra = {}, args = {}) => motivoNoCerrar({ resumen: conc({ ...SIN_PEND, ...extra }), tipo: TIPO_CIERRE.ADMIN, conteo: ok, motivo: MOTIVO, faltanteReconocido: false, ...args });
  it('todo en orden: se puede intentar', () => { expect(base()).toBeNull(); });
  it('órdenes sin resolver: bloquea', () => { expect(motivoNoCerrar({ resumen: conc(), tipo: TIPO_CIERRE.ADMIN, conteo: ok, motivo: MOTIVO })).toMatch(/1 orden sin resolver/); });
  it('entrega sin registro financiero: bloquea', () => {
    expect(base({ cobros_pendientes: [{ orden_id: 8, folio: 'OV-0008', tipo: 'sin_registro', falta: 30, total: 30, cobrado: 0 }] })).toMatch(/1 entrega sin cobro ni cuenta por cobrar/);
  });
  it('un link pendiente NO bloquea', () => { expect(conc(SIN_PEND).links).toHaveLength(1); expect(base()).toBeNull(); });
  it('sobrante: recontar; faltante: declararlo o registrarlo como merma', () => {
    expect(base({}, { conteo: { 'HPC-5K': '11', 'HPC-25K': '4' } })).toMatch(/supera lo que debe regresar/);
    expect(base({}, { conteo: { 'HPC-5K': '8', 'HPC-25K': '4' } })).toMatch(/faltante no justificado/);
    expect(base({}, { conteo: { 'HPC-5K': '8', 'HPC-25K': '4' }, faltanteReconocido: true })).toBeNull();
  });
  it('motivo obligatorio de al menos 10 letras', () => {
    expect(MOTIVO_MINIMO).toBe(10);
    expect(base({}, { motivo: '   corto ' })).toMatch(/motivo de la intervención/);
    expect(base({}, { motivo: '' })).toMatch(/motivo de la intervención/);
  });
  it('inventario inconsistente o conciliación sin cargar: no se cierra', () => {
    expect(base({ consistente: false })).toMatch(/no cuadra/);
    expect(motivoNoCerrar({ resumen: null })).toMatch(/Cargando/);
  });
  it('"el camión no salió": las órdenes sin resolver NO bloquean (se liberan), pero cualquier operación sí', () => {
    const cargada = { estatus: 'Cargada', ordenes: CRUDO.ordenes.filter(o => o.estatus === 'Asignada'), cobros_pendientes: [], mermas: [], ventas_rapidas: { ventas: 0, total: 0 },
      inventario: [{ sku: 'HPC-5K', cargado: 20, entregado: 0, merma: 0, devuelto: 0, restante: 20, exceso: 0 }] };
    const args = { tipo: TIPO_CIERRE.NO_SALIO, conteo: { 'HPC-5K': '20' }, motivo: MOTIVO };
    expect(motivoNoCerrar({ resumen: conc(cargada), ...args })).toBeNull();
    expect(motivoNoCerrar({ resumen: conc({ ...cargada, ventas_rapidas: { ventas: 1, total: 60 } }), ...args })).toMatch(/el camión sí salió/);
    expect(motivoNoCerrar({ resumen: conc({ ...cargada, ordenes: CRUDO.ordenes }), ...args })).toMatch(/el camión sí salió/);
    expect(motivoNoCerrar({ resumen: conc({ ...cargada, mermas: CRUDO.mermas }), ...args })).toMatch(/el camión sí salió/);
  });
});

describe('argumentos de los contratos', () => {
  it('cerrar_ruta_admin: operación, ruta, tipo, conteo limpio, faltantes y motivo; SIN actor', () => {
    const b = buildCerrarRutaAdminArgs({ operacionId: OP, rutaId: '7', tipo: 'cierre_admin', conteo: { 'HPC-5K': '8', 'HPC-25K': '0', '': '3' }, faltantes: [{ sku: 'HPC-5K', cantidad: 2 }], motivo: `  ${MOTIVO} ` });
    expect(b.args).toEqual({ p_operacion_id: OP, p_ruta_id: 7, p_tipo: 'cierre_admin', p_conteo: { 'HPC-5K': 8 }, p_faltantes: [{ sku: 'HPC-5K', cantidad: 2 }], p_motivo: MOTIVO });
    expect(Object.keys(b.args).some(k => /usuario|actor|admin/i.test(k))).toBe(false);
  });
  it('sin faltantes manda null; "no salió" es un tipo válido; no existe "forzar"', () => {
    expect(buildCerrarRutaAdminArgs({ operacionId: OP, rutaId: 7, tipo: 'no_salio', conteo: { A: 10 }, faltantes: [], motivo: MOTIVO }).args).toMatchObject({ p_tipo: 'no_salio', p_faltantes: null });
    expect(buildCerrarRutaAdminArgs({ operacionId: OP, rutaId: 7, tipo: 'forzar', conteo: {}, motivo: MOTIVO }).error).toMatch(/Tipo de cierre inválido/);
  });
  it('rechaza sin operación, sin ruta, conteo o faltante inválido, o sin motivo', () => {
    const b = { operacionId: OP, rutaId: 7, tipo: 'cierre_admin', conteo: { A: 1 }, motivo: MOTIVO };
    expect(buildCerrarRutaAdminArgs({ ...b, operacionId: '' }).error).toBeTruthy();
    expect(buildCerrarRutaAdminArgs({ ...b, rutaId: null }).error).toBeTruthy();
    for (const v of ['-1', '1.5', 'x']) expect(buildCerrarRutaAdminArgs({ ...b, conteo: { A: v } }).error).toMatch(/enteras/);
    for (const f of [{ sku: '', cantidad: 1 }, { sku: 'A', cantidad: 0 }, { sku: 'A', cantidad: 1.5 }]) expect(buildCerrarRutaAdminArgs({ ...b, faltantes: [f] }).error).toMatch(/faltante/);
    expect(buildCerrarRutaAdminArgs({ ...b, motivo: 'corto' }).error).toMatch(/motivo/);
  });
  it('la clave de reintento no depende del orden ni de los espacios, y cambia con cualquier dato', () => {
    const a = claveCierreAdmin({ rutaId: 7, tipo: 'cierre_admin', conteo: { B: '4', A: '8' }, faltantes: [{ sku: 'B', cantidad: 1 }, { sku: 'A', cantidad: 2 }], motivo: ` ${MOTIVO} ` });
    const b = claveCierreAdmin({ rutaId: '7', tipo: 'cierre_admin', conteo: { A: 8, B: 4, C: 0 }, faltantes: [{ sku: 'A', cantidad: 2 }, { sku: 'B', cantidad: 1 }], motivo: MOTIVO });
    expect(a).toBe(b);
    expect(claveCierreAdmin({ rutaId: 7, tipo: 'cierre_admin', conteo: { A: 9, B: 4 }, faltantes: [], motivo: MOTIVO })).not.toBe(a);
    expect(claveCierreAdmin({ rutaId: 7, tipo: 'no_salio', conteo: { B: 4, A: 8 }, faltantes: [{ sku: 'A', cantidad: 2 }, { sku: 'B', cantidad: 1 }], motivo: MOTIVO })).not.toBe(a);
  });
  it('iniciar_ruta_admin: motivo obligatorio', () => {
    expect(buildIniciarRutaAdminArgs({ operacionId: OP, rutaId: 7, motivo: 'El chofer salió sin iniciar' }).args).toEqual({ p_operacion_id: OP, p_ruta_id: 7, p_motivo: 'El chofer salió sin iniciar' });
    expect(buildIniciarRutaAdminArgs({ operacionId: OP, rutaId: 7, motivo: 'no' }).error).toMatch(/motivo/);
  });
});

describe('rechazos del servidor', () => {
  it('los códigos que cambian el estado piden recargar la conciliación', () => {
    for (const codigo of ['ORDENES_PENDIENTES', 'ENTREGAS_SIN_REGISTRO', 'FALTANTE_NO_COINCIDE', 'RUTA_YA_CERRADA', 'ESTADO_NO_VALIDO', 'NO_SALIO_CON_OPERACIONES']) {
      expect(rechazoCierreAdmin({ message: 'cerrar_ruta_admin: texto del servidor', details: JSON.stringify({ codigo }) })).toMatchObject({ codigo, cambio: true, mensaje: 'texto del servidor' });
    }
  });
  it('conteo de más (venta, entrega o merma mientras contaba): explica y recarga', () => {
    const r = rechazoCierreAdmin({ message: 'finalizar_inventario_ruta: el conteo supera el inventario del camión: {"A": 1}', details: '{"sobrante":{"A":1}}' });
    expect(r).toMatchObject({ codigo: 'CONTEO_SOBRANTE', cambio: true });
    expect(r.mensaje).toMatch(/No se cerró nada/);
  });
  it('red: no es un rechazo, se reintenta sin duplicar; permisos y operación repetida', () => {
    expect(rechazoCierreAdmin({ message: 'TypeError: Failed to fetch' })).toMatchObject({ codigo: 'RED', cambio: false });
    expect(rechazoCierreAdmin({ code: '42501', message: 'cerrar_ruta_admin: no autorizado' }).codigo).toBe('NO_AUTORIZADO');
    expect(rechazoCierreAdmin({ message: 'cerrar_ruta_admin: operacion_id ya usado con otros datos' })).toMatchObject({ codigo: 'OPERACION_REPETIDA', cambio: true });
  });
});

describe('diálogo: lo que Administración ve antes de cerrar', () => {
  const html = renderToStaticMarkup(<PanelConciliacion r={conc()} nombreDe={(sku) => `Hielo ${sku}`} />);
  it('estado, chofer, órdenes, ventas rápidas y cierre financiero', () => {
    for (const t of ['En progreso', 'Chofer Uno', 'Entregadas:', 'No entregadas:', 'Sin resolver:', 'Entregas revertidas:', 'Ventas rápidas:', 'sin registrar']) expect(html).toContain(t);
  });
  it('cobrado por método, crédito y efectivo SIN conciliar (cerrar no cuenta el dinero)', () => {
    for (const t of ['Efectivo', '2 pagos', '$180', 'Tarjeta', 'Total cobrado', '$211', '1 cuenta por cobrar', '$90 por cobrar', 'El efectivo todavía NO está conciliado']) expect(html).toContain(t);
  });
  it('links pendientes a la vista, sin llamarlos pagados', () => {
    for (const t of ['Links de pago pendientes (1)', 'OV-0003', '$60', 'NO están pagadas ni fiadas', 'No impiden cerrar la ruta']) expect(html).toContain(t);
  });
  it('merma con su causa; faltante marcado como FALTANTE NO JUSTIFICADO', () => {
    expect(html).toContain('Bolsa rota');
    expect(html).not.toContain('FALTANTE NO JUSTIFICADO');
    const con = renderToStaticMarkup(<PanelConciliacion r={conc({ mermas: [{ id: 6, sku: 'HPC-5K', cantidad: 2, causa: 'x', faltante: true, motivo: 'El chofer no contó' }] })} />);
    for (const t of ['FALTANTE NO JUSTIFICADO', '2× HPC-5K', 'El chofer no contó']) expect(con).toContain(t);
  });
  it('sin conciliación no pinta nada', () => { expect(renderToStaticMarkup(<PanelConciliacion r={null} />)).toBe(''); });
  const dlg = sinComentarios(leer('../components/CierreRutaAdminModal.jsx'));
  it('cada orden se resuelve con SU contrato y una a la vez; nada automático', () => {
    expect(dlg).toMatch(/await actions\.marcarNoEntregada\?\.\(accion\.orden\.id, accion\.motivo, false, \{ operacionId: accion\.operacionId \}\)/);
    expect(dlg).toMatch(/await actions\.entregarOrdenRuta\?\.\(accion\.orden\.id, accion\.metodo, \{ operacionId: accion\.operacionId \}\)/);
    expect(dlg).not.toMatch(/pendientes\.map\([^)]*=>\s*actions\./);
    expect(dlg).not.toMatch(/supabase|\.from\(|forzar/);
  });
  it('faltante: merma con causa comprobada O faltante no justificado reconocido expresamente', () => {
    expect(dlg).toMatch(/await actions\.registrarMermasRuta\?\.\(ruta\.id, items\)/);
    expect(dlg).toMatch(/faltantes: reconoce \? faltantesParaServidor\(dif\.faltante\) : \[\]/);
    expect(dlg).toMatch(/FALTANTE NO JUSTIFICADO/);
    expect(dlg).toMatch(/setConteo\(c => \(\{ \.\.\.c, \[b\.sku\]: e\.target\.value \}\)\); setReconoce\(false\)/);     // cambiar el conteo anula el reconocimiento
  });
  it('camión cargado: Administración elige qué pasó; "salió" registra la salida con motivo', () => {
    expect(dlg).toMatch(/El camión NO salió/);
    expect(dlg).toMatch(/El camión SÍ salió/);
    expect(dlg).toMatch(/await actions\.iniciarRutaAdmin\?\.\(ruta\.id, motivo\)/);
  });
  it('si el servidor dice que el estado cambió, recarga y pide confirmar de nuevo', () => {
    expect(dlg).toMatch(/if \(res\?\.cambio\) \{ setReconoce\(false\); conteoTocado\.current = false; await cargar\(\); \}/);
    expect(dlg).toMatch(/pregúntale antes de cerrar/);
  });
});

describe('store: un contrato, sin forzar, sin marca financiera suelta', () => {
  const store = leer('../data/supaStore.js');
  const adm = accion(store, 'cerrarRuta');
  it('cerrarRuta es UNA llamada a cerrar_ruta_admin, solo Admin', () => {
    expect(adm).toMatch(/requireRol\(\['Admin'\]\)/);
    expect(adm).toMatch(/supabase\.rpc\('cerrar_ruta_admin', built\.args\)/);
    expect((adm.match(/supabase\.rpc\(/g) || []).length).toBe(1);
  });
  it('ya no sella un cierre financiero vacío, ni escribe órdenes por REST, ni existe "forzar"', () => {
    expect(adm).not.toMatch(/cerrar_ruta_financiero|finalizarInventarioRuta|from\('ordenes'\)|from\('rutas'\)/);
    expect(sinComentarios(adm)).not.toMatch(/forzar/i);
    expect(store).not.toMatch(/Cierre forzado por admin|opciones\?\.forzar/);
  });
  it('la operación se conserva para el reintento y se borra al cerrar', () => {
    expect(adm).toMatch(/resolverOperacionCierre\(leerOperacion\(storage, key\), claveCierreAdmin\(\{ rutaId, \.\.\.params \}\)\)/);
    expect(adm.indexOf('borrarOperacion(storage, key)')).toBeGreaterThan(adm.indexOf("supabase.rpc('cerrar_ruta_admin'"));
  });
  it('inicio de Administración, conciliación y cobros pendientes van por sus contratos', () => {
    expect(accion(store, 'iniciarRutaAdmin')).toMatch(/requireRol\(\['Admin'\]\)[\s\S]*supabase\.rpc\('iniciar_ruta_admin', built\.args\)/);
    expect(accion(store, 'conciliacionRuta')).toMatch(/requireRol\(\['Admin'\]\)[\s\S]*supabase\.rpc\('conciliacion_ruta'/);
    expect(accion(store, 'rutaCobrosPendientes')).toMatch(/supabase\.rpc\('ruta_cobros_pendientes'/);
  });
});

describe('chofer: una marca financiera ajena ya no lo deja sin cerrar (defecto A)', () => {
  const prep = accion(leer('../data/supaStore.js'), 'prepararCierreRuta');
  it('ante "ya tiene cierre financiero con otros datos" pregunta al servidor qué falta', () => {
    expect(prep).toMatch(/if \(!\/ya tiene cierre financiero registrado con otros datos\/i\.test\(finErr\.message \|\| ''\)\) return \{ error: mensajeErrorCierreFinanciero\(finErr\) \};/);
    expect(prep).toMatch(/const pend = await actionsRef\.current\.rutaCobrosPendientes\(rutaId\);/);
  });
  it('no la da por buena a ciegas: con entregas sin registro se detiene y dice cuáles', () => {
    expect(prep).toMatch(/const sinRegistro = \(pend\.data \|\| \[\]\)\.filter\(x => x\?\.tipo === 'sin_registro'\);/);
    expect(prep).toMatch(/if \(sinRegistro\.length > 0\) \{\s*return \{ error:/);
    expect(prep).toMatch(/if \(pend\.error\) return \{ error: mensajeErrorCierreFinanciero\(finErr\) \};/);      // sin diagnóstico no continúa
  });
  it('sin nada pendiente continúa al balance reutilizando la marca (sin volver a registrar dinero)', () => {
    expect(prep.indexOf('marcaAjena = true;')).toBeLessThan(prep.indexOf('actionsRef.current.obtenerBalanceRuta(rutaId)'));
    expect(prep).toMatch(/const finRes = marcaAjena \? \{ replay: true, saltadas: \[\] \} : interpretarCierreFinanciero\(finData\);/);
    expect((prep.match(/rpc\('cerrar_ruta_financiero'/g) || []).length).toBe(1);
  });
});

describe('operaciones sin señal que llegan tarde (D2-4)', () => {
  const entrega = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 55, metodoPago: 'Efectivo', folioNota: 'N-9', folio: 'OV-0055', cliente: 'Abarrotes', total: 120, rutaId: 7, rutaFolio: 'R-007' }, 1760000000000)[0];
  const noEntrega = encolar([], TIPOS_MUTACION.NO_ENTREGA, { ordenId: 56, motivo: 'Cliente cerrado', reagendar: true }, 1760000000000)[0];
  it('entrega tardía: se conserva con tipo, orden, identificador, fecha de captura y los datos disponibles', () => {
    const r = registroRevisionOperacion(entrega, 7, 'La orden OV-0055 está No entregada y no se puede entregar', AHORA);
    expect(r).toMatchObject({ tipo: 'entrega', ordenId: 55, folio: 'OV-0055', cliente: 'Abarrotes', total: 120, pago: 'Efectivo', folioNota: 'N-9', rutaId: 7, rutaFolio: 'R-007',
      capturadaAt: new Date(1760000000000).toISOString(), motivo: 'La orden OV-0055 está No entregada y no se puede entregar', rechazadaAt: AHORA.toISOString() });
    expect(r.operacionId).toBe(entrega.payload.operacionId);
    expect(tituloRevision(r)).toBe('Entrega de la orden OV-0055');
  });
  it('no entrega tardía: conserva su motivo; sin folio se identifica por la orden', () => {
    const r = registroRevisionOperacion(noEntrega, 7, 'no se puede marcar desde Entregada', AHORA);
    expect(r).toMatchObject({ tipo: 'no_entrega', ordenId: 56, motivoNoEntrega: 'Cliente cerrado', reagendar: true, total: null, pago: null, rutaId: 7 });
    expect(tituloRevision(r)).toBe('No entrega de la orden #56');
  });
  it('una venta rápida sigue siendo venta rápida (no se confunde con una entrega)', () => {
    const v = nuevaVentaRapida({ operacionId: OP, rutaId: 7, items: [{ sku: 'HPC-5K', cant: 3, precio: 31 }], pago: 'Efectivo', ahora: AHORA });
    const m = encolar([], TIPOS_MUTACION.VENTA_RAPIDA, payloadCola(v), 1000)[0];
    const r = registroRevisionOperacion(m, 7, 'La ruta ya está cerrada', AHORA);
    expect(r).toMatchObject({ tipo: 'venta_rapida', operacionId: OP, total: 93, items: [{ sku: 'HPC-5K', cant: 3, precio: 31 }] });
    expect(tituloRevision(r)).toBe('Venta rápida');
    expect(tituloRevision({})).toBe('Venta rápida');          // registros de T5-D1 (sin tipo)
    expect(TIPOS_REVISABLES).toEqual(['venta_rapida', 'entrega', 'no_entrega']);
  });
  it('las tres clases se encuentran en la cola de una ruta que ya no es la activa; las mermas no', () => {
    let cola = encolar([], TIPOS_MUTACION.ENTREGA, entrega.payload, 1);
    cola = encolar(cola, TIPOS_MUTACION.NO_ENTREGA, noEntrega.payload, 2);
    cola = encolar(cola, TIPOS_MUTACION.MERMA, { sku: 'A', cant: 1 }, 3);
    const st = fakeStorage({ [claveColaRuta(7)]: JSON.stringify(cola), [claveColaRuta(8)]: JSON.stringify(encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1 }, 4)) });
    const otras = colasDeOtrasRutas(st, 8);
    expect(otras).toHaveLength(1);
    expect(otras[0].operaciones.map(m => m.tipo)).toEqual(['entrega', 'no_entrega']);
    expect(otras[0].cola).toHaveLength(3);
    expect(colasDeOtrasRutas(st, null)).toHaveLength(2);
  });
  it('se guardan en el mismo almacén durable, sin duplicarse, junto a las ventas', () => {
    const st = fakeStorage();
    const a = registroRevisionOperacion(entrega, 7, 'rechazada', AHORA); const b = registroRevisionOperacion(noEntrega, 7, 'rechazada', AHORA);
    let lista = agregarRevision(leerRevision(st), a); lista = agregarRevision(lista, b); lista = agregarRevision(lista, a);
    expect(guardarRevision(st, lista)).toBe(true);
    expect(leerRevision(st).map(x => x.tipo)).toEqual(['entrega', 'no_entrega']);
    expect(JSON.parse(st.getItem(CLAVE_REVISION))).toHaveLength(2);
  });
  it('un fallo de RED no es un rechazo: la operación no pasa a revisión ni sale de la cola', () => {
    expect(esFalloDeRed({ error: 'TypeError: Failed to fetch' }, true)).toBe(true);
    expect(esFalloDeRed({ error: 'La orden OV-0055 está No entregada y no se puede entregar' }, true)).toBe(false);
    expect(esFalloDeRed({ error: 'cualquier cosa' }, false)).toBe(true);        // sin señal: nunca se toma como rechazo
    const v = sinComentarios(leer('../components/ChoferView.jsx'));
    const i = v.indexOf('const enviarVentasDeOtrasRutas');
    const bloque = v.slice(i, i + 3200);
    expect(bloque).toMatch(/if \(err\) \{ if \(esFalloDeRed\(err, enLinea\(\)\)\) red = true; else fallo =/);
    expect(bloque).toMatch(/if \(r && r\.error\) \{ if \(esFalloDeRed\(r, enLinea\(\)\)\) red = true; else fallo =/);
    expect(bloque.indexOf('if (red) return;')).toBeLessThan(bloque.indexOf('registroRevisionOperacion(m, q.rutaId, fallo)'));
    expect(bloque.indexOf('if (!guardarRevision(storage, lista)) return;')).toBeLessThan(bloque.indexOf('cola = cola.filter(x => x.id !== m.id);'));
  });
  it('el aviso del chofer distingue cada operación y no ofrece borrarla', () => {
    const html = renderToStaticMarkup(<AvisoVentasRevision ventas={[
      registroRevisionOperacion(entrega, 7, 'La orden OV-0055 está No entregada y no se puede entregar', AHORA),
      registroRevisionOperacion(noEntrega, 7, 'no se puede marcar desde Entregada', AHORA),
    ]} />);
    for (const t of ['Requiere revisión administrativa', 'Estas 2 operaciones NO quedaron registradas', 'Entrega de la orden OV-0055', '$120', 'Efectivo', 'Abarrotes', 'Ruta R-007',
      'No entrega de la orden #56', 'Motivo de la no entrega: Cliente cerrado', 'Motivo: no se puede marcar desde Entregada', `Identificador: ${entrega.payload.operacionId}`]) expect(html).toContain(t);
    expect(html).toContain('data-tipo="entrega"');
    expect(html).toContain('data-tipo="no_entrega"');
    expect(html).not.toMatch(/<button/);
  });
  it('la entrega sin señal guarda folio, cliente, importe y ruta para poder mostrarla después', () => {
    const v = leer('../components/ChoferView.jsx');
    expect(v).toMatch(/folio: s\(entregaModal\.folio\), cliente: s\(entregaModal\.clienteNombre\), total: n\(entregaModal\.totalCalc\),\s*rutaId: miRutaActiva\?\.id \?\? null, rutaFolio: s\(miRutaActiva\?\.folio\),/);
  });
});

describe('avisos de Administración: cobros de ruta pendientes', () => {
  const lista = [
    { orden_id: 3, folio: 'OV-0003', tipo: 'link', falta: 60, ruta_estatus: 'Cerrada' },
    { orden_id: 4, folio: 'OV-0004', tipo: 'link', falta: 30, ruta_estatus: 'En progreso' },
    { orden_id: 5, folio: 'OV-0005', tipo: 'sin_registro', falta: 120, ruta_estatus: 'En progreso' },
  ];
  it('resumen: links y entregas sin registro por separado, con sus importes', () => {
    const r = resumenCobrosPendientes(lista);
    expect([r.links.length, r.sinRegistro.length, r.montoLinks, r.montoSinRegistro]).toEqual([2, 1, 90, 120]);
    expect(r.links[0].rutaCerrada).toBe(true);
    expect(filaCobroPendiente({ tipo: 'otro' }).tipo).toBe('sin_registro');
  });
  it('la bandeja avisa de ambos; el link sigue avisando aunque su ruta ya esté cerrada', () => {
    const tareas = construirBandeja({ cobrosPendientesRuta: lista }, '2026-10-12');
    const links = tareas.find(t => t.id === 'links-pago-pendientes'); const sin = tareas.find(t => t.id === 'entregas-sin-registro');
    expect(links).toMatchObject({ prioridad: 'media', count: 2, modulo: 'ordenes' });
    expect(links.titulo).toMatch(/2 links de pago pendientes.*\$90/);
    expect(links.detalle).toMatch(/NO están pagadas ni fiadas/);
    expect(sin).toMatchObject({ prioridad: 'alta', count: 1 });
    expect(sin.titulo).toMatch(/1 entrega de ruta sin cobro ni cuenta.*\$120/);
  });
  it('sin pendientes no hay aviso (desaparece solo cuando el servidor deja de reportarlo)', () => {
    const ids = (d) => construirBandeja(d, '2026-10-12').map(t => t.id);
    expect(ids({ cobrosPendientesRuta: [] })).not.toContain('links-pago-pendientes');
    expect(ids({})).not.toContain('entregas-sin-registro');
    expect(ids({ cobrosPendientesRuta: [lista[2]] })).toEqual(expect.arrayContaining(['entregas-sin-registro']));
    expect(ids({ cobrosPendientesRuta: [lista[2]] })).not.toContain('links-pago-pendientes');
  });
  it('el aviso se lee del servidor en cada recarga, solo para Administración', () => {
    const store = leer('../data/supaStore.js');
    expect(store).toMatch(/const fetchCobrosPendientes = useCallback\(async \(\) => \{\s*if \(userRolRef\.current !== 'Admin'\) return;/);
    expect(store).toMatch(/supabase\.rpc\('ruta_cobros_pendientes', \{ p_ruta_id: null \}\)/);
    expect(store).toMatch(/fetchActividades\(\), fetchCobrosPendientes\(\)\]\);/);
  });
});
