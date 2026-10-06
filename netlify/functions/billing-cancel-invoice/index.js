// billing-cancel-invoice
// Cancela un CFDI ya timbrado ante el SAT a través de Facturama.
// Tanda 5: motivos SAT (01-04), idempotency, auditoría en invoice_attempts.
//
// Flujo:
//   1. Auth: solo Admin / Facturación / Ventas.
//   2. Lee orden; OL-03A: Ventas solo SU orden (vendedor_id); Admin y
//      Facturación, toda la empresa. Exige CFDI vigente Y estatus 'Facturada'.
//   3. OL-03B: reserva la operación de cancelación en la base
//      (reservar_operacion_cfdi): una sola operación activa o sin resolver por
//      orden; dos cancelaciones simultáneas → una sola llamada al proveedor.
//   4. Llama Facturama DELETE /3/cfdis/{id}?type=issued&motive=XX[&substitution=UUID]
//      con tiempo límite, fuera de toda transacción.
//   5. Clasifica la respuesta por su ESTATUS (un HTTP 200 no basta):
//        canceled  → finalizar 'cancelada': Facturada → Entregada (contrato).
//        requested → 'cancelacion_solicitada': la orden SIGUE Facturada.
//        rejected  → 'cancelacion_rechazada': la orden sigue Facturada.
//        otro / sin respuesta / 5xx / 404 → 'incierta' (conciliación).
//   6. Log invoice_attempts con provider='facturama-cancel' (secundario).
// Todo rechazo de los pasos 1–3 ocurre ANTES del proveedor (cero llamadas).
//
// Importante: facturama_uuid/id/folio se conservan como histórico —
// no se borran. El siguiente timbrado los sobrescribe.

import { badRequest, json, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { insertInvoiceAttempt } from '../_lib/persistence.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { translateFacturamaError } from '../_lib/translateFacturama.js';
import { withSentry } from '../_lib/sentry.js';
import { autorizarOrdenFacturacion, precondicionCancelacion, rolPuedeFacturar } from '../_lib/facturacionGuard.js';
import { clasificarCancelacion, llamarProveedor, respuestaReservaRechazada } from '../_lib/cfdiOperacion.js';

const MOTIVOS_VALIDOS = new Set(['01', '02', '03', '04']);
// Mismos criterios que el timbrado (ver billing-create-invoice).
const PROVEEDOR_TIMEOUT_MS = 8000;
const LEASE_SEGUNDOS = 120;

const cancelarEnFacturama = async ({ facturamaId, motivo, uuidSustituto }, { fetchImpl, getConfig, timeoutMs }) => {
  const config = getConfig();
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const params = new URLSearchParams({ type: 'issued', motive: motivo });
  if (motivo === '01' && uuidSustituto) params.set('substitution', uuidSustituto);
  const url = `${config.baseUrl}/3/cfdis/${encodeURIComponent(facturamaId)}?${params.toString()}`;
  return llamarProveedor(fetchImpl, url, {
    method: 'DELETE',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
  }, timeoutMs);
};

const registrarIntento = async (supabase, intento) => {
  try {
    await insertInvoiceAttempt(intento, supabase);
  } catch (logErr) {
    console.error('[billing-cancel-invoice] bitácora falló:', logErr?.message || logErr);
  }
};

export const createHandler = ({
  getSupabase = getSupabaseAdmin,
  fetchImpl = (...args) => fetch(...args),
  getConfig = getFacturamaConfig,
  timeoutMs = Number(process.env.FACTURAMA_TIMEOUT_MS) || PROVEEDOR_TIMEOUT_MS,
  leaseSegundos = Number(process.env.CFDI_LEASE_SEGUNDOS) || LEASE_SEGUNDOS,
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let body = null;
  let supabase = null;
  let autorizada = false;
  let operacion = null;

  // P0.1 se conserva: sin configuración del servidor → 503 explícito (falla cerrada).
  try {
    supabase = getSupabase();
  } catch (configErr) {
    console.error('[billing-cancel-invoice] configuración ausente:', configErr?.message);
    return json(503, { error: 'Autenticación no configurada en el servidor (faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)', code: 'AUTH_NOT_CONFIGURED' });
  }

  try {
    const auth = await getAuthenticatedProfile(event, { supabase });
    if (auth.errorResponse) return auth.errorResponse;

    if (!rolPuedeFacturar(auth.profile)) {
      return badRequest('Tu rol no puede cancelar facturas');
    }

    body = await readJsonBody(event);
    const { ordenId, motivo, motivoDetalle, uuidSustituto } = body;

    if (!ordenId) return badRequest('ordenId es requerido');
    if (!MOTIVOS_VALIDOS.has(String(motivo || ''))) {
      return badRequest('Motivo SAT inválido (debe ser 01, 02, 03 o 04)');
    }
    if (motivo === '01' && !String(uuidSustituto || '').trim()) {
      return badRequest('El motivo 01 requiere el UUID del CFDI sustituto');
    }

    const { data: orden, error: ordErr } = await supabase
      .from('ordenes')
      .select('id, folio, estatus, vendedor_id, facturama_id, facturama_uuid, facturama_folio, cfdi_cancelado_at')
      .eq('id', ordenId)
      .single();
    if (ordErr || !orden) return badRequest('Orden no encontrada');

    const permiso = autorizarOrdenFacturacion(auth.profile, orden);
    if (!permiso.ok) return json(permiso.status, { error: permiso.error, code: permiso.code });
    autorizada = true;

    const pre = precondicionCancelacion(orden);
    if (!pre.ok) return json(pre.status, { error: pre.error, code: pre.code });
    if (pre.accion === 'ya_cancelada') {
      return ok({ alreadyCancelled: true, ordenId: orden.id, folio: orden.folio });
    }

    // 3. Reserva (transacción corta; sin proveedor todavía).
    const res = await supabase.rpc('reservar_operacion_cfdi', {
      p_orden_id: orden.id, p_tipo: 'cancelacion', p_actor_id: auth.profile.id, p_payload_hash: null,
      p_motivo: String(motivo), p_uuid_sustituto: motivo === '01' ? String(uuidSustituto).trim() : null, p_lease_segundos: leaseSegundos,
    });
    if (res.error) {
      return serverError('No se pudo reservar la cancelación; no se contactó a Facturama. Reintenta.', res.error.message);
    }
    const reserva = res.data || {};
    if (!reserva.ok) {
      if (reserva.codigo === 'YA_CANCELADA') return ok({ alreadyCancelled: true, ordenId: orden.id, folio: orden.folio });
      if (reserva.codigo === 'CANCELACION_PENDIENTE') {
        return json(202, { cancelled: false, pending: true, code: 'CANCELACION_PENDIENTE', operacionId: reserva.operacion_id, ordenId: orden.id, folio: orden.folio });
      }
      const r = respuestaReservaRechazada(reserva);
      return json(r.status, r.body);
    }
    operacion = reserva.operacion_id;

    // 4–5. Proveedor y clasificación por estatus.
    const respuesta = await cancelarEnFacturama({ facturamaId: reserva.facturama_id, motivo: String(motivo), uuidSustituto }, { fetchImpl, getConfig, timeoutMs });
    const clase = clasificarCancelacion(respuesta);
    const datos = {
      ...clase.datos,
      motivo_detalle: motivoDetalle ? String(motivoDetalle).trim() : null,
      cancelado_por: auth.profile.nombre || auth.profile.email || 'Sistema',
    };
    const fin = await supabase.rpc('finalizar_operacion_cfdi', { p_operacion_id: operacion, p_resultado: clase.resultado, p_datos: datos });

    await registrarIntento(supabase, {
      orden_id: orden.id,
      provider: 'facturama-cancel',
      provider_reference: reserva.facturama_uuid || orden.facturama_uuid,
      status: fin.error ? 'review:finalizacion_pendiente'
        : clase.resultado === 'cancelada' ? (fin.data?.estado === 'exitosa' ? 'success' : 'review:orden_no_actualizada')
        : clase.resultado === 'cancelacion_solicitada' ? 'pending'
        : clase.resultado === 'cancelacion_rechazada' ? 'rejected'
        : clase.resultado === 'fallida' ? 'error' : 'uncertain',
      request_payload: { ordenId: orden.id, motivo, motivoDetalle, uuidSustituto, operacion_id: operacion },
      response_payload: { http: respuesta.status ?? null, raw: respuesta.raw ?? null, error: respuesta.error ?? null },
    });

    if (fin.error) {
      return json(502, {
        error: 'Respuesta de Facturama recibida pero no se pudo registrar en la base; la cancelación quedó pendiente de conciliación. No reintentes.',
        code: 'FINALIZACION_PENDIENTE', operacionId: operacion, details: fin.error.message,
      });
    }
    switch (clase.resultado) {
      case 'cancelada':
        if (fin.data?.estado !== 'exitosa') {
          return json(409, {
            error: `El CFDI ${orden.facturama_uuid} se canceló ante el SAT pero la orden ${orden.folio} cambió de estado; no se regresó a Entregada. Quedó en revisión en Facturación.`,
            code: 'ORDEN_CAMBIO_TRAS_CANCELAR', operacionId: operacion,
          });
        }
        return ok({ cancelled: true, ordenId: orden.id, folio: orden.folio, facturamaUuid: orden.facturama_uuid, motivo, operacionId: operacion, cancelResult: respuesta.raw });
      case 'cancelacion_solicitada':
        return json(202, { cancelled: false, pending: true, code: 'CANCELACION_SOLICITADA', ordenId: orden.id, folio: orden.folio, operacionId: operacion,
          message: 'Cancelación solicitada al SAT; el CFDI sigue vigente hasta que se confirme.' });
      case 'cancelacion_rechazada':
        return json(409, { error: 'El SAT/receptor rechazó la cancelación; el CFDI sigue vigente.', code: 'CANCELACION_RECHAZADA', operacionId: operacion });
      case 'fallida':
        return json(422, { error: respuesta.status === 401 ? 'Credenciales de Facturama incorrectas (401)' : translateFacturamaError(respuesta.raw || {}, respuesta.status), code: 'PROVEEDOR_RECHAZO', operacionId: operacion });
      default:
        return json(502, { error: 'No se pudo confirmar con Facturama el resultado de la cancelación. Quedó pendiente de conciliación; no reintentes hasta revisarla.', code: 'RESULTADO_INCIERTO', operacionId: operacion });
    }
  } catch (error) {
    if (autorizada && body?.ordenId && supabase) {
      await registrarIntento(supabase, {
        orden_id: body.ordenId,
        provider: 'facturama-cancel',
        provider_reference: operacion,
        status: operacion ? 'uncertain' : 'error',
        request_payload: body,
        response_payload: { message: error.message, operacion_id: operacion },
      });
    }
    return serverError(error.message || 'No se pudo cancelar el CFDI', error.message);
  }
};

export const handler = withSentry(createHandler());
