// ventaRapidaLogic.js — T5-D1 (mig 141): la venta rápida del chofer se registra en el servidor
// cuando ocurre (`registrar_venta_rapida_ruta`), no al cerrar la ruta. Reglas puras:
//   · con señal: la venta existe cuando el servidor la acepta (orden + cobro o cuenta);
//   · sin señal (solo contado): queda PENDIENTE DE ENVIAR en la cola del teléfono, con su
//     identificador; nada se presenta como registrado ni cobrado por el sistema;
//   · rechazo del servidor a una venta que estaba en cola (p. ej. la ruta ya cerró): la
//     operación se conserva íntegra como REQUIERE REVISIÓN ADMINISTRATIVA; nunca se borra sola;
//   · el cierre financiero ya no lleva ventas rápidas (no hay doble registro).
// La autoridad es el servidor; lo que solo vive en un teléfono el servidor no lo conoce.
import { detalleRechazo, mensajeRechazoServidor } from './recuperacionRutaLogic';
import { esFalloDeRed, TIPOS_MUTACION, parseCola } from './colaOfflineLogic';

const txt = (v) => String(v ?? '').trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const METODOS_VENTA_RAPIDA = ['Efectivo', 'Transferencia', 'Tarjeta', 'Crédito'];
export const CLAVE_REVISION = 'ventas_rapidas_revision';
export const ESTADO_VENTA = { REGISTRADA: 'registrada', PENDIENTE: 'pendiente', REVISION: 'revision' };

/** Sin señal solo se guarda lo que no es crédito (T5-B: sin señal no se fía). */
export const puedeGuardarseSinSenal = (metodo) => METODOS_VENTA_RAPIDA.includes(txt(metodo)) && txt(metodo) !== 'Crédito';

/** La venta tal como vive en el teléfono mientras el servidor no la confirma. */
export function nuevaVentaRapida({ operacionId, rutaId, rutaFolio, clienteId, cliente, items, pago, factura, referencia, ahora = new Date() } = {}) {
  const lineas = (Array.isArray(items) ? items : []).map(it => ({ sku: txt(it?.sku), cant: num(it?.cant ?? it?.cantidad), precio: num(it?.precio) }));
  const total = Math.round(lineas.reduce((t, l) => t + l.cant * l.precio, 0) * 100) / 100;
  return {
    id: `vr-${operacionId}`, operacionId, rutaId: rutaId ?? null, rutaFolio: txt(rutaFolio) || null,
    folio: `VR-${txt(operacionId).slice(0, 4).toUpperCase()}`,
    clienteId: clienteId || null, cliente: txt(cliente) || 'Público en general',
    items: lineas, subtotal: total, iva: 0, total, pago: txt(pago) || 'Efectivo', referencia: txt(referencia) || null,
    factura: factura === true, express: true, estado: ESTADO_VENTA.PENDIENTE,
    capturadaAt: ahora.toISOString(),
    hora: ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
  };
}

/** Argumentos de `registrar_venta_rapida_ruta`. El precio viaja solo como aserción: manda el del servidor. */
export function buildVentaRapidaArgs(venta = {}) {
  if (!txt(venta.operacionId)) return { error: 'La venta no tiene identificador: vuelve a capturarla' };
  if (venta.rutaId === null || venta.rutaId === undefined || venta.rutaId === '') return { error: 'No hay ruta activa para registrar la venta' };
  const items = (Array.isArray(venta.items) ? venta.items : []).map(it => ({ sku: txt(it?.sku), cant: num(it?.cant ?? it?.cantidad), ...(num(it?.precio) > 0 ? { precio: num(it.precio) } : {}) }));
  if (items.length === 0 || items.some(it => !it.sku || !Number.isInteger(it.cant) || it.cant <= 0)) return { error: 'La venta necesita productos con cantidades enteras mayores a 0' };
  const metodo = txt(venta.pago);
  if (!METODOS_VENTA_RAPIDA.includes(metodo)) return { error: 'La venta rápida se cobra en efectivo, transferencia, tarjeta o crédito' };
  return {
    args: {
      p_operacion_id: txt(venta.operacionId), p_ruta_id: Number(venta.rutaId), p_cliente_id: venta.clienteId ? Number(venta.clienteId) : null,
      p_cliente_nombre: txt(venta.cliente) || null, p_items: items, p_metodo: metodo, p_factura: venta.factura === true,
      p_referencia: txt(venta.referencia) || null, p_capturada_at: txt(venta.capturadaAt) || null,
    },
  };
}

/** Lo que guarda la cola sin conexión: la venta completa (para poder mostrarla y reenviarla igual). */
export function payloadCola(venta) {
  const { id: _id, estado: _estado, hora, ...resto } = venta || {};
  return { ...resto, hora: hora || null };
}

/**
 * Interpreta la respuesta fallida del servidor.
 *  - red: no hubo respuesta; la venta NO está registrada y se puede reenviar igual.
 *  - rutaCerrada: la ruta ya no admite ventas (revisión de Administración).
 */
export function clasificarFalloVenta(error, enLinea = true) {
  const det = detalleRechazo(error);
  if (!det.codigo && esFalloDeRed(error, enLinea)) return { red: true, codigo: null, mensaje: 'Sin señal: la venta no llegó al servidor.' };
  return {
    red: false, codigo: det.codigo || null, rutaCerrada: det.codigo === 'RUTA_CERRADA',
    mensaje: mensajeRechazoServidor(error, 'No se pudo registrar la venta. No se aplicó ningún cambio.'),
  };
}

/** La venta confirmada por el servidor sustituye a su copia del teléfono (sin duplicar si la orden ya llegó). */
export function confirmarVentaLocal(entregas, operacionId, resultado) {
  const lista = Array.isArray(entregas) ? entregas : [];
  const ordenId = resultado?.orden_id ?? null;
  if (ordenId === null) return lista;
  const yaEsta = lista.some(e => e?.ordenId != null && String(e.ordenId) === String(ordenId));
  const out = [];
  for (const e of lista) {
    if (e?.operacionId && e.operacionId === operacionId && !e.ordenId) {
      if (!yaEsta) out.push({ ...e, ordenId, folio: txt(resultado?.folio) || e.folio, total: num(resultado?.total) || e.total, estado: ESTADO_VENTA.REGISTRADA, express: false, ventaRapida: true });
      continue;
    }
    out.push(e);
  }
  return out;
}

/** Quita del teléfono la copia de una venta (porque pasó a revisión o se capturó por error). */
export const quitarVentaLocal = (entregas, operacionId) => (Array.isArray(entregas) ? entregas : []).filter(e => !(e?.operacionId === operacionId && !e.ordenId));

/** Ventas rápidas que el servidor todavía no confirma. */
export const ventasSinConfirmar = (entregas) => (Array.isArray(entregas) ? entregas : []).filter(e => e && !e.ordenId);

/** Lo que se manda al cierre financiero: solo órdenes del servidor. Una venta rápida nunca va aquí. */
export const entregasParaCierre = (entregas) => (Array.isArray(entregas) ? entregas : []).filter(e => e && e.ordenId);

/**
 * Ventas rápidas capturadas con la versión anterior (solo en el teléfono, sin identificador):
 * reciben identificador y pasan a pendientes de enviar, para que entren por el contrato nuevo.
 * @returns {{ entregas: object[], adoptadas: object[] }}
 */
export function adoptarVentasAnteriores(entregas, rutaId, nuevoId) {
  const adoptadas = [];
  const out = (Array.isArray(entregas) ? entregas : []).map(e => {
    if (!e || e.ordenId || e.operacionId) return e;
    const operacionId = nuevoId();
    const v = { ...e, id: `vr-${operacionId}`, operacionId, rutaId, express: true, estado: ESTADO_VENTA.PENDIENTE, capturadaAt: e.capturadaAt || null };
    adoptadas.push(v);
    return v;
  });
  return { entregas: adoptadas.length ? out : (Array.isArray(entregas) ? entregas : []), adoptadas };
}

/** Texto del estado para la pantalla del chofer. */
export function etiquetaEstadoVenta(e) {
  if (!e) return '';
  if (e.ordenId) return 'Registrada en el sistema';
  if (e.estado === ESTADO_VENTA.REVISION) return 'Requiere revisión administrativa';
  return 'Solo en este teléfono — falta enviarla';
}

// ── Ventas que requieren revisión administrativa (durable, no ligada a la ruta activa) ──

/** Registro de revisión a partir de la venta (o del payload de la cola) y el motivo del rechazo. */
export function registroRevision(venta, motivo, ahora = new Date()) {
  const v = venta || {};
  return {
    operacionId: txt(v.operacionId), rutaId: v.rutaId ?? null, rutaFolio: txt(v.rutaFolio) || null,
    cliente: txt(v.cliente) || 'Público en general', clienteId: v.clienteId || null,
    items: (Array.isArray(v.items) ? v.items : []).map(it => ({ sku: txt(it?.sku), cant: num(it?.cant ?? it?.cantidad), precio: num(it?.precio) })),
    total: num(v.total), pago: txt(v.pago), factura: v.factura === true, referencia: txt(v.referencia) || null,
    capturadaAt: txt(v.capturadaAt) || null, motivo: txt(motivo) || 'El servidor rechazó la venta', rechazadaAt: ahora.toISOString(),
  };
}

export function leerRevision(storage) {
  try {
    const arr = JSON.parse(storage?.getItem(CLAVE_REVISION) || '[]');
    return Array.isArray(arr) ? arr.filter(r => r && typeof r === 'object' && txt(r.operacionId)) : [];
  } catch { return []; }
}

/** Agrega sin duplicar (misma operación = mismo registro; se conserva el primero). */
export function agregarRevision(lista, registro) {
  const base = Array.isArray(lista) ? lista : [];
  if (!registro || !txt(registro.operacionId) || base.some(r => r.operacionId === registro.operacionId)) return base;
  return [...base, registro];
}

/** Guarda la lista. Devuelve false si el teléfono no pudo guardarla (entonces NO se debe quitar de la cola). */
export function guardarRevision(storage, lista) {
  try { storage?.setItem(CLAVE_REVISION, JSON.stringify(Array.isArray(lista) ? lista : [])); return true; } catch { return false; }
}

/**
 * Ventas rápidas que quedaron en la cola de OTRA ruta (el teléfono cambió de ruta, o
 * Administración la cerró antes de que hubiera señal). Se intentan enviar igual.
 * @returns {{ rutaId: string, clave: string, cola: object[], ventas: object[] }[]}
 */
export function colasConVentasDeOtrasRutas(storage, rutaActivaId) {
  const out = [];
  if (!storage || typeof storage.length !== 'number') return out;
  for (let i = 0; i < storage.length; i++) {
    const clave = storage.key(i);
    const m = /^cola_offline_ruta_(.+)$/.exec(clave || '');
    if (!m || (rutaActivaId != null && String(m[1]) === String(rutaActivaId))) continue;
    const cola = parseCola(storage.getItem(clave));
    const ventas = cola.filter(x => x.tipo === TIPOS_MUTACION.VENTA_RAPIDA);
    if (ventas.length > 0) out.push({ rutaId: m[1], clave, cola, ventas });
  }
  return out;
}

/** Fila del listado de Administración (`ventas_rapidas_de_ruta`). */
export function filaVentaRapidaAdmin(v) {
  const total = num(v?.total); const cobrado = num(v?.cobrado);
  const cxc = v?.cxc_saldo === null || v?.cxc_saldo === undefined ? null : num(v.cxc_saldo);
  return {
    ordenId: v?.orden_id, folio: txt(v?.folio), cliente: txt(v?.cliente), productos: txt(v?.productos), total, metodo: txt(v?.metodo),
    cobrado, porCobrar: cxc, capturadaAt: v?.capturada_at || null, registradaAt: v?.registrada_at || null, actor: txt(v?.actor),
    // Minutos entre la captura en el teléfono y la llegada al servidor (venta guardada sin señal).
    retrasoMin: v?.capturada_at && v?.registrada_at ? Math.max(0, Math.round((new Date(v.registrada_at) - new Date(v.capturada_at)) / 60000)) : 0,
  };
}

/** Totales del listado de Administración por forma de cobro. */
export function resumenVentasRapidas(filas) {
  const r = { n: 0, total: 0, efectivo: 0, otros: 0, credito: 0 };
  for (const f of Array.isArray(filas) ? filas : []) {
    r.n += 1; r.total += f.total;
    if (f.metodo === 'Crédito') r.credito += f.total; else if (f.metodo === 'Efectivo') r.efectivo += f.total; else r.otros += f.total;
  }
  return r;
}
