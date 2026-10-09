// asistenciaLogic.js — WF-0 + PD-01 (mig 116): reloj checador geolocalizado.
//
// Lógica pura (sin React ni Supabase). El servidor decide todo lo que importa
// (persona, hora, turno, geocerca, retardo); aquí solo se arman argumentos,
// se traducen códigos y errores a mensajes y se da formato.
//   - Una sola lectura de ubicación por toque (sin rastreo continuo).
//   - ENTRADA solo dentro de la geocerca; SALIDA puede ser fuera (queda marcada).
//   - Sin cola offline: sin conexión no se marca (la hora es la del servidor).

import { nuevoOperacionId } from './stockContratosLogic';

export const ZONA_NEGOCIO = 'America/Mazatlan';
export const ROL_EMPLEADO = 'Empleado';

/** Opciones de la lectura única de ubicación (sin caché: posición fresca). */
export const GEO_OPCIONES = Object.freeze({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });

export const DIAS_SEMANA = [
  { n: 1, corto: 'Lun' }, { n: 2, corto: 'Mar' }, { n: 3, corto: 'Mié' }, { n: 4, corto: 'Jue' },
  { n: 5, corto: 'Vie' }, { n: 6, corto: 'Sáb' }, { n: 7, corto: 'Dom' },
];

/** El rol Empleado no carga datos de negocio: su única pantalla lee mi_asistencia(). */
export function rolSinDatosNegocio(rol) {
  return rol === ROL_EMPLEADO;
}

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** Argumentos de registrar_entrada / registrar_salida desde una lectura de geolocalización. */
export function buildRegistroArgs({ operacionId, coords } = {}) {
  const lat = num(coords?.latitude);
  const lng = num(coords?.longitude);
  const precision = num(coords?.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: 'No se obtuvo una ubicación válida. Intenta de nuevo.' };
  }
  if (!Number.isFinite(precision) || precision <= 0) {
    return { error: 'El teléfono no informó la precisión de la ubicación. Intenta de nuevo.' };
  }
  return {
    args: {
      p_operacion_id: operacionId || nuevoOperacionId(),
      p_lat: lat,
      p_lng: lng,
      p_precision_m: Math.round(precision * 10) / 10,
    },
  };
}

/** Mensaje para el error de navigator.geolocation (o su ausencia). */
export function mensajeErrorGeo(err) {
  if (!err) return 'No se pudo obtener tu ubicación.';
  if (err === 'no_soportado') return 'Este teléfono o navegador no permite obtener la ubicación.';
  switch (err.code) {
    case 1: return 'Permiso de ubicación denegado. Actívalo para este sitio en los ajustes del navegador y vuelve a intentar.';
    case 2: return 'No se pudo determinar tu ubicación. Activa el GPS y sal a un lugar con mejor señal.';
    case 3: return 'La ubicación tardó demasiado. Activa el GPS y vuelve a intentar.';
    default: return 'No se pudo obtener tu ubicación.';
  }
}

const metros = (v) => `${Math.round(Number(v) || 0).toLocaleString('es-MX')} m`;

/** Mensaje y tono para la respuesta de registrar_entrada / registrar_salida. */
export function mensajeRegistro(tipo, r) {
  if (!r) return { tono: 'error', texto: 'Sin respuesta del servidor. Intenta de nuevo.' };
  const a = r.asistencia || {};
  if (r.ok) {
    if (tipo === 'entrada') {
      if (a.entrada_estado === 'retardo') {
        return { tono: 'aviso', texto: `Entrada registrada a las ${horaNegocio(a.entrada_at)} con retardo de ${a.minutos_retardo} min.` };
      }
      return { tono: 'ok', texto: `Entrada registrada a las ${horaNegocio(a.entrada_at)}. ¡A tiempo!` };
    }
    if (r.fuera_de_ubicacion) {
      return { tono: 'aviso', texto: `Salida registrada a las ${horaNegocio(a.salida_at)} FUERA del centro de trabajo${r.distancia_m != null ? ` (a ${metros(r.distancia_m)})` : ''}. Queda marcada para Admin.` };
    }
    return { tono: 'ok', texto: `Salida registrada a las ${horaNegocio(a.salida_at)}.` };
  }
  switch (r.codigo) {
    case 'sin_empleado': return { tono: 'error', texto: 'Tu usuario no está ligado a una ficha de empleado. Pide a Admin que lo configure.' };
    case 'sin_turno': return { tono: 'error', texto: 'No tienes turno asignado para hoy (configuración pendiente). Avisa a Admin.' };
    case 'fuera_de_horario': return { tono: 'error', texto: 'Todavía no es hora de tu turno (puedes marcar desde 60 min antes) o tu turno ya terminó.' };
    case 'precision_insuficiente':
      return { tono: 'error', texto: `La ubicación no es suficientemente precisa (±${metros(r.precision_m)}; se necesita ±${metros(r.precision_max_m)} o mejor). Activa el GPS, sal al aire libre y vuelve a intentar.` };
    case 'fuera_de_rango':
      return { tono: 'error', texto: `Estás a ${metros(r.distancia_m)} de ${r.centro || 'tu centro de trabajo'} (máximo ${metros(r.radio_m)}). La entrada solo se marca dentro del centro de trabajo.` };
    case 'ya_registrada':
      return { tono: 'info', texto: tipo === 'entrada' ? 'Tu entrada de este turno ya estaba registrada.' : 'Tu salida ya estaba registrada.' };
    case 'sin_entrada': return { tono: 'error', texto: 'No hay una entrada abierta de las últimas 24 horas. Si olvidaste marcar, avisa a Admin.' };
    case 'ubicacion_invalida': return { tono: 'error', texto: 'No se obtuvo una ubicación válida. Intenta de nuevo.' };
    default: return { tono: 'error', texto: 'No se pudo registrar. Intenta de nuevo.' };
  }
}

/** ¿El error de la llamada es de red (sin respuesta del servidor)? Entonces el mismo toque se puede reintentar con la misma operación. */
export function esErrorDeRed(error, enLinea = true) {
  if (!enLinea) return true;
  const m = String(error?.message || error || '');
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout/i.test(m);
}

/** Mensaje para el error de la llamada (no para un rechazo con código). */
export function mensajeErrorLlamada(error, enLinea = true) {
  if (esErrorDeRed(error, enLinea)) return 'Sin conexión. La asistencia necesita internet en el momento de marcar (no se guarda para después). Conéctate y vuelve a intentar.';
  const m = String(error?.message || error || '');
  if (/no autorizado|42501/i.test(m)) return 'Tu usuario no tiene permiso para esta acción.';
  return m || 'No se pudo completar la acción.';
}

/** Pantalla de "Mi asistencia" según mi_asistencia(): título, detalle y botón contextual. */
export function pantallaMiAsistencia(mi) {
  if (!mi) return { titulo: 'Cargando…', boton: null };
  const a = mi.asistencia;
  switch (mi.estado) {
    case 'sin_empleado':
      return { titulo: 'Sin ficha de empleado', detalle: 'Tu usuario no está ligado a un empleado. Pide a Admin que lo configure.', tono: 'aviso', boton: null };
    case 'sin_turno':
      return { titulo: 'Sin turno hoy', detalle: 'No tienes turno asignado para hoy. Si es un error, avisa a Admin (configuración pendiente).', tono: 'neutro', boton: null };
    case 'fuera_de_horario':
      return { titulo: 'Fuera de horario', detalle: 'Puedes marcar tu entrada desde 60 min antes del inicio de tu turno.', tono: 'neutro', boton: null };
    case 'pendiente':
      return { titulo: 'Entrada pendiente', detalle: 'Marca tu entrada cuando estés en el centro de trabajo.', tono: 'neutro', boton: { accion: 'entrada', label: 'Marcar entrada' } };
    case 'en_turno':
      return {
        titulo: a?.entrada_estado === 'retardo' ? `En turno · retardo de ${a.minutos_retardo} min` : 'En turno',
        detalle: `Entrada a las ${horaNegocio(a?.entrada_at)}.`,
        tono: a?.entrada_estado === 'retardo' ? 'aviso' : 'ok',
        boton: { accion: 'salida', label: 'Marcar salida' },
      };
    case 'completa':
      return { titulo: 'Jornada completa', detalle: `Entrada ${horaNegocio(a?.entrada_at)} · Salida ${horaNegocio(a?.salida_at)}.`, tono: 'ok', boton: null };
    default:
      return { titulo: 'Asistencia', detalle: '', tono: 'neutro', boton: null };
  }
}

/** Estados del día (asistencia_dia) para la tabla de Admin. */
export const ESTADOS_DIA = {
  pendiente: { label: 'Pendiente', tono: 'neutro' },
  a_tiempo: { label: 'A tiempo', tono: 'ok' },
  retardo: { label: 'Retardo', tono: 'aviso' },
  fuera_de_ubicacion: { label: 'Fuera de ubicación', tono: 'error' },
  sin_salida: { label: 'Sin salida', tono: 'aviso' },
  completo: { label: 'Completo', tono: 'ok' },
  falta: { label: 'Falta', tono: 'error' },
  sin_turno: { label: 'Sin turno', tono: 'neutro' },
};
export function estadoDia(estado) {
  return ESTADOS_DIA[estado] || { label: estado || '—', tono: 'neutro' };
}

/** Hora local del negocio ("07:05") de un timestamp; '—' si no hay. */
export function horaNegocio(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_NEGOCIO, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** Fecha y hora local del negocio ("2026-10-07 07:05"). */
export function fechaHoraNegocio(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_NEGOCIO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** Valor para <input type="datetime-local"> en la zona del negocio. */
export function datetimeLocalNegocio(ts) {
  const f = fechaHoraNegocio(ts);
  return f === '—' ? '' : f.replace(' ', 'T');
}

/** Desfase de la zona del negocio en un instante ("-07:00"). */
export function desfaseNegocio(fecha = new Date()) {
  try {
    const parte = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_NEGOCIO, timeZoneName: 'longOffset' })
      .formatToParts(fecha).find(x => x.type === 'timeZoneName')?.value || '';
    const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(parte);
    if (m) return `${m[1]}:${m[2] || '00'}`;
    if (parte === 'GMT') return '+00:00';
  } catch { /* Intl sin longOffset */ }
  return '-07:00'; // Mazatlán no tiene horario de verano desde 2022.
}

/** "2026-10-07T07:05" (hora local del negocio) → ISO con desfase, para el servidor. */
export function isoDesdeLocalNegocio(local) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(local || ''));
  if (!m) return null;
  const aprox = new Date(`${m[1]}T${m[2]}:00Z`);
  return `${m[1]}T${m[2]}:00${desfaseNegocio(aprox)}`;
}

/** Hora "HH:MM" de un TIME de Postgres ("07:00:00"). */
export function horaCorta(t) {
  return t ? String(t).slice(0, 5) : '—';
}

export function textoTurno(turno) {
  if (!turno) return 'Sin turno';
  const nocturno = String(turno.hora_salida) <= String(turno.hora_entrada);
  return `${horaCorta(turno.hora_entrada)}–${horaCorta(turno.hora_salida)}${nocturno ? ' (+1 día)' : ''}`;
}

export function textoDias(dias) {
  const set = new Set((dias || []).map(Number));
  if (set.size === 7) return 'Todos los días';
  return DIAS_SEMANA.filter(d => set.has(d.n)).map(d => d.corto).join(', ') || '—';
}

/** Argumentos de corregir_asistencia (Admin). */
export function buildCorreccionArgs({ operacionId, asistenciaId, campo, local, motivo } = {}) {
  if (!asistenciaId) return { error: 'Asistencia requerida' };
  if (campo !== 'entrada' && campo !== 'salida') return { error: 'Elige entrada o salida' };
  const iso = isoDesdeLocalNegocio(local);
  if (!iso) return { error: 'Fecha y hora inválidas' };
  const m = String(motivo || '').trim();
  if (m.length < 5) return { error: 'El motivo es obligatorio (mínimo 5 caracteres)' };
  return { args: { p_operacion_id: operacionId || nuevoOperacionId(), p_asistencia_id: Number(asistenciaId), p_campo: campo, p_valor: iso, p_motivo: m } };
}

/** Argumentos de guardar_centro_trabajo (Admin). */
export function buildCentroArgs(f = {}) {
  const nombre = String(f.nombre || '').trim();
  const lat = num(f.latitud), lng = num(f.longitud), radio = num(f.radio_m), prec = num(f.precision_max_m);
  if (!nombre) return { error: 'Nombre requerido' };
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: 'Latitud inválida' };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: 'Longitud inválida' };
  if (!Number.isInteger(radio) || radio < 10 || radio > 2000) return { error: 'Radio entre 10 y 2,000 m' };
  if (!Number.isInteger(prec) || prec < 5 || prec > 500) return { error: 'Precisión máxima entre 5 y 500 m' };
  return { args: { p_id: f.id ? Number(f.id) : null, p_nombre: nombre, p_latitud: lat, p_longitud: lng, p_radio_m: radio, p_precision_max_m: prec, p_activo: f.activo !== false } };
}

/** Argumentos de guardar_turno (Admin). */
export function buildTurnoArgs(f = {}) {
  const dias = [...new Set((f.dias || []).map(Number))].filter(d => d >= 1 && d <= 7).sort();
  const hhmm = /^\d{2}:\d{2}(:\d{2})?$/;
  const tol = num(f.tolerancia_min === '' || f.tolerancia_min == null ? 0 : f.tolerancia_min);
  if (!f.empleado_id) return { error: 'Empleado requerido' };
  if (!f.centro_id) return { error: 'Centro de trabajo requerido' };
  if (!dias.length) return { error: 'Elige al menos un día' };
  if (!hhmm.test(String(f.hora_entrada || '')) || !hhmm.test(String(f.hora_salida || ''))) return { error: 'Horas de entrada y salida requeridas' };
  if (horaCorta(f.hora_entrada) === horaCorta(f.hora_salida)) return { error: 'La salida debe ser distinta de la entrada' };
  if (!Number.isInteger(tol) || tol < 0 || tol > 120) return { error: 'Tolerancia entre 0 y 120 min' };
  if (f.vigente_hasta && f.vigente_desde && f.vigente_hasta < f.vigente_desde) return { error: 'La vigencia final es anterior a la inicial' };
  return {
    args: {
      p_id: f.id ? Number(f.id) : null, p_empleado_id: Number(f.empleado_id), p_centro_id: Number(f.centro_id), p_dias: dias,
      p_hora_entrada: horaCorta(f.hora_entrada), p_hora_salida: horaCorta(f.hora_salida), p_tolerancia_min: tol,
      p_vigente_desde: f.vigente_desde || null, p_vigente_hasta: f.vigente_hasta || null, p_activo: f.activo !== false,
    },
  };
}

/** Enlace a un mapa con las coordenadas de una marca (evidencia para Admin). */
export function enlaceMapa(lat, lng) {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`;
}

// Pasos de puesta en marcha del reloj checador (guía de Admin, 2026-10-09).
// Orden real: sin centro no hay turnos; sin vínculo el empleado no puede marcar.
export function pasosConfigAsistencia({ centros = [], turnos = [], empleados = [] } = {}) {
  const activos = (empleados || []).filter(e => (e?.estatus || 'Activo') === 'Activo');
  const ligados = activos.filter(e => e?.usuarioId ?? e?.usuario_id);
  const centrosActivos = (centros || []).filter(c => c?.activo !== false);
  const turnosActivos = (turnos || []).filter(t => t?.activo !== false);
  return [
    { k: 'centro', label: 'Centro de trabajo', hecho: centrosActivos.length > 0,
      nota: centrosActivos.length > 0 ? `${centrosActivos.length} configurado(s)` : 'Ubicación y radio de la planta donde se marca la entrada.' },
    { k: 'turnos', label: 'Turnos', hecho: turnosActivos.length > 0,
      nota: turnosActivos.length > 0 ? `${turnosActivos.length} turno(s)` : 'Días, hora de entrada y salida y tolerancia de cada empleado.' },
    { k: 'accesos', label: 'Accesos', hecho: activos.length > 0 && ligados.length === activos.length,
      nota: `${ligados.length} de ${activos.length} empleados ligados a su usuario (cada uno marca desde su teléfono).` },
  ];
}
