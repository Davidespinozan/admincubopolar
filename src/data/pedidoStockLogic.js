// pedidoStockLogic.js — existencia al levantar una venta (decisión del dueño, 2026-10-10; mig 137).
//   · Mostrador: el cliente se lleva el hielo ahí mismo → sin existencia NO se vende (bloqueo).
//   · A domicilio: es un pedido que se surte después → se levanta aunque falte; la pantalla
//     dice cuánto hay que producir. El candado físico sigue en la carga del camión y la entrega.
// Misma regla que el servidor (`crear_orden`): suma de cuartos fríos por producto; media barra,
// picada y triturada se revisan juntas contra la barra entera (133).
import { esDerivadoBarra, avisoFaltaBarra } from './barraVentaLogic';

const entero = (v) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x > 0 ? x : 0; };

/** Suma las líneas por producto: [{ sku, qty }] → { sku: cantidad }. */
export function pedidoPorSku(lineas) {
  const pedido = {};
  for (const l of lineas || []) {
    const q = entero(l?.qty ?? l?.cantidad);
    if (l?.sku && q > 0) pedido[l.sku] = (pedido[l.sku] || 0) + q;
  }
  return pedido;
}

/** Productos (no de barra) cuyo pedido supera la existencia: [{ sku, pedido, disponible, falta }]. */
export function faltantesDePedido(pedido, getStock) {
  const faltan = [];
  for (const [sku, q] of Object.entries(pedido || {})) {
    if (esDerivadoBarra(sku)) continue;
    const disponible = entero(getStock(sku));
    if (q > disponible) faltan.push({ sku, pedido: q, disponible, falta: q - disponible });
  }
  return faltan.sort((a, b) => a.sku.localeCompare(b.sku));
}

/**
 * Qué hacer con la existencia de una venta.
 * @returns {{ hayFaltante:boolean, faltan:Array, barra:string|null, bloqueo:string|null, permitirSinStock:boolean }}
 *   bloqueo: mensaje que impide la venta (solo mostrador). permitirSinStock: lo que se manda al servidor.
 */
export function revisarExistencia({ pedido, getStock, mostrador }) {
  const faltan = faltantesDePedido(pedido, getStock);
  const barra = avisoFaltaBarra(pedido, getStock);
  const hayFaltante = faltan.length > 0 || !!barra;
  let bloqueo = null;
  if (hayFaltante && mostrador) {
    bloqueo = faltan.length
      ? `Stock insuficiente de ${faltan[0].sku} (disp: ${faltan[0].disponible}). En mostrador solo se vende lo que hay; para surtirlo después cámbialo a "A domicilio".`
      : `${barra} En mostrador solo se vende lo que hay; para surtirlo después cámbialo a "A domicilio".`;
  }
  return { hayFaltante, faltan, barra, bloqueo, permitirSinStock: hayFaltante && !mostrador };
}

/** Texto corto de lo que hay que producir ("27 de HPC-5K, 3 de HPC-25K"). */
export function textoFaltantes(faltan, nombreDe = (sku) => sku) {
  return (faltan || []).map(f => `${f.falta.toLocaleString('es-MX')} de ${nombreDe(f.sku)}`).join(', ');
}
