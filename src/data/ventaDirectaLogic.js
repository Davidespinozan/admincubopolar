// ventaDirectaLogic.js — OL-02C: traducción pura entre la interfaz de cobro
// (Ventas y Admin) y el contrato del servidor completar_venta_directa (109).
//
// El servidor es la autoridad: valida rol, dueño, estatus, ruta, existencia,
// pago/CxC y huella de la operación. Este módulo solo:
//   - decide qué órdenes ofrecen la venta directa en la interfaz;
//   - traduce el método de pago al modo del contrato;
//   - arma, con la existencia FÍSICA por cuarto (cuartos_frios.stock, nunca
//     productos.stock), las opciones de origen de cada línea;
//   - preselecciona un cuarto SOLO cuando exactamente uno cubre la línea
//     completa (comodidad de interfaz; el contrato recibe la asignación
//     explícita y el servidor nunca elige);
//   - valida localmente el reparto (asignado == pedido) antes de enviar.
import { s } from '../utils/safe';
import { parseProductos } from './ordenLogic';
import { tieneRutaAsignada } from './ventasCobroLogic';

export const METODOS_CONTADO = Object.freeze(['Efectivo', 'Transferencia SPEI', 'Tarjeta (terminal)']);
export const METODO_CREDITO = 'Crédito (fiado)';
export const METODO_LINK = 'QR / Link de pago';

const entero = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

/** ¿La orden admite venta directa de planta? Creada o Asignada, siempre SIN ruta. */
export function esElegibleVentaDirecta(orden) {
  if (!orden || typeof orden !== 'object') return false;
  return (orden.estatus === 'Creada' || orden.estatus === 'Asignada') && !tieneRutaAsignada(orden);
}

/**
 * Modo del contrato para un método del diálogo de cobro.
 * El link de pago NO es un modo de cobro aquí: generar el link es un paso
 * aparte (sin salida de inventario); la entrega física llega después con
 * 'pagado_link' (ver linkPagadoCompleto).
 */
export function modoVentaDirecta(metodo) {
  if (METODOS_CONTADO.includes(metodo)) return 'contado';
  if (metodo === METODO_CREDITO) return 'credito';
  return null;
}

/** Líneas de la orden {sku, cantidad}: preciosSnapshot (orden_lineas) o, si falta, el texto de productos. */
export function lineasOrden(orden) {
  const acc = new Map();
  const add = (sku, q) => { const k = s(sku).trim(); const n = entero(q); if (k && n > 0) acc.set(k, (acc.get(k) || 0) + n); };
  if (Array.isArray(orden?.preciosSnapshot) && orden.preciosSnapshot.length > 0) {
    for (const l of orden.preciosSnapshot) add(l.sku, l.qty ?? l.cantidad);
  } else {
    for (const it of parseProductos(orden?.productos)) add(it.sku, it.qty);
  }
  return [...acc.entries()].map(([sku, cantidad]) => ({ sku, cantidad })).sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Cuartos que tienen existencia física de ESE SKU (los demás no se ofrecen). */
export function cuartosParaSku(cuartosFrios, sku) {
  return (Array.isArray(cuartosFrios) ? cuartosFrios : [])
    .map(cf => ({ id: s(cf?.id), nombre: s(cf?.nombre) || s(cf?.id), disponible: entero(cf?.stock?.[sku]) || 0 }))
    .filter(c => c.id && c.disponible > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Situación de una línea frente a la existencia física:
 *   'uno'           exactamente un cuarto cubre la línea → se preselecciona;
 *   'elegir'        varios cuartos la cubren → el operador elige (sin preselección);
 *   'dividir'       ningún cuarto solo la cubre pero la suma sí → reparto manual;
 *   'insuficiente'  la suma de los cuartos no alcanza (no se puede enviar);
 *   'sin_existencia' ningún cuarto tiene ese SKU.
 */
export function planLinea(linea, cuartosFrios) {
  const opciones = cuartosParaSku(cuartosFrios, linea.sku);
  const total = opciones.reduce((t, c) => t + c.disponible, 0);
  const cubren = opciones.filter(c => c.disponible >= linea.cantidad);
  let caso;
  if (opciones.length === 0) caso = 'sin_existencia';
  else if (total < linea.cantidad) caso = 'insuficiente';
  else if (cubren.length === 1) caso = 'uno';
  else if (cubren.length > 1) caso = 'elegir';
  else caso = 'dividir';
  const reparto = caso === 'uno' ? { [cubren[0].id]: linea.cantidad } : {};
  return { sku: linea.sku, cantidad: linea.cantidad, opciones, total, caso, reparto };
}

export function planVentaDirecta(orden, cuartosFrios) {
  return lineasOrden(orden).map(l => planLinea(l, cuartosFrios));
}

/** Validación local de una línea: enteros ≥ 0, sin pasar lo disponible, asignado == pedido. */
export function validarLinea(plan, reparto = {}) {
  let asignado = 0;
  for (const [id, v] of Object.entries(reparto || {})) {
    if (v === '' || v === null || v === undefined) continue;
    const q = entero(v);
    if (!Number.isInteger(q) || q < 0) return { asignado, ok: false, error: 'Cantidades enteras, sin negativos' };
    const op = plan.opciones.find(c => c.id === id);
    if (!op) { if (q > 0) return { asignado, ok: false, error: `El cuarto ${id} no tiene ${plan.sku}` }; continue; }
    if (q > op.disponible) return { asignado, ok: false, error: `${op.nombre} solo tiene ${op.disponible}` };
    asignado += q;
  }
  if (plan.caso === 'sin_existencia') return { asignado, ok: false, error: `No hay ${plan.sku} en ningún cuarto` };
  if (plan.caso === 'insuficiente') return { asignado, ok: false, error: `Existencia insuficiente: hay ${plan.total} de ${plan.cantidad}` };
  if (asignado !== plan.cantidad) return { asignado, ok: false, error: asignado < plan.cantidad ? `Faltan ${plan.cantidad - asignado}` : `Sobran ${asignado - plan.cantidad}` };
  return { asignado, ok: true, error: null };
}

/** Asignación explícita para el contrato: [{sku, cuarto_id, cantidad}] con cantidad > 0, ordenada. */
export function construirAsignacion(planes, repartos = {}) {
  const out = [];
  for (const p of planes) {
    for (const [id, v] of Object.entries(repartos[p.sku] || {})) {
      const q = entero(v);
      if (Number.isInteger(q) && q > 0) out.push({ sku: p.sku, cuarto_id: id, cantidad: q });
    }
  }
  return out.sort((a, b) => a.sku.localeCompare(b.sku) || a.cuarto_id.localeCompare(b.cuarto_id));
}

/** ¿Se puede enviar? Todas las líneas válidas. */
export function validarVentaDirecta(planes, repartos = {}) {
  if (!Array.isArray(planes) || planes.length === 0) return { ok: false, errores: { _: 'La orden no tiene productos' } };
  const errores = {};
  for (const p of planes) {
    const v = validarLinea(p, repartos[p.sku]);
    if (!v.ok) errores[p.sku] = v.error;
  }
  return { ok: Object.keys(errores).length === 0, errores };
}

/** Repartos iniciales (solo la preselección del caso 'uno'). */
export function repartosIniciales(planes) {
  return Object.fromEntries((planes || []).map(p => [p.sku, { ...p.reparto }]));
}

/** Pagado según los pagos cargados (pagos.orden_id). */
export function totalPagadoOrden(orden, pagos) {
  const id = String(orden?.id ?? '');
  return r2((Array.isArray(pagos) ? pagos : []).filter(p => String(p?.ordenId ?? p?.orden_id ?? '') === id).reduce((t, p) => t + Number(p?.monto || 0), 0));
}

/**
 * ¿Ofrecer "Entregar pedido pagado"? Solo con datos del servidor ya cargados:
 * orden elegible, total > 0 y pagos que cubren el total. Un toast de "link
 * generado" NO cuenta como pago. El servidor vuelve a verificarlo.
 */
export function linkPagadoCompleto(orden, pagos) {
  if (!esElegibleVentaDirecta(orden)) return false;
  const total = r2(orden?.total);
  return total > 0 && r2(total - totalPagadoOrden(orden, pagos)) <= 0;
}

/** Huella local del intento (misma huella → mismo UUID en un reintento). */
export function claveVentaDirecta({ ordenId, modo, metodo, referencia, folioNota, asignacion } = {}) {
  return JSON.stringify([String(ordenId ?? ''), modo || '', metodo || '', s(referencia).trim(), s(folioNota).trim(),
    (asignacion || []).map(a => `${a.sku}@${a.cuarto_id}:${a.cantidad}`)]);
}

/** Argumentos del RPC (misma forma que la firma de la migración 109). */
export function buildCompletarVentaDirectaArgs({ operacionId, ordenId, modo, metodo, asignacion, referencia, folioNota } = {}) {
  if (!operacionId) return { error: 'Operación requerida' };
  const id = Number(ordenId);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Orden requerida' };
  const okModo = (modo === 'contado' && METODOS_CONTADO.includes(metodo)) || (modo === 'credito' && metodo === METODO_CREDITO)
    || (modo === 'pagado_link' && metodo === METODO_LINK);
  if (!okModo) return { error: 'Método de pago no válido para la entrega' };
  if (!Array.isArray(asignacion) || asignacion.length === 0) return { error: 'Indica de qué cuarto sale cada producto' };
  return {
    args: {
      p_operacion_id: operacionId,
      p_orden_id: id,
      p_modo: modo,
      p_metodo: metodo,
      p_asignacion: asignacion.map(a => ({ sku: a.sku, cuarto_id: a.cuarto_id, cantidad: Number(a.cantidad) })),
      p_referencia: s(referencia).trim() || null,
      p_folio_nota: s(folioNota).trim() || null,
    },
  };
}

/** Mensaje claro para el operador; el error del servidor manda. */
export function mensajeErrorVentaDirecta(error) {
  const raw = s(typeof error === 'string' ? error : error?.message).trim();
  const msg = raw.replace(/^completar_venta_directa:\s*/i, '');
  if (/tiene ruta/i.test(msg)) return 'Esta orden ya tiene ruta: la entrega y el cobro son del chofer.';
  if (/operacion_id ya usado con otros datos/i.test(msg)) return 'Este intento ya se registró con otros datos. Cierra y vuelve a abrir el cobro.';
  if (/no es de este vendedor|no autorizado/i.test(msg)) return 'No puedes completar esta orden.';
  if (/se requiere Creada o Asignada/i.test(msg)) return 'La orden ya no está pendiente (alguien la completó o la canceló). Actualiza la lista.';
  if (/Stock insuficiente/i.test(msg)) return `La existencia cambió: ${msg}. Revisa el origen.`;
  if (/no cubre el total/i.test(msg)) return 'El pago con link aún no cubre el total; todavía no se puede entregar.';
  return msg || 'No se pudo completar la venta';
}
