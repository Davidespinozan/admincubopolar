// finanzasLogic.js — 093: lógica pura de reportes financieros.
//
// Dos conceptos separados, calculados en el servidor (reporte_financiero):
//   - FLUJO DE EFECTIVO: dinero que realmente entró y salió (pagos de
//     clientes, compras de contado, pagos a proveedores, nómina, gastos,
//     reembolsos). No incluye costo de producción ni valuación de mermas.
//   - ESTADO DE RESULTADOS: utilidad devengada. Ingreso al ENTREGAR (no al
//     cobrar), costo de ventas al consumir empaque, gastos una sola vez.
// Aquí solo se normaliza la respuesta y se arman las líneas para la vista;
// ninguna cifra se recalcula desde listas del cliente (sin topes de filas).

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const pad = (x) => String(x).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Periodo de un mes calendario (fechas locales YYYY-MM-DD). */
export function rangoMes(fecha = new Date()) {
  const d = fecha instanceof Date ? fecha : new Date(`${fecha}T12:00:00`);
  const desde = new Date(d.getFullYear(), d.getMonth(), 1);
  const hasta = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { desde: iso(desde), hasta: iso(hasta) };
}

/** Periodo a partir de un valor 'YYYY-MM' (input type=month). */
export function rangoDeMes(yyyyMm) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm || ''));
  if (!m) return rangoMes();
  return rangoMes(new Date(Number(m[1]), Number(m[2]) - 1, 15));
}

const RESULTADOS = ['ventas_entregadas', 'ventas_entregadas_n', 'ventas_legado', 'ventas_legado_n', 'devoluciones', 'costo_ventas',
  'costo_ventas_revertido', 'costos_fijos', 'costos_variables', 'nomina', 'mermas', 'gastos_credito', 'otros_gastos', 'otros_ingresos',
  'utilidad_bruta', 'utilidad'];
const FLUJO = ['entradas', 'entradas_pagos', 'entradas_pagos_n', 'entradas_cobros_cxc', 'entradas_legado', 'entradas_manuales',
  'salidas', 'salidas_compras_contado', 'salidas_pagos_proveedores', 'salidas_nomina', 'salidas_costos', 'salidas_reembolsos',
  'salidas_otras', 'excluido_no_efectivo', 'neto'];
const SALDOS = ['cxc_pendiente', 'cxc_n', 'cxp_pendiente', 'cxp_n'];

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, num(obj?.[k])]));

/** Normaliza la respuesta de reporte_financiero (números, llaves estables). */
export function normalizarReporteFinanciero(raw) {
  return {
    desde: raw?.desde || null,
    hasta: raw?.hasta || null,
    resultados: pick(raw?.resultados, RESULTADOS),
    flujo: pick(raw?.flujo, FLUJO),
    saldos: pick(raw?.saldos, SALDOS),
    limitaciones: Array.isArray(raw?.limitaciones) ? raw.limitaciones.map(String) : [],
  };
}

/** Líneas del Estado de resultados (signo explícito; las vacías se omiten salvo totales). */
export function lineasEstadoResultados(r) {
  const x = r?.resultados || {};
  const lineas = [
    { clave: 'ventas_entregadas', etiqueta: 'Ventas entregadas', monto: x.ventas_entregadas, signo: 1 },
    { clave: 'ventas_legado', etiqueta: 'Ventas anteriores sin fecha de entrega (aprox.)', monto: x.ventas_legado, signo: 1, opcional: true },
    { clave: 'devoluciones', etiqueta: 'Devoluciones', monto: x.devoluciones, signo: -1, opcional: true },
    { clave: 'costo_ventas', etiqueta: 'Costo del hielo (empaque usado)', monto: x.costo_ventas, signo: -1 },
    { clave: 'utilidad_bruta', etiqueta: 'Utilidad bruta', monto: x.utilidad_bruta, total: true },
    { clave: 'costos_fijos', etiqueta: 'Costos fijos', monto: x.costos_fijos, signo: -1, opcional: true },
    { clave: 'costos_variables', etiqueta: 'Gastos variables', monto: x.costos_variables, signo: -1, opcional: true },
    { clave: 'nomina', etiqueta: 'Nómina', monto: x.nomina, signo: -1, opcional: true },
    { clave: 'mermas', etiqueta: 'Mermas (pérdida)', monto: x.mermas, signo: -1, opcional: true },
    { clave: 'gastos_credito', etiqueta: 'Gastos a crédito (CxP)', monto: x.gastos_credito, signo: -1, opcional: true },
    { clave: 'otros_gastos', etiqueta: 'Otros gastos', monto: x.otros_gastos, signo: -1, opcional: true },
    { clave: 'otros_ingresos', etiqueta: 'Otros ingresos', monto: x.otros_ingresos, signo: 1, opcional: true },
    { clave: 'utilidad', etiqueta: 'Utilidad del periodo', monto: x.utilidad, total: true },
  ];
  return lineas.filter(l => !l.opcional || num(l.monto) !== 0);
}

/** Líneas del Flujo de efectivo. */
export function lineasFlujoEfectivo(r) {
  const x = r?.flujo || {};
  const lineas = [
    { clave: 'entradas_pagos', etiqueta: 'Cobros a clientes', monto: x.entradas_pagos, signo: 1 },
    { clave: 'entradas_legado', etiqueta: 'Cobros anteriores sin registro de pago', monto: x.entradas_legado, signo: 1, opcional: true },
    { clave: 'entradas_manuales', etiqueta: 'Otros ingresos de dinero', monto: x.entradas_manuales, signo: 1, opcional: true },
    { clave: 'entradas', etiqueta: 'Entró', monto: x.entradas, total: true },
    { clave: 'salidas_compras_contado', etiqueta: 'Compras de contado', monto: x.salidas_compras_contado, signo: -1, opcional: true },
    { clave: 'salidas_pagos_proveedores', etiqueta: 'Pagos a proveedores (CxP)', monto: x.salidas_pagos_proveedores, signo: -1, opcional: true },
    { clave: 'salidas_nomina', etiqueta: 'Nómina pagada', monto: x.salidas_nomina, signo: -1, opcional: true },
    { clave: 'salidas_costos', etiqueta: 'Gastos pagados', monto: x.salidas_costos, signo: -1, opcional: true },
    { clave: 'salidas_reembolsos', etiqueta: 'Reembolsos a clientes', monto: x.salidas_reembolsos, signo: -1, opcional: true },
    { clave: 'salidas_otras', etiqueta: 'Otras salidas', monto: x.salidas_otras, signo: -1, opcional: true },
    { clave: 'salidas', etiqueta: 'Salió', monto: x.salidas, total: true },
    { clave: 'neto', etiqueta: 'Flujo neto del periodo', monto: x.neto, total: true },
  ];
  return lineas.filter(l => !l.opcional || num(l.monto) !== 0);
}
