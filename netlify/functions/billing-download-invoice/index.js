// billing-download-invoice — entrega el PDF o el XML OFICIAL de un CFDI ya
// timbrado (el que emite Facturama), para verlo o descargarlo.
//
//   1. Auth: Admin / Facturación (toda la empresa) o Ventas (solo SUS órdenes).
//   2. La orden debe tener CFDI timbrado (también sirve uno cancelado: es histórico).
//   3. GET a Facturama con tiempo límite; responde { filename, contentType, base64 }.
//
// No guarda el documento, no cambia nada y no expone credenciales.

import { badRequest, json, methodNotAllowed, ok, readJsonBody } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import { autorizarOrdenFacturacion, rolPuedeFacturar } from '../_lib/facturacionGuard.js';
import { llamarProveedor } from '../_lib/cfdiOperacion.js';
import { contenidoDescarga, formatoValido, mensajeProveedor, mimeDeFormato, nombreArchivoCfdi, precondicionDocumento, urlDescargaCfdi } from '../_lib/cfdiDocumento.js';

const PROVEEDOR_TIMEOUT_MS = 8000;

export const createHandler = ({
  getSupabase = getSupabaseAdmin,
  fetchImpl = (...args) => fetch(...args),
  getConfig = getFacturamaConfig,
  timeoutMs = Number(process.env.FACTURAMA_TIMEOUT_MS) || PROVEEDOR_TIMEOUT_MS,
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let supabase;
  try {
    supabase = getSupabase();
  } catch (configErr) {
    console.error('[billing-download-invoice] configuración ausente:', configErr?.message);
    return json(503, { error: 'Autenticación no configurada en el servidor', code: 'AUTH_NOT_CONFIGURED' });
  }

  const auth = await getAuthenticatedProfile(event, { supabase });
  if (auth.errorResponse) return auth.errorResponse;
  if (!rolPuedeFacturar(auth.profile)) return json(403, { error: 'Tu rol no puede descargar facturas', code: 'ROL_NO_AUTORIZADO' });

  let body;
  try { body = await readJsonBody(event); } catch { return badRequest('JSON inválido'); }
  const ordenId = Number(body?.ordenId);
  const formato = String(body?.formato || '').toLowerCase();
  if (!Number.isInteger(ordenId) || ordenId <= 0) return badRequest('ordenId es requerido');
  if (!formatoValido(formato)) return badRequest('Formato inválido (pdf o xml)');

  const { data: orden, error: ordErr } = await supabase
    .from('ordenes')
    .select('id, folio, vendedor_id, facturama_id, facturama_uuid, facturama_folio, cfdi_cancelado_at')
    .eq('id', ordenId)
    .maybeSingle();
  if (ordErr || !orden) return badRequest('Orden no encontrada');

  const permiso = autorizarOrdenFacturacion(auth.profile, orden);
  if (!permiso.ok) return json(permiso.status, { error: permiso.error, code: permiso.code });
  const pre = precondicionDocumento(orden);
  if (!pre.ok) return json(pre.status, { error: pre.error, code: pre.code });

  const config = getConfig();
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const respuesta = await llamarProveedor(fetchImpl, urlDescargaCfdi(config.baseUrl, orden.facturama_id, formato), {
    method: 'GET',
    headers: { authorization: `Basic ${credentials}`, accept: 'application/json' },
  }, timeoutMs);
  const base64 = contenidoDescarga(respuesta);
  if (!base64) {
    const status = respuesta?.respondio && respuesta.status === 404 ? 404 : 502;
    return json(status, { error: status === 404 ? 'Facturama no encontró esa factura' : mensajeProveedor(respuesta, 'Facturama no entregó el documento'), code: 'PROVEEDOR' });
  }
  return ok({ filename: nombreArchivoCfdi(orden, formato), contentType: mimeDeFormato(formato), base64 });
};

export const handler = withSentry(createHandler());
