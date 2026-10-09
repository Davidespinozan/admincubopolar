// admin-reset-password — GER-1 (mig 120): Administración restablece la
// contraseña de un usuario a una TEMPORAL (p. ej. cuando la olvidó). La cuenta
// queda sin autoridad hasta que su dueño elige una propia (cambio obligatorio).
//
// Reglas (las mismas de guardar_usuario; lógica pura en usuariosLogic):
//   · solo Admin; a otro Admin solo el Dueño; al Dueño nadie por aquí;
//   · nadie restablece la suya por esta vía (para eso está "Cambiar contraseña").
// Orden: Auth primero (la contraseña cambia), después fijar_password_temporal
// (huella + cambio obligatorio). Si el segundo paso falla se responde 500 con
// code TEMPORAL_NO_FIJADA: la contraseña ya es la nueva pero sin cambio
// obligatorio; reintentar el restablecimiento lo corrige (idempotente).
//
// Se exporta `createHandler(deps)` para tests sin red.

import { badRequest, forbidden, json, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import { permisosSobreUsuario, validarPasswordTemporal } from '../../../src/data/usuariosLogic.js';

export const createHandler = ({
  getProfile = getAuthenticatedProfile,
  getSupabase = getSupabaseAdmin,
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  const authResult = await getProfile(event);
  if (authResult.errorResponse) return authResult.errorResponse;
  const actor = authResult.profile;
  if (actor?.rol !== 'Admin') return forbidden('Solo Administración restablece contraseñas');

  let body = null;
  try {
    body = await readJsonBody(event);
  } catch {
    return badRequest('JSON inválido');
  }
  const usuarioId = Number(body?.usuarioId);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) return badRequest('Usuario requerido');
  const v = validarPasswordTemporal(body?.password);
  if (v.error) return badRequest(v.error);

  const supabase = getSupabase();
  let objetivo = null;
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', usuarioId)
      .maybeSingle();
    if (error) throw error;
    objetivo = data || null;
  } catch (error) {
    return serverError('No se pudo leer el usuario', error.message);
  }
  if (!objetivo) return badRequest('Usuario no encontrado');
  if (!objetivo.auth_id) return badRequest('Ese usuario no tiene cuenta de acceso');

  const permisos = permisosSobreUsuario(actor, objetivo);
  if (!permisos.password) return forbidden(permisos.motivo || 'No puedes restablecer esa contraseña');

  try {
    const { error } = await supabase.auth.admin.updateUserById(objetivo.auth_id, { password: body.password });
    if (error) return badRequest(error.message || 'No se pudo cambiar la contraseña');
  } catch (error) {
    return serverError('No se pudo cambiar la contraseña', error.message);
  }

  try {
    const { error } = await supabase.rpc('fijar_password_temporal', { p_usuario_id: objetivo.id, p_por: actor?.nombre || null });
    if (error) throw error;
  } catch (error) {
    console.error('[admin-reset-password] TEMPORAL_NO_FIJADA', { usuarioId: objetivo.id, error: error?.message });
    return json(500, {
      error: 'La contraseña se cambió, pero no quedó marcada como temporal. Vuelve a restablecerla.',
      code: 'TEMPORAL_NO_FIJADA',
    });
  }

  return ok({ usuario: { id: objetivo.id, nombre: objetivo.nombre }, temporal: true });
};

export const handler = withSentry(createHandler());
