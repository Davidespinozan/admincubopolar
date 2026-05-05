// auth.js — fixtures de Playwright que loguean como Admin / Ventas / Chofer
// y exponen `page` ya autenticada. Read-only: ninguna fixture muta BD.
//
// Variables de entorno requeridas (ver docs/E2E_SETUP.md):
//   E2E_ADMIN_EMAIL  / E2E_ADMIN_PASSWORD
//   E2E_VENTAS_EMAIL / E2E_VENTAS_PASSWORD
//   E2E_CHOFER_EMAIL / E2E_CHOFER_PASSWORD
//
// Las cuentas DEBEN tener `is_test_account=true` en la tabla `usuarios`
// (mig 063). Eso las oculta de los dropdowns admin sin afectar el login.

import { test as base, expect } from '@playwright/test';
import { SEL } from '../helpers/selectors.js';

/**
 * Hace login programático en la UI (no por API directa: queremos que
 * el flujo Login.jsx → Supabase auth → fetch perfil → setUser corra
 * idéntico al de un usuario real).
 *
 * Antes de navegar setea `localStorage.E2E='1'` para que initSentry
 * se salte y no contamine el dashboard de Sentry.
 */
async function loginAs(page, email, password) {
  await page.addInitScript(() => {
    // Flag E2E: src/lib/sentry.js lo lee para no inicializar Sentry.
    try {
      window.localStorage.setItem('E2E', '1');
    } catch {}
  });

  await page.goto('/');
  await page.fill(SEL.login.email, email);
  await page.fill(SEL.login.password, password);
  await page.click(SEL.login.submit);
  // El shell se renderiza una vez que App.jsx resuelve user + data.
  // Para Admin/Ventas-vista-admin → dashboard-shell. Para roles standalone
  // (Chofer, Ventas-standalone) el shell es distinto — esperamos cualquiera
  // que aparezca primero.
  await expect(
    page.locator(`${SEL.shell.dashboard}, ${SEL.shell.chofer}, ${SEL.shell.ventas}`).first()
  ).toBeVisible({ timeout: 20_000 });
}

function envOrSkip(name) {
  const v = process.env[name];
  if (!v) {
    return null;
  }
  return v;
}

export const test = base.extend({
  adminPage: async ({ page }, use, testInfo) => {
    const email = envOrSkip('E2E_ADMIN_EMAIL');
    const password = envOrSkip('E2E_ADMIN_PASSWORD');
    if (!email || !password) {
      testInfo.skip(true, 'E2E_ADMIN_EMAIL/PASSWORD no configurados');
    }
    await loginAs(page, email, password);
    await use(page);
  },

  ventasPage: async ({ page }, use, testInfo) => {
    const email = envOrSkip('E2E_VENTAS_EMAIL');
    const password = envOrSkip('E2E_VENTAS_PASSWORD');
    if (!email || !password) {
      testInfo.skip(true, 'E2E_VENTAS_EMAIL/PASSWORD no configurados');
    }
    await loginAs(page, email, password);
    await use(page);
  },

  choferPage: async ({ page }, use, testInfo) => {
    const email = envOrSkip('E2E_CHOFER_EMAIL');
    const password = envOrSkip('E2E_CHOFER_PASSWORD');
    if (!email || !password) {
      testInfo.skip(true, 'E2E_CHOFER_EMAIL/PASSWORD no configurados');
    }
    await loginAs(page, email, password);
    await use(page);
  },
});

export { expect };
