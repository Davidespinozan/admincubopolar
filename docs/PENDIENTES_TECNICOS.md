# Pendientes técnicos — Cubo Polar

Última actualización: 2026-05-05

Este documento agrupa deuda técnica de bajo riesgo detectada en auditorías recientes. Ninguna acción aquí es urgente. Cada sección dice **claramente** si requiere ejecución de SQL en producción y bajo qué condiciones.

---

## Convención de migraciones

Las migraciones del proyecto viven en `supabase/` directamente (no en una subcarpeta `migrations/`).

| Migración | Estado |
|---|---|
| Última versionada | `058_rpc_update_orden_atomic.sql` |
| Próximo número libre | `059` |

Todas las migraciones son idempotentes (`IF NOT EXISTS` en `ADD COLUMN`, `IF EXISTS` en types/triggers, etc.).

---

## 🟡 Investigación: columna `cuartos_frios.capacidad` (legacy Fase 19)

**Origen**: campo agregado en el schema inicial (`001_schema.sql:158`). Reemplazado en Fase 19 por el sistema de tarimas (`capacidad_tarimas` en migración `040`).

**Resultado del grep en código** (`src/`):

| Archivo | Línea | Uso | Veredicto |
|---|---|---|---|
| [supaStore.js:240](../src/data/supaStore.js#L240) | `capacidad: Number(q.capacidad)` | Mapea el campo del row al objeto de frontend | ⚠️ Lectura sin consumidor — **único uso en producción**, pero nadie consume `cf.capacidad` después |
| `src/data/mockData.js:55-57` | Valores hardcoded en mockData | Dato de prueba legacy | Sin impacto |
| Búsqueda de `cf.capacidad` en componentes | **0 hits** | — | Frontend usa `cf.capacidad_tarimas` (nuevo) |
| `comodatos.capacidad` | múltiples (no es lo mismo) | Modelo distinto, sigue activo | NO TOCAR |

**Conclusión**: la columna `cuartos_frios.capacidad` es **candidata segura para DROP** en una migración futura. Solo `supaStore.js:240` la lee y el resultado se descarta.

**Acción pendiente** (no ejecutar aún):

```sql
-- Pendiente de revisar antes de ejecutar:
-- 1. SELECT capacidad FROM cuartos_frios; — confirmar valores genéricos o NULL
-- 2. Backup completo
-- 3. Tras DROP, eliminar también la línea 240 de supaStore.js
-- ALTER TABLE cuartos_frios DROP COLUMN capacidad;
```

---

## ✅ Resuelto: columnas huérfanas en `rutas` (archivadas en migración 041)

3 columnas que existían en producción pero no estaban en ninguna migración versionada — ahora archivadas en [`041_archivo_columnas_huerfanas_rutas.sql`](../supabase/041_archivo_columnas_huerfanas_rutas.sql) como `ADD COLUMN IF NOT EXISTS`. La migración es NO-OP en producción (las columnas ya existen) y permite replicar el schema en ambientes nuevos.

| Columna | Tipo en migración | Usos en `supaStore.js` | Estado |
|---|---|---|---|
| `carga_confirmada_at` | `TIMESTAMP` | 7+ (validación, set, lookup en cierre legacy) | ✅ Archivada en 041 |
| `carga_confirmada_por` | `TEXT` | 2 (set en confirmar carga + firma) | ✅ Archivada en 041 |
| `fecha_fin` | `TIMESTAMP` | 1 (cierre de ruta) | ✅ Archivada en 041 (la `fecha_fin` que sí existe en migración previa es de `nomina_periodos`, no de `rutas`) |

**Pendiente futuro** (no urgente): hacer auditoría exhaustiva del resto de tablas (ordenes, productos, mermas, clientes, empleados, etc.) por si tienen columnas huérfanas similares. Si aparecen, crear migración(es) siguiendo el mismo patrón.

### Otras tablas verificadas en spot-check (NO huérfanas)

- `folio_nota` → `029_nombre_comercial_folio_nota.sql` ✅
- `monto_pagado` / `saldo_pendiente` → `003_empleados_nomina_contabilidad.sql` ✅
- `facturama_id` → `011_facturama_sync.sql` ✅

---

## 🟡 Backfill: mermas históricas sin ruta_id

**Estado**: investigación pendiente — sin acceso a tooling SQL en esta sesión.

David: ejecutar manualmente esta query en Supabase SQL Editor cuando convenga:

```sql
SELECT
  COUNT(*) AS total_mermas,
  COUNT(*) FILTER (WHERE ruta_id IS NOT NULL) AS con_ruta_id,
  COUNT(*) FILTER (WHERE ruta_id IS NULL) AS sin_ruta_id,
  COUNT(*) FILTER (WHERE ruta_id IS NULL AND origen LIKE 'Ruta%') AS huerfanas_de_ruta
FROM mermas;
```

**Reglas de decisión** según resultado:

| `huerfanas_de_ruta` | Decisión recomendada |
|---|---|
| < 50 | Probablemente datos de test. NO migrar. |
| 50 – 500 | Decisión de negocio. Si se quieren preservar para reportes históricos, ejecutar el script de backfill abajo. |
| > 500 | Backfill obligatorio para no perder trazabilidad. |

**Script de backfill (NO ejecutar sin confirmación)**:

```sql
UPDATE mermas m
SET ruta_id = r.id
FROM rutas r
WHERE m.ruta_id IS NULL
  AND m.origen LIKE 'Ruta %'
  AND m.created_at::date = r.fecha_fin::date;
-- Riesgo: si dos rutas cerraron el mismo día con el mismo chofer,
-- el match es ambiguo. Ese caso es raro pero existe.
```

---

## 🟢 Optimización menor: índice parcial en `mermas.ruta_id`

El índice `idx_mermas_ruta_id` ya existe (creado en [`037_mermas_ruta_id.sql`](../supabase/037_mermas_ruta_id.sql)) como índice **completo**. Cuando el volumen de mermas crezca a >100k filas, considerar migrarlo a índice parcial para ahorrar storage y acelerar inserts:

```sql
DROP INDEX IF EXISTS idx_mermas_ruta_id;
CREATE INDEX idx_mermas_ruta_id ON mermas(ruta_id) WHERE ruta_id IS NOT NULL;
```

**No es prioritario.** El índice actual funciona bien para el volumen presente. Solo migrar cuando se note degradación de inserts en `mermas`.

---

## Cómo usar este documento

1. **Antes de tocar BD**: leer la sección relevante. Cada acción dice claramente si requiere SQL en producción.
2. **Cada SQL marcado "no ejecutar aún"**: revisar el contexto antes, hacer backup, y solo entonces correr en Supabase.
3. **Mantener el doc actualizado**: cuando se ejecute una acción, mover su sección a un changelog (o eliminar si quedó completa).
exportReports.js bundle 298KB → lazy load solo cuando se exporta

---

## 🟡 RPC `confirmar_produccion` sin uso desde la app

Tras el refactor de Producción (PR `refactor/produccion-admin-solo-gestion`), el flujo "registrar → confirmar" ya no existe: el operario registra desde `ProduccionStandaloneView` y el ingreso al cuarto frío es atómico vía `producirYCongelar`. La acción JS `actions.confirmarProduccion` y el RPC SQL `confirmar_produccion` dejaron de invocarse desde el cliente.

- Acción JS `confirmarProduccion` en [`src/data/supaStore.js`](../src/data/supaStore.js) (~línea 1332). Sin callers desde UI; código muerto.
- RPC SQL `confirmar_produccion(p_produccion_id, p_usuario_id)` en [`007_rpc_atomic_operations.sql`](../supabase/007_rpc_atomic_operations.sql) y reescrito en [`034_fix_rls_rpc_permissions.sql`](../supabase/034_fix_rls_rpc_permissions.sql).

**Acción pendiente** (no urgente):
1. Eliminar la acción JS `confirmarProduccion` del store.
2. `DROP FUNCTION confirmar_produccion(BIGINT, BIGINT);` en migración nueva.

No ejecutar todavía: dejar como código muerto un sprint para confirmar que ningún flujo (cierre de caja, reportes históricos) lo necesita.

---

## 🔴 Costo de empaque NO se registra en contabilidad cuando producción se hace desde Standalone

Bug latente descubierto durante el refactor de Producción.

`addProduccion` ([`src/data/supaStore.js:1280`](../src/data/supaStore.js)) descuenta el empaque del stock pero **no registra el egreso contable** ni inserta en `costos_historial`. Esa lógica vivía exclusivamente dentro de `confirmarProduccion` (~líneas 1353-1395), que ya no se llama desde ningún flujo activo tras el refactor.

**Consecuencia operativa.** Cuando el operario produce 1000 bolsas con empaque a $0.50 c/u:
- ✅ Stock de empaque baja en 1000 unidades.
- ✅ Stock de producto terminado sube 1000.
- ❌ Los $500 de costo de empaque **NO aparecen como Egreso en `movimientos_contables` ni en `costos_historial`**.
- → El estado de resultados subestima costo de ventas mientras dure el bug.

**Fix propuesto:**

1. Extraer la sección "calcular costo + insertar contabilidad" de `confirmarProduccion` a un helper privado del store, p. ej. `_registrarCostoProduccion(prodRow)`.
2. Llamarlo desde `producirYCongelar` después de `meterACuartoFrio`. Best-effort: si falla, notificar y permitir registro manual desde Costos (mismo patrón que el egreso contable de mermas en `registrarMerma`).
3. Tests puros de la función de cálculo (cantidad × costo_unitario_empaque).

Tiempo estimado: ~45 min. Postergado a PR dedicado para no inflar el refactor de Producción.

---

## 🟡 Deuda: `clientes.cp` (legacy) vs `clientes.codigo_postal` (mig 009)

**Origen**: la migración `002_safe_migration.sql` agregó `cp VARCHAR(5)` a clientes; meses después la migración `009_clientes_geolocalizacion.sql` agregó `codigo_postal VARCHAR(10)` para la geolocalización. Ambas columnas conviven en producción.

**Estado actual** (verificado en sesión 2026-05-04):

| Columna | Tipo | Origen | Uso en código |
|---|---|---|---|
| `cp` | `VARCHAR(5)` | mig 002 | ✅ `addCliente`/`updateCliente` la insertan/actualizan; CFDI 4.0 lee desde aquí |
| `codigo_postal` | `VARCHAR(10)` | mig 009 | ❌ **sin uso** en clientes — solo se usa en `configuracion_empresa.codigo_postal` |

**Por qué no se consolidó en el PR de número exterior (mig 056)**:
- Migrar `cp` → `codigo_postal` requiere copiar datos de las 200+ filas existentes, refactorizar todo el código que lee `cp` (incluyendo timbrado Facturama), y eliminar la columna vieja. Es un PR de ~3 hrs con riesgo de romper facturación.
- En el PR de número exterior, el form persiste **ambas** columnas sincronizadas (`cp = codigo_postal`) para no introducir más divergencia.

**Acción pendiente** (PR dedicado, sin urgencia):

```sql
-- 1. Confirmar que codigo_postal está vacío en clientes
SELECT COUNT(*) FILTER (WHERE codigo_postal IS NOT NULL) AS con_cp_nuevo,
       COUNT(*) FILTER (WHERE cp IS NOT NULL) AS con_cp_legacy
  FROM clientes;

-- 2. Backfill: copiar de cp a codigo_postal
UPDATE clientes SET codigo_postal = cp WHERE codigo_postal IS NULL AND cp IS NOT NULL;

-- 3. En el código:
--    - addCliente/updateCliente: usar codigo_postal en INSERT/UPDATE
--    - billing-create-invoice: leer cliente.codigo_postal (no cp) para CFDI
--    - DireccionForm + ClientesView: ya editan codigo_postal
--    - Al deploy, eliminar cualquier escritura a cp

-- 4. Migración para drop:
-- ALTER TABLE clientes DROP COLUMN cp;
```

**Riesgo de no hacerlo**: bajo. La duplicación no rompe nada hoy — el form sincroniza ambas. Si en el futuro alguien edita `codigo_postal` por SQL directo y no `cp`, el CFDI usará el dato viejo. Por ahora documentado y bloqueado en código a través de `DireccionForm`.

---

## ✅ Resuelto: trigger FSM zombie de rutas (mig 057)

**Origen**: `001_schema.sql:230-245` definía el trigger `trg_ruta_state` y la función `check_ruta_transition()` con una whitelist de transiciones que solo permitía:
- `Programada → En progreso/Cancelada`
- `En progreso → Completada`
- `Completada → Cerrada`

Pero el código moderno (post-Fase 18) hace transiciones que NO están en la whitelist:
- `Programada → Cargada / Pendiente firma`
- `Pendiente firma → Cargada`
- `Cargada → En progreso`
- `En progreso → Cerrada` (saltando Completada en `cerrarRutaCompleta`)

Producción nunca tuvo el trigger activo (mig 002 hizo `ALTER TABLE rutas ADD COLUMN estatus TEXT NOT NULL DEFAULT 'Programada'`, evitando el ENUM y dejando el trigger huérfano sin re-aplicar). Pero un clone del repo + `CREATE` desde `001_schema.sql` lo activaría y rompería todas las operaciones de ruta.

**Acción ejecutada en migración 057** (2026-05-05):

```sql
DROP TRIGGER IF EXISTS trg_ruta_state ON rutas;
DROP FUNCTION IF EXISTS check_ruta_transition();
```

**Estado actual**: la FSM de rutas se valida solo en JS (`src/data/rutasLogic.js` — `validateEdicionRuta`, transiciones en cada action de `supaStore`) y en BD a nivel de UNIQUE INDEX (`049_unique_chofer_ruta_activa.sql`). No hay trigger de transición; la complejidad de la FSM justifica mantenerla en código y no en SQL.

---

## 🟡 Deprecated: columna `clientes.saldo` (cache stale)

**Origen**: la columna existe desde el schema inicial (`001_schema.sql:39`). Se mantiene actualizada vía RPC `increment_saldo` (en `cerrarRutaCompleta`, `registrarPago`, etc.) — pero como cualquier cache, puede divergir del valor "real" si una operación falla a la mitad o si se hace un cleanup manual de CxC.

**Caso real verificado el 2026-05-04**: cliente `id=97` (DAVID ESPINOZA) tenía `saldo=$2000` pero `SUM(cuentas_por_cobrar.saldo_pendiente WHERE estatus != 'Pagada') = $0`. Limpiado manualmente en `055_unique_rfc_nominativos.sql`.

**Acción ejecutada en Tanda 2** (2026-05-05):

1. **Frontend ya no lee `clientes.saldo` de BD**. El mapeo de clientes en [`supaStore.js`](../src/data/supaStore.js) sobrescribe `c.saldo` con `SUM(saldo_pendiente)` agrupado por `cliente_id` desde `data.cuentasPorCobrar` (excluye estatus 'Pagada'). Todos los consumidores (ClientesView, NuevaVentaModal, exportReports, DashboardView) reciben el valor correcto sin cambiar su código.

2. **`addOrden` valida límite de crédito leyendo de `cuentas_por_cobrar` directo**, no del cache. Cierra el agujero donde una orden a crédito podía aceptarse aunque el saldo real ya hubiera superado el límite.

3. **Las RPCs y flujos que SÍ escriben en `clientes.saldo` siguen funcionando** (`increment_saldo`, `cerrarRutaCompleta` en cierres legacy, etc.). No es necesario tocarlas — la columna queda como "campo cache que nadie lee desde la app, solo se escribe por inercia".

**Acción pendiente** (PR dedicado, sin urgencia):

```sql
-- 1. Confirmar que ningún consumidor lee clientes.saldo (grep en src/)
-- 2. Eliminar funciones/triggers que escriben en clientes.saldo
--    (busca SET saldo = en supabase/*.sql)
-- 3. ALTER TABLE clientes DROP COLUMN saldo;
```

**Riesgo de no hacerlo**: nulo. La columna ocupa pocos KB. La fuente de verdad ahora es `cuentas_por_cobrar`.

