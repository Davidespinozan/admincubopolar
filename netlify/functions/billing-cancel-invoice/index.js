// billing-cancel-invoice
// Cancela un CFDI ya timbrado ante el SAT a través de Facturama.
// Tanda 5: motivos SAT (01-04), idempotency, auditoría en invoice_attempts.
//
// Flujo:
//   1. Auth: solo Admin / Facturación / Ventas.
//   2. Lee orden; OL-03A: Ventas solo SU orden (vendedor_id); Admin y
//      Facturación, toda la empresa. Exige CFDI vigente Y estatus 'Facturada'.
//   3. Llama Facturama DELETE /3/cfdis/{id}?type=issued&motive=XX[&substitution=UUID].
//   4. UPDATE ordenes condicional Facturada → Entregada + cfdi_cancelado_*
//      (mismo CFDI, aún no cancelado); se verifica que tocó la orden.
//   5. Log invoice_attempts con provider='facturama-cancel'.
// Todo rechazo de los pasos 1–2 ocurre ANTES del proveedor (cero llamadas).
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
import { autorizarOrdenFacturacion, precondicionCancelacion, rolPuedeFacturar, updateCondicionalOk } from '../_lib/facturacionGuard.js';

const MOTIVOS_VALIDOS = new Set(['01', '02', '03', '04']);
const cancelOnFacturama = async ({ facturamaId, motivo, uuidSustituto }, { fetchImpl, getConfig }) => {
  const config = getConfig();
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');

  const params = new URLSearchParams({
    type: 'issued',
    motive: motivo,
  });
  if (motivo === '01' && uuidSustituto) {
    params.set('substitution', uuidSustituto);
  }

  const url = `${config.baseUrl}/3/cfdis/${encodeURIComponent(facturamaId)}?${params.toString()}`;

  const response = await fetchImpl(url, {
    method: 'DELETE',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/json',
    },
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('Credenciales de Facturama incorrectas (401)');
    if (response.status === 404) throw new Error('CFDI no encontrado en Facturama (¿ya fue cancelado?)');
    const friendly = translateFacturamaError(raw, response.status);
    const detail = JSON.stringify(raw?.ModelState || raw);
    const err = new Error(friendly);
    err.facturamaDetail = detail;
    err.facturamaRaw = raw;
    throw err;
  }

  return raw;
};

export const createHandler = ({
  getSupabase = getSupabaseAdmin,
  fetchImpl = (...args) => fetch(...args),
  getConfig = getFacturamaConfig,
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let body = null;
  let supabase = null;
  let autorizada = false;

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

    const cancelResult = await cancelOnFacturama({
      facturamaId: orden.facturama_id,
      motivo,
      uuidSustituto,
    }, { fetchImpl, getConfig });

    const nowIso = new Date().toISOString();
    const upd = await supabase
      .from('ordenes')
      .update({
        estatus: 'Entregada',
        cfdi_cancelado_at: nowIso,
        cfdi_cancelado_motivo: motivo,
        cfdi_cancelado_motivo_detalle: motivoDetalle ? String(motivoDetalle).trim() : null,
        cfdi_cancelado_uuid_sustituto: motivo === '01' ? String(uuidSustituto).trim() : null,
        cfdi_cancelado_por: auth.profile.nombre || auth.profile.email || 'Sistema',
      })
      .eq('id', orden.id)
      .eq('estatus', 'Facturada')
      .eq('facturama_uuid', orden.facturama_uuid)
      .is('cfdi_cancelado_at', null)
      .select('id');
    const actualizada = updateCondicionalOk(upd, orden.id);

    try {
      await insertInvoiceAttempt({
        orden_id: orden.id,
        provider: 'facturama-cancel',
        provider_reference: orden.facturama_uuid,
        status: actualizada ? 'success' : 'review:orden_no_actualizada',
        request_payload: { ordenId: orden.id, motivo, motivoDetalle, uuidSustituto },
        response_payload: cancelResult,
      }, supabase);
    } catch (logErr) {
      console.error('[billing-cancel-invoice] bitácora falló:', logErr?.message || logErr);
    }

    if (!actualizada) {
      return json(409, {
        error: `El CFDI ${orden.facturama_uuid} se canceló ante el SAT pero la orden ${orden.folio} cambió de estado; no se regresó a Entregada. Revísalo en Facturación.`,
        code: 'ORDEN_CAMBIO_TRAS_CANCELAR',
        details: upd?.error?.message || null,
      });
    }

    return ok({
      cancelled: true,
      ordenId: orden.id,
      folio: orden.folio,
      facturamaUuid: orden.facturama_uuid,
      motivo,
      cancelResult,
    });
  } catch (error) {
    if (autorizada && body?.ordenId && supabase) {
      try {
        await insertInvoiceAttempt({
          orden_id: body.ordenId,
          provider: 'facturama-cancel',
          provider_reference: null,
          status: 'error',
          request_payload: body,
          response_payload: {
            message: error.message,
            facturamaDetail: error.facturamaDetail,
            facturamaRaw: error.facturamaRaw,
          },
        }, supabase);
      } catch {}
    }
    return serverError(error.message || 'No se pudo cancelar el CFDI', error.message);
  }
};

export const handler = withSentry(createHandler());
