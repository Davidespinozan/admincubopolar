// t5d1VentaRapida.test.jsx — T5-D1 (mig 141): la venta rápida se registra en el servidor al
// capturarla. La autoridad vive en la base (suite 141 y concurrencia C141); aquí se prueban la
// lógica pura del teléfono (pendiente / registrada / revisión), la cola sin señal, lo que se
// manda al cierre, lo que muestran las pantallas y que el borrado indiscriminado ya no existe.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  METODOS_VENTA_RAPIDA, CLAVE_REVISION, ESTADO_VENTA, puedeGuardarseSinSenal, nuevaVentaRapida, buildVentaRapidaArgs, payloadCola,
  clasificarFalloVenta, confirmarVentaLocal, quitarVentaLocal, ventasSinConfirmar, entregasParaCierre, adoptarVentasAnteriores,
  etiquetaEstadoVenta, registroRevision, leerRevision, agregarRevision, guardarRevision, colasConVentasDeOtrasRutas,
  filaVentaRapidaAdmin, resumenVentasRapidas,
} from '../data/ventaRapidaLogic';
import { TIPOS_MUTACION, encolar, parseCola, quitar, marcarIntento, mutacionesPendientes, mutacionesFallidas, descripcionMutacion, claveColaRuta, MAX_INTENTOS } from '../data/colaOfflineLogic';
import { normalizarEntregasCierre, claveCierreFinanciero } from '../data/cierreFinancieroLogic';
import { motivoNoFiar } from '../data/recuperacionRutaLogic';
import { AvisoVentasRevision } from '../components/ChoferView';
import { ListaVentasRapidas } from '../components/VentasRapidasRuta';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const OP = '11111111-1111-4111-8111-111111111111';
const OP2 = '22222222-2222-4222-8222-222222222222';
const AHORA = new Date('2026-10-11T18:30:00Z');
const venta = (extra = {}) => nuevaVentaRapida({ operacionId: OP, rutaId: 7, rutaFolio: 'R-007', clienteId: null, cliente: '', items: [{ sku: 'HPC-5K', cant: 3, precio: 31 }], pago: 'Efectivo', factura: false, ahora: AHORA, ...extra });
// localStorage mínimo (con `length` y `key`, como el real).
const fakeStorage = (inicial = {}) => {
  const m = new Map(Object.entries(inicial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, key: i => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m };
};

describe('la venta en el teléfono', () => {
  it('nace PENDIENTE, con identificador, ruta, productos, importe, método y hora de captura', () => {
    const v = venta();
    expect(v).toMatchObject({ operacionId: OP, id: `vr-${OP}`, rutaId: 7, rutaFolio: 'R-007', total: 93, subtotal: 93, iva: 0, pago: 'Efectivo', cliente: 'Público en general',
      express: true, estado: ESTADO_VENTA.PENDIENTE, capturadaAt: '2026-10-11T18:30:00.000Z', items: [{ sku: 'HPC-5K', cant: 3, precio: 31 }] });
    expect(v.ordenId).toBeUndefined();
    expect(etiquetaEstadoVenta(v)).toMatch(/Solo en este teléfono/);
  });
  it('no habilita modalidades nuevas: efectivo, transferencia, tarjeta y crédito; sin link', () => {
    expect(METODOS_VENTA_RAPIDA).toEqual(['Efectivo', 'Transferencia', 'Tarjeta', 'Crédito']);
    expect(buildVentaRapidaArgs(venta({ pago: 'QR / Link de pago' })).error).toMatch(/efectivo, transferencia, tarjeta o crédito/);
  });
  it('sin señal solo se guarda lo que no es crédito', () => {
    expect(['Efectivo', 'Transferencia', 'Tarjeta'].every(puedeGuardarseSinSenal)).toBe(true);
    expect(puedeGuardarseSinSenal('Crédito')).toBe(false);
    expect(puedeGuardarseSinSenal('QR / Link de pago')).toBe(false);
    expect(puedeGuardarseSinSenal('')).toBe(false);
  });
  it('crédito sin señal: bloqueado también por la regla de T5-B', () => {
    const cli = { id: 3, credito_autorizado: true, limite_credito: 1000, saldo: 0 };
    expect(motivoNoFiar({ metodo: 'Crédito', cliente: cli, importe: 93, enLinea: false })).toMatch(/Sin señal no se puede fiar/);
    expect(motivoNoFiar({ metodo: 'Crédito', cliente: cli, importe: 93, enLinea: true })).toBeNull();
  });
});

describe('argumentos del contrato', () => {
  it('manda operación, ruta, productos, método, factura y la hora de captura; el precio solo como aserción', () => {
    expect(buildVentaRapidaArgs(venta({ clienteId: 12, cliente: 'Abarrotes', factura: true, pago: 'Transferencia', referencia: ' SPEI-9 ' })).args).toEqual({
      p_operacion_id: OP, p_ruta_id: 7, p_cliente_id: 12, p_cliente_nombre: 'Abarrotes', p_items: [{ sku: 'HPC-5K', cant: 3, precio: 31 }],
      p_metodo: 'Transferencia', p_factura: true, p_referencia: 'SPEI-9', p_capturada_at: '2026-10-11T18:30:00.000Z',
    });
  });
  it('el reenvío desde la cola arma EXACTAMENTE la misma llamada (misma operación, mismos datos)', () => {
    const v = venta();
    const cola = parseCola(JSON.stringify(encolar([], TIPOS_MUTACION.VENTA_RAPIDA, payloadCola(v), 1000)));
    expect(cola[0].payload.operacionId).toBe(OP);
    expect(buildVentaRapidaArgs(cola[0].payload).args).toEqual(buildVentaRapidaArgs(v).args);
  });
  it('no arma la llamada sin identificador, sin ruta, sin productos o con cantidades inválidas', () => {
    expect(buildVentaRapidaArgs({ ...venta(), operacionId: '' }).error).toBeTruthy();
    expect(buildVentaRapidaArgs({ ...venta(), rutaId: null }).error).toBeTruthy();
    expect(buildVentaRapidaArgs({ ...venta(), items: [] }).error).toBeTruthy();
    for (const cant of [0, -1, 1.5, 'x']) expect(buildVentaRapidaArgs({ ...venta(), items: [{ sku: 'HPC-5K', cant }] }).error).toBeTruthy();
  });
});

describe('respuesta del servidor', () => {
  it('sin respuesta = fallo de red: la venta NO está registrada y se reenvía igual', () => {
    expect(clasificarFalloVenta({ message: 'TypeError: Failed to fetch' })).toMatchObject({ red: true, codigo: null });
    expect(clasificarFalloVenta({ message: 'cualquier cosa' }, false)).toMatchObject({ red: true });
  });
  it('ruta cerrada: rechazo definitivo con su código (aunque el teléfono diga que no hay señal)', () => {
    const e = { message: 'La ruta R-007 ya está cerrada: esta venta rápida no se registró. Requiere revisión de Administración.', details: '{"codigo":"RUTA_CERRADA","ruta_id":7}' };
    expect(clasificarFalloVenta(e)).toMatchObject({ red: false, codigo: 'RUTA_CERRADA', rutaCerrada: true });
    expect(clasificarFalloVenta(e, false)).toMatchObject({ red: false, rutaCerrada: true });
    expect(clasificarFalloVenta(e).mensaje).toMatch(/Requiere revisión de Administración/);
  });
  it('carga, crédito y precio: rechazos con su texto, no son de red ni de ruta cerrada', () => {
    for (const codigo of ['CARGA_INSUFICIENTE', 'CREDITO_RECHAZADO', 'PRECIO_CAMBIO', 'REFERENCIA_REPETIDA']) {
      expect(clasificarFalloVenta({ message: 'registrar_venta_rapida_ruta: motivo', details: JSON.stringify({ codigo }) })).toMatchObject({ red: false, codigo, rutaCerrada: false, mensaje: 'motivo' });
    }
  });
});

describe('de pendiente a registrada, sin duplicar', () => {
  const RES = { orden_id: 501, folio: 'OV-0501', total: 93 };
  it('la confirmación sustituye la copia del teléfono por la orden del servidor', () => {
    const out = confirmarVentaLocal([{ ordenId: 9, folio: 'OV-0009' }, venta()], OP, RES);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ ordenId: 501, folio: 'OV-0501', total: 93, estado: ESTADO_VENTA.REGISTRADA, express: false, ventaRapida: true, operacionId: OP });
    expect(etiquetaEstadoVenta(out[1])).toBe('Registrada en el sistema');
    expect(ventasSinConfirmar(out)).toHaveLength(0);
  });
  it('si la orden ya había llegado por la recarga, no queda dos veces', () => {
    const out = confirmarVentaLocal([venta(), { ordenId: 501, folio: 'OV-0501', total: 93 }], OP, RES);
    expect(out).toEqual([{ ordenId: 501, folio: 'OV-0501', total: 93 }]);
  });
  it('confirmar dos veces (reintento) no duplica ni cambia nada', () => {
    const una = confirmarVentaLocal([venta()], OP, RES);
    expect(confirmarVentaLocal(una, OP, RES)).toEqual(una);
  });
  it('una respuesta sin orden no toca la lista; otra operación tampoco', () => {
    const lista = [venta()];
    expect(confirmarVentaLocal(lista, OP, {})).toBe(lista);
    expect(confirmarVentaLocal(lista, OP2, RES)).toEqual(lista);
  });
  it('quitar solo quita ESA venta sin confirmar; nunca una orden del servidor', () => {
    const lista = [{ ordenId: 9 }, venta(), venta({ operacionId: OP2 }), { ordenId: 501, operacionId: OP }];
    expect(quitarVentaLocal(lista, OP)).toEqual([{ ordenId: 9 }, lista[2], { ordenId: 501, operacionId: OP }]);
  });
});

describe('cierre financiero: convive sin doble registro', () => {
  const lista = [{ ordenId: 9, pago: 'Efectivo', items: [] }, venta(), { ordenId: 501, pago: 'Efectivo', ventaRapida: true, items: [] }];
  it('al cierre solo van órdenes del servidor; una venta del teléfono NUNCA va como venta exprés', () => {
    const payload = normalizarEntregasCierre(entregasParaCierre(lista));
    expect(payload.map(e => e.ordenId)).toEqual([9, 501]);
    expect(payload.some(e => e.express)).toBe(false);
  });
  it('capturar otra venta después del cierre no cambia lo que el cierre reenvía (sigue siendo un reintento)', () => {
    const antes = claveCierreFinanciero(7, normalizarEntregasCierre(entregasParaCierre([lista[0], lista[2]])));
    const despues = claveCierreFinanciero(7, normalizarEntregasCierre(entregasParaCierre([...[lista[0], lista[2]], venta({ operacionId: OP2 })])));
    expect(despues).toBe(antes);
  });
  it('el store filtra antes de armar el cierre y la pantalla ya no borra ventas al registrarlo', () => {
    const store = leer('../data/supaStore.js');
    const vista = sinComentarios(leer('../components/ChoferView.jsx'));
    expect(store).toMatch(/let entregasPayload = normalizarEntregasCierre\(entregasParaCierre\(entregas\)\);/);
    expect(vista).not.toMatch(/setEntregas\(prev => prev\.filter\(e => e\.ordenId\)\)/);
    expect(vista).not.toMatch(/folio: "EX-"/);
  });
});

describe('cola sin señal', () => {
  it('la venta encolada conserva identificador, ruta, productos, importes, método y hora; sobrevive a recargar', () => {
    const cola = parseCola(JSON.stringify(encolar([], TIPOS_MUTACION.VENTA_RAPIDA, payloadCola(venta()), 1000)));
    expect(cola).toHaveLength(1);
    expect(cola[0]).toMatchObject({ tipo: 'venta_rapida', intentos: 0, payload: { operacionId: OP, rutaId: 7, rutaFolio: 'R-007', total: 93, pago: 'Efectivo', capturadaAt: '2026-10-11T18:30:00.000Z', items: [{ sku: 'HPC-5K', cant: 3, precio: 31 }] } });
    expect(mutacionesPendientes(cola)).toHaveLength(1);
    expect(descripcionMutacion(cola[0])).toBe('Venta rápida $93 (Efectivo)');
  });
  it('sincronización exitosa: sale de la cola y la lista queda con la orden del servidor', () => {
    let cola = encolar([], TIPOS_MUTACION.VENTA_RAPIDA, payloadCola(venta()), 1000);
    let entregas = [venta()];
    entregas = confirmarVentaLocal(entregas, OP, { orden_id: 501, folio: 'OV-0501', total: 93 });
    cola = quitar(cola, cola[0].id);
    expect(cola).toHaveLength(0);
    expect(ventasSinConfirmar(entregas)).toHaveLength(0);
    expect(entregasParaCierre(entregas)).toHaveLength(1);
  });
  it('rechazo que no es de ruta cerrada: tras los intentos queda fallida, visible y con motivo (bloquea el cierre)', () => {
    let cola = encolar([], TIPOS_MUTACION.VENTA_RAPIDA, payloadCola(venta()), 1000);
    for (let i = 0; i < MAX_INTENTOS; i++) cola = marcarIntento(cola, cola[0].id, 'La venta rápida no cabe en lo que queda en el camión');
    expect(mutacionesPendientes(cola)).toHaveLength(0);
    expect(mutacionesFallidas(cola)[0]).toMatchObject({ ultimoError: 'La venta rápida no cabe en lo que queda en el camión', payload: { operacionId: OP, total: 93 } });
  });
});

describe('requiere revisión administrativa', () => {
  const MOTIVO = 'La ruta R-007 ya está cerrada: esta venta rápida no se registró. Requiere revisión de Administración.';
  it('el registro conserva productos, importe, método, fecha, ruta e identificador', () => {
    expect(registroRevision(payloadCola(venta({ pago: 'Tarjeta' })), MOTIVO, AHORA)).toEqual({
      operacionId: OP, rutaId: 7, rutaFolio: 'R-007', cliente: 'Público en general', clienteId: null, items: [{ sku: 'HPC-5K', cant: 3, precio: 31 }],
      total: 93, pago: 'Tarjeta', factura: false, referencia: null, capturadaAt: '2026-10-11T18:30:00.000Z', motivo: MOTIVO, rechazadaAt: '2026-10-11T18:30:00.000Z',
    });
  });
  it('se guarda fuera de la ruta (sobrevive al cierre y al cambio de ruta) y no se duplica', () => {
    const st = fakeStorage();
    const r = registroRevision(venta(), MOTIVO, AHORA);
    expect(guardarRevision(st, agregarRevision(leerRevision(st), r))).toBe(true);
    expect(guardarRevision(st, agregarRevision(leerRevision(st), r))).toBe(true);
    expect(leerRevision(st)).toEqual([r]);
    expect(CLAVE_REVISION).not.toMatch(/ruta_\d|\$\{/);
    st.removeItem('entregas_ruta_7'); st.removeItem(claveColaRuta(7));           // lo que borra el cierre de la ruta
    expect(leerRevision(st)).toHaveLength(1);
  });
  it('si el teléfono no puede guardarla, avisa (false) para que NO se quite de la cola', () => {
    expect(guardarRevision({ setItem() { throw new Error('QuotaExceeded'); } }, [registroRevision(venta(), MOTIVO)])).toBe(false);
  });
  it('lectura tolerante: basura o entradas sin identificador no rompen ni inventan ventas', () => {
    expect(leerRevision(fakeStorage({ [CLAVE_REVISION]: '{no json' }))).toEqual([]);
    expect(leerRevision(fakeStorage({ [CLAVE_REVISION]: JSON.stringify([null, { total: 5 }, { operacionId: OP, total: 93 }]) }))).toEqual([{ operacionId: OP, total: 93 }]);
    expect(leerRevision(null)).toEqual([]);
  });
  it('la pantalla del chofer la conserva y NO ofrece borrarla', () => {
    const vista = sinComentarios(leer('../components/ChoferView.jsx'));
    expect(vista).toMatch(/if \(r\.rutaCerrada && mandarARevision\(p, r\.error\)\) return null;/);
    expect(vista).toMatch(/if \(m\?\.tipo === TIPOS_MUTACION\.VENTA_RAPIDA && !mandarARevision\(m\.payload, m\.ultimoError\)\)/);
    expect(vista).not.toMatch(/removeItem\(CLAVE_REVISION\)|setVentasRevision\(\[\]\)/);
    const html = renderToStaticMarkup(<AvisoVentasRevision ventas={[registroRevision(venta({ pago: 'Tarjeta' }), MOTIVO, AHORA)]} />);
    for (const t of ['Requiere revisión administrativa', 'NO quedó registrada', '$93', 'Tarjeta', '3× HPC-5K', 'Ruta R-007', 'Motivo: La ruta R-007 ya está cerrada', `Identificador: ${OP}`]) expect(html).toContain(t);
    expect(html).not.toMatch(/<button/);
    expect(renderToStaticMarkup(<AvisoVentasRevision ventas={[]} />)).toBe('');
  });
});

describe('ventas en la cola de otra ruta (cerrada por Administración o teléfono reasignado)', () => {
  it('se encuentran aunque esa ruta ya no sea la activa; la ruta activa y las colas sin ventas se ignoran', () => {
    const st = fakeStorage({
      [claveColaRuta(7)]: JSON.stringify(encolar([], TIPOS_MUTACION.VENTA_RAPIDA, payloadCola(venta()), 1000)),
      [claveColaRuta(8)]: JSON.stringify(encolar([], TIPOS_MUTACION.VENTA_RAPIDA, payloadCola(venta({ operacionId: OP2, rutaId: 8 })), 1000)),
      [claveColaRuta(9)]: JSON.stringify(encolar([], TIPOS_MUTACION.NO_ENTREGA, { ordenId: 1, motivo: 'x' }, 1000)),
      entregas_ruta_7: '[]',
    });
    const otras = colasConVentasDeOtrasRutas(st, 8);
    expect(otras.map(q => q.rutaId)).toEqual(['7']);
    expect(otras[0].ventas[0].payload).toMatchObject({ operacionId: OP, rutaId: 7, total: 93 });
    expect(colasConVentasDeOtrasRutas(st, null).map(q => q.rutaId).sort()).toEqual(['7', '8']);
    expect(colasConVentasDeOtrasRutas(null, 1)).toEqual([]);
  });
  it('la pantalla las envía con el mismo contrato; sin respuesta las deja donde están; rechazadas → revisión antes de quitarlas', () => {
    const vista = sinComentarios(leer('../components/ChoferView.jsx'));
    const i = vista.indexOf('const enviarVentasDeOtrasRutas');
    const bloque = vista.slice(i, i + 1100);
    // T5-D2 generalizó este bloque a entregas y no entregas (ver t5d2RecuperacionRutas): mismo contrato para la venta,
    // sin respuesta no se toca la cola, y la revisión se guarda ANTES de quitar la operación.
    expect(bloque).toMatch(/await actions\.registrarVentaRapidaRuta\?\.\(p\)/);
    expect(bloque.indexOf('if (!r || r.red) red = true;')).toBeGreaterThan(0);
    const todo = vista.slice(i, i + 3200);
    expect(todo.indexOf('if (red) return;')).toBeLessThan(todo.indexOf('cola = cola.filter(x => x.id !== m.id);'));
    expect(todo.indexOf('if (!guardarRevision(storage, lista)) return;')).toBeLessThan(todo.indexOf('cola = cola.filter(x => x.id !== m.id);'));
  });
});

describe('ventas capturadas con la versión anterior', () => {
  it('reciben identificador y pasan a pendientes; las órdenes y las ventas nuevas no se tocan', () => {
    const vieja = { id: 1760000000000, folio: 'EX-0001', cliente: 'Público en general', items: [{ sku: 'HPC-5K', cant: 2, precio: 31 }], total: 62, pago: 'Efectivo', express: true };
    const lista = [{ ordenId: 9 }, vieja, venta()];
    let k = 0;
    const { entregas, adoptadas } = adoptarVentasAnteriores(lista, 7, () => (k++ ? 'no' : OP2));
    expect(adoptadas).toHaveLength(1);
    expect(entregas[1]).toMatchObject({ operacionId: OP2, id: `vr-${OP2}`, rutaId: 7, total: 62, estado: ESTADO_VENTA.PENDIENTE, express: true });
    expect(entregas[0]).toBe(lista[0]);
    expect(entregas[2]).toBe(lista[2]);
    expect(buildVentaRapidaArgs(entregas[1]).args).toMatchObject({ p_operacion_id: OP2, p_ruta_id: 7, p_items: [{ sku: 'HPC-5K', cant: 2, precio: 31 }], p_capturada_at: null });
    const otra = adoptarVentasAnteriores(entregas, 7, () => 'x');                 // segunda pasada: nada que adoptar, misma lista
    expect(otra.adoptadas).toHaveLength(0);
    expect(otra.entregas).toBe(entregas);
  });
});

describe('pantalla del chofer: estados sin ambigüedad y cierre protegido', () => {
  const vista = sinComentarios(leer('../components/ChoferView.jsx'));
  it('con señal la venta se registra en el servidor y solo entonces dice "registrada"', () => {
    const i = vista.indexOf('const crearVentaExpress');
    const bloque = vista.slice(i, vista.indexOf('const quitarVentaPendiente'));
    expect(bloque).toMatch(/const r = await actions\.registrarVentaRapidaRuta\?\.\(venta\);/);
    expect(bloque.indexOf('if (r?.data) {')).toBeLessThan(bloque.indexOf('Venta rápida registrada:'));
    expect(bloque).not.toMatch(/showToast\("Venta exprés: "/);
  });
  it('sin señal: solo contado, a la cola, y el aviso dice que todavía NO está registrada', () => {
    expect(vista).toMatch(/if \(!puedeGuardarseSinSenal\(venta\.pago\)\) \{ showToast\('Sin señal no se puede fiar\. Cobra en efectivo, transferencia o tarjeta\.', 'error'\); return; \}/);
    expect(vista).toMatch(/encolarOffline\(TIPOS_MUTACION\.VENTA_RAPIDA, payloadCola\(venta\)\);/);
    expect(vista).toMatch(/quedó guardada SOLO en este teléfono\. Todavía no está registrada/);
  });
  it('sin respuesta del servidor se reenvía con el MISMO identificador (no se genera otro)', () => {
    const i = vista.indexOf('const crearVentaExpress');
    const bloque = vista.slice(i, vista.indexOf('const quitarVentaPendiente'));
    expect((bloque.match(/nuevoOperacionId\(\)/g) || []).length).toBe(1);
    expect(bloque).toMatch(/if \(!r \|\| r\.red\) \{[\s\S]*?guardarPendiente\(\);/);
  });
  it('el cierre final exige señal, cola vacía, nada rechazado y ninguna venta por enviar', () => {
    const i = vista.indexOf('const cerrarRuta = async');
    const bloque = vista.slice(i, i + 1100);
    expect(bloque.indexOf('pendientesCola().length > 0')).toBeGreaterThan(0);
    expect(bloque.indexOf('fallidasCola().length > 0')).toBeLessThan(bloque.indexOf('actions.finalizarInventarioRuta'));
    expect(vista).toMatch(/const sinEnviar = ventasSinConfirmar\(entregas\)\.length;/);
    expect(vista).toMatch(/disabled=\{cerrandoRuta \|\| !balanceCierre \|\| sinEnviar > 0 \|\|/);
    expect(vista).toMatch(/Faltan ventas por enviar al sistema/);
  });
  it('una venta con el conteo abierto pide el balance vigente; no vuelve a consolidar', () => {
    expect(vista).toMatch(/const bal = await actions\.obtenerBalanceRuta\?\.\(miRutaActiva\.id\);/);
    expect(vista).toMatch(/Se actualizó lo que debe regresar en el camión/);
  });
  it('la etiqueta de cada venta dice dónde está', () => {
    expect(etiquetaEstadoVenta({ ordenId: 1 })).toBe('Registrada en el sistema');
    expect(etiquetaEstadoVenta({ operacionId: OP })).toBe('Solo en este teléfono — falta enviarla');
    expect(etiquetaEstadoVenta({ estado: ESTADO_VENTA.REVISION })).toBe('Requiere revisión administrativa');
    expect(vista).toMatch(/data-testid="venta-pendiente"/);
  });
});

describe('Administración: ventas rápidas registradas', () => {
  const filas = [
    { orden_id: 501, folio: 'OV-0501', cliente: 'Público en general', productos: '3×HPC-5K', total: 93, metodo: 'Efectivo', cobrado: 93, cxc_saldo: null, capturada_at: '2026-10-11T18:30:00Z', registrada_at: '2026-10-11T18:30:02Z', actor: 'Chofer Uno' },
    { orden_id: 502, folio: 'OV-0502', cliente: 'Abarrotes', productos: '2×HPC-5K', total: 62, metodo: 'Crédito', cobrado: 0, cxc_saldo: 62, capturada_at: '2026-10-11T18:40:00Z', registrada_at: '2026-10-11T18:40:01Z', actor: 'Chofer Uno' },
    { orden_id: 503, folio: 'OV-0503', cliente: 'Público en general', productos: '1×HPC-5K', total: 31, metodo: 'Tarjeta', cobrado: 31, cxc_saldo: null, capturada_at: '2026-10-11T17:00:00Z', registrada_at: '2026-10-11T17:45:00Z', actor: 'Chofer Uno' },
  ].map(filaVentaRapidaAdmin);
  it('resumen por forma de cobro y retraso de las capturadas sin señal', () => {
    expect(resumenVentasRapidas(filas)).toEqual({ n: 3, total: 186, efectivo: 93, otros: 31, credito: 62 });
    expect(filas.map(f => f.retrasoMin)).toEqual([0, 0, 45]);
    expect(filas[1]).toMatchObject({ porCobrar: 62, cobrado: 0 });
    expect(filas[0].porCobrar).toBeNull();
  });
  it('la lista muestra folio, cliente, importe, cobro o deuda, y advierte lo que el servidor no puede ver', () => {
    const html = renderToStaticMarkup(<ListaVentasRapidas filas={filas} />);
    for (const t of ['Ventas rápidas registradas (3)', 'OV-0501', 'Abarrotes', '$186', 'Efectivo · cobrado $93', 'Crédito · debe $62', 'llegó al sistema 45 min después', 'pregúntale antes de cerrar']) expect(html).toContain(t);
    expect(renderToStaticMarkup(<ListaVentasRapidas filas={[]} />)).toContain('no ha registrado ventas rápidas');
    expect(renderToStaticMarkup(<ListaVentasRapidas filas={null} error="No autorizado" />)).toContain('No autorizado');
  });
  it('el store lee por contrato y solo para Admin; el cierre de Administración la muestra', () => {
    const store = leer('../data/supaStore.js');
    const i = store.indexOf('ventasRapidasDeRuta: async');
    expect(store.slice(i, i + 200)).toContain("requireRol(['Admin'])");
    expect(store).toContain("supabase.rpc('ventas_rapidas_de_ruta'");
    expect(store).toContain("supabase.rpc('registrar_venta_rapida_ruta'");
    expect(leer('../components/CierreRutaAdminModal.jsx')).toMatch(/<VentasRapidasRuta rutaId=\{ruta\.id\} actions=\{actions\} \/>/);
  });
});
