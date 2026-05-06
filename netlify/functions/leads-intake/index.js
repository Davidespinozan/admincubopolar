// leads-intake — endpoint público para recibir leads del formulario de
// la landing (cubopolar.com). Tanda 19.
//
// Particularidades vs los demás handlers de billing-*:
//   1. NO requiere auth (es POST público desde landing).
//   2. CORS abierto SOLO a orígenes whitelisted.
//   3. Honeypot: si el field invisible `company_url` viene lleno → bot
//      detectado, respondemos 200 silencioso para no dar pistas al
//      atacante.
//   4. Dedup por teléfono en ventana 5 min: si el mismo número ya
//      mandó un lead recientemente, respondemos 200 sin INSERT (el
//      cliente probablemente hizo doble-click o regresó al form).
//   5. Insert con service_role; los datos quedan con origen='Landing
//      page' o 'Landing - {utm_source}' según UTMs.
//
// Contrato: ver docs/LEADS_INTAKE.md.

import { badRequest, methodNotAllowed, readJsonBody, serverError } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import { validateLeadIntake, buildLeadRow } from '../../../src/data/leadsIntakeLogic.js';

// Orígenes aceptados. Si el header Origin no coincide, devolvemos
// 403 (no CORS) para que un atacante que pruebe el endpoint desde
// otros sitios sepa que está cerrado. NO incluimos 'null' (file://)
// porque solo testing local lo necesita.
const ALLOWED_ORIGINS = new Set([
  'https://cubopolar.com',
  'https://www.cubopolar.com',
]);

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : '',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

const _handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || '';

  // Preflight CORS: el browser hace OPTIONS antes del POST.
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(origin),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      ...methodNotAllowed(['POST', 'OPTIONS']),
      headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
    };
  }

  // Origin whitelist. Si no está permitido, 403.
  if (!ALLOWED_ORIGINS.has(origin)) {
    return {
      statusCode: 403,
      headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Origin no permitido' }),
    };
  }

  let body = null;
  try {
    body = await readJsonBody(event);
  } catch {
    return {
      ...badRequest('JSON inválido'),
      headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
    };
  }

  // Validación + honeypot.
  const validation = validateLeadIntake(body);
  if (validation.honeypot) {
    // Bot detectado. 200 silencioso (no le decimos que cazamos).
    return {
      statusCode: 200,
      headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, received: true }),
    };
  }
  if (validation.error) {
    return {
      ...badRequest(validation.error),
      headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
    };
  }

  const { nombre, telefono } = validation;
  const supabase = getSupabaseAdmin();

  try {
    // Dedup: si ya hay lead con este teléfono en últimos 5 min, NO
    // insertar. El cliente probablemente hizo doble click o regresó
    // al form. Devolvemos 200 con cached:true para que la UX en la
    // landing siga viéndose como éxito.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: dup } = await supabase
      .from('leads')
      .select('id')
      .eq('telefono', telefono)
      .gte('created_at', fiveMinAgo)
      .limit(1)
      .maybeSingle();

    if (dup?.id) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, deduped: true, id: dup.id }),
      };
    }

    const row = buildLeadRow({ nombre, telefono, body });
    const { data: inserted, error } = await supabase
      .from('leads')
      .insert(row)
      .select('id')
      .single();

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id: inserted?.id }),
    };
  } catch (error) {
    return {
      ...serverError('No se pudo guardar el lead', error.message),
      headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
    };
  }
};

export const handler = withSentry(_handler);
