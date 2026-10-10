// billing-send-invoice — envía por correo un CFDI YA timbrado, a través de
// Facturama (el correo lleva el PDF y el XML oficiales).
//
//   1. Auth: Admin / Facturación (toda la empresa) o Ventas (solo SUS órdenes),
//      la misma regla que timbrar y cancelar (facturacionGuard).
//   2. La orden debe tener CFDI vigente (no se envía uno cancelado).
//   3. Correo: el que escribe el operador o, si no, el del cliente. Se valida.
//   4. POST a Facturama con tiempo límite. Éxito = 2xx Y success === true.
//   5. Bitácora en invoice_attempts (provider 'facturama-email'), sin el
//      documento ni credenciales. Un fallo de bitácora no cambia la respuesta.
//
// No cambia la orden, el CFDI, pagos ni inventario. Reenviar es inofensivo.

import { badRequest, json, methodNotAllowed, ok, readJsonBody } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { insertInvoiceAttempt } from '../_lib/persistence.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import { autorizarOrdenFacturacion, rolPuedeFacturar } from '../_lib/facturacionGuard.js';
import { llamarProveedor } from '../_lib/cfdiOperacion.js';
import { envioExitoso, mensajeProveedor, precondicionDocumento, resolverEmailDestino, urlEnvioCfdi } from '../_lib/cfdiDocumento.js';

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
    console.error('[billing-send-invoice] configuración ausente:', configErr?.message);
    return json(503, { error: 'Autenticación no configurada en el servidor', code: 'AUTH_NOT_CONFIGURED' });
  }

  const auth = await getAuthenticatedProfile(event, { supabase });
  if (auth.errorResponse) return auth.errorResponse;
  if (!rolPuedeFacturar(auth.profile)) return json(403, { error: 'Tu rol no puede enviar facturas', code: 'ROL_NO_AUTORIZADO' });

  let body;
  try { body = await readJsonBody(event); } catch { return badRequest('JSON inválido'); }
  const ordenId = Number(body?.ordenId);
  if (!Number.isInteger(ordenId) || ordenId <= 0) return badRequest('ordenId es requerido');

  const { data: orden, error: ordErr } = await supabase
    .from('ordenes')
    .select('id, folio, cliente_id, vendedor_id, facturama_id, facturama_uuid, facturama_folio, cfdi_cancelado_at')
    .eq('id', ordenId)
    .maybeSingle();
  if (ordErr || !orden) return badRequest('Orden no encontrada');

  const permiso = autorizarOrdenFacturacion(auth.profile, orden);
  if (!permiso.ok) return json(permiso.status, { error: permiso.error, code: permiso.code });
  const pre = precondicionDocumento(orden, { paraEnviar: true });
  if (!pre.ok) return json(pre.status, { error: pre.error, code: pre.code });

  let correoCliente = null;
  if (orden.cliente_id) {
    const { data: cli } = await supabase.from('clientes').select('correo').eq('id', orden.cliente_id).maybeSingle();
    correoCliente = cli?.correo || null;
  }
  const destino = resolverEmailDestino(body?.email, correoCliente);
  if (!destino.ok) return json(destino.status, { error: destino.error, code: destino.code });

  const config = getConfig();
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const respuesta = await llamarProveedor(fetchImpl, urlEnvioCfdi(config.baseUrl, orden.facturama_id, destino.email), {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, accept: 'application/json' },
  }, timeoutMs);
  const enviado = envioExitoso(respuesta);

  try {
    await insertInvoiceAttempt({
      orden_id: orden.id, provider: 'facturama-email', status: enviado ? 'sent' : 'error',
      request_payload: { email: destino.email, facturama_id: orden.facturama_id },
      response_payload: enviado ? { success: true } : { status: respuesta?.status ?? null, mensaje: mensajeProveedor(respuesta, 'sin mensaje') },
    }, supabase);
  } catch (logErr) {
    console.error('[billing-send-invoice] bitácora falló:', logErr?.message || logErr);
  }

  if (!enviado) {
    return json(502, { error: mensajeProveedor(respuesta, 'Facturama no aceptó el envío de la factura'), code: 'PROVEEDOR' });
  }
  return ok({ sent: true, email: destino.email, ordenId: orden.id, folio: orden.folio });
};

export const handler = withSentry(createHandler());
