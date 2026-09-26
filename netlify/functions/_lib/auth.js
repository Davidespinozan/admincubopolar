import { json, unauthorized } from './http.js';
import { getSupabaseAdmin } from './supabaseAdmin.js';

const getBearerToken = (event) => {
  const header = event?.headers?.authorization || event?.headers?.Authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim();
};

// P0.1 — FAIL CLOSED.
//
// ANTES (commit c10c671 "Make billing auth resilient to missing Supabase
// env vars"): si faltaban SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY este
// helper devolvía un perfil { rol: 'Admin' } sin validar ningún token,
// y canAccessOrden devolvía true cuando no había cliente Supabase. Era
// un seam de conveniencia para probar billing en local sin env; en
// producción significaba "sin configuración → Admin".
//
// AHORA: configuración ausente → 503 explícito (configuration error).
// Nunca se construye un perfil privilegiado sin JWT válido + fila en
// `usuarios`. Los tests inyectan `deps.supabase` (cliente falso); no
// existe bypass productivo.

const configurationError = () =>
  json(503, { error: 'Autenticación no configurada en el servidor (faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)', code: 'AUTH_NOT_CONFIGURED' });

/**
 * @param {Object} event - evento Netlify
 * @param {{ supabase?: Object }} [deps] - solo para tests (cliente falso)
 */
const getAuthenticatedProfile = async (event, deps = {}) => {
  const token = getBearerToken(event);
  if (!token) return { errorResponse: unauthorized('Missing authorization token') };

  let supabase;
  try {
    supabase = deps.supabase || getSupabaseAdmin();
  } catch (error) {
    console.error('[auth] configuración ausente:', error?.message);
    return { errorResponse: configurationError() };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  const authUser = authData?.user;
  if (authError || !authUser) return { errorResponse: unauthorized('Invalid authorization token') };

  let profile = null;
  if (authUser.id) {
    const { data } = await supabase
      .from('usuarios')
      .select('id, nombre, email, rol, estatus, auth_id')
      .eq('auth_id', authUser.id)
      .maybeSingle();
    profile = data || null;
  }

  if (!profile && authUser.email) {
    const normalizedEmail = String(authUser.email).trim().toLowerCase();
    const { data } = await supabase
      .from('usuarios')
      .select('id, nombre, email, rol, estatus, auth_id')
      .eq('email', normalizedEmail)
      .maybeSingle();
    profile = data || null;

    if (profile && !profile.auth_id) {
      await supabase.from('usuarios').update({ auth_id: authUser.id }).eq('id', profile.id);
      profile = { ...profile, auth_id: authUser.id };
    }
  }

  if (!profile) return { errorResponse: unauthorized('User profile not found') };
  if (profile.estatus && profile.estatus !== 'Activo') return { errorResponse: unauthorized('User is inactive') };

  return { authUser, profile, supabase };
};

const canAccessOrden = async ({ profile, orden, supabase }) => {
  if (!profile || !orden) return false;
  if (profile.rol === 'Admin') return true;
  // Sin cliente Supabase no se puede verificar propiedad → denegar.
  if (!supabase) return false;

  if (profile.rol === 'Ventas') {
    // Allow access if this Ventas rep owns the order, or if vendedor_id is not set (legacy orders)
    if (!orden.vendedor_id) return true;
    return String(orden.vendedor_id) === String(profile.id);
  }

  if (profile.rol === 'Chofer') {
    if (!orden.ruta_id) return false;
    const { data: ruta } = await supabase
      .from('rutas')
      .select('chofer_id')
      .eq('id', orden.ruta_id)
      .maybeSingle();
    return String(ruta?.chofer_id || '') === String(profile.id);
  }

  return false;
};

export { canAccessOrden, getAuthenticatedProfile };
