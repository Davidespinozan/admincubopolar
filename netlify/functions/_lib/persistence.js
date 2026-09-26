import { getSupabaseAdmin } from './supabaseAdmin.js';
import { evaluatePaymentInvariants, METODO_PAGO_LINK, metodoPagoTrasCobroLink } from './paymentSecurity.js';

// Todas las funciones aceptan un cliente Supabase opcional (último
// parámetro) para poder probarlas con un cliente falso sin red. En
// producción usan el cliente service_role.

const upsertPaymentIntent = async (payload, supabaseOverride) => {
  const supabase = supabaseOverride || getSupabaseAdmin();
  const { data, error } = await supabase
    .from('payment_intents')
    .upsert(payload, { onConflict: 'provider,provider_reference' })
    .select()
    .single();

  if (error) throw error;
  return data;
};

const insertWebhookEvent = async (payload, supabaseOverride) => {
  const supabase = supabaseOverride || getSupabaseAdmin();
  const { data, error } = await supabase
    .from('payment_webhook_events')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
};

const markWebhookEventProcessed = async (id, supabaseOverride) => {
  const supabase = supabaseOverride || getSupabaseAdmin();
  const { error } = await supabase
    .from('payment_webhook_events')
    .update({ processed: true })
    .eq('id', id);

  if (error) throw error;
};

const getCuentaPorCobrarPaymentState = async ({ orden, amount }, supabase) => {
  const { data: cxc, error } = await supabase
    .from('cuentas_por_cobrar')
    .select('id, cliente_id, monto_original, monto_pagado, saldo_pendiente')
    .eq('orden_id', orden.id)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !cxc) {
    return { cxcId: null, clienteId: null, saldoAntes: 0, saldoDespues: 0, nuevoMontoPagado: 0, nuevoEstatus: null };
  }

  const montoOriginal = Number(cxc.monto_original || 0);
  const saldoAntes = Number(cxc.saldo_pendiente || 0);
  const montoPagado = Number(cxc.monto_pagado || 0);
  const nuevoMontoPagado = Math.min(montoOriginal, montoPagado + Number(amount || 0));
  const saldoDespues = Math.max(0, montoOriginal - nuevoMontoPagado);
  const nuevoEstatus = saldoDespues <= 0 ? 'Pagada' : (nuevoMontoPagado > 0 ? 'Parcial' : 'Pendiente');

  return {
    cxcId: cxc.id,
    clienteId: cxc.cliente_id,
    saldoAntes,
    saldoDespues,
    nuevoMontoPagado,
    nuevoEstatus,
  };
};

const applyCuentaPorCobrarPaymentState = async (cxcState, supabase) => {
  if (!cxcState?.cxcId) return;

  const { error: updateError } = await supabase
    .from('cuentas_por_cobrar')
    .update({
      monto_pagado: cxcState.nuevoMontoPagado,
      saldo_pendiente: cxcState.saldoDespues,
      estatus: cxcState.nuevoEstatus,
    })
    .eq('id', cxcState.cxcId);

  if (updateError) throw updateError;

  const deltaSaldo = Number(cxcState.saldoAntes || 0) - Number(cxcState.saldoDespues || 0);
  if (cxcState.clienteId && deltaSaldo > 0) {
    const { error: saldoError } = await supabase.rpc('increment_saldo', {
      p_cli: cxcState.clienteId,
      p_delta: -deltaSaldo,
    });
    if (saldoError) throw saldoError;
  }
};

/**
 * Aplica un pago CONFIRMADO POR EL PROVEEDOR a la orden interna.
 *
 * P0: el caller ya verificó la autenticidad del webhook y obtuvo el pago
 * desde el proveedor (no desde el body). Aquí se comprueban las
 * invariantes financieras antes de tocar pagos / CxC / clientes.saldo:
 *   - la orden existe y no está cancelada
 *   - el estatus del proveedor es "pagado"
 *   - moneda esperada (MXN)
 *   - monto confirmado == ordenes.total (±1 centavo)
 *   - idempotencia por pagos.referencia = `${provider}:${providerReference}`
 *
 * Resultado: { applied, code, ... }. Nunca lanza por una invariante
 * fallida (eso se registra como intent `review:<code>` para revisión
 * manual, sin mutación financiera). Sí lanza por errores de BD para que
 * el proveedor reintente.
 *
 * @param {Object} p
 * @param {'stripe'|'mercadopago'} p.provider
 * @param {string} p.providerReference
 * @param {{ ordenId:number|null, status:string, amount:number, currency:string }} p.payment
 * @param {Object} p.rawPayload
 * @param {{ supabase?: Object }} [deps]
 */
const syncOrderPayment = async ({ provider, providerReference, payment, rawPayload }, deps = {}) => {
  const supabase = deps.supabase || getSupabaseAdmin();
  const ordenId = payment?.ordenId ?? null;

  if (!ordenId) return { applied: false, code: 'orden_id_missing' };

  const { data: orden, error: ordenError } = await supabase
    .from('ordenes')
    .select('id, cliente_id, folio, total, estatus, metodo_pago')
    .eq('id', ordenId)
    .maybeSingle();
  if (ordenError) throw ordenError;
  if (!orden) return { applied: false, code: 'orden_not_found' };

  // P0-2: el monto esperado es el PENDIENTE real (total - SUM(pagos)),
  // no el total. Un abono previo (manual o por link) reduce lo cobrable;
  // un pago por el total sobre una orden con abono va a review.
  const { data: pagosPrevios, error: pagosPreviosError } = await supabase
    .from('pagos')
    .select('monto')
    .eq('orden_id', orden.id);
  if (pagosPreviosError) throw pagosPreviosError;
  const pagado = (pagosPrevios || []).reduce((acc, p) => acc + Number(p?.monto || 0), 0);
  const pendiente = Math.round((Number(orden.total || 0) - pagado) * 100) / 100;
  if (pendiente <= 0) {
    return { applied: false, code: 'duplicate', detail: `orden sin pendiente (pagado=${pagado})` };
  }

  const invariantes = evaluatePaymentInvariants({ provider, providerReference, orden, payment, expectedAmount: pendiente });
  if (!invariantes.ok) {
    // Registro NO financiero: queda en payment_intents con status
    // review:<code> para que Admin lo concilie a mano. No se toca
    // pagos, CxC, saldo ni el estatus de la orden.
    await upsertPaymentIntent({
      orden_id: orden.id,
      provider,
      provider_reference: providerReference,
      status: `review:${invariantes.code}`,
      amount: Number.isFinite(Number(payment?.amount)) ? Number(payment.amount) : 0,
      currency: payment?.currency || 'MXN',
      raw_payload: rawPayload || {},
    }, supabase);
    return { applied: false, code: invariantes.code, detail: invariantes.detail };
  }

  const referencia = `${provider}:${providerReference}`;
  const { data: pagoExistente, error: pagoExistenteError } = await supabase
    .from('pagos')
    .select('id')
    .eq('referencia', referencia)
    .maybeSingle();
  if (pagoExistenteError) throw pagoExistenteError;
  if (pagoExistente) {
    // Webhook repetido: exactamente un efecto financiero. No se vuelve
    // a tocar pagos, CxC, saldo ni orden.
    return { applied: false, code: 'duplicate', pagoId: pagoExistente.id };
  }

  const amount = Number(payment.amount);
  const intent = await upsertPaymentIntent({
    orden_id: orden.id,
    provider,
    provider_reference: providerReference,
    status: 'paid',
    amount,
    currency: payment.currency,
    raw_payload: rawPayload || {},
  }, supabase);

  const cxcState = await getCuentaPorCobrarPaymentState({ orden, amount }, supabase);
  const { data: insertedPago, error: pagoError } = await supabase
    .from('pagos')
    .insert({
      // P0: sin centinela 0. Orden anónima (Público en general) → NULL
      // (migración 068 quita el NOT NULL). NUNCA se inventa un cliente.
      cliente_id: orden.cliente_id ?? null,
      orden_id: orden.id,
      cxc_id: cxcState.cxcId,
      monto: amount,
      // P0.2: método del catálogo (PAYMENT_FORM_MAP), nunca el proveedor.
      metodo_pago: METODO_PAGO_LINK,
      fecha: new Date().toISOString().slice(0, 10),
      referencia,
      saldo_antes: cxcState.saldoAntes,
      saldo_despues: cxcState.saldoDespues,
      usuario_id: null,
    })
    .select('id')
    .single();

  if (pagoError) {
    // Carrera entre dos entregas del mismo webhook: el índice único de
    // pagos.referencia gana. Sin segundo efecto financiero.
    if (pagoError.code === '23505') return { applied: false, code: 'duplicate', intentId: intent?.id };
    throw pagoError;
  }

  try {
    await applyCuentaPorCobrarPaymentState(cxcState, supabase);
  } catch (error) {
    if (insertedPago?.id) {
      await supabase.from('pagos').delete().eq('id', insertedPago.id);
    }
    throw error;
  }

  if (orden.estatus !== 'Facturada') {
    // P0.2: metodo_pago conserva el contrato del catálogo. Crédito (PPD)
    // se respeta; cualquier otro método pasa a 'QR / Link de pago'.
    const { error: ordenUpdError } = await supabase
      .from('ordenes')
      .update({ estatus: 'Entregada', metodo_pago: metodoPagoTrasCobroLink(orden.metodo_pago) })
      .eq('id', orden.id);
    if (ordenUpdError) throw ordenUpdError;
  }

  return { applied: true, code: 'applied', pagoId: insertedPago?.id, intentId: intent?.id };
};

const insertInvoiceAttempt = async (payload, supabaseOverride) => {
  const supabase = supabaseOverride || getSupabaseAdmin();
  const { data, error } = await supabase
    .from('invoice_attempts')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export { insertInvoiceAttempt, insertWebhookEvent, markWebhookEventProcessed, syncOrderPayment, upsertPaymentIntent };
