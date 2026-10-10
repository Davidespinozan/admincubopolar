// resumenRolLogic.js — cifras del "Resumen" de los roles de campo (2026-10-09).
// Puras: reciben el `data` del store ya recortado al alcance del rol.
import { resumenVentasHoy, resumenPendientes } from './ventasResumenLogic';
import { resumenCongeladores, resumenMermas, esDelDia } from './produccionResumenLogic';

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const lista = (v) => (Array.isArray(v) ? v : []);
const dinero = (v) => '$' + Math.round(num(v)).toLocaleString('es-MX');

/** Accesos directos a los módulos de trabajo del usuario (los de su menú, sin Inicio ni lo personal). */
export function accesosDeTrabajo(nav) {
  const fuera = new Set(['dashboard', 'bandeja', 'mi-asistencia', 'mis-actividades', 'mi-cuenta']);
  return lista(nav?.areas).flatMap(a => lista(a.items)).filter(i => !fuera.has(i.id));
}

/**
 * Cifras por rol (o acceso adicional). Cada una: { label, value, hint?, tone?, modulo? }.
 * @param {string[]} roles rol principal + accesos adicionales
 */
export function cifrasResumen(roles, data, hoy) {
  const d = data || {};
  const out = [];
  if (roles.includes('Ventas')) {
    const v = resumenVentasHoy(d.ordenes, hoy);
    const p = resumenPendientes(d.ordenes, d.pagos);
    out.push({ label: 'Vendido hoy', value: dinero(v.vendidoHoy), hint: `${v.count} ${v.count === 1 ? 'venta' : 'ventas'} hoy`, modulo: 'ventas-hoy' });
    out.push({ label: 'Por cobrar o entregar', value: String(p.count), hint: p.count > 0 ? dinero(p.porCobrar.monto + p.pagadasPorEntregar.monto) : 'nada pendiente',
      tone: p.count > 0 ? 'warning' : undefined, modulo: 'ventas' });
  }
  if (roles.includes('Producción')) {
    const producido = lista(d.produccion).filter(x => esDelDia(x.fecha, hoy) && String(x.estatus || '') !== 'Revertida').reduce((t, x) => t + num(x.cantidad), 0);
    const cf = resumenCongeladores(d.cuartosFrios, d.productos);
    const mer = resumenMermas(d.mermas, hoy);
    out.push({ label: 'Producido hoy', value: producido.toLocaleString('es-MX'), hint: 'bolsas', modulo: 'prod-producir' });
    out.push({ label: 'En congeladores', value: num(cf.existencia).toLocaleString('es-MX'), hint: `${cf.congeladores} congeladores`, modulo: 'prod-cuartos' });
    out.push({ label: 'Merma hoy', value: num(mer.mermaHoy).toLocaleString('es-MX'), hint: 'bolsas', tone: num(mer.mermaHoy) > 0 ? 'danger' : undefined, modulo: 'prod-mermas' });
  }
  if (roles.includes('Almacén Bolsas')) {
    for (const p of lista(d.productos).filter(x => String(x.tipo || '') === 'Empaque')) {
      const st = num(p.stock);
      out.push({ label: String(p.nombre || p.sku || ''), value: st.toLocaleString('es-MX'), hint: st <= 0 ? 'sin existencia' : 'bolsas', tone: st <= 0 ? 'danger' : undefined, modulo: 'bolsas-almacen' });
    }
  }
  return out;
}
