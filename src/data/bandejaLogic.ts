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
}

export interface TareaBandeja {
  id: string;
  prioridad: 'alta' | 'media';
  icono: string;
  titulo: string;
  detalle: string;
  modulo: string;
  count: number;
}

const money = (v: unknown): string =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(v) || 0);

const plural = (n: number, sing: string, plur: string): string => `${n} ${n === 1 ? sing : plur}`;

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
      icono: '✍️',
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
      icono: '🚚',
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
      icono: '💰',
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
      icono: '⚠️',
      titulo: plural(cierresDif.length, 'corte de hoy con diferencia de caja', 'cortes de hoy con diferencia de caja'),
      detalle: 'El efectivo contado no cuadra con lo esperado. Revísalo hoy mismo.',
      modulo: 'conciliacion',
      count: cierresDif.length,
    });
  }

  // ── 5. Stock crítico (alertas de umbral, sin las de CxC/complemento) ──
  const alertasStock = (d.alertas || []).filter(a => {
    const id = String(a.id || '');
    return !id.startsWith('cxc-') && !id.startsWith('comp-');
  });
  const stockCritico = alertasStock.filter(a => a.tipo === 'critica');
  if (stockCritico.length > 0) {
    tareas.push({
      id: 'stock-critico',
      prioridad: 'alta',
      icono: '🧊',
      titulo: plural(stockCritico.length, 'producto bajo mínimo', 'productos bajo mínimo'),
      detalle: 'Sin stock no hay reparto mañana. Programa producción.',
      modulo: 'produccion',
      count: stockCritico.length,
    });
  }

  // ── 6. Ventas creadas sin asignar a ruta ──
  const sinRuta = (d.ordenes || []).filter(o => String(o.estatus || '') === 'Creada');
  if (sinRuta.length > 0) {
    tareas.push({
      id: 'ordenes-sin-ruta',
      prioridad: 'media',
      icono: '📦',
      titulo: plural(sinRuta.length, 'venta sin asignar a ruta', 'ventas sin asignar a ruta'),
      detalle: 'Asígnalas a una ruta para que salgan a reparto.',
      modulo: 'rutas',
      count: sinRuta.length,
    });
  }

  // ── 7. Por facturar ──
  const porFacturar = d.facturacionPendiente || [];
  if (porFacturar.length > 0) {
    tareas.push({
      id: 'por-facturar',
      prioridad: 'media',
      icono: '🧾',
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
      icono: '📄',
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
      icono: '📉',
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
      icono: '📞',
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
