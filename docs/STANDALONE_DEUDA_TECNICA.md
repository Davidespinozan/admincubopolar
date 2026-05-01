# Deuda técnica: vistas standalone

Este documento lista deuda técnica detectada en las vistas standalone (mobile-first usadas a diario por el equipo en campo) que no se atacó en su fase original y queda pendiente para fases dedicadas.

---

## Fase Standalone Robustez (data layer)

Tras investigación previa al PR 1 detectamos que el alcance original sobreestimó el problema. La realidad:
- **2 funciones eran fire-and-forget puro** (críticas)
- **3 estaban parcialmente robustas** (chequeaban algunos errores, no todos)
- **3 ya estaban OK** (el bug venía del consumer, ya arreglado en Fase Standalone UX)

### ✅ PR 1 — Standalone Robustez Core (commit en main)

Refactorizadas con patrón estándar (try/catch + chequeo `.error` en cada llamada Supabase + rollback selectivo + retorno consistente `{ error, partial? }` o `undefined`).

| Función | Antes | Después |
|---|---|---|
| `movimientoBolsa` ([supaStore.js:2492](../src/data/supaStore.js#L2492)) | Fire-and-forget puro (4 ops sin chequeo) | try/catch envolvente, chequeo en select/update/insert, rollback de stock si insert mov falla, `{ error, partial }` si falla CxP/egreso (operación principal sí quedó) |
| `producirYCongelar` ([supaStore.js:1019](../src/data/supaStore.js#L1019)) | Wrapper de 4 líneas que descartaba el error de `meterACuartoFrio` | Propaga el error de `addProduccion`. Si producción ok pero `meterACuartoFrio` falla, retorna `{ error, partial }` (admin debe meter manual desde Inventario) |
| `registrarMerma` ([supaStore.js:2233](../src/data/supaStore.js#L2233)) | Solo chequeaba el insert principal, ignoraba 4 ops posteriores | try/catch envolvente. Rollback de la merma (DELETE) si falla `select cuartos_frios` o `rpc update_stocks_atomic`. Asiento contable es secundario: si falla, retorna `{ error, partial }` con notify de advertencia, las ops principales sí quedan |

**Patrón estándar aplicado:**

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

**Convención de retorno:**
- `undefined` → éxito completo
- `{ error: msg }` → fallo crítico, operación NO se hizo (rollback aplicado)
- `{ error: msg, partial: true }` → operación principal SÍ quedó pero un side-effect secundario falló (asiento contable, notify, etc.)

Compatible con consumers existentes que usan `if (err) { ... }` — el `undefined` sigue siendo falsy.

---

### ⏳ PR 2 — Standalone Robustez Consistencia (pendiente)

Funciones parcialmente robustas (ya chequean errores en operaciones críticas, pero falta endurecer rollback en casos secundarios o agregar `return { ok: true }` por consistencia):

| Función | Línea | Acción pendiente |
|---|---|---|
| `addOrden` | [689](../src/data/supaStore.js#L689) | Si insert `orden_lineas` falla DESPUÉS de crear la orden (línea 735-737), agregar rollback `DELETE FROM ordenes WHERE id = newOrd.id` para evitar orden huérfana sin líneas |
| `updateOrdenEstatus` | [748](../src/data/supaStore.js#L748) | Defensivos: agregar chequeos en selects intermedios (estatus prev, datos completos, cliente nombre, factura folio) |
| `addCliente` | [522](../src/data/supaStore.js#L522) | Solo cosmético: cambiar `return newCli` a `return { ok: true, id: newCli.id }` para consistencia. Bug original ya estaba en consumer (resuelto en Standalone Fix #3 UX). |
| `traspasoEntreUbicaciones` | [1197](../src/data/supaStore.js#L1197) | Solo cosmético: agregar `return { ok: true }` en éxito. Insert mov también debe chequear error (omisión menor). |
| `sacarDeCuartoFrio` | [1165](../src/data/supaStore.js#L1165) | Solo cosmético: agregar `return { ok: true }` en éxito. Lógica ya OK con rollback. |

**Estimación PR 2:** ~1 hora.

---

### Otras funciones revisadas (NO requieren refactor)

Ya tienen el patrón correcto (chequeos + rollback donde aplica):
- `addProduccion` ([879](../src/data/supaStore.js#L879)) — chequea principal y rollback de stock empaque
- `meterACuartoFrio` ([1144](../src/data/supaStore.js#L1144)) — chequea, rollback
- `addTransformacion` ([1030](../src/data/supaStore.js#L1030)) — chequea cada paso, rollback
- `firmarCarga` ([1516](../src/data/supaStore.js#L1516)) — patrón de referencia con rollback de inventario via RPC
- `crearCheckoutPago` ([1737](../src/data/supaStore.js#L1737)) — try/catch externo, retorna `{ error }` o payload
- `confirmarCargaRuta` ([1352](../src/data/supaStore.js#L1352)) — validaciones extensas, chequeo en cada paso
- `cerrarRutaCompleta` ([2540](../src/data/supaStore.js#L2540)) — try/catch envolvente extenso con rollback masivo (función de >300 líneas, no inspeccionada al detalle)

**No inspeccionadas a fondo** (consumidas por admin, no por standalones — fuera de scope):
- `cobrarCxC`, `aplicarCostoFijo`, `pagarCuentaPorPagar`, `pagarNomina`. Si en algún momento se reportan bugs ahí, vale la pena auditarlas.

---

## Otras deudas detectadas en investigación 2026-05-01

### Doble-submit en ChoferView.enviarFirma — ✅ Resuelto

Atendido en Standalone Fix #4 UX. Ya tiene `enviandoFirma` + try/catch + guard.

### Inconsistencia de formato (dinero/fecha) en standalones — ⏳ Pendiente

Tras UX-4 admin usa `fmtMoney`/`fmtDate`/`fmtPct` consistentemente. Los 3 standalones (BolsasView, VentasStandaloneView, ProduccionStandaloneView) siguen con `toLocaleString`/`toFixed` ad-hoc. Total: ~26 ocurrencias inconsistentes. Bajo impacto funcional, alto impacto cosmético cuando admin compara cifras entre vistas.

### Estados vacíos genéricos en standalones — ⏳ Pendiente

Ningún standalone usa `EmptyState`. Casos como "Sin órdenes", "Sin movimientos hoy" se renderizan con `<p className="text-center text-sm text-slate-400 py-8">`. Funcional pero sin hint accionable ni CTA. Decisión de diseño pendiente: mantener minimalismo de las standalones o migrar a `EmptyState` con CTA contextual.
