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

// Tiendas E5 — PERFIL EFECTIVO.
//
// `usuarios.rol` es el rol GUARDADO. Desde la migración 145 un usuario con rol guardado
// "Ventas" asignado a una tienda propia es, para la base de datos, "Ventas Tienda": no opera
// nada central. Estas funciones corren con service role y leían el rol guardado, así que lo
// habrían tratado como Ventas central (facturar, generar links de pago, notas).
//
// La regla NO se copia aquí: se le pregunta a la base con la misma función que usan
// erp_actor() y erp_roles_activos() (`erp_usuario_de_tienda`, 145). Si responde que sí, el
// perfil que reciben TODAS las funciones lleva rol "Ventas Tienda" (sin accesos adicionales)
// y ninguna lista de roles central lo acepta. Solo se consulta para el rol guardado "Ventas":
// los demás roles no cambian ni hacen una llamada más.
//   · La función no existe (145 todavía no aplicada) → no puede haber tiendas: Ventas central.
//   · Cualquier otro error → FALLA CERRADO (503): no se asume Ventas central sin saberlo.
export const ROL_VENTAS_TIENDA = 'Ventas Tienda';
const funcionInexistente = (error) => ['PGRST202', '42883'].includes(String(error?.code || ''));

const aplicarPerfilEfectivo = async (supabase, profile) => {
  if (profile?.rol !== 'Ventas') return { profile };
  let res;
  try {
    res = await supabase.rpc('erp_usuario_de_tienda', { p_usuario_id: profile.id });
  } catch (error) {
    res = { data: null, error };
  }
  if (res?.error) {
    if (funcionInexistente(res.error)) return { profile };
    console.error('[auth] no se pudo resolver el perfil efectivo:', res.error?.code || res.error?.message);
    return { errorResponse: json(503, { error: 'No se pudo verificar tu perfil. Intenta de nuevo.', code: 'PERFIL_NO_VERIFICADO' }) };
  }
  if (res?.data === true) {
    return { profile: { ...profile, rol: ROL_VENTAS_TIENDA, rol_guardado: 'Ventas', accesos_extra: [] } };
  }
  return { profile };
};

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

  // R5 (083): el perfil se resuelve SOLO por identidad canónica
  // (usuarios.auth_id = uid de Auth, único por 082). Ya no existe la
  // búsqueda por email ni la vinculación automática de auth_id: un Auth
  // user sin perfil vinculado falla cerrado (401), aunque su email coincida
  // con el de algún perfil. La vinculación la hace admin-create-user al
  // dar de alta.
  let profile = null;
  if (authUser.id) {
    const { data } = await supabase
      .from('usuarios')
      // '*' y no una lista: es_dueno / accesos_extra / debe_cambiar_password llegan
      // con la migración 120; el perfil debe resolverse igual antes de ella (o si se revierte).
      .select('*')
      .eq('auth_id', authUser.id)
      .maybeSingle();
    profile = data || null;
  }

  if (!profile) return { errorResponse: unauthorized('User profile not found') };
  if (profile.estatus && profile.estatus !== 'Activo') return { errorResponse: unauthorized('User is inactive') };
  // GER-1 (120): con la contraseña temporal no hay autoridad (igual que erp_actor en la base).
  if (profile.debe_cambiar_password) return { errorResponse: unauthorized('Password change required') };

  // Tiendas E5: el perfil con que el servidor trata al usuario (Ventas Tienda ≠ Ventas).
  const efectivo = await aplicarPerfilEfectivo(supabase, profile);
  if (efectivo.errorResponse) return { errorResponse: efectivo.errorResponse };

  return { authUser, profile: efectivo.profile, supabase };
};

const canAccessOrden = async ({ profile, orden, supabase }) => {
  if (!profile || !orden) return false;
  if (profile.rol === 'Admin') return true;
  // Sin cliente Supabase no se puede verificar propiedad → denegar.
  if (!supabase) return false;

  // GER-1 (120): el acceso adicional de Ventas vale como Ventas (mismas órdenes propias).
  // Tiendas E5: el perfil de tienda no accede a órdenes por las funciones centrales (ni a las suyas:
  // su venta se cobra en el POS, sin links de pago ni notas de este camino).
  if (profile.rol === ROL_VENTAS_TIENDA) return false;
  const accesos = Array.isArray(profile.accesos_extra) ? profile.accesos_extra : [];
  if (profile.rol === 'Ventas' || accesos.includes('Ventas')) {
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
