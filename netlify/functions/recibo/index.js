// recibo — nota de venta pública con link firmado (Tanda 28).
//
// Dos modos:
//   GET  /nota/:id?t=<token>  (redirect en netlify.toml) — PÚBLICO: el
//        cliente final abre la nota sin login. El token HMAC es la
//        única protección; sin token válido → 403 sin filtrar datos.
//   POST { ordenId }          — AUTENTICADO (Admin/Ventas/Chofer con
//        acceso a la orden, o Facturación): devuelve la URL firmada
//        para compartirla por WhatsApp.
//
// Seam (patrón renovacell): si RECIBO_SECRET no está configurado en
// Netlify, ambos modos responden 501 y la UI degrada con un aviso —
// nada truena. Generar el secret: `openssl rand -hex 32`.

import { json, methodNotAllowed, badRequest, forbidden, readJsonBody, serverError, ok } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { getAuthenticatedProfile, canAccessOrden } from '../_lib/auth.js';
import { withSentry } from '../_lib/sentry.js';
import { firmarRecibo, verificarRecibo, getReciboSecret } from '../_lib/reciboToken.js';
import { buildNotaHtml } from '../_lib/notaHtml.js';
import { importeEnLetras } from '../../../src/data/enLetras.js';

const html = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex',
  },
  body,
});

const paginaError = (titulo, detalle) =>
  `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title></head>
<body style="font-family:system-ui;background:#eef4f6;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<div style="background:#fff;border:1px solid #d9e2e6;border-radius:16px;padding:32px;max-width:420px;text-align:center">
<p style="font-size:40px;margin:0 0 8px">🧊</p><h1 style="font-size:18px;margin:0 0 6px">${titulo}</h1>
<p style="font-size:14px;color:#5a6b7a;margin:0">${detalle}</p></div></body></html>`;

const _handler = async (event) => {
  const secret = getReciboSecret();

  if (event.httpMethod === 'GET') {
    if (!secret) return html(501, paginaError('Notas no disponibles', 'Esta función no está configurada todavía.'));
    const params = event.queryStringParameters || {};
    const ordenId = String(params.o || '').trim();
    const token = String(params.t || '').trim();
    if (!ordenId || !/^\d+$/.test(ordenId)) return html(400, paginaError('Link inválido', 'A este link le falta información.'));
    if (!verificarRecibo(ordenId, token, secret)) {
      return html(403, paginaError('Link inválido', 'Este link de nota no es válido o fue alterado.'));
    }

    const supabase = getSupabaseAdmin();
    const { data: orden, error: ordErr } = await supabase
      .from('ordenes')
      .select('id, folio, folio_nota, cliente_id, cliente_nombre, fecha, created_at, total, estatus, metodo_pago')
      .eq('id', Number(ordenId))
      .maybeSingle();
    if (ordErr) return html(500, paginaError('Error', 'No se pudo cargar la nota. Intenta de nuevo.'));
    if (!orden) return html(404, paginaError('Nota no encontrada', 'La venta ya no existe.'));

    const [{ data: lineas }, { data: cliente }, { data: empresa }] = await Promise.all([
      supabase.from('orden_lineas').select('sku, cantidad, precio_unit, subtotal').eq('orden_id', orden.id).order('id'),
      orden.cliente_id
        ? supabase.from('clientes').select('nombre').eq('id', orden.cliente_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('configuracion_empresa').select('*').eq('id', 1).maybeSingle(),
    ]);

    return html(200, buildNotaHtml({
      empresa,
      orden,
      lineas: lineas || [],
      cliente,
      letras: importeEnLetras(orden.total),
    }));
  }

  if (event.httpMethod === 'POST') {
    if (!secret) return json(501, { error: 'Notas públicas no configuradas (falta RECIBO_SECRET en Netlify)' });

    const auth = await getAuthenticatedProfile(event);
    if (auth.errorResponse) return auth.errorResponse;
    const { profile, supabase } = auth;

    let body;
    try {
      body = await readJsonBody(event);
    } catch {
      return badRequest('JSON inválido');
    }
    const ordenId = Number(body?.ordenId);
    if (!Number.isInteger(ordenId) || ordenId <= 0) return badRequest('ordenId requerido');

    if (supabase) {
      const { data: orden, error } = await supabase
        .from('ordenes')
        .select('id, folio, vendedor_id, ruta_id')
        .eq('id', ordenId)
        .maybeSingle();
      if (error) return serverError('No se pudo verificar la orden', error.message);
      if (!orden) return badRequest('Orden no encontrada');
      // Facturación comparte notas de cualquier orden; el resto pasa por
      // la regla estándar (Admin todo, Ventas las suyas, Chofer su ruta).
      const permitido = profile.rol === 'Facturación' || await canAccessOrden({ profile, orden, supabase });
      if (!permitido) return forbidden('Tu rol no puede compartir la nota de esta orden');
    }

    return ok({ url: `/nota/${ordenId}?t=${firmarRecibo(ordenId, secret)}` });
  }

  return methodNotAllowed(['GET', 'POST']);
};

export const handler = withSentry(_handler);
