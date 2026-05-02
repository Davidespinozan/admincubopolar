// devolucionesLogic.js — lógica pura de devoluciones post-entrega.
// Estos helpers son determinísticos y sin Supabase: todos los tests viven
// en src/__tests__/devoluciones.test.js.
import { centavos } from '../utils/safe';

export const ESTATUS_DEVOLVIBLES = ['Entregada', 'Facturada'];
export const TIPOS_REEMBOLSO = ['Efectivo', 'Nota credito', 'Reposicion'];

/**
 * Valida que una devolución pueda registrarse.
 *
 * @param {Object} params
 * @param {Object} params.orden            — { estatus, tiene_devolucion, metodo_pago }
 * @param {Array}  params.items            — [{ sku, cantidad, precio_unitario, ... }]
 * @param {Array}  params.lineasOriginales — [{ sku, cantidad }] de la orden
 * @param {string} params.motivo
 * @param {string} params.tipoReembolso
 * @param {string} params.cuartoDestino
 * @returns {{ error: string }|null}
 */
export function validateDevolucion({ orden, items, lineasOriginales, motivo, tipoReembolso, cuartoDestino }) {
  const est = String(orden?.estatus || '').trim();
  if (!ESTATUS_DEVOLVIBLES.includes(est)) {
    return { error: `Solo se devuelven órdenes Entregadas o Facturadas (estatus actual: ${est || 'desconocido'})` };
  }
  if (orden?.tiene_devolucion || orden?.tieneDevolucion) {
    return { error: 'Esta orden ya tiene una devolución registrada' };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'Captura al menos un producto a devolver' };
  }
  if (!String(motivo || '').trim()) {
    return { error: 'Motivo requerido' };
  }
  if (!TIPOS_REEMBOLSO.includes(tipoReembolso)) {
    return { error: 'Tipo de reembolso inválido' };
  }
  if (!String(cuartoDestino || '').trim()) {
    return { error: 'Selecciona el cuarto frío destino' };
  }

  // Cantidad por SKU no debe exceder lo originalmente entregado
  const originalPorSku = {};
  for (const l of (lineasOriginales || [])) {
    const sku = String(l?.sku || '');
    if (!sku) continue;
    originalPorSku[sku] = (originalPorSku[sku] || 0) + Number(l?.cantidad || 0);
  }
  for (const it of items) {
    const sku = String(it?.sku || '');
    const qty = Number(it?.cantidad || 0);
    if (!sku) return { error: 'Item sin SKU' };
    if (!Number.isFinite(qty) || qty <= 0) {
      return { error: `Cantidad inválida para ${sku}` };
    }
    const max = originalPorSku[sku] || 0;
    if (max <= 0) {
      return { error: `${sku} no estaba en la orden original` };
    }
    if (qty > max) {
      return { error: `${sku}: máximo ${max} (entregado originalmente), pediste ${qty}` };
    }
  }

  return null;
}

/**
 * Calcula los changes para `update_stocks_atomic` (delta POSITIVO: regresa
 * stock al cuarto destino).
 *
 * @param {Array}  items          — [{ sku, cantidad }, ...]
 * @param {string} cuartoDestino  — id del cuarto frío
 * @param {string} usuario
 * @param {string} ordenRef       — folio o "ID N" para origen
 * @returns {{ changes: Array }}
 */
export function calcDevolucionChanges(items, cuartoDestino, usuario, ordenRef) {
  const changes = [];
  if (!Array.isArray(items)) return { changes };
  const cf = String(cuartoDestino || '').trim();
  if (!cf) return { changes };
  const user = String(usuario || 'Admin');
  const ref = String(ordenRef || 'orden');

  for (const it of items) {
    const sku = String(it?.sku || '');
    const qty = Number(it?.cantidad || 0);
    if (!sku || qty <= 0) continue;
    changes.push({
      cuarto_id: cf,
      sku,
      delta: qty,
      tipo: 'Devolución cliente',
      origen: `Devolución ${ref}`,
      usuario: user,
    });
  }
  return { changes };
}

/**
 * Calcula el ajuste financiero según tipo de reembolso. Solo describe la
 * intención (qué tabla mover y con qué payload base); el caller en
 * supaStore.js es quien ejecuta la mutación real con SQL.
 *
 * Tipos:
 *   - 'Reposicion'   → no toca finanzas (solo se entrega producto físico)
 *   - 'Efectivo'     → genera Egreso contable categoría 'Devoluciones'
 *   - 'Nota credito' → marca requiere_nota_credito=true (CFDI tipo E pendiente);
 *                      si la orden NO estaba facturada, se trata como Efectivo.
 *   - Crédito (orden a crédito + tipo Efectivo): adicional, reduce CxC
 *
 * @param {Object} params
 * @param {Object} params.orden           — { estatus, metodo_pago, total }
 * @param {number} params.totalDevuelto
 * @param {string} params.tipoReembolso
 * @returns {{
 *   accion: 'ninguna'|'egreso'|'nota_credito',
 *   ajustaCxC: boolean,
 *   monto: number,
 *   requiereNotaCredito: boolean,
 *   conceptoEgreso?: string,
 * }}
 */
export function calcAjustePago({ orden, totalDevuelto, tipoReembolso }) {
  const monto = centavos(Number(totalDevuelto || 0));
  const metodo = String(orden?.metodo_pago || orden?.metodoPago || '').toLowerCase();
  const esCredito = metodo.includes('crédito') || metodo.includes('credito') || metodo.includes('fiado');
  const folio = String(orden?.folio || '');
  const conceptoEgreso = `Devolución cliente ${folio ? folio + ' ' : ''}— $${monto}`;

  if (tipoReembolso === 'Reposicion') {
    return { accion: 'ninguna', ajustaCxC: false, monto, requiereNotaCredito: false };
  }

  if (tipoReembolso === 'Nota credito') {
    // Marca el flag para CFDI tipo E pendiente. Si la orden estaba Facturada
    // (CFDI tipo I emitido), Santiago necesita disparar la nota crédito desde
    // facturación cuando se integre.
    const facturada = String(orden?.estatus || '').trim() === 'Facturada';
    return {
      accion: 'nota_credito',
      ajustaCxC: false,
      monto,
      requiereNotaCredito: facturada,
    };
  }

  // tipoReembolso === 'Efectivo'
  // - Si era venta a crédito: además de egreso, reducir CxC pendiente.
  // - Si era venta de contado: solo egreso contable.
  return {
    accion: 'egreso',
    ajustaCxC: esCredito,
    monto,
    requiereNotaCredito: false,
    conceptoEgreso,
  };
}

/**
 * Calcula el total de los items a partir de líneas originales (precio).
 * Cantidad × precio_unitario por línea, sumado.
 *
 * @param {Array} items             — [{ sku, cantidad, precio_unitario? }]
 * @param {Array} lineasOriginales  — [{ sku, precio_unitario }] de la orden
 * @returns {number}
 */
export function calcTotalDevolucion(items, lineasOriginales) {
  if (!Array.isArray(items)) return 0;
  const precioPorSku = {};
  for (const l of (lineasOriginales || [])) {
    const sku = String(l?.sku || '');
    if (!sku) continue;
    const precio = Number(l?.precio_unitario ?? l?.precioUnit ?? l?.precio ?? 0);
    precioPorSku[sku] = precio;
  }
  let total = 0;
  for (const it of items) {
    const sku = String(it?.sku || '');
    const qty = Number(it?.cantidad || 0);
    if (!sku || qty <= 0) continue;
    const precio = Number(it?.precio_unitario ?? it?.precioUnit ?? precioPorSku[sku] ?? 0);
    total += qty * precio;
  }
  return centavos(total);
}
