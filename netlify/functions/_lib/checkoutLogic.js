// checkoutLogic.js — P0: el cliente NO decide el monto a cobrar.
//
// Lógica pura para construir un checkout (Stripe / Mercado Pago) a
// partir de la orden interna. El frontend solo manda { provider,
// ordenId, successUrl, cancelUrl }; monto, líneas, moneda y email salen
// de la base de datos.

const CENTAVO = 0.01;
const MONEDA = 'MXN';

/**
 * Decide si se puede generar un checkout cobrable para la orden.
 *
 * @param {Object} p
 * @param {Object|null} p.orden        - fila de ordenes { id, total, estatus }
 * @param {Array}  [p.pagos]           - filas de pagos con orden_id = orden.id
 * @param {Array}  [p.intents]         - filas de payment_intents de la orden
 * @returns {{ ok: boolean, code?: string }}
 */
export function checkCheckoutAllowed({ orden, pagos = [], intents = [] }) {
  if (!orden || !orden.id) return { ok: false, code: 'orden_not_found' };
  if (String(orden.estatus || '') === 'Cancelada') return { ok: false, code: 'orden_cancelada' };
  const total = Number(orden.total);
  if (!Number.isFinite(total) || total <= 0) return { ok: false, code: 'total_invalid' };
  if ((pagos || []).length > 0) return { ok: false, code: 'already_paid' };
  if ((intents || []).some(i => String(i?.status || '') === 'paid')) return { ok: false, code: 'already_paid' };
  return { ok: true };
}

/**
 * Construye el plan de cobro con valores autoritativos de la BD.
 *
 * Las líneas se usan solo si su suma coincide con ordenes.total (±1
 * centavo); si no, se cobra una sola línea por el total de la orden.
 * Así el monto cobrado SIEMPRE es ordenes.total.
 *
 * @param {Object} p
 * @param {Object} p.orden     - { id, folio, total, cliente_nombre }
 * @param {Array}  [p.lineas]  - orden_lineas { sku, cantidad, precio_unit, subtotal }
 * @param {Array}  [p.productos] - productos { sku, nombre }
 * @param {Object|null} [p.cliente] - clientes { nombre, correo }
 */
export function buildCheckoutPlan({ orden, lineas = [], productos = [], cliente = null }) {
  const total = Number(orden.total);
  const nombreCliente = String(cliente?.nombre || orden.cliente_nombre || 'Cliente').trim();
  const description = `Orden ${orden.folio || orden.id} — ${nombreCliente}`;

  const items = (lineas || [])
    .map(l => {
      const quantity = Number(l.cantidad);
      const unitPrice = Number(l.precio_unit);
      const prod = (productos || []).find(p => String(p.sku) === String(l.sku));
      return {
        name: String(prod?.nombre || l.sku || 'Producto'),
        sku: String(l.sku || ''),
        quantity,
        unitPrice,
      };
    })
    .filter(i => Number.isFinite(i.quantity) && i.quantity > 0 && Number.isFinite(i.unitPrice) && i.unitPrice >= 0);

  const sumaLineas = items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0);
  const lineasCuadran = items.length > 0 && Math.abs(sumaLineas - total) <= CENTAVO;

  const emailRaw = typeof cliente?.correo === 'string' ? cliente.correo.trim().toLowerCase() : '';
  const customerEmail = /^\S+@\S+\.\S+$/.test(emailRaw) ? emailRaw : null;

  return {
    amount: Number(total.toFixed(2)),
    currency: MONEDA,
    description,
    items: lineasCuadran ? items : [{ name: description, sku: '', quantity: 1, unitPrice: Number(total.toFixed(2)) }],
    customerEmail,
    customerName: nombreCliente,
  };
}

/**
 * Valida el body que el frontend manda al endpoint. Solo referencia a
 * la operación; nunca montos.
 */
export function validateCheckoutRequest(body) {
  const provider = String(body?.provider || '').toLowerCase();
  if (provider !== 'stripe' && provider !== 'mercadopago') return { error: 'provider inválido' };
  const ordenIdStr = String(body?.ordenId ?? '').trim();
  if (!/^\d+$/.test(ordenIdStr) || Number(ordenIdStr) <= 0) return { error: 'ordenId inválido' };
  const successUrl = typeof body?.successUrl === 'string' && /^https?:\/\//.test(body.successUrl) ? body.successUrl : null;
  const cancelUrl = typeof body?.cancelUrl === 'string' && /^https?:\/\//.test(body.cancelUrl) ? body.cancelUrl : null;
  if (provider === 'stripe' && (!successUrl || !cancelUrl)) return { error: 'successUrl y cancelUrl son requeridos para Stripe' };
  return { provider, ordenId: Number(ordenIdStr), successUrl, cancelUrl };
}
