// devolucionesLogic.js — 104: devolución de cliente por contrato
// (registrar_devolucion). El servidor decide todo lo autoritativo: precio
// (línea original de la orden), total, cantidades máximas, CxC, saldo del
// cliente, reembolso (tope = lo cobrado), egreso, kardex y nota fiscal. El
// cliente solo arma SKU + cantidad, tipo, disposición, cuarto y motivo, y
// conserva el UUID del intento. Tests en src/__tests__/devoluciones.test.js.
import { centavos } from '../utils/safe';

export const ESTATUS_DEVOLVIBLES = ['Entregada', 'Facturada'];
// 104: 'Reposicion' bloqueada hasta que exista el flujo de reposición (salida
// del producto de reemplazo). 'Nota credito' solo en ventas a crédito.
export const TIPOS_REEMBOLSO = ['Efectivo', 'Nota credito'];
export const DISPOSICIONES = [
  { value: 'Reintegrar', label: 'Reintegrar a inventario' },
  { value: 'Merma', label: 'Merma (dañado / no vendible)' },
];

const txt = (v) => (v == null ? '' : String(v)).trim();

/** ¿La orden es venta a crédito? (aviso de UI; el servidor decide por su CxC). */
export function esVentaCredito(orden) {
  const tc = txt(orden?.tipoCobro ?? orden?.tipo_cobro).toLowerCase();
  const mp = txt(orden?.metodoPago ?? orden?.metodo_pago).toLowerCase();
  return tc === 'credito' || tc === 'crédito' || mp.includes('crédito') || mp.includes('credito');
}

/**
 * Validación de captura (UX). El servidor vuelve a validar todo.
 * @returns {{ error: string }|null}
 */
export function validateDevolucion({ orden, items, lineasOriginales, motivo, tipoReembolso, disposicion, cuartoDestino }) {
  const est = txt(orden?.estatus);
  if (!ESTATUS_DEVOLVIBLES.includes(est)) {
    return { error: `Solo se devuelven órdenes Entregadas o Facturadas (estatus actual: ${est || 'desconocido'})` };
  }
  if (orden?.tiene_devolucion || orden?.tieneDevolucion) {
    return { error: 'Esta orden ya tiene una devolución registrada' };
  }
  if (!Array.isArray(items) || items.length === 0) return { error: 'Captura al menos un producto a devolver' };
  if (txt(motivo).length < 3) return { error: 'Motivo requerido' };
  if (!TIPOS_REEMBOLSO.includes(tipoReembolso)) {
    return { error: tipoReembolso === 'Reposicion' ? 'La reposición no está disponible todavía' : 'Tipo de reembolso inválido' };
  }
  if (tipoReembolso === 'Nota credito' && !esVentaCredito(orden)) {
    return { error: 'Nota de crédito solo en ventas a crédito (no existe saldo a favor del cliente)' };
  }
  if (!DISPOSICIONES.some(d => d.value === disposicion)) return { error: 'Elige qué pasa con el producto devuelto' };
  if (disposicion === 'Reintegrar' && !txt(cuartoDestino)) return { error: 'Selecciona el cuarto frío destino' };

  const originalPorSku = {};
  for (const l of (lineasOriginales || [])) {
    const sku = txt(l?.sku);
    if (sku) originalPorSku[sku] = (originalPorSku[sku] || 0) + Number(l?.cantidad || 0);
  }
  const vistos = new Set();
  for (const it of items) {
    const sku = txt(it?.sku);
    const qty = Number(it?.cantidad);
    if (!sku) return { error: 'Item sin SKU' };
    if (vistos.has(sku)) return { error: `${sku} repetido` };
    vistos.add(sku);
    if (!Number.isInteger(qty) || qty <= 0) return { error: `Cantidad inválida para ${sku}` };
    const max = originalPorSku[sku] || 0;
    if (max <= 0) return { error: `${sku} no estaba en la orden original` };
    if (qty > max) return { error: `${sku}: máximo ${max} (entregado originalmente), pediste ${qty}` };
  }
  return null;
}

/** Vista previa del total con los precios de la orden (el servidor recalcula). */
export function calcTotalDevolucion(items, lineasOriginales) {
  if (!Array.isArray(items)) return 0;
  const precioPorSku = {};
  for (const l of (lineasOriginales || [])) {
    const sku = String(l?.sku || '');
    if (!sku) continue;
    precioPorSku[sku] = Number(l?.precio_unitario ?? l?.precioUnit ?? l?.precio ?? 0);
  }
  let total = 0;
  for (const it of items) {
    const sku = String(it?.sku || '');
    const qty = Number(it?.cantidad || 0);
    if (!sku || qty <= 0) continue;
    total += qty * Number(precioPorSku[sku] ?? 0);
  }
  return centavos(total);
}

/** Clave estable del intento (mismo intento → mismo UUID entre reintentos). */
export function claveDevolucion({ ordenId, items, tipoReembolso, disposicion, cuartoDestino, motivo, notas } = {}) {
  const partidas = (Array.isArray(items) ? items : []).map(it => `${txt(it?.sku)}:${Number(it?.cantidad)}`).sort().join(',');
  return ['DEV', txt(ordenId), partidas, txt(tipoReembolso), txt(disposicion), disposicion === 'Reintegrar' ? txt(cuartoDestino) : '', txt(motivo), txt(notas)].join('|');
}

/**
 * Parámetros de registrar_devolucion: solo SKU y cantidad por partida (nunca
 * precio, total, cliente, cobrado, CxC ni reembolso).
 * @returns {{args:Object}|{error:string}}
 */
export function buildRegistrarDevolucionArgs({ operacionId, ordenId, items, tipoReembolso, disposicion, cuartoDestino, motivo, notas } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  const id = Number(ordenId);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Orden requerida' };
  const partidas = (Array.isArray(items) ? items : []).map(it => ({ sku: txt(it?.sku), cantidad: Number(it?.cantidad) }));
  if (partidas.length === 0 || partidas.some(p => !p.sku || !Number.isInteger(p.cantidad) || p.cantidad <= 0)) {
    return { error: 'Cada partida necesita SKU y una cantidad entera mayor a 0' };
  }
  return {
    args: {
      p_operacion_id: txt(operacionId),
      p_orden_id: id,
      p_items: partidas,
      p_tipo_reembolso: txt(tipoReembolso),
      p_disposicion: txt(disposicion),
      p_cuarto_id: disposicion === 'Reintegrar' ? (txt(cuartoDestino) || null) : null,
      p_motivo: txt(motivo),
      p_notas: txt(notas) || null,
    },
  };
}

/** Mensaje en español para errores del contrato. */
export function mensajeErrorDevolucion(error) {
  const msg = txt(typeof error === 'string' ? error : error?.message);
  if (/ya tiene una devolución/i.test(msg)) return 'Esta orden ya tiene una devolución registrada (una por orden).';
  if (/operacion_id ya usado con otros datos/i.test(msg)) return 'Este intento ya se registró con otros datos. Cierra y vuelve a abrir la devolución.';
  if (/no autorizado/i.test(msg)) return 'Solo Admin registra devoluciones.';
  return msg || 'No se pudo registrar la devolución';
}
