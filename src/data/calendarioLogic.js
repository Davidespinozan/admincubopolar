// calendarioLogic.js — PD-02 (mig 118): calendario operativo.
//
// Lógica pura. El ESTADO de cada ocurrencia (proxima / pendiente / vencida /
// completada) y la clasificación de la terminación (anticipada / en_ventana /
// tardia) los calcula el servidor con la fecha de negocio (Mazatlán); aquí solo
// se traducen a etiquetas y colores, se arman argumentos y se resume.

import { nuevoOperacionId } from './stockContratosLogic';

/** Estado semántico → etiqueta y tono de la interfaz (el color no es estado de la base). */
export const ESTADOS_ACTIVIDAD = {
  proxima: { label: 'Próxima', tono: 'neutro' },
  pendiente: { label: 'Pendiente', tono: 'amarillo' },
  vencida: { label: 'Vencida', tono: 'rojo' },
  completada: { label: 'Completada', tono: 'verde' },
};
export function estadoActividad(estado) {
  return ESTADOS_ACTIVIDAD[estado] || { label: estado || '—', tono: 'neutro' };
}

export const CLASIFICACIONES = {
  anticipada: 'Completada antes de la ventana',
  en_ventana: 'Completada a tiempo',
  tardia: 'Completada tarde',
};
export function textoClasificacion(c) {
  return CLASIFICACIONES[c] || '';
}

export const CATEGORIAS = [
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'limpieza', label: 'Limpieza' },
  { value: 'operativa', label: 'Operativa' },
  { value: 'pago', label: 'Pago' },
  { value: 'administrativa', label: 'Administrativa' },
  { value: 'otra', label: 'Otra' },
];
export const ROLES_RESPONSABLES = ['Admin', 'Ventas', 'Chofer', 'Producción', 'Almacén Bolsas', 'Facturación', 'Empleado'];
export const MAQUINAS = ['Máquina 30', 'Máquina 20', 'Máquina 15', 'Máquina Barra'];
const DIAS = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-10-28" → "28 oct". */
export function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '—';
  return `${Number(m[3])} ${MESES[Number(m[2])]}`;
}

/** Texto de la recurrencia de una ocurrencia/actividad (campos de calendario()). */
export function textoRecurrencia(a) {
  if (!a) return '';
  switch (a.recurrencia) {
    case 'unica': return `Una vez: ${fechaCorta(a.fecha_inicio)} → ${fechaCorta(a.fecha_fin)}`;
    case 'semanal': {
      const cruza = Number(a.dia_semana_fin) < Number(a.dia_semana_inicio);
      return `Cada semana: ${DIAS[a.dia_semana_inicio]} → ${DIAS[a.dia_semana_fin]}${cruza ? ' (semana siguiente)' : ''}`;
    }
    case 'mensual': {
      const cruza = Number(a.dia_fin) < Number(a.dia_inicio);
      return `Cada mes: día ${a.dia_inicio} → ${a.dia_fin}${cruza ? ' del mes siguiente' : ''}`;
    }
    case 'anual': {
      const cruza = Number(a.dia_fin) < Number(a.dia_inicio);
      return `Cada año: ${a.dia_inicio} ${MESES[a.mes]} → ${a.dia_fin}${cruza ? ` ${MESES[(Number(a.mes) % 12) + 1]}` : ` ${MESES[a.mes]}`}`;
    }
    default: return '';
  }
}

export function textoResponsable(o) {
  if (!o) return '';
  if (o.responsable_usuario_id) return `${o.responsable_nombre || 'Usuario'}${o.responsable_activo === false ? ' (sin responsable activo)' : ''}`;
  if (o.responsable_rol) return `Rol ${o.responsable_rol}`;
  return 'Sin responsable (Admin)';
}

const isoLocal = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
/** Suma días a una fecha ISO (aritmética en UTC: sin depender de la zona del navegador). */
export function sumarDiasISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoLocal(d);
}

/** Primer y último día del mes 'YYYY-MM'. */
export function rangoDeMes(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${ym}-01`, hasta: `${ym}-${String(ultimo).padStart(2, '0')}` };
}

export function mesSiguiente(ym, delta = 1) {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Celdas del mes (lunes primero): null para los huecos antes del día 1. */
export function celdasDeMes(ym) {
  const { desde, hasta } = rangoDeMes(ym);
  const primero = new Date(`${desde}T00:00:00Z`);
  const offset = (primero.getUTCDay() + 6) % 7;
  const dias = Number(hasta.slice(8, 10));
  const out = Array.from({ length: offset }, () => null);
  for (let i = 0; i < dias; i++) out.push(sumarDiasISO(desde, i));
  return out;
}

/** Rangos de cada vista (fechas de negocio que da el servidor como `hoy`). */
export function rangoVista(vista, hoy, ym) {
  switch (vista) {
    case 'mes': return rangoDeMes(ym || hoy.slice(0, 7));
    case 'proximas': return { desde: hoy, hasta: sumarDiasISO(hoy, 60) };
    case 'vencidas': return { desde: sumarDiasISO(hoy, -1095), hasta: hoy };
    case 'completadas': return { desde: sumarDiasISO(hoy, -730), hasta: sumarDiasISO(hoy, 366) };
    default: return { desde: sumarDiasISO(hoy, -1095), hasta: sumarDiasISO(hoy, 4) };
  }
}

/** Filtra por vista (el estado viene del servidor). */
export function filtrarVista(ocurrencias, vista) {
  const l = ocurrencias || [];
  switch (vista) {
    case 'proximas': return l.filter(o => o.estado === 'proxima' || o.estado === 'pendiente');
    case 'vencidas': return l.filter(o => o.estado === 'vencida');
    case 'completadas': return l.filter(o => o.estado === 'completada').sort((a, b) => String(b.completada_at).localeCompare(String(a.completada_at)));
    default: return l;
  }
}

/** Resumen compacto (Dashboard): pendientes hoy, por vencer (≤ 3 días) y vencidas. */
export function resumenActividades(ocurrencias, hoy) {
  const abiertas = (ocurrencias || []).filter(o => o.estado !== 'completada');
  const limite = hoy ? sumarDiasISO(hoy, 3) : null;
  return {
    pendientesHoy: abiertas.filter(o => o.estado === 'pendiente').length,
    porVencer: abiertas.filter(o => (o.estado === 'pendiente' || o.estado === 'proxima') && limite && o.ventana_fin >= hoy && o.ventana_fin <= limite).length,
    vencidas: abiertas.filter(o => o.estado === 'vencida').length,
  };
}

/** Clave única de una ocurrencia. */
export const claveOcurrencia = (o) => `${o.actividad_id}|${o.periodo}`;

const entero = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/** Datos de guardar_actividad desde el formulario (validación previa; la base vuelve a validar). */
export function buildActividadDatos(f = {}) {
  const titulo = String(f.titulo || '').trim();
  if (!titulo) return { error: 'Título requerido' };
  if (!CATEGORIAS.some(c => c.value === f.categoria)) return { error: 'Categoría requerida' };
  const datos = {
    titulo, descripcion: String(f.descripcion || '').trim(), categoria: f.categoria, recurrencia: f.recurrencia,
    visibilidad: f.visibilidad === 'admin' ? 'admin' : 'asignado', asignado_puede_completar: f.asignado_puede_completar !== false,
  };
  if (f.responsable_tipo === 'usuario') {
    if (!f.responsable_usuario_id) return { error: 'Elige el usuario responsable' };
    datos.responsable_usuario_id = Number(f.responsable_usuario_id);
  } else if (f.responsable_tipo === 'rol') {
    if (!ROLES_RESPONSABLES.includes(f.responsable_rol)) return { error: 'Elige el rol responsable' };
    datos.responsable_rol = f.responsable_rol;
  }
  if (f.relacionado_tipo) {
    if (!['camion', 'maquina', 'costo_fijo'].includes(f.relacionado_tipo) || !f.relacionado_ref) return { error: 'Elige el elemento relacionado' };
    datos.relacionado_tipo = f.relacionado_tipo;
    datos.relacionado_ref = String(f.relacionado_ref);
  }
  const dia = (v, max) => { const n = entero(v); return Number.isInteger(n) && n >= 1 && n <= max ? n : null; };
  switch (f.recurrencia) {
    case 'unica':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha_inicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha_fin || '')) return { error: 'Fechas de inicio y fin requeridas' };
      if (f.fecha_fin < f.fecha_inicio) return { error: 'La fecha límite es anterior al inicio' };
      datos.fecha_inicio = f.fecha_inicio; datos.fecha_fin = f.fecha_fin;
      break;
    case 'semanal':
      datos.dia_semana_inicio = dia(f.dia_semana_inicio, 7); datos.dia_semana_fin = dia(f.dia_semana_fin, 7);
      if (!datos.dia_semana_inicio || !datos.dia_semana_fin) return { error: 'Días de la semana requeridos' };
      break;
    case 'mensual':
      datos.dia_inicio = dia(f.dia_inicio, 31); datos.dia_fin = dia(f.dia_fin, 31);
      if (!datos.dia_inicio || !datos.dia_fin) return { error: 'Días del mes (1–31) requeridos' };
      break;
    case 'anual':
      datos.mes = dia(f.mes, 12); datos.dia_inicio = dia(f.dia_inicio, 31); datos.dia_fin = dia(f.dia_fin, 31);
      if (!datos.mes || !datos.dia_inicio || !datos.dia_fin) return { error: 'Mes y días requeridos' };
      break;
    default: return { error: 'Elige la recurrencia' };
  }
  if (f.recurrencia !== 'unica' && f.vigente_desde) datos.vigente_desde = f.vigente_desde;
  return { datos };
}

/** Argumentos de completar_ocurrencia. */
export function buildCompletarArgs({ operacionId, actividadId, periodo, notas } = {}) {
  if (!actividadId || !/^\d{4}-\d{2}-\d{2}$/.test(periodo || '')) return { error: 'Ocurrencia inválida' };
  return { args: { p_operacion_id: operacionId || nuevoOperacionId(), p_actividad_id: Number(actividadId), p_periodo: periodo, p_notas: String(notas || '').trim() || null } };
}

/** Argumentos de editar_ocurrencia (solo esta ocurrencia). */
export function buildEditarOcurrenciaArgs({ operacionId, actividadId, periodo, inicio, fin, motivo } = {}) {
  if (!actividadId || !periodo) return { error: 'Ocurrencia inválida' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fin || '')) return { error: 'Fechas requeridas' };
  if (fin < inicio) return { error: 'La fecha límite es anterior al inicio' };
  const m = String(motivo || '').trim();
  if (m.length < 5) return { error: 'El motivo es obligatorio (mínimo 5 caracteres)' };
  return { args: { p_operacion_id: operacionId || nuevoOperacionId(), p_actividad_id: Number(actividadId), p_periodo: periodo, p_ventana_inicio: inicio, p_ventana_fin: fin, p_motivo: m } };
}

/** Mensaje para la respuesta de completar_ocurrencia. */
export function mensajeCompletar(r) {
  if (!r) return { tono: 'error', texto: 'Sin respuesta del servidor.' };
  if (r.ok) {
    const c = r.ocurrencia?.clasificacion;
    return { tono: c === 'tardia' ? 'aviso' : 'ok', texto: `Actividad completada. ${textoClasificacion(c)}.` };
  }
  if (r.codigo === 'ya_completada') {
    return { tono: 'info', texto: `Ya estaba completada por ${r.ocurrencia?.completada_por || 'otra persona'}.` };
  }
  return { tono: 'error', texto: 'No se pudo completar.' };
}

/** Formulario de edición "de aquí en adelante" a partir de una ocurrencia (versión vigente). */
export function formDesdeOcurrencia(o) {
  return {
    id: o.actividad_id, titulo: o.titulo, descripcion: o.descripcion, categoria: o.categoria, recurrencia: o.recurrencia,
    fecha_inicio: o.fecha_inicio || '', fecha_fin: o.fecha_fin || '', dia_semana_inicio: o.dia_semana_inicio || '', dia_semana_fin: o.dia_semana_fin || '',
    mes: o.mes || '', dia_inicio: o.dia_inicio || '', dia_fin: o.dia_fin || '', visibilidad: o.visibilidad, asignado_puede_completar: o.asignado_puede_completar,
    responsable_tipo: o.responsable_usuario_id ? 'usuario' : (o.responsable_rol ? 'rol' : 'ninguno'),
    responsable_usuario_id: o.responsable_usuario_id || '', responsable_rol: o.responsable_rol || '',
    relacionado_tipo: o.relacionado_tipo || '', relacionado_ref: o.relacionado_ref || '', vigente_desde: '',
  };
}
