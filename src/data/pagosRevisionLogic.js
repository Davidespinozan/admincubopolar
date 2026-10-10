// pagosRevisionLogic.js — pagos por link que el proveedor (Stripe / Mercado Pago) SÍ cobró
// pero que el sistema no registró porque algo no cuadraba. El webhook los deja en
// `payment_intents` con status `review:<código>` y no toca pagos, CxC ni la orden.
// Antes no se veían en ninguna pantalla: el cliente había pagado y nadie se enteraba.
// Aquí solo se LEEN; se resuelven a mano (registrar el cobro o devolver el dinero).

// Códigos en los que NO hubo cobro (no hay nada que conciliar): no se muestran.
const SIN_COBRO = new Set(['status_not_paid']);

const MOTIVOS = {
  amount_mismatch: 'El cliente pagó un importe distinto al que la venta tenía pendiente.',
  orden_no_cobrable: 'El cliente pagó una venta que ya estaba cancelada o no admitía cobro.',
  currency_mismatch: 'El pago llegó en una moneda distinta a pesos.',
  orden_total_invalid: 'La venta no tenía un total válido al llegar el pago.',
  amount_invalid: 'El proveedor reportó un importe que no se pudo leer.',
};
const QUE_HACER = {
  amount_mismatch: 'Revisa en el proveedor cuánto pagó. Registra ese cobro a mano en la venta (con la referencia) o devuelve la diferencia.',
  orden_no_cobrable: 'Devuelve el dinero desde el proveedor, o reactiva la venta y registra el cobro a mano con la referencia.',
};
const PROVEEDORES = { stripe: 'Stripe', mercadopago: 'Mercado Pago' };

/** Código de revisión de un status ("review:amount_mismatch" → "amount_mismatch"); null si no es revisión. */
export function codigoRevision(status) {
  const m = /^review:(.+)$/.exec(String(status || ''));
  return m ? m[1] : null;
}

/**
 * Pagos por link que necesitan revisión, listos para mostrarse (más recientes primero).
 * @param {Array} intents filas de payment_intents
 * @param {Array} ordenes órdenes del store (para folio y cliente)
 */
export function pagosEnRevision(intents, ordenes = []) {
  const porId = new Map((ordenes || []).map(o => [String(o.id), o]));
  return (intents || [])
    .map(i => ({ i, codigo: codigoRevision(i?.status) }))
    .filter(x => x.codigo && !SIN_COBRO.has(x.codigo))
    .map(({ i, codigo }) => {
      const o = porId.get(String(i.orden_id)) || null;
      return {
        id: i.id, codigo,
        ordenId: i.orden_id ?? null,
        folio: o?.folio || (i.orden_id ? `Venta #${i.orden_id}` : 'Sin venta'),
        cliente: o?.cliente || o?.cliente_nombre || '',
        monto: Number(i.amount) || 0,
        totalVenta: o ? Number(o.total) || 0 : null,
        proveedor: PROVEEDORES[i.provider] || String(i.provider || ''),
        referencia: String(i.provider_reference || ''),
        fecha: i.updated_at || i.created_at || null,
        motivo: MOTIVOS[codigo] || `El pago no cuadró con la venta (${codigo}).`,
        queHacer: QUE_HACER[codigo] || 'Revisa el pago en el proveedor y regístralo a mano o devuélvelo.',
      };
    })
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
}
