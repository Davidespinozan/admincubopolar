// smoke-chofer.spec.js — Tanda 10 Fase A. READ-ONLY. NO mutaciones.
// Verifica login Chofer + ChoferView renderiza.
//
// Nota sobre el mapa: el mapa Leaflet sólo se monta cuando el chofer
// tiene una ruta activa (step="ruta"). Como la cuenta E2E NO tiene ruta
// asignada (Fase A read-only), el smoke verifica el shell + el EmptyState
// "No tienes ruta asignada", NO el canvas del mapa.
//
// La validación del mapa Leaflet inicializando se cubrirá en Fase B
// mutativa, donde podamos crear una ruta de prueba con namespacing.

import { test, expect } from '../fixtures/auth.js';
import { SEL, attachConsoleErrorWatcher } from '../helpers/selectors.js';

test.describe('Smoke Chofer', () => {
  test('login + chofer shell renderiza + sin errores consola', async ({ choferPage }) => {
    const consoleWatcher = attachConsoleErrorWatcher(choferPage);

    await expect(choferPage.locator(SEL.shell.chofer)).toBeVisible();

    // Sin ruta asignada → vemos el EmptyState. Confirmamos por copy
    // (más estable que un testid en un componente compartido).
    await expect(
      choferPage.getByText(/No tienes ruta asignada/i)
    ).toBeVisible();

    consoleWatcher.assertNoUnexpected();
  });
});
