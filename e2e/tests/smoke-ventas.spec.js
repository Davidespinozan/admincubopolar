// smoke-ventas.spec.js — Tanda 10 Fase A. READ-ONLY. NO mutaciones.
// Verifica login Ventas + shell standalone Ventas renderiza + sin
// errores de consola.

import { test, expect } from '../fixtures/auth.js';
import { SEL, attachConsoleErrorWatcher } from '../helpers/selectors.js';

test.describe('Smoke Ventas', () => {
  test('login + ventas shell renderiza + sin errores consola', async ({ ventasPage }) => {
    const consoleWatcher = attachConsoleErrorWatcher(ventasPage);

    // El rol Ventas puede caer en VentasStandaloneView (shell propio) o en
    // CuboPolarERP filtrado (depende de cómo lo configuró admin). Aceptamos
    // cualquiera de los dos shells; lo importante es que NO crashea.
    await expect(
      ventasPage.locator(`${SEL.shell.ventas}, ${SEL.shell.dashboard}`).first()
    ).toBeVisible();

    consoleWatcher.assertNoUnexpected();
  });
});
