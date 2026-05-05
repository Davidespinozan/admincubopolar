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
});
