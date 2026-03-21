import { unauthorized } from './http.js';
import { getSupabaseAdmin } from './supabaseAdmin.js';

const getBearerToken = (event) => {
  const header = event?.headers?.authorization || event?.headers?.Authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim();
};

// If Supabase env vars are not configured, return a permissive admin-like profile
// so billing functions work even without SUPABASE_SERVICE_ROLE_KEY in Netlify.
const isSupabaseConfigured = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const getAuthenticatedProfile = async (event) => {
  if (!isSupabaseConfigured()) {
    return {
      authUser: null,
      profile: { id: null, nombre: 'Sistema', email: null, rol: 'Admin', estatus: 'Activo' },
      supabase: null,
    };
  }

  const token = getBearerToken(event);
  if (!token) return { errorResponse: unauthorized('Missing authorization token') };

  const supabase = getSupabaseAdmin();
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
  if (!supabase) return true; // Supabase not configured — allow through

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