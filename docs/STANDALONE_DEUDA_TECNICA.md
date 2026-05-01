# Deuda técnica: vistas standalone

Este documento lista deuda técnica detectada en las vistas standalone (mobile-first usadas a diario por el equipo en campo) y el estado actual del refactor del data layer.

---

## Fase Standalone Robustez (data layer) — ✅ COMPLETA

Tras investigación previa al PR 1 detectamos que el alcance original sobreestimó el problema. La realidad:
- **2 funciones eran fire-and-forget puro** (críticas) — atendidas en PR 1
- **3 estaban parcialmente robustas** (chequeaban algunos errores, no todos) — atendidas en PR 1 y PR 2
- **3 ya estaban OK** (el bug venía del consumer, ya arreglado en Fase Standalone UX) — atendidas cosméticamente en PR 2

### ✅ PR 1 — Standalone Robustez Core

Refactorizadas con patrón estándar (try/catch + chequeo `.error` en cada llamada Supabase + rollback selectivo + retorno consistente `{ error, partial? }` o `undefined`).

| Función | Cambio principal |
|---|---|
| `movimientoBolsa` ([supaStore.js:2492](../src/data/supaStore.js#L2492)) | try/catch envolvente, chequeo en select/update/insert, rollback de stock si insert mov falla, `{ error, partial }` si falla CxP/egreso |
| `producirYCongelar` ([supaStore.js:1019](../src/data/supaStore.js#L1019)) | Propaga error de `addProduccion`. Si producción ok pero `meterACuartoFrio` falla → `{ error, partial }` |
| `registrarMerma` ([supaStore.js:2233](../src/data/supaStore.js#L2233)) | try/catch envolvente. Rollback DELETE de la merma si falla `select cuartos_frios` o `rpc update_stocks_atomic`. Asiento contable es secundario |

### ✅ PR 2 — Standalone Robustez Consistencia

| Función | Cambio principal |
|---|---|
| `addOrden` ([supaStore.js:689](../src/data/supaStore.js#L689)) | try/catch envolvente. Chequeo en selects iniciales (productos, precios_esp, rpc nextval, clientes). **Rollback DELETE de la orden** si falla insert `orden_lineas` (evita orden huérfana sin líneas) |
| `updateOrdenEstatus` ([supaStore.js:777](../src/data/supaStore.js#L777)) | try/catch envolvente. Chequeo en TODOS los selects intermedios (estatus prev, datos completos, cliente nombre, existing CxC, existing ingreso, folio Facturada). Rollback de estatus si falla read post-update |
| `addCliente` ([supaStore.js:522](../src/data/supaStore.js#L522)) | try/catch envolvente defensivo. Lógica interna sin cambio (ya chequeaba error en insert) |
| `traspasoEntreUbicaciones` ([supaStore.js:1197](../src/data/supaStore.js#L1197)) | try/catch envolvente. Chequeo agregado al insert `inventario_mov`. Si falla movimiento (secundario), retorna `{ error, partial }` sin rollback de stocks (el traspaso real sí ocurrió) |
| `sacarDeCuartoFrio` ([supaStore.js:1165](../src/data/supaStore.js#L1165)) | try/catch envolvente. Validaciones tempranas pasan de `new Error(...)` a `{ message }` para consistencia con el resto del store |

### Patrón estándar aplicado

```js
funcionX: async (params) => {
  try {
    const { data: a, error: errA } = await supabase.from('X').select(...);
    if (errA) {
      console.warn('[funcionX] select X:', errA.message);
      t()?.error('Mensaje friendly');
      return { error: errA.message };
    }

    const { error: errB } = await supabase.from('Y').update(...);
    if (errB) { /* ... */ return { error: errB.message }; }

    const { error: errC } = await supabase.from('Z').insert(...);
    if (errC) {
      // ROLLBACK del update Y si aplica
      await supabase.from('Y').update(...rollback...).eq(...);
      return { error: errC.message };
    }

    rf();
    return undefined; // éxito
  } catch (e) {
    console.error('[funcionX] excepción:', e);
    t()?.error('Error inesperado');
    return { error: e?.message || 'Error inesperado' };
  }
}
```

### Convención de retorno

- `undefined` → éxito completo
- `{ error: msg }` o `{ message: msg }` → fallo crítico, operación NO se hizo (rollback aplicado)
- `{ error, partial: true }` → operación principal SÍ quedó pero un side-effect secundario falló (asiento contable, notify, etc.)
- `{ orden: {...} }` (caso específico de `addOrden`) — éxito + retorna la orden creada

Compatible con consumers existentes que usan `if (err) { ... }` — el `undefined` sigue siendo falsy.

---

### Otras funciones revisadas (NO requirieron refactor)

Ya tenían el patrón correcto (chequeos + rollback donde aplica):
- `addProduccion` ([879](../src/data/supaStore.js#L879)) — chequea principal y rollback de stock empaque
- `meterACuartoFrio` ([1144](../src/data/supaStore.js#L1144)) — chequea, rollback
- `addTransformacion` ([1030](../src/data/supaStore.js#L1030)) — chequea cada paso, rollback
- `firmarCarga` ([1516](../src/data/supaStore.js#L1516)) — patrón de referencia con rollback de inventario via RPC
- `crearCheckoutPago` ([1737](../src/data/supaStore.js#L1737)) — try/catch externo, retorna `{ error }` o payload
- `confirmarCargaRuta` ([1352](../src/data/supaStore.js#L1352)) — validaciones extensas, chequeo en cada paso
- `cerrarRutaCompleta` ([2540](../src/data/supaStore.js#L2540)) — try/catch envolvente extenso con rollback masivo

**No inspeccionadas a fondo** (consumidas por admin, no por standalones — fuera de scope):
- `cobrarCxC`, `aplicarCostoFijo`, `pagarCuentaPorPagar`, `pagarNomina`. Si en algún momento se reportan bugs ahí, vale la pena auditarlas.

---

## Otras deudas detectadas en investigación 2026-05-01

### Doble-submit en ChoferView.enviarFirma — ✅ Resuelto

Atendido en Standalone Fix #4 UX. Ya tiene `enviandoFirma` + try/catch + guard.

### Bug pre-existente en OrdenesView (admin) — ⏳ Pendiente

`OrdenesView.jsx:118-122` usa `if (err) { toast?.error(...) }` después de `addOrden`, pero `addOrden` retorna `{ orden }` (truthy) en éxito. El admin SIEMPRE muestra "No se pudo crear la orden" tras crear una orden, aunque la orden sí se cree. Fix: cambiar el chequeo a `if (err?.message || err?.error)` o desestructurar `result.orden`. Detectado durante PR 2 pero fuera de scope. Bajo impacto si Santiago no está usando intensamente el admin desde mobile.

### Inconsistencia de formato (dinero/fecha) en standalones — ⏳ Pendiente

Tras UX-4 admin usa `fmtMoney`/`fmtDate`/`fmtPct` consistentemente. Los 3 standalones (BolsasView, VentasStandaloneView, ProduccionStandaloneView) siguen con `toLocaleString`/`toFixed` ad-hoc. Total: ~26 ocurrencias inconsistentes. Bajo impacto funcional, alto impacto cosmético cuando admin compara cifras entre vistas.

### Estados vacíos genéricos en standalones — ⏳ Pendiente

Ningún standalone usa `EmptyState`. Casos como "Sin órdenes", "Sin movimientos hoy" se renderizan con `<p className="text-center text-sm text-slate-400 py-8">`. Funcional pero sin hint accionable ni CTA. Decisión de diseño pendiente: mantener minimalismo de las standalones o migrar a `EmptyState` con CTA contextual.
