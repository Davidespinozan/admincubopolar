// cron-avisos-asistencia — avisos de asistencia al celular (PD-01.1, mig 131).
// Cada 5 minutos pide a la base los avisos que tocan AHORA
// (asistencia_generar_avisos: uno por tipo, persona, turno y día; nunca
// repite) y los manda por Web Push:
//   - a la persona: solo a SUS dispositivos ("marca tu entrada", "no has
//     marcado", "marca tu salida");
//   - a los jefes (Admins o solo el Dueño, según la configuración): quién no
//     ha marcado, quién llegó con retardo, quién no marcó salida. Varios en la
//     misma corrida viajan en UN solo aviso.
// La base registra el aviso ANTES del envío: si el envío falla se pierde ese
// aviso, pero nunca se repite en bucle. No escribe asistencias.
// Seam: sin vars VAPID responde skipped y no toca nada.

import { ok, serverError } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import { enviarPush, pushHabilitado } from '../_lib/push.js';
import { armarEnviosAvisos } from '../../../src/data/avisosAsistenciaLogic.js';

const _handler = async () => {
  if (!pushHabilitado()) return ok({ skipped: 'VAPID no configurado' });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('asistencia_generar_avisos');
  if (error) return serverError('No se pudieron generar los avisos de asistencia', error.message);

  const envios = armarEnviosAvisos(data);
  let enviadas = 0;
  let borradas = 0;
  for (const envio of envios) {
    const r = await enviarPush(supabase, envio.payload, { usuarioIds: envio.usuarioIds });
    enviadas += r.enviadas;
    borradas += r.borradas;
  }
  return ok({ activo: Boolean(data?.activo), avisos: (data?.avisos || []).length, envios: envios.length, enviadas, suscripcionesBorradas: borradas });
};

export const handler = withSentry(_handler);
