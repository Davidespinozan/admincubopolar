# CUBOPOLAR — reglas permanentes del repositorio

Este repositorio es **CUBOPOLAR**: el ERP de Cubo Polar (fábrica de hielo).
React + Vite, Supabase (Postgres/Auth), Netlify. La rama `main` es producción.
No mezcles aquí instrucciones, arquitectura ni estado de ningún otro repositorio.

Este archivo solo tiene reglas permanentes. El estado actual (base de producción,
última fase cerrada, trabajo en curso, siguiente paso) vive en un solo lugar:

@docs/STATUS.md

Si ese contenido no está en contexto, lee `docs/STATUS.md` antes de cualquier trabajo
sustantivo, al oír "continuemos", o para saber la base vigente y el siguiente paso autorizado.

## Vocabulario de estado — NINGÚN ESTADO IMPLICA EL SIGUIENTE
- AUDITED / DIAGNOSED: se investigó; nada cambió.
- PROPOSED: hay un diseño; no está autorizado ni hecho.
- IMPLEMENTED LOCALLY: cambios en el árbol de trabajo, sin commit.
- COMMITTED: en git local. PUSHED: en el remoto.
- DEPLOYED: Netlify publicó ese commit (se verifica, no se supone).
- MIGRATION APPLIED TO PRODUCTION: el SQL se ejecutó en la base de producción.
- VALIDATED IN PRODUCTION: verificación de solo lectura hecha contra producción.
- CLOSED IN PRODUCTION: validado y aceptado por el dueño.
- PENDING / OPEN: sin resolver.

commit ≠ deploy · deploy ≠ migración aplicada · archivo de migración ≠ migración en
producción · auditoría ≠ implementación.

## Verdad de producción
- Nunca deduzcas el estado de producción solo del repositorio. `docs/STATUS.md` registra el
  último estado VERIFICADO; `git HEAD` no es verdad de producción.
- Al iniciar trabajo sustantivo compara la base de STATUS con el repositorio:
  `git status --short` y
  `git log --oneline <base>..HEAD -- . ':(exclude)docs' ':(exclude)CLAUDE.md' ':(exclude).claude' ':(exclude)supabase/tests/prod'`
- Si hay cambios de código o migraciones más nuevos que STATUS: repórtalos como cambios del
  repositorio con estado de producción DESCONOCIDO. No los promuevas en silencio.

## Reglas de trabajo
- READ-ONLY significa: sin ediciones, sin migraciones, sin escrituras a base de datos o
  producción, sin commit, sin push, sin deploy.
- HARD STOP: entrega el reporte pedido y detente. No inicies la siguiente fase.
- Lo CLOSED IN PRODUCTION no se reabre sin evidencia nueva. Si la evidencia contradice un
  invariante cerrado, reporta la contradicción antes de proponer cualquier cambio.
- Datos históricos: no se reescriben ni reparan sin autorización explícita y defendible.
  Si la verdad histórica no se puede reconstruir, corrige solo hacia adelante.
- QA en producción: solo lectura. No crees telemetría ni registros de negocio para probar.
- Un push a `main` dispara un deploy de producción: requiere autorización explícita de esa
  fase. Una preaprobación técnica de `git push` no es autorización del dueño.
- Nunca imprimas secretos. Nunca incluyas `supabase/.temp/` en un commit.

## Dominios de alto riesgo
Cambios en dinero, CxC/CxP, pagos, inventario, rutas, producción, nómina, devoluciones,
contabilidad o autenticación/RLS exigen análisis explícito de invariantes y de regresión
(skills `fase-auditoria` y `gate-local`) antes de implementarse.

## Qué leer según la tarea (solo lo necesario)
| Tarea | Lee |
|---|---|
| Producción, empaque, compras de empaque, costo de empaque | `docs/sistema/produccion-empaque.md` |
| Identidad, roles, RLS, grants, contratos, idempotencia, fecha de negocio | `docs/sistema/plataforma.md` |
| Dinero: ingresos, cobros, CxC/CxP, caja, reportes, costos | `docs/sistema/finanzas.md` |
| Nómina: periodos, recibos, bonos, comisiones, descuentos y préstamos | `docs/sistema/nomina.md` |
| Otro subsistema (rutas, cuartos fríos, devoluciones, órdenes) | Aún sin tarjeta: usa el encabezado de sus migraciones y sus suites, citados en STATUS |

La historia detallada son las migraciones (`supabase/NNN_*.sql`, su encabezado resume cada
fase), las suites (`supabase/tests/`) y `git log`. Se consultan solo cuando la tarea lo pide.
Documentos antiguos NO autoritativos (obsoletos para base de datos y seguridad):
`DOSSIER.md`, `docs/PENDIENTES_TECNICOS.md`, `docs/RESUMEN_REPO_PARA_CLAUDE.md`,
`supabase/MIGRATIONS_README.md`. Si citas algo de ellos, compruébalo antes contra el código.

## Skills (procedimientos; se cargan solo al usarlos)
- `fase-auditoria`: auditoría de solo lectura de un subsistema, con HARD STOP.
- `gate-local`: validación local completa antes de dar por buena una implementación.
- `activar-produccion`: llevar una fase autorizada a producción, paso por paso.
- `verificar-produccion`: verificación de solo lectura de producción.

## Convenciones estables
- Lógica pura en `src/data/*Logic.js` con pruebas; las vistas y el store solo orquestan.
- Toda mutación de negocio va por un contrato del servidor (ver `plataforma.md`), nunca por
  escritura REST directa nueva.
- Commits en español: `feat(NNN): …` / `fix(…)` / `security(…)` / `docs(…)`.
- El service worker se versiona solo en el build; no se edita a mano.

## Comandos locales seguros
`npm test` · `npm run lint` · `npm run typecheck` · `npm run build` · `npm run dev`
(`npm run dev` usa el `.env` local, que apunta a la base de PRODUCCIÓN: no guardes datos de prueba).
