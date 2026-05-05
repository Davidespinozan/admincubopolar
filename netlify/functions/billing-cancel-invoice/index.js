// billing-cancel-invoice
// Cancela un CFDI ya timbrado ante el SAT a través de Facturama.
// Tanda 5: motivos SAT (01-04), idempotency, auditoría en invoice_attempts.
//
// Flujo:
//   1. Auth: solo Admin / Facturación / Ventas.
//   2. Lee orden, valida que tenga CFDI vigente (isFacturada = true).
//   3. Llama Facturama DELETE /3/cfdis/{id}?type=issued&motive=XX[&substitution=UUID].
//   4. UPDATE ordenes: estatus='Entregada' + cfdi_cancelado_*.
//   5. Log invoice_attempts con provider='facturama-cancel'.
//
// Importante: facturama_uuid/id/folio se conservan como histórico —
// no se borran. El siguiente timbrado los sobrescribe.

import { badRequest, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { insertInvoiceAttempt } from '../_lib/persistence.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { translateFacturamaError } from '../_lib/translateFacturama.js';

const MOTIVOS_VALIDOS = new Set(['01', '02', '03', '04']);
const ROLES_PERMITIDOS = new Set(['Admin', 'Facturación', 'Ventas']);

const cancelOnFacturama = async ({ facturamaId, motivo, uuidSustituto }) => {
  const config = getFacturamaConfig();
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');

  const params = new URLSearchParams({
    type: 'issued',
    motive: motivo,
  });
  if (motivo === '01' && uuidSustituto) {
    params.set('substitution', uuidSustituto);
  }

  const url = `${config.baseUrl}/3/cfdis/${encodeURIComponent(facturamaId)}?${params.toString()}`;

  const response = await fetch(url, {
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

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let body = null;

  try {
    const auth = await getAuthenticatedProfile(event);
    if (auth.errorResponse) return auth.errorResponse;

    if (!ROLES_PERMITIDOS.has(auth.profile.rol)) {
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

    const supabase = getSupabaseAdmin();

    const { data: orden, error: ordErr } = await supabase
      .from('ordenes')
      .select('id, folio, facturama_id, facturama_uuid, facturama_folio, cfdi_cancelado_at')
      .eq('id', ordenId)
      .single();
    if (ordErr || !orden) return badRequest('Orden no encontrada');

    if (!orden.facturama_uuid || !orden.facturama_id) {
      return badRequest('La orden no tiene un CFDI timbrado para cancelar');
    }
    if (orden.cfdi_cancelado_at) {
      return ok({ alreadyCancelled: true, ordenId: orden.id, folio: orden.folio });
    }

    const cancelResult = await cancelOnFacturama({
      facturamaId: orden.facturama_id,
      motivo,
      uuidSustituto,
    });

    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('ordenes')
      .update({
        estatus: 'Entregada',
        cfdi_cancelado_at: nowIso,
        cfdi_cancelado_motivo: motivo,
        cfdi_cancelado_motivo_detalle: motivoDetalle ? String(motivoDetalle).trim() : null,
        cfdi_cancelado_uuid_sustituto: motivo === '01' ? String(uuidSustituto).trim() : null,
        cfdi_cancelado_por: auth.profile.nombre || auth.profile.email || 'Sistema',
      })
      .eq('id', orden.id);

    if (updErr) throw updErr;

    await insertInvoiceAttempt({
      orden_id: orden.id,
      provider: 'facturama-cancel',
      provider_reference: orden.facturama_uuid,
      status: 'success',
      request_payload: { ordenId: orden.id, motivo, motivoDetalle, uuidSustituto },
      response_payload: cancelResult,
    });

    return ok({
      cancelled: true,
      ordenId: orden.id,
      folio: orden.folio,
      facturamaUuid: orden.facturama_uuid,
      motivo,
      cancelResult,
    });
  } catch (error) {
    if (body?.ordenId) {
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
        });
      } catch {}
    }
    return serverError(error.message || 'No se pudo cancelar el CFDI', error.message);
  }
};
