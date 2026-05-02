# Pendientes técnicos — Cubo Polar

Última actualización: 2026-05-01

Este documento agrupa deuda técnica de bajo riesgo detectada en auditorías recientes. Ninguna acción aquí es urgente. Cada sección dice **claramente** si requiere ejecución de SQL en producción y bajo qué condiciones.

---

## Convención de migraciones

Las migraciones del proyecto viven en `supabase/` directamente (no en una subcarpeta `migrations/`).

| Migración | Estado |
|---|---|
| Última versionada | `041_archivo_columnas_huerfanas_rutas.sql` |
| Próximo número libre | `042` |

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
