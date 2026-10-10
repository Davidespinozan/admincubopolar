// rastro.js — deja en `auditoria` lo que el servidor hace con la llave de
// servicio. Esas escrituras no pasan por la bitácora de 120 (que solo ve la API
// del usuario): sin esto, crear un usuario o restablecer una contraseña no dejaba
// rastro de quién lo hizo.
//
// Nunca lanza ni detiene la operación: si no se pudo registrar, se anota en el
// log del servidor y se sigue (la operación ya ocurrió).

/**
 * @param {object} supabase cliente con llave de servicio
 * @param {{actor?: {id?: number, nombre?: string}, accion: string, modulo: string, detalle: string}} r
 * @returns {Promise<boolean>} true si quedó registrado
 */
export async function registrarRastro(supabase, { actor, accion, modulo, detalle }) {
  try {
    const { error } = await supabase.from('auditoria').insert({
      usuario: actor?.nombre || 'Sistema',
      usuario_id: actor?.id ?? null,
      accion, modulo,
      detalle: String(detalle || '').slice(0, 500),
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[rastro] no se pudo registrar', { accion, modulo, error: error?.message });
    return false;
  }
}
