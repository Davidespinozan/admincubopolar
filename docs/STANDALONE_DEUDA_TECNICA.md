# Deuda técnica: vistas standalone

Este documento lista deuda técnica detectada en las vistas standalone (mobile-first usadas a diario por el equipo en campo) que no se atacó en su fase original y queda pendiente para fases dedicadas.

---

## Pendiente: Fase Standalone Robustez (data layer)

Funciones de [src/data/supaStore.js](../src/data/supaStore.js) que **no chequean `.error` de Supabase** y **no retornan estado**, causando errores silenciosos en operación real. Cuando Supabase responde 4xx/5xx (RLS rechaza, constraint falla, sesión expirada, etc.) el `await` se resuelve normalmente, la función termina como si todo hubiera salido bien, y el operario ve "✓" pero la BD no recibió el cambio.

### Funciones afectadas

| Función | Vista que la consume | Acción del operario |
|---|---|---|
| `movimientoBolsa` | BolsasView | Registrar entrada/salida de empaques |
| `producirYCongelar` | ProduccionStandaloneView.registrarProduccion | Registrar producción + meter a CF |
| `traspasoEntreUbicaciones` | ProduccionStandaloneView.hacerTraspaso | Mover stock entre cuartos fríos |
| `sacarDeCuartoFrio` | ProduccionStandaloneView.hacerSalida | Sacar bolsas a ruta |
| `addCliente` | VentasStandaloneView.registrarCliente | Alta de cliente nuevo en campo |
| `addOrden` / `crearOrdenRapida` | VentasStandaloneView.crearOrden | Crear venta |
| `updateOrdenEstatus` | VentasStandaloneView.confirmarCobro | Marcar venta como cobrada |
| `registrarMerma` | ProduccionStandaloneView.registrarMerma | Registrar merma con foto |

### Patrón a aplicar en cada una

1. **Wrap try/catch interno** en la función del store.
2. **Chequear `.error`** en cada llamada Supabase (`.select`, `.update`, `.insert`, `.delete`, `.rpc`).
3. **Hacer rollback parcial** donde aplique. `registrarMerma` ya tiene un patrón de rollback de archivo de Storage si falla la inserción — replicarlo donde haya múltiples llamadas dependientes.
4. **Retornar `{ error: "mensaje" }` o `{ ok: true }`** consistentemente, NO `undefined`.
5. **El consumer** (BolsasView, ChoferView, VentasStandaloneView, etc.) chequea `result?.error` y muestra toast específico de error en lugar de toast genérico de éxito.

### Ejemplo de refactor (movimientoBolsa)

**Antes** (estado actual):
```js
movimientoBolsa: async (sku, cantidad, tipo, motivo, costo, proveedor, esCredito) => {
  const { data: prod } = await supabase.from('productos').select('id, stock').eq('sku', sku).single();
  if (!prod) return;
  const newStock = tipo === 'Entrada' ? Number(prod.stock) + Number(cantidad) : Math.max(0, Number(prod.stock) - Number(cantidad));
  await supabase.from('productos').update({ stock: newStock }).eq('id', prod.id);
  await supabase.from('inventario_mov').insert({...});
  // ...más inserts sin chequeo...
  rf();
},
```

**Después** (target):
```js
movimientoBolsa: async (sku, cantidad, tipo, motivo, costo, proveedor, esCredito) => {
  try {
    const { data: prod, error: errProd } = await supabase.from('productos').select('id, stock').eq('sku', sku).single();
    if (errProd) return { error: 'No se encontró el producto' };
    if (!prod) return { error: 'Producto inexistente: ' + sku };

    const newStock = tipo === 'Entrada' ? Number(prod.stock) + Number(cantidad) : Math.max(0, Number(prod.stock) - Number(cantidad));

    const { error: errUpd } = await supabase.from('productos').update({ stock: newStock }).eq('id', prod.id);
    if (errUpd) return { error: 'No se pudo actualizar stock: ' + errUpd.message };

    const { error: errIns } = await supabase.from('inventario_mov').insert({...});
    if (errIns) {
      // Rollback del stock
      await supabase.from('productos').update({ stock: prod.stock }).eq('id', prod.id);
      return { error: 'No se registró el movimiento: ' + errIns.message };
    }

    // ...resto con mismo patrón...
    rf();
    return { ok: true };
  } catch (e) {
    return { error: e?.message || 'Error desconocido' };
  }
},
```

### Tiempo estimado

3-4 horas para refactorizar las 8 funciones, más tiempo de prueba real con red lenta y desconexiones en cada vista standalone.

### Riesgo si NO se hace

- Stock fantasma (registro local indica que se movió, BD no tiene el movimiento).
- Órdenes "cobradas" que en BD siguen sin pagar.
- Clientes "creados" que no existen en BD (vendedor cree que el alta funcionó).
- Inventario lógico vs físico diverge silenciosamente, solo se detecta en cortes / conciliaciones.

---

## Otras deudas detectadas en investigación 2026-05-01

### Doble-submit en ChoferView.enviarFirma

[`enviarFirma` en ChoferView.jsx:359](../src/components/ChoferView.jsx#L359) es la única función crítica del flujo del chofer que se quedó fuera del patrón UX-3 (loading state + guard). Botones "Confirmar" y "Cargar sin firma" pueden dispararse 2 veces si la subida tarda. Fix similar a UX-3 (saving state + try/finally + disabled).

### Inconsistencia de formato (dinero/fecha) en standalones

Tras UX-4 admin usa `fmtMoney`/`fmtDate`/`fmtPct` consistentemente. Los 3 standalones (BolsasView, VentasStandaloneView, ProduccionStandaloneView) siguen con `toLocaleString`/`toFixed` ad-hoc. Total: ~26 ocurrencias inconsistentes. Bajo impacto funcional, alto impacto cosmético cuando admin compara cifras entre vistas.

### Estados vacíos genéricos en standalones

Ningún standalone usa `EmptyState`. Casos como "Sin órdenes", "Sin movimientos hoy" se renderizan con `<p className="text-center text-sm text-slate-400 py-8">`. Funcional pero sin hint accionable ni CTA. Decisión de diseño pendiente: mantener minimalismo de las standalones o migrar a `EmptyState` con CTA contextual.
