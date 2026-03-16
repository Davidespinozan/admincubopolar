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

const syncCuentaPorCobrarPayment = async ({ orden, amount, referencia }) => {
  const supabase = getSupabaseAdmin();
  const { data: cxc, error } = await supabase
    .from('cuentas_por_cobrar')
    .select('id, cliente_id, monto_original, monto_pagado, saldo_pendiente')
    .eq('orden_id', orden.id)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !cxc) {
    return { cxcId: null, saldoAntes: 0, saldoDespues: 0 };
  }

  const montoOriginal = Number(cxc.monto_original || 0);
  const saldoAntes = Number(cxc.saldo_pendiente || 0);
  const montoPagado = Number(cxc.monto_pagado || 0);
  const nuevoMontoPagado = Math.min(montoOriginal, montoPagado + Number(amount || 0));
  const saldoDespues = Math.max(0, montoOriginal - nuevoMontoPagado);
  const nuevoEstatus = saldoDespues <= 0 ? 'Pagada' : (nuevoMontoPagado > 0 ? 'Parcial' : 'Pendiente');

  const { error: updateError } = await supabase
    .from('cuentas_por_cobrar')
    .update({
      monto_pagado: nuevoMontoPagado,
      saldo_pendiente: saldoDespues,
      estatus: nuevoEstatus,
    })
    .eq('id', cxc.id);

  if (updateError) throw updateError;

  const deltaSaldo = saldoAntes - saldoDespues;
  if (cxc.cliente_id && deltaSaldo > 0) {
    const { error: saldoError } = await supabase.rpc('increment_saldo', {
      p_cli: cxc.cliente_id,
      p_delta: -deltaSaldo,
    });
    if (saldoError) throw saldoError;
  }

  return { cxcId: cxc.id, saldoAntes, saldoDespues, referencia };
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
    const cxcSync = await syncCuentaPorCobrarPayment({ orden, amount, referencia });
    await supabase.from('pagos').insert({
      cliente_id: orden.cliente_id || 0,
      orden_id: orden.id,
      cxc_id: cxcSync.cxcId,
      monto: amount,
      metodo_pago: metodoPago,
      fecha: new Date().toISOString().slice(0, 10),
      referencia,
      saldo_antes: cxcSync.saldoAntes,
      saldo_despues: cxcSync.saldoDespues,
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