// perfilEfectivo.js — Tiendas E5: el perfil con el que el SERVIDOR trata al usuario.
//
// `usuarios.rol` es el rol guardado. Desde la migración 145, un usuario con rol guardado
// "Ventas" asignado a una tienda es, para el servidor, "Ventas Tienda": no lee ni opera lo
// central. La pantalla no lo deduce por su cuenta: le pregunta al servidor (erp_actor(), la
// misma función que usan los permisos) y pinta el menú de ese perfil. Si la consulta falla,
// se queda con el rol guardado: el servidor sigue negando lo que no corresponde.
export const ROL_VENTAS_TIENDA = 'Ventas Tienda';

/** Aplica al usuario de la sesión el rol que respondió erp_actor(). Puro. */
export function aplicarPerfilEfectivo(user, actor) {
  if (!user) return user;
  const fila = Array.isArray(actor) ? actor[0] : actor;
  const rol = fila?.rol;
  if (!rol || rol === user.rol) return user;
  // Solo se acepta el cambio que el servidor define: Ventas → Ventas Tienda.
  if (rol !== ROL_VENTAS_TIENDA || user.rol !== 'Ventas') return user;
  return { ...user, rol: ROL_VENTAS_TIENDA, rol_guardado: user.rol, accesos_extra: [] };
}

/** Pregunta al servidor por el perfil efectivo (solo hace falta para el rol guardado Ventas). */
export async function resolverPerfilEfectivo(supabase, user) {
  if (!user || user.rol !== 'Ventas' || !supabase?.rpc) return user;
  try {
    const { data, error } = await supabase.rpc('erp_actor');
    if (error) return user;
    return aplicarPerfilEfectivo(user, data);
  } catch {
    return user;
  }
}
