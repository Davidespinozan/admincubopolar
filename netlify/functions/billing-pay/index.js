import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';

// billing-pay — /pagar/:id: manda al cliente a su link de pago (Stripe).
// Antes redirigía SIEMPRE al último link creado. Si la venta se editaba o se
// cancelaba después de mandar el link, el cliente pagaba el importe viejo: el
// cobro entraba en el proveedor y el sistema no lo registraba (importe distinto).
// Ahora el link solo sirve si la venta sigue cobrable y el importe del link es
// exactamente lo que falta por pagar.

const pagina = (status, titulo, texto) => ({
  statusCode: status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px"><div style="text-align:center;max-width:360px"><h2>${titulo}</h2><p>${texto}</p></div></body></html>`,
});

/** ¿Este link todavía corresponde a la venta? Lógica pura (probada). */
export function estadoDelLink({ orden, pagado, intent }) {
  if (!intent?.checkout_url) return 'sin_link';
  if (!orden) return 'sin_link';
  if (String(orden.estatus) === 'Cancelada') return 'cancelada';
  const pendiente = Math.round((Number(orden.total || 0) - Number(pagado || 0)) * 100) / 100;
  if (pendiente <= 0) return 'pagada';
  if (Math.abs(Number(intent.amount || 0) - pendiente) > 0.004) return 'importe_cambio';
  return 'vigente';
}

export const createHandler = ({ getSupabase = getSupabaseAdmin } = {}) => async (event) => {
  // Support both query param ?o=ID and path param /pagar/ID
  let ordenId = event.queryStringParameters?.o;
  if (!ordenId && event.path) {
    const match = event.path.match(/\/pagar\/(\d+)/);
    if (match) ordenId = match[1];
  }
  if (!ordenId || !/^\d+$/.test(ordenId)) {
    return { statusCode: 400, body: 'Enlace inválido' };
  }

  const supabase = getSupabase();
  const id = Number(ordenId);
  const [{ data: intent }, { data: orden }, { data: pagos }] = await Promise.all([
    supabase.from('payment_intents').select('checkout_url, amount, status').eq('orden_id', id).not('checkout_url', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('ordenes').select('id, estatus, total').eq('id', id).maybeSingle(),
    supabase.from('pagos').select('monto').eq('orden_id', id),
  ]);
  const pagado = (pagos || []).reduce((t, p) => t + Number(p.monto || 0), 0);

  switch (estadoDelLink({ orden, pagado, intent })) {
    case 'vigente': return { statusCode: 302, headers: { Location: intent.checkout_url, 'Cache-Control': 'no-store' } };
    case 'pagada': return pagina(200, 'Esta compra ya está pagada', 'No necesitas hacer nada más. ¡Gracias!');
    case 'cancelada': return pagina(410, 'Este link ya no es válido', 'La compra fue cancelada. Si tienes dudas, comunícate con nosotros.');
    case 'importe_cambio': return pagina(410, 'Este link ya no es válido', 'El importe de tu compra cambió. Pídenos el link actualizado para pagar.');
    default: return pagina(404, 'Link de pago no encontrado', 'Este enlace ya no es válido o la compra ya fue pagada.');
  }
};

export const handler = withSentry(createHandler());
