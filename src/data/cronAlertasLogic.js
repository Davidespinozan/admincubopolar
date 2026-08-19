// cronAlertasLogic.js — lógica pura de los crons de alertas (Tanda 21).
// Consumida por netlify/functions/cron-cxc-vencidas y cron-rutas-atoradas.
//
// Los crons corren con service_role sobre filas crudas de Supabase, por
// eso estas funciones trabajan en snake_case (sin toCamel). Reciben la
// fecha "hoy" como string 'YYYY-MM-DD' para ser deterministas en tests.
import { ESTADOS_TERMINALES_RUTA } from './rutasLogic';

/**
 * Fecha de hoy en zona horaria de la planta (CDMX), como 'YYYY-MM-DD'.
 * Los crons de Netlify corren en UTC; sin esto, un cron de las 7:00
 * CDMX (13:00 UTC) compararía contra la fecha UTC y las cuentas que
 * vencen "hoy" se marcarían vencidas un día antes.
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function fechaHoyMx(date = new Date()) {
  // en-CA formatea como YYYY-MM-DD directamente.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const formatMonto = (n) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(Number(n) || 0);

/**
 * Filtra las cuentas por cobrar realmente vencidas: con saldo pendiente,
 * con fecha de vencimiento definida y anterior a hoy, y en un estatus
 * cobrable. Una CxC sin fecha_vencimiento no puede estar vencida.
 *
 * Comparación de fechas como strings 'YYYY-MM-DD' (orden lexicográfico
 * == orden cronológico), igual que llegan de Postgres tipo DATE.
 *
 * @param {Array<object>} cuentas filas snake_case de cuentas_por_cobrar
 * @param {string} hoy 'YYYY-MM-DD'
 * @returns {Array<object>}
 */
export function filtrarCxcVencidas(cuentas, hoy) {
  const cobrables = new Set(['Pendiente', 'Parcial', 'Vencida']);
  return (cuentas || []).filter((c) => {
    if (!c || !cobrables.has(String(c.estatus || '').trim())) return false;
    if (!(Number(c.saldo_pendiente) > 0)) return false;
    const vence = String(c.fecha_vencimiento || '').slice(0, 10);
    return Boolean(vence) && vence < hoy;
  });
}

/**
 * Construye la fila de `notificaciones` con el resumen de cartera
 * vencida, o null si no hay nada que avisar. La `referencia`
 * `cron-cxc:YYYY-MM-DD` sirve como llave de dedup: el cron consulta
 * si ya existe antes de insertar (una alerta por día máximo).
 *
 * @param {Array<object>} vencidas salida de filtrarCxcVencidas
 * @param {string} hoy 'YYYY-MM-DD'
 * @returns {object|null}
 */
export function buildNotifCxcVencidas(vencidas, hoy) {
  if (!vencidas || vencidas.length === 0) return null;
  const total = vencidas.reduce((acc, c) => acc + (Number(c.saldo_pendiente) || 0), 0);
  const clientes = new Set(vencidas.map((c) => c.cliente_id)).size;
  const cuentasTxt = vencidas.length === 1 ? '1 cuenta vencida' : `${vencidas.length} cuentas vencidas`;
  const clientesTxt = clientes === 1 ? '1 cliente' : `${clientes} clientes`;
  return {
    tipo: 'alerta',
    titulo: 'Cartera vencida',
    mensaje: `Tienes ${cuentasTxt} de ${clientesTxt} por ${formatMonto(total)}. Revísalas en Por cobrar.`,
    icono: '💰',
    referencia: `cron-cxc:${hoy}`,
  };
}

/**
 * Detecta rutas "atoradas": de fecha anterior a hoy y que siguen en un
 * estatus no terminal (ni Cerrada, ni Cancelada, ni Completada). Una
 * ruta de ayer sin cerrar significa caja sin cortar e inventario en
 * el limbo del camión.
 *
 * @param {Array<object>} rutas filas snake_case de rutas
 * @param {string} hoy 'YYYY-MM-DD'
 * @returns {Array<object>}
 */
export function filtrarRutasAtoradas(rutas, hoy) {
  return (rutas || []).filter((r) => {
    if (!r) return false;
    if (ESTADOS_TERMINALES_RUTA.has(String(r.estatus || '').trim())) return false;
    const fecha = String(r.fecha || '').slice(0, 10);
    return Boolean(fecha) && fecha < hoy;
  });
}

/**
 * Fila de `notificaciones` para rutas atoradas, o null si no hay.
 * Nombra hasta 3 rutas (folio o nombre) para que el admin sepa a
 * cuáles ir sin abrir el módulo. Dedup diario vía referencia
 * `cron-rutas:YYYY-MM-DD`.
 *
 * @param {Array<object>} atoradas salida de filtrarRutasAtoradas
 * @param {string} hoy 'YYYY-MM-DD'
 * @returns {object|null}
 */
export function buildNotifRutasAtoradas(atoradas, hoy) {
  if (!atoradas || atoradas.length === 0) return null;
  const nombres = atoradas
    .map((r) => r.folio || r.nombre || `#${r.id}`)
    .slice(0, 3)
    .join(', ');
  const extra = atoradas.length > 3 ? ` y ${atoradas.length - 3} más` : '';
  const rutasTxt = atoradas.length === 1 ? '1 ruta de días anteriores sigue abierta' : `${atoradas.length} rutas de días anteriores siguen abiertas`;
  return {
    tipo: 'alerta',
    titulo: 'Rutas sin cerrar',
    mensaje: `${rutasTxt}: ${nombres}${extra}. Ciérralas para cortar caja y regresar inventario.`,
    icono: '🚚',
    referencia: `cron-rutas:${hoy}`,
  };
}
