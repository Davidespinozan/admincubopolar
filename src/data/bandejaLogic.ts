// bandejaLogic.ts — "Mi bandeja": centro de pendientes del admin
// (Tanda 24, roadmap item 8; TS en Tanda 29).
//
// Responde la pregunta "¿qué tengo que atender ahora?" agregando los
// pendientes reales del negocio desde `data` (el store ya mapeado en
// camelCase) y enrutando cada uno al módulo donde se resuelve. Nació
// del feedback de los dueños (abril 2026): no sabían por dónde seguía
// el flujo — la bandeja se los dice.

import { ESTADOS_TERMINALES_RUTA } from './rutasLogic';

type Fila = Record<string, unknown>;

export interface DataBandeja {
  rutas?: Fila[];
  ordenes?: Fila[];
  cuentasPorCobrar?: Fila[];
  cierresDiarios?: Fila[];
  alertas?: Fila[];
  facturacionPendiente?: Fila[];
  leads?: Fila[];
  actividadesAbiertas?: Fila[];
}

export interface TareaBandeja {
  id: string;
  prioridad: 'alta' | 'media';
  /** Nombre de un componente de `Icons` (ui/Icons.jsx), p. ej. 'Truck'. */
  icono: string;
  titulo: string;
  detalle: string;
  modulo: string;
  count: number;
}

const money = (v: unknown): string =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(v) || 0);

const plural = (n: number, sing: string, plur: string): string => `${n} ${n === 1 ? sing : plur}`;

// Órdenes que Ventas mandó a reparto y aún no tienen ruta (Asignada sin ruta).
export function ordenesEsperanRuta(ordenes: Fila[]): Fila[] {
  return ordenes.filter(o => String(o.estatus || '') === 'Asignada' && !(o.ruta_id ?? o.rutaId));
}

/**
 * Construye la lista de tareas pendientes, ordenada: prioridad alta
 * primero, y dentro de cada prioridad en el orden de detección
 * (operación antes que finanzas antes que comercial).
 *
 * @param data el `data` del store (camelCase, ya mapeado)
 * @param hoy 'YYYY-MM-DD' (inyectable en tests)
 */
export function construirBandeja(data: DataBandeja | null | undefined, hoy: string): TareaBandeja[] {
  const d = data || {};
  const tareas: TareaBandeja[] = [];

  // ── 1. Cargas esperando firma (bloquean la salida del camión) ──
  const firmas = (d.rutas || []).filter(r => String(r.estatus || '').trim() === 'Pendiente firma');
  if (firmas.length > 0) {
    tareas.push({
      id: 'firmas',
      prioridad: 'alta',
      icono: 'Pen',
      titulo: plural(firmas.length, 'carga espera firma', 'cargas esperan firma'),
      detalle: 'El chofer no puede salir hasta que Producción firme.',
      modulo: 'rutas',
      count: firmas.length,
    });
  }

  // ── 2. Rutas de días anteriores sin cerrar ──
  const atoradas = (d.rutas || []).filter(r => {
    if (ESTADOS_TERMINALES_RUTA.has(String(r.estatus || '').trim())) return false;
    const fecha = String(r.fecha || '').slice(0, 10);
    return Boolean(fecha) && fecha < hoy;
  });
  if (atoradas.length > 0) {
    const nombres = atoradas.map(r => r.folio || r.nombre).filter(Boolean).slice(0, 3).join(', ');
    tareas.push({
      id: 'rutas-atoradas',
      prioridad: 'alta',
      icono: 'Truck',
      titulo: plural(atoradas.length, 'ruta de días anteriores sigue abierta', 'rutas de días anteriores siguen abiertas'),
      detalle: `${nombres ? nombres + ' — ' : ''}sin cierre no hay corte de caja ni retorno de inventario.`,
      modulo: 'rutas',
      count: atoradas.length,
    });
  }

  // ── 3. Cartera vencida ──
  const cxcVencidas = (d.cuentasPorCobrar || []).filter(c => {
    if (String(c.estatus || '') === 'Pagada') return false;
    if (!(Number(c.saldoPendiente) > 0)) return false;
    const vence = String(c.fechaVencimiento || '').slice(0, 10);
    return Boolean(vence) && vence < hoy;
  });
  if (cxcVencidas.length > 0) {
    const total = cxcVencidas.reduce((acc, c) => acc + (Number(c.saldoPendiente) || 0), 0);
    tareas.push({
      id: 'cxc-vencidas',
      prioridad: 'alta',
      icono: 'DollarSign',
      titulo: `Cartera vencida: ${money(total)}`,
      detalle: `${plural(cxcVencidas.length, 'cuenta vencida', 'cuentas vencidas')} — entre más días pasan, más difícil cobrar.`,
      modulo: 'cobros',
      count: cxcVencidas.length,
    });
  }

  // ── 4. Cortes de HOY con diferencia de caja ──
  const cierresDif = (d.cierresDiarios || []).filter(c => {
    const fecha = String(c.fecha || '').slice(0, 10);
    return fecha === hoy && Number(c.diferencia || 0) !== 0;
  });
  if (cierresDif.length > 0) {
    tareas.push({
      id: 'cierres-diferencia',
      prioridad: 'alta',
      icono: 'AlertTriangle',
      titulo: plural(cierresDif.length, 'corte de hoy con diferencia de caja', 'cortes de hoy con diferencia de caja'),
      detalle: 'El efectivo contado no cuadra con lo esperado. Revísalo hoy mismo.',
      modulo: 'conciliacion',
      count: cierresDif.length,
    });
  }

  // ── 5. Stock crítico (alertas de umbral, sin las de CxC/complemento) ──
  const alertasStock = (d.alertas || []).filter(a => {
    const id = String(a.id || '');
    return !id.startsWith('cxc-') && !id.startsWith('comp-') && !id.startsWith('ruta-');
  });
  const stockCritico = alertasStock.filter(a => a.tipo === 'critica');
  if (stockCritico.length > 0) {
    tareas.push({
      id: 'stock-critico',
      prioridad: 'alta',
      icono: 'Snowflake',
      titulo: plural(stockCritico.length, 'producto bajo mínimo', 'productos bajo mínimo'),
      detalle: 'Sin stock no hay reparto mañana. Programa producción.',
      modulo: 'produccion',
      count: stockCritico.length,
    });
  }

  // ── 6. Ventas creadas sin asignar a ruta ──
  // ── PD-02: actividades del calendario vencidas (estado calculado por el servidor) ──
  const actVencidas = (d.actividadesAbiertas || []).filter(a => String(a.estado || '') === 'vencida');
  if (actVencidas.length > 0) {
    tareas.push({
      id: 'actividades-vencidas',
      prioridad: 'alta',
      icono: 'Calendar',
      titulo: plural(actVencidas.length, 'actividad vencida', 'actividades vencidas'),
      detalle: 'Mantenimientos, pagos u obligaciones que pasaron su fecha límite sin completarse.',
      modulo: 'calendario',
      count: actVencidas.length,
    });
  }

  // Ventas pidió reparto ("Enviar a ruta" deja la orden Asignada SIN ruta):
  // solo Admin la puede subir a una ruta, así que es urgente para él.
  const esperanRuta = ordenesEsperanRuta(d.ordenes || []);
  if (esperanRuta.length > 0) {
    tareas.push({
      id: 'ordenes-esperan-ruta',
      prioridad: 'alta',
      icono: 'Truck',
      titulo: plural(esperanRuta.length, 'venta espera ruta', 'ventas esperan ruta'),
      detalle: 'Ventas las mandó a reparto: asígnalas a una ruta para que el chofer las entregue.',
      modulo: 'rutas',
      count: esperanRuta.length,
    });
  }

  // Creadas: aún no se cobran/entregan en mostrador ni se mandan a reparto.
  const sinRuta = (d.ordenes || []).filter(o => String(o.estatus || '') === 'Creada');
  if (sinRuta.length > 0) {
    tareas.push({
      id: 'ordenes-sin-ruta',
      prioridad: 'media',
      icono: 'Box',
      titulo: plural(sinRuta.length, 'venta sin entregar', 'ventas sin entregar'),
      detalle: 'Cóbrala y entrégala en mostrador o mándala a una ruta.',
      modulo: 'ordenes',
      count: sinRuta.length,
    });
  }

  // ── 7. Por facturar ──
  const porFacturar = d.facturacionPendiente || [];
  if (porFacturar.length > 0) {
    tareas.push({
      id: 'por-facturar',
      prioridad: 'media',
      icono: 'Receipt',
      titulo: plural(porFacturar.length, 'venta por facturar', 'ventas por facturar'),
      detalle: 'Clientes esperando su CFDI.',
      modulo: 'facturacion',
      count: porFacturar.length,
    });
  }

  // ── 8. Complementos de pago PPD pendientes ──
  const complementos = (d.alertas || []).filter(a => String(a.id || '').startsWith('comp-'));
  if (complementos.length > 0) {
    tareas.push({
      id: 'complementos-ppd',
      prioridad: 'media',
      icono: 'FileText',
      titulo: plural(complementos.length, 'complemento de pago pendiente', 'complementos de pago pendientes'),
      detalle: 'Facturas a crédito (PPD) sin complemento — el SAT lo exige al cobrar.',
      modulo: 'facturacion',
      count: complementos.length,
    });
  }

  // ── 9. Stock en nivel accionable (aún no crítico) ──
  const stockBajo = alertasStock.filter(a => a.tipo === 'accionable');
  if (stockBajo.length > 0) {
    tareas.push({
      id: 'stock-bajo',
      prioridad: 'media',
      icono: 'TrendDown',
      titulo: plural(stockBajo.length, 'producto en nivel bajo', 'productos en nivel bajo'),
      detalle: 'Todavía no es crítico, pero planéalo en la siguiente producción.',
      modulo: 'produccion',
      count: stockBajo.length,
    });
  }

  // ── 10. Leads sin contactar ──
  const leadsNuevos = (d.leads || []).filter(l => String(l.estatus || '') === 'Nuevo');
  if (leadsNuevos.length > 0) {
    tareas.push({
      id: 'leads-nuevos',
      prioridad: 'media',
      icono: 'Phone',
      titulo: plural(leadsNuevos.length, 'lead sin contactar', 'leads sin contactar'),
      detalle: 'Llegaron de la landing — un lead frío se pierde en días.',
      modulo: 'leads',
      count: leadsNuevos.length,
    });
  }

  // alta primero, media después; dentro de cada prioridad se conserva
  // el orden de detección (estable).
  return [
    ...tareas.filter(t => t.prioridad === 'alta'),
    ...tareas.filter(t => t.prioridad === 'media'),
  ];
}

/** Total de pendientes prioridad alta — para el badge del menú. */
export function contarUrgentes(tareas: TareaBandeja[] | null | undefined): number {
  return (tareas || []).filter(t => t.prioridad === 'alta').length;
}

// ─── Mi bandeja para TODOS los roles (2026-10-09) ───────────────────────────
// Admin (y back office) conserva su bandeja de negocio (construirBandeja); los
// roles de campo ven lo que les toca a ellos. Todos suman lo personal:
// asistencia por marcar y actividades asignadas. El alcance de los datos ya
// viene recortado por rol (App: scopedData) y por el servidor (RLS).

interface UsuarioBandeja { id?: unknown; rol?: string; accesos_extra?: unknown; accesosExtra?: unknown }
interface PersonalesBandeja {
  /** Resultado de recordatorioAsistencia(mi_asistencia) o null. */
  asistencia?: { clave: string; titulo: string; detalle: string } | null;
  /** Ocurrencias abiertas asignadas a la persona (calendario, solo mías). */
  actividades?: Fila[];
}
const ROLES_BACKOFFICE = ['Admin', 'Facturación', 'Sin asignar'];
const rolesDeUsuario = (u: UsuarioBandeja | null | undefined): string[] => {
  const extra = (u?.accesosExtra ?? u?.accesos_extra) as unknown;
  return [String(u?.rol || ''), ...(Array.isArray(extra) ? extra.map(String) : [])].filter(Boolean);
};

/** Pendientes personales: asistencia y actividades asignadas. */
export function tareasPersonales(p: PersonalesBandeja | null | undefined): TareaBandeja[] {
  const tareas: TareaBandeja[] = [];
  const a = p?.asistencia;
  if (a && a.clave !== 'salida') {
    tareas.push({ id: 'mi-asistencia-' + a.clave, prioridad: a.clave === 'entrada' ? 'alta' : 'media', icono: 'Clock',
      titulo: a.titulo, detalle: a.detalle, modulo: 'mi-asistencia', count: 1 });
  }
  const acts = p?.actividades || [];
  const vencidas = acts.filter(x => String(x.estado || '') === 'vencida');
  const pendientes = acts.filter(x => String(x.estado || '') === 'pendiente');
  if (vencidas.length > 0) {
    tareas.push({ id: 'mis-actividades-vencidas', prioridad: 'alta', icono: 'Calendar',
      titulo: plural(vencidas.length, 'actividad tuya vencida', 'actividades tuyas vencidas'),
      detalle: vencidas.slice(0, 2).map(x => String(x.titulo || '')).filter(Boolean).join(' · ') || 'Pasaron su fecha límite sin completarse.',
      modulo: 'mis-actividades', count: vencidas.length });
  }
  if (pendientes.length > 0) {
    tareas.push({ id: 'mis-actividades-pendientes', prioridad: 'media', icono: 'Calendar',
      titulo: plural(pendientes.length, 'actividad por hacer', 'actividades por hacer'),
      detalle: pendientes.slice(0, 2).map(x => String(x.titulo || '')).filter(Boolean).join(' · ') || 'Están dentro de su ventana.',
      modulo: 'mis-actividades', count: pendientes.length });
  }
  return tareas;
}

/** Pendientes de Ventas (rol o acceso adicional): sus ventas sin cobrar/entregar. */
export function tareasVentas(d: DataBandeja, hoy: string): TareaBandeja[] {
  const tareas: TareaBandeja[] = [];
  const creadas = (d.ordenes || []).filter(o => String(o.estatus || '') === 'Creada');
  const viejas = creadas.filter(o => String(o.fecha || '').slice(0, 10) < hoy);
  const deHoy = creadas.filter(o => !viejas.includes(o));
  if (viejas.length > 0) {
    tareas.push({ id: 'ventas-atrasadas', prioridad: 'alta', icono: 'ShoppingCart',
      titulo: plural(viejas.length, 'venta de días anteriores sin entregar', 'ventas de días anteriores sin entregar'),
      detalle: 'Cóbrala y entrégala, mándala a ruta o pide que la cancelen.', modulo: 'ventas', count: viejas.length });
  }
  if (deHoy.length > 0) {
    tareas.push({ id: 'ventas-por-cobrar', prioridad: 'media', icono: 'DollarSign',
      titulo: plural(deHoy.length, 'venta por cobrar o entregar', 'ventas por cobrar o entregar'),
      detalle: 'Cóbrala en mostrador o mándala a ruta.', modulo: 'ventas', count: deHoy.length });
  }
  return tareas;
}

/** Pendientes de Producción: firmas de carga, lo que falta producir y stock crítico. */
export function tareasProduccion(d: DataBandeja): TareaBandeja[] {
  const tareas: TareaBandeja[] = [];
  const firmas = (d.rutas || []).filter(r => String(r.estatus || '').trim() === 'Pendiente firma');
  if (firmas.length > 0) {
    tareas.push({ id: 'firmas', prioridad: 'alta', icono: 'Pen',
      titulo: plural(firmas.length, 'carga espera tu firma', 'cargas esperan tu firma'),
      detalle: 'El chofer no puede salir hasta que firmes su carga.', modulo: 'prod-producir', count: firmas.length });
  }
  const producir = (d.alertas || []).filter(a => String(a.id || '').startsWith('prod-min-'));
  if (producir.length > 0) {
    tareas.push({ id: 'por-producir', prioridad: 'media', icono: 'Factory',
      titulo: plural(producir.length, 'producto por producir', 'productos por producir'),
      detalle: 'Hay pedidos o mínimos que el stock no cubre.', modulo: 'prod-producir', count: producir.length });
  }
  return tareas;
}

/** Pendientes de Almacén de Bolsas: empaques sin existencia o bajo mínimo. */
export function tareasAlmacen(d: DataBandeja & { productos?: Fila[] }): TareaBandeja[] {
  const tareas: TareaBandeja[] = [];
  const empaques = (d.productos || []).filter(p => String(p.tipo || '') === 'Empaque');
  const sin = empaques.filter(p => Number(p.stock || 0) <= 0);
  const bajo = empaques.filter(p => Number(p.stock || 0) > 0 && Number(p.stock_minimo ?? p.stockMinimo ?? 0) > 0 && Number(p.stock) <= Number(p.stock_minimo ?? p.stockMinimo));
  if (sin.length > 0) {
    tareas.push({ id: 'bolsas-sin-existencia', prioridad: 'alta', icono: 'Box',
      titulo: plural(sin.length, 'tipo de bolsa sin existencia', 'tipos de bolsa sin existencia'),
      detalle: sin.slice(0, 3).map(p => String(p.nombre || p.sku || '')).join(' · ') + '. Sin bolsas no se puede producir.',
      modulo: 'bolsas-almacen', count: sin.length });
  }
  if (bajo.length > 0) {
    tareas.push({ id: 'bolsas-bajas', prioridad: 'media', icono: 'Box',
      titulo: plural(bajo.length, 'tipo de bolsa bajo el mínimo', 'tipos de bolsa bajo el mínimo'),
      detalle: bajo.slice(0, 3).map(p => String(p.nombre || p.sku || '')).join(' · '), modulo: 'bolsas-almacen', count: bajo.length });
  }
  return tareas;
}

/**
 * Bandeja de una persona: lo de su rol (y accesos) + lo personal, urgentes primero.
 * Back office: la bandeja de negocio de siempre + lo personal.
 */
export function construirBandejaUsuario(usuario: UsuarioBandeja | null | undefined, data: DataBandeja | null | undefined,
  hoy: string, personales?: PersonalesBandeja | null): TareaBandeja[] {
  const d = (data || {}) as DataBandeja & { productos?: Fila[] };
  const roles = rolesDeUsuario(usuario);
  let tareas: TareaBandeja[] = [];
  if (roles.some(r => ROLES_BACKOFFICE.includes(r))) {
    tareas = construirBandeja(d, hoy);
    // En back office las actividades de todos ya salen como "actividades vencidas": lo personal suma solo la asistencia.
    tareas = [...tareasPersonales({ asistencia: personales?.asistencia }), ...tareas];
  } else {
    if (roles.includes('Ventas')) tareas.push(...tareasVentas(d, hoy));
    if (roles.includes('Producción')) tareas.push(...tareasProduccion(d));
    if (roles.includes('Almacén Bolsas')) tareas.push(...tareasAlmacen(d));
    tareas.push(...tareasPersonales(personales));
  }
  const vistos = new Set<string>();
  tareas = tareas.filter(t => (vistos.has(t.id) ? false : (vistos.add(t.id), true)));
  return [...tareas.filter(t => t.prioridad === 'alta'), ...tareas.filter(t => t.prioridad === 'media')];
}
