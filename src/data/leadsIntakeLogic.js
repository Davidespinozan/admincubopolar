// leadsIntakeLogic.js — helpers puros del endpoint público de leads.
// Tanda 19. Aislados aquí para que el test corra sin Supabase ni HTTP.
//
// El endpoint Netlify Function (netlify/functions/leads-intake) usa
// estos helpers para validar el payload del form de la landing,
// detectar honeypot, normalizar teléfono mexicano y construir el row
// final para INSERT en la tabla `leads`.

/**
 * Normaliza un teléfono mexicano a 10 dígitos.
 *   "+52 618 840 5561"  → "6188405561"
 *   "52-618-840-5561"   → "6188405561"
 *   "(618) 840-5561"    → "6188405561"
 *   "618 840 5561"      → "6188405561"
 *   "01 800 ..."        → null (formato legacy no soportado)
 *
 * Retorna la cadena de 10 dígitos o `null` si no se puede normalizar.
 *
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizarTelefono(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D+/g, '');
  if (!digits) return null;
  // Permitir prefijos de 52 / 521 (México con/sin código móvil legacy).
  let normalized = digits;
  if (normalized.length === 12 && normalized.startsWith('52')) {
    normalized = normalized.slice(2);
  } else if (normalized.length === 13 && normalized.startsWith('521')) {
    normalized = normalized.slice(3);
  }
  if (normalized.length !== 10) return null;
  // Lada mexicana válida empieza por 2-9 (no 0, no 1).
  if (!/^[2-9]/.test(normalized)) return null;
  return normalized;
}

/**
 * Valida el payload del form de la landing.
 * Niveles de retorno:
 *   - { honeypot: true } → bot detectado, caller debe responder 200 OK silencioso.
 *   - { error: 'msg' }   → 400 al cliente.
 *   - { ok: true, telefono: '6188405561' } → seguir.
 *
 * @param {Object} body
 * @returns {Object}
 */
export function validateLeadIntake(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Payload vacío' };
  }
  // Honeypot: el form invisible `company_url`. Si bot lo llenó, descartamos.
  if (body.company_url && String(body.company_url).trim()) {
    return { honeypot: true };
  }
  const nombre = String(body.nombre || '').trim();
  if (nombre.length < 2) {
    return { error: 'Nombre requerido (mínimo 2 caracteres)' };
  }
  if (nombre.length > 120) {
    return { error: 'Nombre demasiado largo' };
  }
  const telefono = normalizarTelefono(body.telefono);
  if (!telefono) {
    return { error: 'Teléfono mexicano de 10 dígitos requerido' };
  }
  return { ok: true, nombre, telefono };
}

/**
 * Concatena los campos del form en un mensaje legible para que el
 * vendedor en LeadsView pueda leer todo el contexto sin necesidad
 * de columnas extra en la tabla.
 *
 * @param {Object} body
 * @returns {string}
 */
export function formatLeadMensaje(body) {
  const lines = [];
  const add = (label, value) => {
    const v = String(value || '').trim();
    if (v) lines.push(`${label}: ${v}`);
  };

  add('Producto', body.producto);
  add('Cantidad', body.cantidad);

  const recurrente = String(body.recurrente || '').trim();
  if (recurrente) {
    const frecuencia = String(body.frecuencia || '').trim();
    if (recurrente === 'Sí' && frecuencia) {
      lines.push(`Recurrente: Sí (${frecuencia})`);
    } else {
      lines.push(`Recurrente: ${recurrente}`);
    }
  }

  add('Negocio', body.negocio);
  add('Zona', body.zona);

  const comentarios = String(body.comentarios || '').trim();
  if (comentarios) {
    if (lines.length > 0) lines.push('');
    lines.push(`Comentarios: ${comentarios}`);
  }

  // Tracking de origen (UTM + cta_origen). Visible al final, separado.
  const tracking = [];
  const ctaOrigen = String(body.cta_origen || '').trim();
  if (ctaOrigen && ctaOrigen !== 'directo') {
    tracking.push(`CTA: ${ctaOrigen}`);
  }
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(k => {
    const v = String(body[k] || '').trim();
    if (v) tracking.push(`${k}: ${v}`);
  });
  if (tracking.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('─── Tracking ───');
    tracking.forEach(t => lines.push(t));
  }

  return lines.join('\n');
}

/**
 * Construye el row para INSERT en la tabla `leads`.
 * Asume que validateLeadIntake ya pasó (nombre + telefono limpios).
 *
 * El campo `origen` por default es 'Landing page'. Si el body trae
 * `utm_source`, lo concatenamos como `Landing - {utm_source}` para
 * que en el LeadsView se distingan campañas distintas sin necesidad
 * de columnas extra.
 *
 * @param {Object} params
 * @param {string} params.nombre — ya validado y trimmed
 * @param {string} params.telefono — ya normalizado (10 dígitos)
 * @param {Object} params.body — payload original
 * @param {string} [params.todayISO] — fecha YYYY-MM-DD inyectable para tests
 * @returns {Object}
 */
export function buildLeadRow({ nombre, telefono, body, todayISO }) {
  const utmSource = String(body?.utm_source || '').trim();
  const origen = utmSource ? `Landing - ${utmSource}` : 'Landing page';
  const fecha = todayISO || new Date().toISOString().slice(0, 10);
  return {
    nombre,
    telefono,
    correo: null, // la landing no captura email hoy
    mensaje: formatLeadMensaje(body),
    origen,
    estatus: 'Nuevo',
    fecha,
  };
}
