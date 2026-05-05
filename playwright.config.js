// playwright.config.js — Tanda 10 Fase A.
// Smoke tests read-only contra producción. NO mutativos: cero riesgo
// de contaminar la BD real. Si Fase B se activa, requiere migrar a
// staging dedicada o namespacing de datos.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,    // Defensivo: aunque sean read-only, evitamos ráfagas paralelas contra prod.
  retries: 1,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://sistema.cubopolar.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Tanda 10: el SDK de Sentry frontend revisa `localStorage.E2E === '1'`
    // para saltarse init y evitar reportar console.error legítimos como
    // issues reales. El flag se setea en e2e/fixtures/auth.js.
  },
  projects: [
    {
      name: 'production-readonly',
      use: { browserName: 'chromium' },
    },
  ],
});
