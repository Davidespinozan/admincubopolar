// navRolLogic.js — Fase B (convergencia por rol): UNA fuente de verdad de la
// navegación que recibe cada rol dentro del shell compartido (CuboPolarERP).
//
// El shell ya no decide por rol con JSX disperso: lee `navParaRol(rol)` y
// pinta sidebar, drawer, cabecera y contenido con esos datos.
//   - modo 'completo': sidebar (lg+) / drawer (móvil) + cabecera con módulos.
//   - modo 'enfoque':  sin sidebar ni cabecera del shell; el contenido trae su
//                      propio chrome mínimo (Chofer: pasos cargar → ruta → cierre).
//   - areas/items:     menú por rol. Admin, Facturación y Sin asignar conservan
//                      EXACTAMENTE los 25 módulos de siempre (su alcance no se
//                      reduce aquí: eso es una decisión de producto aparte).
//   - chrome:          qué extras de la cabecera aplican al rol.
//   - inicio:          módulo de entrada (sustituye al hash inválido).
// Las pestañas internas de Producción son módulos del menú (deep link
// #/prod-cuartos) y se traducen a la pestaña de la vista con tabDesdeModulo.
// B3.6: Ventas es UN solo módulo ("ventas"); Pendientes / Hoy / Todas son
// filtros internos del espacio de trabajo. Cada filtro conserva un hash propio
// (vista que no es entrada del menú: nav.vistas) para que refrescar, atrás y
// adelante y los enlaces guardados abran el mismo filtro; '#/ventas-cobrar'
// (B3.4) queda como alias de '#/ventas' (Pendientes).

// WF-0 + PD-01 (mig 116): asistencia. "Asistencia" (Admin) es un módulo del
// área Equipo; "Mi asistencia" es la ÚNICA pantalla del rol Empleado y, para
// los demás roles, una vista sin entrada de menú (botón de la cabecera).
export const MODULO_ASISTENCIA = { id: "asistencia", label: "Asistencia", icon: "Clock" };
export const MODULO_MI_ASISTENCIA = { id: "mi-asistencia", label: "Mi asistencia", icon: "Clock" };
// PD-02 (mig 118): "Calendario" (Admin, área Operación) y "Mis actividades"
// (lo asignado a la persona; módulo del Empleado y vista para los demás roles).
export const MODULO_CALENDARIO = { id: "calendario", label: "Calendario", icon: "Calendar" };
export const MODULO_MIS_ACTIVIDADES = { id: "mis-actividades", label: "Mis actividades", icon: "Calendar" };
const VISTA_MI_ASISTENCIA = {
  [MODULO_MI_ASISTENCIA.id]: MODULO_MI_ASISTENCIA.id,
  [MODULO_MIS_ACTIVIDADES.id]: MODULO_MIS_ACTIVIDADES.id,
};
const SOLO_ADMIN = new Set([MODULO_ASISTENCIA.id, MODULO_CALENDARIO.id]);

export const AREAS_ADMIN = [
  { id: "operacion", label: "Operación", icon: "Factory", color: "blue",
    items: [
      { id: "dashboard", label: "Resumen", icon: "Dashboard" },
      { id: "bandeja", label: "Mi bandeja", icon: "ClipboardCheck" },
      MODULO_CALENDARIO,
      { id: "produccion", label: "Producción", icon: "Factory" },
      { id: "inventario", label: "Congeladores", icon: "Warehouse" },
      { id: "mermas", label: "Mermas", icon: "AlertTriangle" },
      { id: "comodatos", label: "Comodatos", icon: "Truck" },
      { id: "rutas", label: "Rutas", icon: "Truck" },
      { id: "bolsas", label: "Insumos", icon: "Box" },
    ]
  },
  { id: "comercial", label: "Comercial", icon: "ShoppingCart", color: "emerald",
    items: [
      { id: "ordenes", label: "Ventas", icon: "ShoppingCart" },
      { id: "clientes", label: "Clientes", icon: "Users" },
      { id: "leads", label: "Leads", icon: "UserCheck" },
      { id: "precios", label: "Precios", icon: "DollarSign" },
      { id: "productos", label: "Catálogo", icon: "Package" },
    ]
  },
  { id: "finanzas", label: "Finanzas", icon: "Wallet", color: "amber",
    items: [
      { id: "contabilidad", label: "Movimientos", icon: "Calculator" },
      { id: "cobros", label: "Por cobrar", icon: "DollarSign" },
      { id: "proveedores", label: "Por pagar", icon: "CreditCard" },
      { id: "devoluciones", label: "Devoluciones", icon: "Truck" },
      { id: "costos", label: "Costos", icon: "Receipt" },
      { id: "facturacion", label: "Facturación", icon: "FileText" },
      { id: "conciliacion", label: "Cortes", icon: "ClipboardCheck" },
      { id: "nomina", label: "Nómina", icon: "Wallet" },
    ]
  },
  { id: "equipo", label: "Equipo", icon: "Users", color: "purple",
    items: [
      { id: "empleados", label: "Empleados", icon: "UserCheck" },
      MODULO_ASISTENCIA,
      { id: "kardex", label: "Kardex", icon: "ClipboardCheck" },
      { id: "auditoria", label: "Auditoría", icon: "Shield" },
      { id: "configuracion", label: "Ajustes", icon: "Settings" },
    ]
  },
];

// Facturación y Sin asignar: los mismos 25 módulos de siempre (Asistencia y Calendario son solo de Admin).
export const AREAS_BACKOFFICE = AREAS_ADMIN.map(a => ({ ...a, items: a.items.filter(i => !SOLO_ADMIN.has(i.id)) }));

// B3.6: Ventas — un módulo y sus filtros internos (no son módulos del menú).
export const MODULO_VENTAS = { id: "ventas", label: "Ventas", icon: "ShoppingCart" };
export const FILTROS_VENTAS = [
  { id: "pendientes", label: "Pendientes", icon: "ClipboardCheck", vista: "ventas" },
  { id: "hoy", label: "Hoy", icon: "Clock", vista: "ventas-hoy" },
  { id: "todas", label: "Todas", icon: "List", vista: "ventas-todas" },
];
// Hashes heredados de B3.4 que siguen abriendo Ventas (alias → vista canónica).
export const ALIAS_VISTAS_VENTAS = { "ventas-cobrar": "ventas" };

// Módulos de las vistas por rol: id del menú ↔ pestaña de la vista.
export const MODULOS_PRODUCCION = [
  { id: "prod-producir", label: "Producción", icon: "Factory", tab: "producir" },
  { id: "prod-cuartos", label: "Congeladores", icon: "Warehouse", tab: "cuartos" },
  { id: "prod-mermas", label: "Mermas", icon: "AlertTriangle", tab: "mermas" },
  // OP-01D: "Preparar desde barra" reemplaza a Transformación (superseded).
  { id: "prod-preparar", label: "Preparar barra", labelMovil: "Preparar", icon: "Snowflake", tab: "preparar" },
];
export const MODULO_BOLSAS = { id: "bolsas-almacen", label: "Almacén de Bolsas", icon: "Box" };

// B3 — navegación inferior en móvil (misma fuente que el sidebar).
// Admin / Facturación / Sin asignar: 25 módulos no caben; en móvil van 4
// destinos de uso diario (el primero de cada área de trabajo: Operación ×2,
// Comercial, Finanzas) + "Más", que abre el menú completo agrupado por área
// (el mismo drawer de siempre). Un rol con un solo módulo no lleva barra.
export const PRINCIPALES_MOVIL_ADMIN = ["dashboard", "bandeja", "ordenes", "cobros"];
export const MAX_DESTINOS_MOVIL = 5;
export const MODULO_CHOFER = { id: "chofer-ruta", label: "Mi ruta", icon: "Truck" };

// miAsistencia / misActividades: botones de la cabecera (el rol Empleado ya los tiene como módulos).
const CHROME_ADMIN = { busqueda: true, firmas: true, alertas: true, notificaciones: true, verComo: true, miAsistencia: true, misActividades: true };
const CHROME_BACKOFFICE = { ...CHROME_ADMIN, verComo: false };
const CHROME_CAMPO = { busqueda: false, firmas: false, alertas: false, notificaciones: false, verComo: false, miAsistencia: true, misActividades: true };
const CHROME_EMPLEADO = { ...CHROME_CAMPO, miAsistencia: false, misActividades: false };

export const NAV_ROLES = {
  Admin: { modo: "completo", areas: AREAS_ADMIN, inicio: "dashboard", chrome: CHROME_ADMIN, persistirAreas: true, vistas: VISTA_MI_ASISTENCIA },
  "Facturación": { modo: "completo", areas: AREAS_BACKOFFICE, inicio: "dashboard", chrome: CHROME_BACKOFFICE, persistirAreas: true, vistas: VISTA_MI_ASISTENCIA },
  "Sin asignar": { modo: "completo", areas: AREAS_BACKOFFICE, inicio: "dashboard", chrome: CHROME_BACKOFFICE, persistirAreas: true, vistas: VISTA_MI_ASISTENCIA },
  Ventas: {
    modo: "completo", inicio: MODULO_VENTAS.id, chrome: CHROME_CAMPO, persistirAreas: false,
    areas: [{ id: "ventas", label: "Ventas", icon: "ShoppingCart", color: "emerald", items: [MODULO_VENTAS] }],
    // vistas que no son entradas del menú → módulo dueño (los filtros con hash propio)
    vistas: { "ventas-hoy": MODULO_VENTAS.id, "ventas-todas": MODULO_VENTAS.id, ...VISTA_MI_ASISTENCIA },
    alias: ALIAS_VISTAS_VENTAS,
  },
  "Producción": {
    modo: "completo", inicio: "prod-producir", chrome: { ...CHROME_CAMPO, firmas: true }, persistirAreas: false,
    areas: [{ id: "planta", label: "Planta", icon: "Factory", color: "blue", items: MODULOS_PRODUCCION }],
    // Hash heredado de la pestaña de Transformación → la de preparar.
    alias: { "prod-trans": "prod-preparar" },
    vistas: VISTA_MI_ASISTENCIA,
  },
  "Almacén Bolsas": {
    modo: "completo", inicio: MODULO_BOLSAS.id, chrome: CHROME_CAMPO, persistirAreas: false,
    areas: [{ id: "almacen", label: "Almacén", icon: "Box", color: "amber", items: [MODULO_BOLSAS] }],
    vistas: VISTA_MI_ASISTENCIA,
  },
  Chofer: { modo: "enfoque", inicio: MODULO_CHOFER.id, chrome: CHROME_CAMPO, persistirAreas: false, areas: [{ id: "ruta", label: "Ruta", icon: "Truck", color: "blue", items: [MODULO_CHOFER] }], vistas: VISTA_MI_ASISTENCIA },
  // WF-0: rol mínimo. Solo "Mi asistencia" y "Mis actividades": sin back office, sin datos de negocio, sin "Ver como".
  Empleado: {
    modo: "completo", inicio: MODULO_MI_ASISTENCIA.id, chrome: CHROME_EMPLEADO, persistirAreas: false,
    areas: [{ id: "personal", label: "Personal", icon: "Clock", color: "purple", items: [MODULO_MI_ASISTENCIA, MODULO_MIS_ACTIVIDADES] }],
  },
};

/** Navegación del rol. Un rol desconocido cae al shell completo de respaldo (como hoy: App.jsx lo mandaba al shell admin).
 *  'Empleado' tiene su propia entrada: nunca cae al respaldo de back office. */
export function navParaRol(rol) {
  return NAV_ROLES[rol] || NAV_ROLES["Sin asignar"];
}

export function idsModulos(nav) {
  return new Set((nav?.areas || []).flatMap(a => a.items.map(i => i.id)));
}

export function itemsModulos(nav) {
  return (nav?.areas || []).flatMap(a => a.items);
}

export function areaDeModulo(nav, id) {
  return (nav?.areas || []).find(a => a.items.some(i => i.id === id)) || null;
}

/** Pestaña de la vista por rol para un módulo del menú ('prod-cuartos' → 'cuartos'). Solo Producción. */
export function tabDesdeModulo(id) {
  const m = MODULOS_PRODUCCION.find(x => x.id === id);
  return m ? m.tab : null;
}

/** Módulo del menú para una pestaña de la vista ('Producción', 'cuartos' → 'prod-cuartos'). */
export function moduloDesdeTab(rol, tab) {
  const lista = rol === "Producción" ? MODULOS_PRODUCCION : [];
  const m = lista.find(x => x.tab === tab);
  return m ? m.id : null;
}

/** Todos los ids de vista válidos del rol: módulos del menú + vistas internas + alias. */
export function idsVistas(nav) {
  const ids = idsModulos(nav);
  for (const k of Object.keys(nav?.vistas || {})) ids.add(k);
  for (const k of Object.keys(nav?.alias || {})) ids.add(k);
  return ids;
}

/** Vista canónica (resuelve alias) o null si no es válida para el rol. */
export function normalizarVista(nav, id) {
  if (!id) return null;
  const v = nav?.alias?.[id] || id;
  if (idsModulos(nav).has(v)) return v;
  if (nav?.vistas && Object.prototype.hasOwnProperty.call(nav.vistas, v)) return v;
  return null;
}

/** Módulo del menú dueño de una vista ('ventas-hoy' → 'ventas'); el propio id si ya es módulo. */
export function moduloDeVista(nav, id) {
  const v = normalizarVista(nav, id);
  if (!v) return null;
  return nav?.vistas?.[v] || v;
}

/** Filtro interno de Ventas para una vista/hash ('ventas-hoy' → 'hoy'; 'ventas-cobrar' → 'pendientes'). */
export function filtroVentasDesdeVista(id) {
  const v = ALIAS_VISTAS_VENTAS[id] || id;
  const f = FILTROS_VENTAS.find(x => x.vista === v);
  return f ? f.id : null;
}

/** Vista (hash) de un filtro interno de Ventas ('todas' → 'ventas-todas'). */
export function vistaDesdeFiltroVentas(filtro) {
  const f = FILTROS_VENTAS.find(x => x.id === filtro);
  return f ? f.vista : null;
}

/**
 * Navegación inferior (móvil) derivada del mismo modelo: null si el rol no la
 * lleva (modo enfoque o un solo módulo). `items` usan los MISMOS ids que el
 * sidebar; `mas` = true cuando hay módulos fuera de la barra (abre el menú).
 */
export function bottomNavParaRol(nav) {
  if (!nav || nav.modo !== "completo") return null;
  const todos = itemsModulos(nav);
  if (todos.length <= 1) return null;
  const aMovil = (i) => ({ id: i.id, label: i.labelMovil || i.label, icon: i.icon });
  if (todos.length < MAX_DESTINOS_MOVIL) return { items: todos.map(aMovil), mas: false };
  const ids = new Set(todos.map(i => i.id));
  const principales = PRINCIPALES_MOVIL_ADMIN.filter(id => ids.has(id)).map(id => todos.find(i => i.id === id)).map(aMovil);
  return { items: principales, mas: principales.length < todos.length };
}

/** Áreas expandidas por defecto: Admin conserva su preferencia; los roles de campo ven todo abierto. */
export function areasExpandidasInicial(nav) {
  const out = {};
  for (const a of nav?.areas || []) out[a.id] = true;
  if (nav?.persistirAreas) return { operacion: true, comercial: true, finanzas: false, equipo: false };
  return out;
}
