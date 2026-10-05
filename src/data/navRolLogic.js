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
// Las pestañas internas de Ventas y Producción son módulos del menú (deep link
// #/ventas-hoy) y se traducen a la pestaña de la vista con tabDesdeModulo.

export const AREAS_ADMIN = [
  { id: "operacion", label: "Operación", icon: "Factory", color: "blue",
    items: [
      { id: "dashboard", label: "Resumen", icon: "Dashboard" },
      { id: "bandeja", label: "Mi bandeja", icon: "ClipboardCheck" },
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
      { id: "kardex", label: "Kardex", icon: "ClipboardCheck" },
      { id: "auditoria", label: "Auditoría", icon: "Shield" },
      { id: "configuracion", label: "Ajustes", icon: "Settings" },
    ]
  },
];

// Módulos de las vistas por rol: id del menú ↔ pestaña de la vista.
export const MODULOS_VENTAS = [
  { id: "ventas-cobrar", label: "Por cobrar", icon: "DollarSign", tab: "ventas" },
  { id: "ventas-hoy", label: "Hoy", icon: "Clock", tab: "hoy" },
  { id: "ventas-todas", label: "Todas", icon: "List", tab: "todas" },
];
export const MODULOS_PRODUCCION = [
  { id: "prod-producir", label: "Producción", icon: "Factory", tab: "producir" },
  { id: "prod-cuartos", label: "Congeladores", icon: "Warehouse", tab: "cuartos" },
  { id: "prod-mermas", label: "Mermas", icon: "AlertTriangle", tab: "mermas" },
  { id: "prod-trans", label: "Transformación", labelMovil: "Transf.", icon: "Snowflake", tab: "trans" },
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

const CHROME_ADMIN = { busqueda: true, firmas: true, alertas: true, notificaciones: true, verComo: true };
const CHROME_BACKOFFICE = { ...CHROME_ADMIN, verComo: false };
const CHROME_CAMPO = { busqueda: false, firmas: false, alertas: false, notificaciones: false, verComo: false };

export const NAV_ROLES = {
  Admin: { modo: "completo", areas: AREAS_ADMIN, inicio: "dashboard", chrome: CHROME_ADMIN, persistirAreas: true },
  "Facturación": { modo: "completo", areas: AREAS_ADMIN, inicio: "dashboard", chrome: CHROME_BACKOFFICE, persistirAreas: true },
  "Sin asignar": { modo: "completo", areas: AREAS_ADMIN, inicio: "dashboard", chrome: CHROME_BACKOFFICE, persistirAreas: true },
  Ventas: {
    modo: "completo", inicio: "ventas-cobrar", chrome: CHROME_CAMPO, persistirAreas: false,
    areas: [{ id: "ventas", label: "Ventas", icon: "ShoppingCart", color: "emerald", items: MODULOS_VENTAS }],
  },
  "Producción": {
    modo: "completo", inicio: "prod-producir", chrome: { ...CHROME_CAMPO, firmas: true }, persistirAreas: false,
    areas: [{ id: "planta", label: "Planta", icon: "Factory", color: "blue", items: MODULOS_PRODUCCION }],
  },
  "Almacén Bolsas": {
    modo: "completo", inicio: MODULO_BOLSAS.id, chrome: CHROME_CAMPO, persistirAreas: false,
    areas: [{ id: "almacen", label: "Almacén", icon: "Box", color: "amber", items: [MODULO_BOLSAS] }],
  },
  Chofer: { modo: "enfoque", inicio: MODULO_CHOFER.id, chrome: CHROME_CAMPO, persistirAreas: false, areas: [{ id: "ruta", label: "Ruta", icon: "Truck", color: "blue", items: [MODULO_CHOFER] }] },
};

/** Navegación del rol. Un rol desconocido cae al shell completo de respaldo (como hoy: App.jsx lo mandaba al shell admin). */
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

/** Pestaña de la vista por rol para un módulo del menú ('ventas-hoy' → 'hoy'). */
export function tabDesdeModulo(id) {
  const m = [...MODULOS_VENTAS, ...MODULOS_PRODUCCION].find(x => x.id === id);
  return m ? m.tab : null;
}

/** Módulo del menú para una pestaña de la vista ('Ventas', 'hoy' → 'ventas-hoy'). */
export function moduloDesdeTab(rol, tab) {
  const lista = rol === "Ventas" ? MODULOS_VENTAS : rol === "Producción" ? MODULOS_PRODUCCION : [];
  const m = lista.find(x => x.tab === tab);
  return m ? m.id : null;
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
