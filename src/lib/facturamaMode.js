// facturamaMode.js — Tanda 14.
// Helper que indica si la app está conectada al endpoint sandbox o
// producción de Facturama. Se usa para mostrar el banner "MODO PRUEBA"
// y bloquear/marcar UI dependiente.
//
// Se controla con la env var de build VITE_FACTURAMA_MODE:
//   - 'production' → modo real (CFDI válido ante SAT).
//   - 'sandbox' (default si no se define) → fail-safe: si alguien olvida
//     configurarla, asumimos sandbox y mostramos el banner.
//
// IMPORTANTE: esta var debe mantenerse SINCRONIZADA con la env var de
// runtime FACTURAMA_API_URL en netlify/functions/_lib/providers.js.
// Si el frontend dice "production" pero el backend sigue apuntando a
// apisandbox.facturama.mx, los CFDI siguen siendo de prueba pero el
// banner desaparece — peor de los mundos. Ver docs/CUTOVER_PRODUCCION.md.

const RAW = import.meta.env.VITE_FACTURAMA_MODE;

/**
 * Modo actual normalizado: 'production' | 'sandbox'.
 * Default a 'sandbox' si la var no está definida o tiene un valor
 * desconocido (defensa fail-safe).
 */
export const FACTURAMA_MODE = (
  typeof RAW === 'string' && RAW.trim().toLowerCase() === 'production'
) ? 'production' : 'sandbox';

/**
 * @returns {boolean} true si la app está apuntando a sandbox de Facturama.
 */
export function isSandboxMode() {
  return FACTURAMA_MODE === 'sandbox';
}

/**
 * @returns {boolean} true si la app está apuntando a producción real.
 */
export function isProductionMode() {
  return FACTURAMA_MODE === 'production';
}
