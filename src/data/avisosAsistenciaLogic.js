// avisosAsistenciaLogic.js — lógica pura de los avisos de asistencia (PD-01.1).
// La comparten la función programada (cron-avisos-asistencia) y la pantalla de
// configuración (Asistencia → Avisos). Sin efectos: solo arma y valida.

const URL_PERSONA = '/#/mi-asistencia';
const URL_JEFES = '/#/asistencia';
const MAX_NOMBRES_RESUMEN = 4;

/**
 * Convierte la respuesta de asistencia_generar_avisos en los envíos de Web Push.
 * - Cada aviso a la persona va solo a su usuario.
 * - Los avisos a los jefes de una misma corrida se juntan en UNO.
 * @returns {{ usuarioIds: number[], payload: { title: string, body: string, url: string } }[]}
 */
export function armarEnviosAvisos(respuesta) {
  const avisos = Array.isArray(respuesta?.avisos) ? respuesta.avisos : [];
  const jefes = (Array.isArray(respuesta?.jefes) ? respuesta.jefes : []).map(Number).filter(Number.isFinite);
  const envios = [];

  for (const a of avisos) {
    if (a?.destino !== 'empleado') continue;
    const usuario = Number(a.usuario_id);
    if (!Number.isFinite(usuario) || usuario <= 0) continue;
    envios.push({ usuarioIds: [usuario], payload: { title: String(a.titulo || 'Asistencia'), body: String(a.mensaje || ''), url: URL_PERSONA } });
  }

  const deJefes = avisos.filter(a => a?.destino === 'jefes');
  if (deJefes.length === 1 && jefes.length > 0) {
    envios.push({ usuarioIds: jefes, payload: { title: String(deJefes[0].titulo || 'Asistencia'), body: String(deJefes[0].mensaje || ''), url: URL_JEFES } });
  } else if (deJefes.length > 1 && jefes.length > 0) {
    const titulos = deJefes.map(a => String(a.titulo || '')).filter(Boolean);
    const visibles = titulos.slice(0, MAX_NOMBRES_RESUMEN);
    const resto = titulos.length - visibles.length;
    envios.push({
      usuarioIds: jefes,
      payload: {
        title: `Asistencia: ${deJefes.length} avisos`,
        body: visibles.join(' · ') + (resto > 0 ? ` · y ${resto} más` : ''),
        url: URL_JEFES,
      },
    });
  }
  return envios;
}

/** Valores con los que nace la configuración (espejo de la migración 131). */
export const AVISOS_POR_OMISION = {
  activo: true,
  empleado_antes_min: 10,
  empleado_tarde: true,
  empleado_salida_min: 5,
  jefes_sin_marcar_min: 15,
  jefes_retardo: true,
  jefes_sin_salida_min: 60,
  jefes: 'admins',
};

/** Avisos con minutos: límites (espejo de los CHECK de 131) y textos de la pantalla. */
export const AVISOS_CON_MINUTOS = [
  { campo: 'empleado_antes_min', grupo: 'persona', min: 5, max: 60, omision: 10, titulo: 'Antes de su entrada', unidad: 'min antes', ayuda: '"Tu turno empieza a las 8:00. Marca tu entrada al llegar."' },
  { campo: 'empleado_salida_min', grupo: 'persona', min: 0, max: 120, omision: 5, titulo: 'Al terminar su turno sin marcar salida', unidad: 'min después', ayuda: '"Terminó tu turno. No olvides marcar tu salida."' },
  { campo: 'jefes_sin_marcar_min', grupo: 'jefes', min: 0, max: 120, omision: 15, titulo: 'Alguien no ha marcado entrada', unidad: 'min después de su tolerancia', ayuda: '"Juan no ha marcado entrada. Su turno empezó a las 8:00."' },
  { campo: 'jefes_sin_salida_min', grupo: 'jefes', min: 10, max: 240, omision: 60, titulo: 'Alguien no marcó salida', unidad: 'min después del turno', ayuda: '"Juan no marcó salida."' },
];
export const AVISOS_SI_NO = [
  { campo: 'empleado_tarde', grupo: 'persona', titulo: 'Al pasar su tolerancia sin marcar', ayuda: '"No has marcado tu entrada. Márcala ahora."' },
  { campo: 'jefes_retardo', grupo: 'jefes', titulo: 'Alguien llegó con retardo', ayuda: '"Juan llegó con retardo: 25 min tarde."' },
];

/** Formulario de la pantalla a partir de la configuración guardada. Un aviso con minutos apagado = `encendido: false`. */
export function formDeAvisos(config) {
  const c = { ...AVISOS_POR_OMISION, ...(config || {}) };
  const form = { activo: c.activo !== false, jefes: c.jefes === 'dueno' ? 'dueno' : 'admins' };
  for (const a of AVISOS_CON_MINUTOS) {
    const v = config ? config[a.campo] : c[a.campo];
    const apagado = v === null || v === undefined || v === '';
    form[a.campo] = { encendido: !apagado, minutos: String(apagado ? a.omision : v) };
  }
  for (const a of AVISOS_SI_NO) form[a.campo] = Boolean(c[a.campo]);
  return form;
}

/**
 * Valida el formulario y arma p_datos de guardar_avisos_asistencia.
 * @returns {{ error: string } | { datos: object }}
 */
export function buildGuardarAvisosArgs(form) {
  const datos = { activo: Boolean(form?.activo), jefes: form?.jefes === 'dueno' ? 'dueno' : 'admins' };
  for (const a of AVISOS_CON_MINUTOS) {
    const f = form?.[a.campo];
    if (!f?.encendido) { datos[a.campo] = null; continue; }
    const n = Number(String(f.minutos ?? '').trim());
    if (String(f.minutos ?? '').trim() === '' || !Number.isInteger(n) || n < a.min || n > a.max) {
      return { error: `"${a.titulo}": escribe minutos entre ${a.min} y ${a.max}` };
    }
    datos[a.campo] = n;
  }
  for (const a of AVISOS_SI_NO) datos[a.campo] = Boolean(form?.[a.campo]);
  return { datos };
}

const ETIQUETA_TIPO = {
  entrada_proxima: 'Recordatorio de entrada',
  entrada_tarde: 'No ha marcado',
  salida: 'Recordatorio de salida',
  jefes_sin_marcar: 'A jefes: sin marcar',
  jefes_retardo: 'A jefes: retardo',
  jefes_sin_salida: 'A jefes: sin salida',
};
export const etiquetaTipoAviso = (tipo) => ETIQUETA_TIPO[tipo] || 'Aviso';
