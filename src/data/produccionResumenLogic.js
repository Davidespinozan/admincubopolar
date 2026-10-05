// produccionResumenLogic.js — B3.2 (convergencia por rol): resumen propio de
// cada módulo del rol Producción, derivado SOLO de los datos que la vista ya
// recibe (data.cuartosFrios, data.productos, data.mermas, data.produccion).
// No consulta nada: ni Supabase, ni RPC, ni contratos. Las reglas de "hoy"
// (fecha.slice(0,10) === día de negocio), de merma vigente (mermasActivas) y
// de tarimas (utils/tarimas) son las mismas que ya usa la vista; aquí solo se
// agrupan por módulo para que Congeladores, Mermas y Transformación abran con
// su propio contexto en vez de repetir el resumen general de Producción.
import { s, n } from '../utils/safe';
import { mermasActivas } from './mermasLogic';
import { tarimasOcupadasEnCuarto, colorTarimasUso } from '../utils/tarimas';

const num = (v) => Number(v || 0);
const idNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Misma regla que prodHoy / mermasHoyList de la vista: la fecha (DATE o ISO) empieza por el día de negocio. */
export function esDelDia(fecha, hoy) {
  const f = s(fecha);
  return !!f && !!hoy && f.slice(0, 10) === hoy;
}

/**
 * Congeladores: existencia total (bolsas), tarimas ocupadas vs capacidad
 * configurada (solo cuartos con capacidad_tarimas > 0, como la barra de cada
 * tarjeta) y tarimas libres (capacidad − ocupadas). `pct` es null sin capacidad.
 */
export function resumenCongeladores(cuartosFrios, productos) {
  const cuartos = Array.isArray(cuartosFrios) ? cuartosFrios : [];
  let existencia = 0; let ocupadas = 0; let capacidad = 0;
  const sinCapacidad = [];
  const porCuarto = cuartos.map(cf => {
    const stock = (cf?.stock && typeof cf.stock === 'object') ? cf.stock : {};
    const bolsas = Object.values(stock).reduce((t, v) => t + n(v), 0);
    existencia += bolsas;
    const cap = n(cf?.capacidad_tarimas);
    const ocup = cap > 0 ? tarimasOcupadasEnCuarto(cf, productos) : 0;
    if (cap > 0) { ocupadas += ocup; capacidad += cap; } else sinCapacidad.push(s(cf?.nombre) || s(cf?.id));
    return { id: s(cf?.id), nombre: s(cf?.nombre), bolsas, ocupadas: ocup, capacidad: cap, color: colorTarimasUso(ocup, cap) };
  });
  const pct = capacidad > 0 ? Math.round((ocupadas / capacidad) * 100) : null;
  return {
    existencia,
    congeladores: cuartos.length,
    conCapacidad: cuartos.length - sinCapacidad.length,
    sinCapacidad,
    tarimasOcupadas: ocupadas,
    tarimasCapacidad: capacidad,
    tarimasLibres: capacidad > 0 ? Math.max(0, capacidad - ocupadas) : null,
    pct,
    color: colorTarimasUso(ocupadas, capacidad),
    porCuarto,
  };
}

/**
 * Mermas: bolsas y registros de las mermas VIGENTES de hoy (mismo filtro que
 * la lista "Mermas de hoy") y la última registrada hoy (id mayor).
 */
export function resumenMermas(mermas, hoy) {
  const deHoy = mermasActivas(mermas).filter(m => esDelDia(m.fecha, hoy));
  const mermaHoy = deHoy.reduce((t, m) => t + n(m.cantidad), 0);
  const u = deHoy.reduce((acc, m) => (!acc || idNum(m.id) > idNum(acc.id) ? m : acc), null);
  return {
    mermaHoy,
    registrosHoy: deHoy.length,
    ultima: u ? { id: u.id, sku: s(u.sku), cantidad: n(u.cantidad), causa: s(u.causa), origen: s(u.origen) } : null,
  };
}

/**
 * Transformación: filas tipo 'Transformacion' de data.produccion (misma regla
 * que el historial). Conteo y kg de entrada/salida de hoy (sumas de los
 * valores guardados por el servidor; sin rendimiento agregado) y la última
 * transformación del historial (id mayor).
 */
export function resumenTransformacion(produccion, hoy) {
  const todas = (Array.isArray(produccion) ? produccion : []).filter(p => p && p.tipo === 'Transformacion');
  const deHoy = todas.filter(t => esDelDia(t.fecha, hoy));
  const u = todas.reduce((acc, t) => (!acc || idNum(t.id) > idNum(acc.id) ? t : acc), null);
  return {
    transformacionesHoy: deHoy.length,
    entradaKg: deHoy.reduce((t, x) => t + num(x.input_kg), 0),
    salidaKg: deHoy.reduce((t, x) => t + num(x.output_kg), 0),
    historial: todas.length,
    ultima: u ? {
      id: u.id, folio: s(u.folio) || s(u.id), fecha: u.fecha,
      inputKg: num(u.input_kg), inputSku: s(u.input_sku), outputKg: num(u.output_kg), outputSku: s(u.sku || u.output_sku),
    } : null,
  };
}
