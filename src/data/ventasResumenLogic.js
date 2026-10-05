// ventasResumenLogic.js — B3.4 (convergencia por rol): contexto propio de cada
// módulo del rol Ventas (Por cobrar · Hoy · Todas), derivado SOLO de las
// órdenes que la vista ya tiene (`ordenesUsuario`: las propias, o todas en la
// vista previa de Admin). No consulta nada ni cambia estatus: los filtros usan
// los estatus persistidos tal cual ('Creada', 'Asignada', 'Entregada', …).
//   Por cobrar directo  = estatus === 'Creada'
//   En ruta por cobrar  = estatus === 'Asignada'
// Son etiquetas de presentación (decisión del dueño, B3.4); el ciclo de vida
// de la orden, quién cobra y los contratos no cambian. Sin saldo, CxC ni cobros.
import { s, n } from '../utils/safe';
import { TRANSICIONES_ORDEN } from './ordenLogic';

export const ESTATUS_DIRECTO = 'Creada';
export const ESTATUS_EN_RUTA = 'Asignada';
// Orden de presentación: el vocabulario existente del ciclo de vida.
const ORDEN_ESTATUS = Object.keys(TRANSICIONES_ORDEN);

const lista = (v) => (Array.isArray(v) ? v : []);
const idNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const bucket = (ordenes) => ({ ordenes, count: ordenes.length, monto: ordenes.reduce((t, o) => t + n(o.total), 0) });

/** Misma regla que la vista: `o.fecha && o.fecha.slice(0, 10) === hoy`. */
export function esOrdenDelDia(o, hoy) {
  return !!(o && o.fecha && s(o.fecha).slice(0, 10) === hoy);
}

/**
 * Por cobrar: dos grupos que no se mezclan. `monto` = Σ total de cada grupo
 * (aritmética de los totales guardados; no es saldo ni CxC).
 */
export function resumenPorCobrar(ordenes) {
  const todas = lista(ordenes);
  const directo = bucket(todas.filter(o => o && o.estatus === ESTATUS_DIRECTO));
  const enRuta = bucket(todas.filter(o => o && o.estatus === ESTATUS_EN_RUTA));
  return { directo, enRuta, vacio: directo.count === 0 && enRuta.count === 0 };
}

/**
 * Hoy: órdenes del día de negocio, "Vendido hoy" con la semántica existente
 * (Σ total de las de hoy en 'Entregada'), desglose por estatus persistido y la
 * última venta de hoy (id mayor: el orden en que el servidor las numera).
 */
export function resumenVentasHoy(ordenes, hoy) {
  const ordenesHoy = lista(ordenes).filter(o => esOrdenDelDia(o, hoy));
  const vendidoHoy = ordenesHoy.filter(o => o.estatus === "Entregada").reduce((t, o) => t + n(o.total), 0);
  const conteo = new Map();
  for (const o of ordenesHoy) { const e = s(o.estatus) || 'Sin estatus'; conteo.set(e, (conteo.get(e) || 0) + 1); }
  const rango = (e) => { const i = ORDEN_ESTATUS.indexOf(e); return i === -1 ? ORDEN_ESTATUS.length : i; };
  const porEstatus = [...conteo.entries()]
    .sort((a, b) => rango(a[0]) - rango(b[0]) || a[0].localeCompare(b[0]))
    .map(([estatus, count]) => ({ estatus, count }));
  const u = ordenesHoy.reduce((acc, o) => (!acc || idNum(o.id) > idNum(acc.id) ? o : acc), null);
  return {
    ordenesHoy,
    count: ordenesHoy.length,
    vendidoHoy,
    porEstatus,
    ultima: u ? { id: u.id, folio: s(u.folio) || s(u.id), cliente: s(u.cliente), total: n(u.total), estatus: s(u.estatus) } : null,
  };
}

/** "2 Entregada · 1 Creada": desglose legible con los estatus tal como se guardan. */
export function textoDesglose(porEstatus) {
  return lista(porEstatus).map(x => `${x.count} ${x.estatus}`).join(' · ');
}

/** Todas: número de órdenes y fecha más antigua (YYYY-MM-DD) o null. */
export function resumenHistorial(ordenes) {
  const todas = lista(ordenes);
  const fechas = todas.map(o => s(o && o.fecha).slice(0, 10)).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  return { count: todas.length, desde: fechas[0] || null };
}
