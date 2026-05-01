# Pendientes técnicos — Cubo Polar

Última actualización: 2026-05-01

Este documento agrupa deuda técnica de bajo riesgo detectada en auditorías recientes. Ninguna acción aquí es urgente. Cada sección dice **claramente** si requiere ejecución de SQL en producción y bajo qué condiciones.

---

## Convención de migraciones

Las migraciones del proyecto viven en `supabase/` directamente (no en una subcarpeta `migrations/`).

| Migración | Estado |
|---|---|
| Última versionada | `040_capacidad_tarimas.sql` |
| Próximo número libre | `041` |

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

## 🔴 Auditoría: columnas en código sin migración versionada

Hallazgo de auditoría rápida. Estas columnas **están en uso en producción** (probablemente agregadas manualmente al Dashboard de Supabase) pero **no existen en ninguna migración versionada del repo**. Son deuda de auditoría — no rompen nada hoy, pero si alguien recrea el ambiente desde 0 (test, staging) faltarán.

### Tabla `rutas`

| Columna | Tipo probable | Usos en `supaStore.js` | Estado |
|---|---|---|---|
| `carga_confirmada_at` | `TIMESTAMPTZ` | 7+ (validación, set, lookup en cierre legacy) | ❌ Huérfana |
| `carga_confirmada_por` | `UUID` o `BIGINT` | 2 (set en confirmar carga + firma) | ❌ Huérfana |
| `fecha_fin` | `DATE` | 1 (cierre de ruta) | ❌ Huérfana en `rutas` (la columna `fecha_fin` que sí existe está en `nomina_periodos`) |

**Acción pendiente**: en una sesión futura, hacer auditoría exhaustiva de TODAS las tablas y crear una migración consolidada (probablemente `041_archivo_columnas_huerfanas.sql`) que documente cada columna huérfana con su tipo correcto. La migración usaría `ADD COLUMN IF NOT EXISTS` para que sea segura ejecutar tanto en producción (no-op porque ya existen) como en ambientes nuevos.

### Otras tablas verificadas (NO huérfanas)

Spot-checked y todas con migración versionada:
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
