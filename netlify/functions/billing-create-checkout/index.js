import { Preference } from 'mercadopago';
import { badRequest, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { canAccessOrden, getAuthenticatedProfile } from '../_lib/auth.js';
import { getMercadoPagoClient, getStripeClient } from '../_lib/providers.js';
import { upsertPaymentIntent } from '../_lib/persistence.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';

const supabaseConfigured = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  try {
    const auth = await getAuthenticatedProfile(event);
    if (auth.errorResponse) return auth.errorResponse;

    const body = await readJsonBody(event);
    const { provider, ordenId, amount, currency = 'MXN', description, items, customer, successUrl, cancelUrl } = body;

    if (!provider || !ordenId || !amount || Number(amount) <= 0) {
      return badRequest('provider, ordenId and amount are required');
    }

    // When Supabase is configured: validate order from DB and use canonical amount/items.
    // When not configured: trust the values from the request (original behavior).
    let canonicalAmount = Number(amount);
    let canonicalItems = items || [];
    let ordenFolio = ordenId;

    if (supabaseConfigured()) {
      const supabase = getSupabaseAdmin();
      const { data: orden, error: ordenError } = await supabase
        .from('ordenes')
        .select('id, folio, total, cliente_id, cliente_nombre, vendedor_id, ruta_id, estatus')
        .eq('id', ordenId)
        .single();

      if (ordenError || !orden) return badRequest('Orden no encontrada');
      if (!(await canAccessOrden({ profile: auth.profile, orden, supabase }))) {
        return badRequest('No tienes permiso para generar cobro de esta orden');
      }
      if (orden.estatus === 'Cancelada') return badRequest('No se puede cobrar una orden cancelada');

      canonicalAmount = Number(orden.total || 0);
      if (canonicalAmount <= 0) return badRequest('La orden no tiene un total válido para cobro');
      if (Math.abs(Number(amount) - canonicalAmount) > 0.01) {
        return badRequest('El monto solicitado no coincide con el total de la orden');
      }

      ordenFolio = orden.folio || ordenId;

      const { data: lineas } = await supabase
        .from('orden_lineas')
        .select('sku, cantidad, precio_unit, subtotal')
        .eq('orden_id', orden.id);

      canonicalItems = (lineas || []).map((linea) => ({
        sku: linea.sku,
        name: linea.sku,
        quantity: Number(linea.cantidad || 0),
        unitPrice: Number(linea.precio_unit || 0),
        subtotal: Number(linea.subtotal || 0),
      })).filter((linea) => linea.quantity > 0 && linea.unitPrice >= 0);
    }

    // Build line items from order items or fallback to single line
    const buildStripeLineItems = () => {
      if (canonicalItems.length > 0) {
        const lineItems = canonicalItems.map(item => ({
          quantity: item.quantity || 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: Math.round(Number(item.unitPrice) * 100),
            product_data: { name: item.name || item.sku || 'Producto' },
          },
        }));
        // Add IVA line if totals don't match
        const itemsTotal = canonicalItems.reduce((s, i) => s + (i.quantity || 1) * Number(i.unitPrice || 0), 0);
        const diff = Math.round((canonicalAmount - itemsTotal) * 100);
        if (diff > 0) {
          lineItems.push({ quantity: 1, price_data: { currency: currency.toLowerCase(), unit_amount: diff, product_data: { name: 'IVA 16%' } } });
        }
        return lineItems;
      }
      return [{ quantity: 1, price_data: { currency: currency.toLowerCase(), unit_amount: Math.round(canonicalAmount * 100), product_data: { name: description || `Orden ${ordenFolio}` } } }];
    };

    if (provider === 'stripe') {
      if (!successUrl || !cancelUrl) return badRequest('successUrl and cancelUrl are required for Stripe');
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        payment_method_types: ['card'],
        customer_email: customer?.email || auth.authUser?.email || undefined,
        metadata: { orden_id: String(ordenId) },
        line_items: buildStripeLineItems(),
      });

      // Non-blocking — don't let DB persistence failure block the checkout URL
      upsertPaymentIntent({
        orden_id: ordenId,
        provider: 'stripe',
        provider_reference: session.id,
        status: session.status || 'open',
        amount: canonicalAmount,
        currency,
        checkout_url: session.url,
        raw_payload: session,
      }).catch(err => console.warn('[billing] upsertPaymentIntent failed (non-critical):', err?.message));

      return ok({ provider: 'stripe', checkoutUrl: session.url, reference: session.id });
    }

    if (provider === 'mercadopago') {
      const preference = new Preference(getMercadoPagoClient());
      const mpItems = canonicalItems.length > 0
        ? canonicalItems.map((item, i) => ({
            id: `${ordenId}-${i}`,
            title: item.name || item.sku || 'Producto',
            quantity: item.quantity || 1,
            currency_id: currency,
            unit_price: Number(item.unitPrice || 0),
          }))
        : [{ id: String(ordenId), title: description || `Orden ${ordenFolio}`, quantity: 1, currency_id: currency, unit_price: canonicalAmount }];

      // Add IVA if items don't cover full amount
      if (canonicalItems.length > 0) {
        const itemsTotal = mpItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
        const diff = canonicalAmount - itemsTotal;
        if (diff > 0.01) {
          mpItems.push({ id: `${ordenId}-iva`, title: 'IVA 16%', quantity: 1, currency_id: currency, unit_price: Math.round(diff * 100) / 100 });
        }
      }

      const result = await preference.create({
        body: {
          external_reference: String(ordenId),
          items: mpItems,
          payer: {
            email: customer?.email || auth.authUser?.email || 'pagos@cubopolar.local',
          },
          back_urls: successUrl && cancelUrl ? {
            success: successUrl,
            failure: cancelUrl,
            pending: cancelUrl,
          } : undefined,
          auto_return: successUrl ? 'approved' : undefined,
          metadata: { orden_id: String(ordenId) },
        },
      });

      upsertPaymentIntent({
        orden_id: ordenId,
        provider: 'mercadopago',
        provider_reference: String(result.id),
        status: result.status || 'pending',
        amount: canonicalAmount,
        currency,
        checkout_url: result.init_point || result.sandbox_init_point || null,
        raw_payload: result,
      }).catch(err => console.warn('[billing] upsertPaymentIntent failed (non-critical):', err?.message));

      return ok({
        provider: 'mercadopago',
        checkoutUrl: result.init_point || result.sandbox_init_point || null,
        reference: result.id,
      });
    }

    return badRequest('Unsupported provider');
  } catch (error) {
    return serverError('Could not create checkout', error.message);
  }
};
