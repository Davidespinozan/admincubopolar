import { getSupabaseAdmin } from './supabaseAdmin.js';

const upsertPaymentIntent = async (payload) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('payment_intents')
    .upsert(payload, { onConflict: 'provider,provider_reference' })
    .select()
    .single();

  if (error) throw error;
  return data;
};

const insertWebhookEvent = async (payload) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('payment_webhook_events')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
};

const markWebhookEventProcessed = async (id) => {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('payment_webhook_events')
    .update({ processed: true })
    .eq('id', id);

  if (error) throw error;
};

const syncOrderPayment = async ({ ordenId, provider, providerReference, amount, currency = 'MXN', metodoPago, rawPayload }) => {
  const supabase = getSupabaseAdmin();

  const intent = await upsertPaymentIntent({
    orden_id: ordenId,
    provider,
    provider_reference: providerReference,
    status: 'paid',
    amount,
    currency,
    raw_payload: rawPayload,
  });

  if (!ordenId) return intent;

  const { data: orden, error: ordenError } = await supabase
    .from('ordenes')
    .select('id, cliente_id, folio, total, estatus')
    .eq('id', ordenId)
    .single();

  if (ordenError || !orden) return intent;

  const referencia = `${provider}:${providerReference}`;
  const { data: pagoExistente } = await supabase
    .from('pagos')
    .select('id')
    .eq('referencia', referencia)
    .maybeSingle();

  if (!pagoExistente) {
    await supabase.from('pagos').insert({
      cliente_id: orden.cliente_id || 0,
      orden_id: orden.id,
      monto: amount,
      metodo_pago: metodoPago,
      fecha: new Date().toISOString().slice(0, 10),
      referencia,
      saldo_antes: 0,
      saldo_despues: 0,
      usuario_id: null,
    });
  }

  if (orden.estatus !== 'Facturada') {
    await supabase
      .from('ordenes')
      .update({ estatus: 'Entregada', metodo_pago: metodoPago })
      .eq('id', orden.id);
  }

  return intent;
};

const insertInvoiceAttempt = async (payload) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('invoice_attempts')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export { insertInvoiceAttempt, insertWebhookEvent, markWebhookEventProcessed, syncOrderPayment, upsertPaymentIntent };