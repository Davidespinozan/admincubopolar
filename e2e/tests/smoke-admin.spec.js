// smoke-admin.spec.js — Tanda 10 Fase A. READ-ONLY. NO mutaciones.
// Verifica login Admin + shell renderiza + role-badge correcto + sin
// errores de consola no whitelisted.

import { test, expect } from '../fixtures/auth.js';
import { SEL, attachConsoleErrorWatcher } from '../helpers/selectors.js';

test.describe('Smoke Admin', () => {
  test('login + shell renderiza + role badge dice Admin + sin errores consola', async ({ adminPage }) => {
    const consoleWatcher = attachConsoleErrorWatcher(adminPage);

    // Shell del dashboard (CuboPolarERP) visible.
    await expect(adminPage.locator(SEL.shell.dashboard)).toBeVisible();

    // Atributo data-rol del shell debe coincidir.
    await expect(adminPage.locator(SEL.shell.dashboard)).toHaveAttribute('data-rol', /Admin/);

    // Badge en el sidebar muestra el rol.
    const badge = adminPage.locator(SEL.shell.roleBadge).first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/Admin/);

    // No hubo errores de consola no esperados durante la carga.
    consoleWatcher.assertNoUnexpected();
  });

  // Mobile-first (2026-10-09): ya no hay banner global de MODO PRUEBA; el
  // aviso de sandbox vive solo dentro de Facturación.
  test('sin banner global de modo prueba', async ({ adminPage }) => {
    await expect(adminPage.locator('[data-testid="modo-prueba-banner"]')).toHaveCount(0);
  });

  // Tanda 19: tras un reload de página, la sesión debe restaurarse
  // automáticamente. Sin el fix de Tanda 19 (getSession + restore al
  // mount), cada reload mostraba LoginScreen aunque el JWT siguiera
  // válido en localStorage.
  test('sesión persiste después de page reload', async ({ adminPage }) => {
    // El fixture ya hizo login, dashboard-shell visible.
    await expect(adminPage.locator('[data-testid="dashboard-shell"]')).toBeVisible();

    // Reload de la página.
    await adminPage.reload();

    // Tras el reload, dashboard-shell debe seguir visible (no hay
    // redirect a Login). El timeout es generoso porque incluye
    // re-login programático del fixture si fallara la restauración.
    await expect(adminPage.locator('[data-testid="dashboard-shell"]'))
      .toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="role-badge"]').first())
      .toHaveText(/Admin/);
  });
});
