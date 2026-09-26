// billing-create-checkout — P0 seguridad financiera.
//
// ANTES: endpoint público; monto, líneas y email venían del body.
// AHORA:
//   - Requiere JWT de un usuario activo del ERP (getAuthenticatedProfile)
//     y autorización sobre la orden (canAccessOrden: Admin todo; Ventas
//     sus órdenes; Chofer las de su ruta).
//   - El body solo trae { provider, ordenId, successUrl, cancelUrl }.
//   - Monto, líneas, moneda y email se leen de la BD (checkoutLogic).
//   - No se genera un segundo checkout cobrable para una orden ya pagada
//     o cancelada (409).
//
// Decisión documentada: NO existe checkout público para clientes
// externos. El link que recibe el cliente final es /pagar/:id
// (billing-pay), que solo redirige a un checkout YA creado por staff
// autenticado; el cliente no puede elegir monto ni otra orden.
//
// Se exporta `createHandler(deps)` para tests sin red.

import { Preference } from 'mercadopago';
import { badRequest, forbidden, json, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { canAccessOrden, getAuthenticatedProfile } from '../_lib/auth.js';
import { getMercadoPagoClient, getStripeClient } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { upsertPaymentIntent } from '../_lib/persistence.js';
import { buildCheckoutPlan, checkCheckoutAllowed, validateCheckoutRequest } from '../_lib/checkoutLogic.js';
import { withSentry } from '../_lib/sentry.js';

const defaultCreateStripeSession = async (params) => {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.create(params);
};

const defaultCreateMercadoPagoPreference = async (body) => {
  const preference = new Preference(getMercadoPagoClient());
  return preference.create({ body });
};

export const createHandler = ({
  getProfile = getAuthenticatedProfile,
  getSupabase = getSupabaseAdmin,
  createStripeSession = defaultCreateStripeSession,
  createMercadoPagoPreference = defaultCreateMercadoPagoPreference,
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  // 1. Autenticación
  const auth = await getProfile(event);
  if (auth?.errorResponse) return auth.errorResponse;
  if (!auth?.profile) return forbidden('Perfil no resuelto');

  let body;
  try {
    body = await readJsonBody(event);
  } catch {
    return badRequest('JSON inválido');
  }

  const req = validateCheckoutRequest(body);
  if (req.error) return badRequest(req.error);
  const { provider, ordenId, successUrl, cancelUrl } = req;

  try {
    const supabase = getSupabase();

    // 2. Orden autoritativa
    const { data: orden, error: ordenError } = await supabase
      .from('ordenes')
      .select('id, folio, total, estatus, cliente_id, cliente_nombre, vendedor_id, ruta_id')
      .eq('id', ordenId)
      .maybeSingle();
    if (ordenError) throw ordenError;
    if (!orden) return json(404, { error: 'Orden no encontrada' });

    // 3. Autorización sobre ESTA orden
    const permitido = await canAccessOrden({ profile: auth.profile, orden, supabase });
    if (!permitido) return forbidden('No tienes acceso a esta orden');

    // 4. ¿Cobrable?
    const [{ data: pagos, error: pagosError }, { data: intents, error: intentsError }] = await Promise.all([
      supabase.from('pagos').select('id').eq('orden_id', orden.id),
      supabase.from('payment_intents').select('id, status').eq('orden_id', orden.id),
    ]);
    if (pagosError) throw pagosError;
    if (intentsError) throw intentsError;
    const permiso = checkCheckoutAllowed({ orden, pagos: pagos || [], intents: intents || [] });
    if (!permiso.ok) {
      const mensajes = {
        orden_cancelada: 'La orden está cancelada',
        total_invalid: 'La orden no tiene un total cobrable',
        already_paid: 'La orden ya tiene un pago registrado',
      };
      return json(409, { error: mensajes[permiso.code] || 'No se puede cobrar esta orden', code: permiso.code });
    }

    // 5. Monto y líneas desde BD
    const [{ data: lineas }, { data: productos }, clienteRes] = await Promise.all([
      supabase.from('orden_lineas').select('sku, cantidad, precio_unit, subtotal').eq('orden_id', orden.id),
      supabase.from('productos').select('sku, nombre'),
      orden.cliente_id
        ? supabase.from('clientes').select('nombre, correo').eq('id', orden.cliente_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const plan = buildCheckoutPlan({ orden, lineas: lineas || [], productos: productos || [], cliente: clienteRes?.data || null });

    if (provider === 'stripe') {
      const session = await createStripeSession({
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        payment_method_types: ['card'],
        customer_email: plan.customerEmail || undefined,
        client_reference_id: String(orden.id),
        metadata: { orden_id: String(orden.id) },
        line_items: plan.items.map(item => ({
          quantity: item.quantity,
          price_data: {
            currency: plan.currency.toLowerCase(),
            unit_amount: Math.round(item.unitPrice * 100),
            product_data: { name: item.name },
          },
        })),
      });

      try {
        await upsertPaymentIntent({
          orden_id: orden.id,
          provider: 'stripe',
          provider_reference: session.id,
          status: session.status || 'open',
          amount: plan.amount,
          currency: plan.currency,
          checkout_url: session.url,
          raw_payload: session,
        }, supabase);
      } catch (persistErr) {
        console.error('[billing-create-checkout] persistencia stripe falló:', persistErr?.message || persistErr);
        return serverError('Checkout creado pero no se pudo guardar. Reintenta.', persistErr?.message || String(persistErr));
      }

      return ok({ provider: 'stripe', checkoutUrl: session.url, reference: session.id, amount: plan.amount });
    }

    // mercadopago
    const result = await createMercadoPagoPreference({
      external_reference: String(orden.id),
      items: plan.items.map((item, i) => ({
        id: `${orden.id}-${i}`,
        title: item.name,
        quantity: item.quantity,
        currency_id: plan.currency,
        unit_price: Number(item.unitPrice.toFixed(2)),
      })),
      payer: plan.customerEmail ? { email: plan.customerEmail } : undefined,
      back_urls: successUrl && cancelUrl ? { success: successUrl, failure: cancelUrl, pending: cancelUrl } : undefined,
      auto_return: successUrl ? 'approved' : undefined,
      metadata: { orden_id: String(orden.id) },
    });

    const checkoutUrl = result.init_point || result.sandbox_init_point || null;
    try {
      await upsertPaymentIntent({
        orden_id: orden.id,
        provider: 'mercadopago',
        provider_reference: String(result.id),
        status: result.status || 'pending',
        amount: plan.amount,
        currency: plan.currency,
        checkout_url: checkoutUrl,
        raw_payload: result,
      }, supabase);
    } catch (persistErr) {
      console.error('[billing-create-checkout] persistencia mercadopago falló:', persistErr?.message || persistErr);
      return serverError('Checkout creado pero no se pudo guardar. Reintenta.', persistErr?.message || String(persistErr));
    }

    return ok({ provider: 'mercadopago', checkoutUrl, reference: result.id, amount: plan.amount });
  } catch (error) {
    return serverError(error.message || 'Could not create checkout', error.message);
  }
};

export const handler = withSentry(createHandler());
