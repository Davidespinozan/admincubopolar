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
