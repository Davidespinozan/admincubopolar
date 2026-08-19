// realtimeLogic.js — partición de tablas para el realtime granular
// (Tanda 23).
//
// Antes, cualquier cambio en cualquiera de las 20 tablas suscritas
// disparaba un fetchAll completo (~30 queries). La partición separa:
//
// - NÚCLEO: tablas con joins cruzados en el mapeo del store (el saldo
//   del cliente sale de CxC, la ruta cuenta sus órdenes y resuelve
//   chofer/ayudante/camión, las alertas mezclan productos + umbrales +
//   cuartos + órdenes + CxC + invoice_attempts). Cambia una → se
//   recarga el núcleo completo (14 queries), porque recalcular sus
//   derivados requiere a las demás.
//
// - SLICES: tablas independientes que solo se mapean a sí mismas
//   (toCamel + números). Cambia una → se recarga SOLO esa (1-2
//   queries). Las que cambian juntas comparten slice: cxp arrastra
//   pagos_proveedores, nómina arrastra recibos, costos arrastra
//   historial.
//
// supaStore.js consume estas listas; los tests validan que la
// partición sea disjunta y cubra todo lo que estaba suscrito antes.

export const TABLAS_CORE_RT = [
  'clientes',
  'productos',
  'ordenes',
  'rutas',
  'cuartos_frios',
  'empleados',
  'cuentas_por_cobrar',
];

export const TABLAS_SLICE_RT = [
  'produccion',
  'inventario_mov',
  'pagos',
  'auditoria',
  'comodatos',
  'leads',
  'movimientos_contables',
  'mermas',
  'nomina_periodos',
  'cuentas_por_pagar',
  'costos_fijos',
  'devoluciones',
  'cierres_diarios',
  // Nuevas suscripciones (no estaban en el realtime pre-Tanda 23):
  // sin esta, las notificaciones de los crons (Tanda 21) no aparecían
  // en la campana hasta que otro evento refrescara los datos.
  'notificaciones',
  // GPS en vivo: el mapa del admin ahora ve al chofer moverse sin
  // esperar a que otra tabla cambie.
  'chofer_ubicaciones',
];

export type GrupoRealtime = 'core' | 'slice';

/** Grupo de refetch para una tabla suscrita: 'core' | 'slice' | null. */
export function grupoParaTabla(tabla: string): GrupoRealtime | null {
  if (TABLAS_CORE_RT.includes(tabla)) return 'core';
  if (TABLAS_SLICE_RT.includes(tabla)) return 'slice';
  return null;
}
