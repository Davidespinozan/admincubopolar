// selectors.js — Tanda 10. Selectors centralizados para los smoke tests.
// Si la UI cambia un data-testid, se actualiza en un solo lugar.

export const SEL = {
  login: {
    email: '[data-testid="login-email"]',
    password: '[data-testid="login-password"]',
    submit: '[data-testid="login-submit"]',
  },
  shell: {
    dashboard: '[data-testid="dashboard-shell"]',
    chofer:    '[data-testid="chofer-shell"]',
    ventas:    '[data-testid="ventas-shell"]',
    roleBadge: '[data-testid="role-badge"]',
  },
};

// Strings benignos que aparecen en console en condiciones normales y
// NO deben fallar un smoke. Si encuentras un nuevo error legítimo durante
// la operación normal del ERP, agrégalo aquí.
export const WHITELISTED_CONSOLE_ERRORS = [
  'NetworkError when attempting to fetch',
  'ResizeObserver loop',
  'chrome-extension://',
  'PostgrestError',          // errores Supabase tolerados (ej. row-level security en lecturas opcionales)
  'Failed to load resource', // típico cuando un asset estático tarda o el SW responde stale
  'service-worker',          // mensajes del SW de PWA
];

/**
 * Crea un listener de console que falla el test si aparece un error
 * NO whitelisted. Devuelve el array de mensajes capturados (todos,
 * filtrados al final) por si se necesita inspección.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {{ getErrors: () => string[], assertNoUnexpected: () => void }}
 */
export function attachConsoleErrorWatcher(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (WHITELISTED_CONSOLE_ERRORS.some((w) => text.includes(w))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => {
    const text = String(err?.message || err);
    if (WHITELISTED_CONSOLE_ERRORS.some((w) => text.includes(w))) return;
    errors.push(text);
  });
  return {
    getErrors: () => errors.slice(),
    assertNoUnexpected: () => {
      if (errors.length > 0) {
        throw new Error(
          `Console errors no esperados (${errors.length}):\n  - ${errors.join('\n  - ')}`
        );
      }
    },
  };
}
