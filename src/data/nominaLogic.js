// nominaLogic.js — 100: nómina canónica. Lógica pura (sin Supabase); tests en
// src/__tests__/nomina.test.js.
//
// La semana de nómina es SÁBADO → VIERNES con pago el VIERNES, en días de
// negocio (Durango, America/Monterrey). El servidor es la autoridad: crea el periodo
// (crear_periodo_nomina), toma el snapshot del salario (generar_recibos_nomina)
// y recalcula los recibos (editar_recibo_nomina). Aquí solo hay espejo para
// mostrar la semana actual y vista previa mientras se captura.
import { centavos } from '../utils/safe';
import { partesFecha, sumarDias } from '../utils/fechas';

/** Sábado (inicio) de la semana de nómina que contiene la fecha 'YYYY-MM-DD'. */
export function inicioSemanaNomina(fecha) {
  const p = partesFecha(fecha);
  if (!p) return '';
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = domingo … 6 = sábado
  return sumarDias(fecha, -((dow + 1) % 7));
}

/** Periodo canónico (sábado → viernes, pago viernes) de una fecha de negocio. */
export function periodoNominaDe(fecha) {
  const fechaInicio = inicioSemanaNomina(fecha);
  if (!fechaInicio) return null;
  const fechaFin = sumarDias(fechaInicio, 6);
  return { fechaInicio, fechaFin, fechaPago: fechaFin };
}

const ddmm = (f) => { const p = partesFecha(f); return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}` : ''; };

/** Etiqueta legible del periodo (la identidad es fecha_inicio, no un número de semana). */
export function etiquetaPeriodoNomina({ fechaInicio, fechaFin } = {}) {
  if (!fechaInicio || !fechaFin) return '';
  return `Sáb ${ddmm(fechaInicio)} – Vie ${ddmm(fechaFin)}`;
}

const num = (v) => {
  if (v === '' || v == null) return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};

export const CAMPOS_RECIBO = ['comisiones', 'primaDominical', 'bonoPuntualidad', 'bonoProductividad', 'otrasPercepciones', 'deducciones'];

/**
 * Valida la captura de un recibo y arma los parámetros de editar_recibo_nomina.
 * El cliente nunca manda salario ni totales.
 * @returns {{args: Object}|{error: string}}
 */
export function buildEditarReciboArgs(reciboId, campos = {}) {
  const id = Number(reciboId);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Recibo inválido' };
  const dias = Number(campos.diasPagados);
  if (campos.diasPagados === '' || campos.diasPagados == null || !Number.isInteger(dias) || dias < 0 || dias > 7) {
    return { error: 'Días pagados inválidos (0 a 7)' };
  }
  const v = {};
  for (const k of CAMPOS_RECIBO) {
    const x = num(campos[k]);
    if (!Number.isFinite(x)) return { error: 'Importe inválido' };
    if (x < 0) return { error: 'Los importes del recibo no pueden ser negativos' };
    v[k] = centavos(x);
  }
  return {
    args: {
      p_recibo_id: id,
      p_dias_pagados: dias,
      p_con_septimo: campos.conSeptimo === true,
      p_comisiones: v.comisiones,
      p_prima_dominical: v.primaDominical,
      p_bono_puntualidad: v.bonoPuntualidad,
      p_bono_productividad: v.bonoProductividad,
      p_otras_percepciones: v.otrasPercepciones,
      p_deducciones: v.deducciones,
    },
  };
}

/**
 * Vista previa del recibo con el salario del snapshot (solo para mostrar; el
 * servidor recalcula al guardar). Sin deducciones automáticas.
 */
export function previewRecibo(salarioDiario, campos = {}) {
  const sal = num(salarioDiario);
  const dias = num(campos.diasPagados);
  const sueldo = centavos(sal * dias);
  const septimoDia = campos.conSeptimo ? centavos(sal) : 0;
  const extras = ['comisiones', 'primaDominical', 'bonoPuntualidad', 'bonoProductividad', 'otrasPercepciones'].reduce((s, k) => s + (num(campos[k]) || 0), 0);
  const totalPercepciones = centavos(sueldo + septimoDia + extras);
  const deducciones = centavos(num(campos.deducciones) || 0);
  return { sueldo, septimoDia, totalPercepciones, deducciones, netoAPagar: centavos(totalPercepciones - deducciones) };
}

/** Campos editables a partir de un recibo del servidor (camelCase). */
export function camposDeRecibo(r = {}) {
  return {
    diasPagados: String(r.diasPagados ?? 6),
    conSeptimo: Number(r.septimoDia || 0) > 0,
    comisiones: String(Number(r.comisiones || 0)),
    primaDominical: String(Number(r.primaDominical || 0)),
    bonoPuntualidad: String(Number(r.bonoPuntualidad || 0)),
    bonoProductividad: String(Number(r.bonoProductividad || 0)),
    otrasPercepciones: String(Number(r.otrasPercepciones || 0)),
    deducciones: String(Number(r.deducciones || 0)),
  };
}

// ═══ 128 (NOM-1): conceptos de nómina ═══
// Catálogo de bonos, comisiones, primas y descuentos que Admin configura, y
// desglose del recibo por renglones. El servidor es la autoridad: propone los
// conceptos al generar los recibos (generar_recibos_nomina), guarda la FOTO de
// cada renglón y recalcula (guardar_recibo_nomina). Aquí solo hay espejo para
// mostrar y para validar la captura antes de enviarla.

/** Clases de concepto. El id es la casilla del recibo donde se suma (100). */
export const CLASES_CONCEPTO = [
  { id: 'bono_puntualidad', tipo: 'percepcion', label: 'Bono de puntualidad' },
  { id: 'bono_productividad', tipo: 'percepcion', label: 'Bono de productividad' },
  { id: 'comisiones', tipo: 'percepcion', label: 'Comisión' },
  { id: 'prima_dominical', tipo: 'percepcion', label: 'Prima dominical' },
  { id: 'otras_percepciones', tipo: 'percepcion', label: 'Otro pago' },
  { id: 'prestamo', tipo: 'descuento', label: 'Préstamo' },
  { id: 'isr', tipo: 'descuento', label: 'ISR' },
  { id: 'imss', tipo: 'descuento', label: 'IMSS' },
  { id: 'otras_deducciones', tipo: 'descuento', label: 'Otro descuento' },
];
export const clasesDeTipo = (tipo) => CLASES_CONCEPTO.filter(c => c.tipo === tipo);
export const etiquetaClase = (categoria) => CLASES_CONCEPTO.find(c => c.id === categoria)?.label || '';
const claseValida = (tipo, categoria) => CLASES_CONCEPTO.some(c => c.id === categoria && c.tipo === tipo);

// 130 (NOM-2): además de monto fijo y % del salario diario, un concepto se
// puede calcular con lo ENTREGADO de la persona (lo calcula el servidor) y una
// percepción se puede condicionar a la asistencia de la semana.
export const FORMAS_CALCULO = [
  { id: 'fijo', label: 'Monto fijo por semana', campo: 'Monto por semana', ejemplo: '200' },
  { id: 'porcentaje_sd', label: '% del salario diario', campo: 'Porcentaje del salario diario', ejemplo: '25' },
  { id: 'porcentaje_ventas', label: '% de lo vendido', campo: 'Porcentaje sobre el importe', ejemplo: '2', comision: true },
  { id: 'por_unidad', label: '$ por bolsa', campo: 'Pesos por bolsa', ejemplo: '0.50', comision: true },
  { id: 'por_entrega', label: '$ por entrega', campo: 'Pesos por venta o entrega', ejemplo: '5', comision: true },
];
export const BASES_COMISION = [
  { id: 'vendedor', label: 'Sus ventas', ayuda: 'Las ventas que levantó, cuando ya se entregaron.' },
  { id: 'chofer', label: 'Sus entregas como chofer', ayuda: 'Lo que entregó en sus rutas, lo haya vendido quien lo haya vendido.' },
  { id: 'ayudante', label: 'Sus entregas como ayudante', ayuda: 'Lo que se entregó en las rutas donde fue de ayudante.' },
];
const formaDe = (calculo) => FORMAS_CALCULO.find(f => f.id === calculo) || FORMAS_CALCULO[0];
/** ¿Se calcula con ventas o entregas? */
export const esComision = (calculo) => formaDe(calculo).comision === true;
/** ¿El servidor lo calcula cada semana (ventas o asistencia)? */
export const esAutomatico = (concepto) => !!concepto && (esComision(concepto.calculo) || concepto.reglaAsistencia === true);
/** Formas de cálculo disponibles según el tipo (un descuento no se calcula con ventas). */
export const formasDeTipo = (tipo) => FORMAS_CALCULO.filter(f => tipo === 'percepcion' || !f.comision);
/** Etiqueta y ejemplo del campo del número según la forma de cálculo. */
export const campoDeCalculo = (calculo) => ({ label: formaDe(calculo).campo, ejemplo: formaDe(calculo).ejemplo });
const plural = (k, uno, varios) => `${k} ${k === 1 ? uno : varios}`;
/** "Se pierde con más de 0 retardos o más de 1 falta" en palabras llanas. */
export function describirRegla(concepto) {
  if (!concepto?.reglaAsistencia) return '';
  const r = Number(concepto.maxRetardos) || 0;
  const f = Number(concepto.maxFaltas) || 0;
  if (r === 0 && f === 0) return 'solo si no falta ni llega tarde';
  return `permite ${plural(r, 'retardo', 'retardos')} y ${plural(f, 'falta', 'faltas')}`;
}

const mismoId = (a, b) => a != null && b != null && Number(a) === Number(b);
const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const esVacio = (v) => v === '' || v == null;
const pesos = (x) => `$${Number(x || 0).toLocaleString('es-MX', { minimumFractionDigits: Number.isInteger(Number(x || 0)) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** Fila de nomina_concepto_empleados de una persona en un concepto (o null). */
export function asignacionDe(asignaciones, conceptoId, empleadoId) {
  return (asignaciones || []).find(a => mismoId(a.conceptoId, conceptoId) && mismoId(a.empleadoId, empleadoId)) || null;
}

/** ¿El concepto le toca a esta persona? (espejo de nomina_conceptos_propuestos, sin vigencia) */
export function conceptoAplica(concepto, empleado, asignacion) {
  if (!concepto || !empleado || asignacion?.excluido) return false;
  if (concepto.aplicaA === 'todos') return true;
  if (concepto.aplicaA === 'departamento') return texto(empleado.depto) === texto(concepto.departamento);
  return concepto.aplicaA === 'personas' && !!asignacion;
}

/** Monto semanal de un concepto para una persona (monto propio y % del salario diario), sin tope. */
export function montoConcepto(concepto, asignacion, salarioDiario) {
  if (!concepto) return 0;
  // Con ventas o entregas el importe lo calcula el servidor (aquí no hay órdenes).
  if (esComision(concepto.calculo)) return 0;
  const base = Number(esVacio(asignacion?.monto) ? concepto.monto : asignacion.monto) || 0;
  if (concepto.calculo !== 'porcentaje_sd') return centavos(base);
  // En centavos enteros: mismo redondeo que el servidor (318.93 al 50 % = 159.47, no 159.46).
  return Math.round(Math.round((Number(salarioDiario) || 0) * 100) * base / 100) / 100;
}

/** "$200 por semana" · "25 % del salario diario" · "2 % de sus ventas" (+ condición de asistencia). */
export function describirMonto(concepto) {
  if (!concepto) return '';
  const m = Number(concepto.monto) || 0;
  const de = { vendedor: 'sus ventas', chofer: 'sus entregas', ayudante: 'sus entregas de ayudante' }[concepto.baseRol] || 'sus ventas';
  const solo = (concepto.skus || []).length ? ` (${(concepto.skus || []).join(', ')})` : '';
  let base;
  if (concepto.calculo === 'porcentaje_sd') base = `${m} % del salario diario`;
  else if (concepto.calculo === 'porcentaje_ventas') base = `${m} % de ${de}${solo}`;
  else if (concepto.calculo === 'por_unidad') base = `${pesos(m)} por bolsa de ${de}${solo}`;
  else if (concepto.calculo === 'por_entrega') base = `${pesos(m)} por cada una de ${de}${solo}`;
  else base = m > 0 ? `${pesos(m)} por semana` : 'Monto por persona';
  const regla = describirRegla(concepto);
  return regla ? `${base} · ${regla}` : base;
}

/** "Todos" · "Producción" · "3 personas" (+ excepciones). */
export function describirAlcance(concepto, asignaciones) {
  if (!concepto) return '';
  const propias = (asignaciones || []).filter(a => mismoId(a.conceptoId, concepto.id));
  const excluidas = propias.filter(a => a.excluido).length;
  if (concepto.aplicaA === 'personas') {
    const k = propias.length - excluidas;
    return k === 1 ? '1 persona' : `${k} personas`;
  }
  const base = concepto.aplicaA === 'departamento' ? texto(concepto.departamento) : 'Todos';
  return excluidas > 0 ? `${base}, menos ${excluidas}` : base;
}

/** Personas a las que hoy les toca el concepto (para mostrar a quién aplica). */
export function personasDeConcepto(concepto, empleados, asignaciones) {
  return (empleados || []).filter(e => String(e.estatus ?? 'Activo') === 'Activo')
    .filter(e => conceptoAplica(concepto, e, asignacionDe(asignaciones, concepto?.id, e.id)));
}

// ── Recibo: desglose ──
let _llave = 0;
/** Renglón manual vacío para la captura. */
export function lineaManualNueva(tipo = 'percepcion') {
  _llave += 1;
  return { key: `n${_llave}`, conceptoId: null, nombre: '', tipo, categoria: tipo === 'descuento' ? 'otras_deducciones' : 'otras_percepciones', monto: '', propuesto: null };
}

/** Renglón de catálogo para agregar a un recibo que no lo tenía. */
export function lineaDeConcepto(concepto, asignacion, salarioDiario) {
  const m = montoConcepto(concepto, asignacion, salarioDiario);
  return { key: `c${concepto.id}`, conceptoId: Number(concepto.id), nombre: texto(concepto.nombre), tipo: concepto.tipo, categoria: concepto.categoria, monto: String(m), propuesto: null };
}

/** Desglose editable de un recibo: percepciones primero; dentro, catálogo antes que manual. */
export function lineasEditables(recibo, lineas) {
  return (lineas || []).filter(l => mismoId(l.reciboId, recibo?.id))
    .map(l => ({
      key: `l${l.id}`, conceptoId: l.conceptoId == null ? null : Number(l.conceptoId), nombre: texto(l.nombre), tipo: l.tipo, categoria: l.categoria,
      monto: String(Number(l.monto || 0)), propuesto: l.propuesto == null ? null : Number(l.propuesto), detalle: texto(l.detalle), _id: Number(l.id),
    }))
    .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'percepcion' ? -1 : 1) || ((a.conceptoId == null) - (b.conceptoId == null)) || (a._id - b._id))
    .map(({ _id, ...l }) => l);
}

/** Conceptos activos que el recibo todavía no tiene (para "Agregar"). */
export function conceptosParaAgregar(conceptos, lineas, tipo) {
  const usados = new Set((lineas || []).filter(l => l.conceptoId != null).map(l => Number(l.conceptoId)));
  return (conceptos || []).filter(c => c.activo !== false && (!tipo || c.tipo === tipo) && !usados.has(Number(c.id)));
}

/**
 * Vista previa del recibo con su desglose (solo para mostrar; el servidor
 * recalcula al guardar). `excede`: los descuentos pasan de las percepciones.
 */
export function previewDesglose(salarioDiario, campos = {}, lineas = []) {
  const sal = num(salarioDiario);
  const sueldo = centavos(sal * (num(campos.diasPagados) || 0));
  const septimoDia = campos.conSeptimo ? centavos(sal) : 0;
  const suma = (tipo) => centavos((lineas || []).filter(l => l.tipo === tipo).reduce((s, l) => s + (num(l.monto) || 0), 0));
  const extras = suma('percepcion');
  const deducciones = suma('descuento');
  const totalPercepciones = centavos(sueldo + septimoDia + extras);
  const netoAPagar = centavos(totalPercepciones - deducciones);
  return { sueldo, septimoDia, extras, totalPercepciones, deducciones, netoAPagar, excede: netoAPagar < 0 };
}

/**
 * Valida la captura y arma los parámetros de guardar_recibo_nomina. El cliente
 * manda el desglose completo; nunca salario ni totales. Un renglón manual sin
 * nombre y sin importe se ignora.
 * @returns {{args: Object}|{error: string}}
 */
export function buildGuardarReciboArgs(reciboId, campos = {}, lineas = [], salarioDiario = null) {
  const id = Number(reciboId);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Recibo inválido' };
  const dias = Number(campos.diasPagados);
  if (esVacio(campos.diasPagados) || !Number.isInteger(dias) || dias < 0 || dias > 7) return { error: 'Días pagados inválidos (0 a 7)' };
  const out = [];
  const vistos = new Set();
  for (const l of lineas || []) {
    const m = num(l.monto);
    if (!Number.isFinite(m)) return { error: `Importe inválido${l.nombre ? ` en "${texto(l.nombre)}"` : ''}` };
    if (m < 0) return { error: 'Los importes del recibo no pueden ser negativos' };
    if (l.conceptoId != null) {
      const cid = Number(l.conceptoId);
      if (vistos.has(cid)) return { error: `"${texto(l.nombre)}" aparece dos veces en el recibo` };
      vistos.add(cid);
      out.push({ concepto_id: cid, monto: centavos(m) });
      continue;
    }
    const nombre = texto(l.nombre);
    if (!nombre && m === 0) continue;
    if (!nombre) return { error: 'Escribe el nombre de cada renglón del recibo' };
    if (nombre.length > 60) return { error: 'El nombre de un renglón no puede pasar de 60 letras' };
    if (!claseValida(l.tipo, l.categoria)) return { error: `Renglón "${nombre}" inválido` };
    if (m === 0) continue;
    out.push({ nombre, tipo: l.tipo, categoria: l.categoria, monto: centavos(m) });
  }
  if (salarioDiario != null && previewDesglose(salarioDiario, { diasPagados: dias, conSeptimo: campos.conSeptimo === true }, lineas).excede) {
    return { error: 'Los descuentos son mayores que lo que gana esta semana' };
  }
  return { args: { p_recibo_id: id, p_dias_pagados: dias, p_con_septimo: campos.conSeptimo === true, p_lineas: out } };
}

// ── Catálogo: formulario ──
/** Estado del formulario de un concepto (nuevo o existente). */
export function formDeConcepto(concepto, asignaciones) {
  const c = concepto || {};
  const tipo = c.tipo === 'descuento' ? 'descuento' : 'percepcion';
  const personas = {};
  for (const a of (asignaciones || []).filter(x => c.id != null && mismoId(x.conceptoId, c.id))) {
    personas[String(a.empleadoId)] = { incluida: !a.excluido, monto: esVacio(a.monto) ? '' : String(Number(a.monto)), limite: esVacio(a.limiteTotal) ? '' : String(Number(a.limiteTotal)) };
  }
  return {
    nombre: texto(c.nombre), tipo, categoria: c.categoria || (tipo === 'descuento' ? 'prestamo' : 'bono_puntualidad'),
    calculo: FORMAS_CALCULO.some(f => f.id === c.calculo) ? c.calculo : 'fijo', monto: esVacio(c.monto) ? '' : String(Number(c.monto)),
    baseRol: BASES_COMISION.some(b => b.id === c.baseRol) ? c.baseRol : 'vendedor', skus: Array.isArray(c.skus) ? c.skus.map(String) : [],
    reglaAsistencia: c.reglaAsistencia === true, maxRetardos: String(Number(c.maxRetardos) || 0), maxFaltas: String(Number(c.maxFaltas) || 0),
    aplicaA: ['todos', 'departamento', 'personas'].includes(c.aplicaA) ? c.aplicaA : 'todos', departamento: texto(c.departamento),
    activo: c.activo !== false, vigenteDesde: c.vigenteDesde || '', vigenteHasta: c.vigenteHasta || '', notas: texto(c.notas), personas,
  };
}

/** Personas que el formulario lista según su alcance (activos; o ya asignadas aunque estén de baja). */
export function personasDelForm(form, empleados) {
  return (empleados || []).filter(e => {
    const activa = String(e.estatus ?? 'Activo') === 'Activo';
    if (!activa && !form?.personas?.[String(e.id)]) return false;
    return form?.aplicaA !== 'departamento' || texto(e.depto) === texto(form.departamento);
  });
}

/** ¿La persona está marcada en el formulario? Por alcance: en "personas" hay que elegirla; en los demás, quitarla. */
export function personaIncluida(form, empleadoId) {
  const p = form?.personas?.[String(empleadoId)];
  return form?.aplicaA === 'personas' ? !!p?.incluida : p?.incluida !== false;
}

/**
 * Valida el formulario y arma p_datos de guardar_concepto_nomina.
 * @returns {{args: {p_concepto_id: number|null, p_datos: Object}}|{error: string}}
 */
export function buildGuardarConceptoArgs(conceptoId, form = {}, empleados = []) {
  const nombre = texto(form.nombre);
  if (!nombre) return { error: 'Escribe el nombre del concepto' };
  if (nombre.length > 60) return { error: 'El nombre no puede pasar de 60 letras' };
  if (!claseValida(form.tipo, form.categoria)) return { error: 'Elige qué clase de concepto es' };
  const calculo = FORMAS_CALCULO.some(f => f.id === form.calculo) ? form.calculo : 'fijo';
  const comision = esComision(calculo);
  if (comision && form.tipo !== 'percepcion') return { error: 'Un descuento no se calcula con ventas' };
  if (comision && !BASES_COMISION.some(b => b.id === form.baseRol)) return { error: 'Indica de quién son las ventas o entregas que cuentan' };
  const monto = num(form.monto);
  if (!Number.isFinite(monto) || monto < 0) return { error: 'Monto inválido' };
  if (calculo === 'porcentaje_sd' && monto > 700) return { error: 'El porcentaje del salario diario no puede pasar de 700' };
  if (calculo === 'porcentaje_ventas' && monto > 100) return { error: 'El porcentaje sobre ventas no puede pasar de 100' };
  const regla = form.reglaAsistencia === true && form.tipo === 'percepcion';
  const maxRetardos = regla ? Number(form.maxRetardos || 0) : 0;
  const maxFaltas = regla ? Number(form.maxFaltas || 0) : 0;
  if (![maxRetardos, maxFaltas].every(x => Number.isInteger(x) && x >= 0 && x <= 7)) return { error: 'Los retardos y las faltas permitidos van de 0 a 7' };
  const tasaMax = calculo === 'porcentaje_sd' ? 700 : calculo === 'porcentaje_ventas' ? 100 : Infinity;
  if (!['todos', 'departamento', 'personas'].includes(form.aplicaA)) return { error: 'Indica a quién aplica' };
  if (form.aplicaA === 'departamento' && !texto(form.departamento)) return { error: 'Elige el departamento' };
  if (form.vigenteDesde && form.vigenteHasta && form.vigenteHasta < form.vigenteDesde) return { error: 'La fecha final no puede ser anterior a la inicial' };

  const personas = [];
  let conMonto = 0;
  for (const e of personasDelForm(form, empleados)) {
    const p = form.personas?.[String(e.id)] || {};
    const incluida = personaIncluida(form, e.id);
    if (!incluida) {
      if (form.aplicaA !== 'personas') personas.push({ empleado_id: Number(e.id), excluido: true });
      continue;
    }
    const pm = esVacio(p.monto) ? null : num(p.monto);
    const pl = esVacio(p.limite) ? null : num(p.limite);
    if (pm != null && (!Number.isFinite(pm) || pm < 0 || pm > tasaMax)) return { error: `Monto inválido para ${texto(e.nombre)}` };
    if (pl != null && (!Number.isFinite(pl) || pl <= 0)) return { error: `Total del préstamo inválido para ${texto(e.nombre)}` };
    if ((pm ?? monto) > 0) conMonto += 1;
    if (form.aplicaA !== 'personas' && pm == null && pl == null) continue;
    const fila = { empleado_id: Number(e.id) };
    if (pm != null) fila.monto = centavos(pm);
    if (pl != null) fila.limite_total = centavos(pl);
    personas.push(fila);
  }
  if (form.aplicaA === 'personas' && !personas.length && form.activo !== false) return { error: 'Elige al menos una persona' };
  if (form.activo !== false && conMonto === 0) return { error: 'Escribe el monto del concepto (general o por persona)' };

  const id = conceptoId == null || conceptoId === '' ? null : Number(conceptoId);
  return {
    args: {
      p_concepto_id: id,
      p_datos: {
        nombre, tipo: form.tipo, categoria: form.categoria, calculo, monto: centavos(monto), aplica_a: form.aplicaA,
        departamento: form.aplicaA === 'departamento' ? texto(form.departamento) : null,
        activo: form.activo !== false, vigente_desde: form.vigenteDesde || null, vigente_hasta: form.vigenteHasta || null,
        notas: texto(form.notas) || null, personas,
        base_rol: comision ? form.baseRol : null, skus: comision ? [...new Set((form.skus || []).map(texto).filter(Boolean))] : [],
        regla_asistencia: regla, max_retardos: maxRetardos, max_faltas: maxFaltas,
      },
    },
  };
}

/** Avance del tope (préstamo) de una persona en un concepto, o null si no tiene tope. */
export function avanceTope(acumulados, conceptoId, empleadoId) {
  const a = (acumulados || []).find(x => mismoId(x.concepto_id ?? x.conceptoId, conceptoId) && mismoId(x.empleado_id ?? x.empleadoId, empleadoId));
  if (!a) return null;
  const limite = Number(a.limite_total ?? a.limiteTotal) || 0;
  const pagado = Number(a.pagado) || 0;
  const enBorrador = Number(a.en_borrador ?? a.enBorrador) || 0;
  return { limite, pagado, enBorrador, restante: Math.max(centavos(limite - pagado - enBorrador), 0), terminado: pagado >= limite };
}

/** Recibos de un borrador a los que les falta algún concepto del catálogo (para ofrecer "Aplicar"). */
export function recibosConFaltantes(recibos, lineas, conceptos, asignaciones, empleados) {
  const activos = (conceptos || []).filter(c => c.activo !== false);
  if (!activos.length) return 0;
  let k = 0;
  for (const r of recibos || []) {
    const emp = (empleados || []).find(e => mismoId(e.id, r.empleadoId));
    if (!emp) continue;
    const tiene = new Set((lineas || []).filter(l => mismoId(l.reciboId, r.id) && l.conceptoId != null).map(l => Number(l.conceptoId)));
    // Sin vigencia ni tope: son los casos que aquí se pueden saber sin el servidor.
    if (activos.some(c => {
      const a = asignacionDe(asignaciones, c.id, emp.id);
      return !tiene.has(Number(c.id)) && !(c.vigenteDesde || c.vigenteHasta) && esVacio(a?.limiteTotal)
        && conceptoAplica(c, emp, a) && (esAutomatico(c) || montoConcepto(c, a, r.salarioDiario) > 0);
    })) k += 1;
  }
  return k;
}

/** ¿El borrador tiene renglones que el servidor calcula (ventas o asistencia)? Entonces conviene "Actualizar" antes de pagar. */
export function recibosConAutomaticos(recibos, lineas, conceptos) {
  const auto = new Set((conceptos || []).filter(esAutomatico).map(c => Number(c.id)));
  if (!auto.size) return 0;
  const ids = new Set((recibos || []).map(r => Number(r.id)));
  return new Set((lineas || []).filter(l => ids.has(Number(l.reciboId)) && l.conceptoId != null && auto.has(Number(l.conceptoId))).map(l => Number(l.reciboId))).size;
}

/** Texto de ayuda del catálogo (vive aquí: la vista no menciona impuestos ni los calcula). */
export const AYUDA_CONCEPTOS = 'Da de alta aquí cada bono, comisión, prima o descuento una sola vez y di a quién le toca. '
  + 'Al crear la nómina de la semana, cada recibo ya los trae puestos y tú solo quitas o cambias lo que no aplicó. '
  + 'ISR e IMSS se capturan como descuento con el monto de cada persona: el sistema no calcula impuestos. '
  + 'Un préstamo lleva el total a descontar y se apaga solo al terminar. '
  + 'Una comisión se puede calcular sola con lo que cada quien vendió o entregó, y un bono se puede quitar solo a quien faltó o llegó tarde: '
  + 'el sistema propone el número, dice de dónde salió, y tú lo puedes cambiar en el recibo.';
