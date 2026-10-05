# CUBOPOLAR — STATUS (única fuente del estado actual)

Actualizado: 2026-10-05. Lo actualizan los skills `activar-produccion` (al cerrar una fase)
y `fase-auditoria` (al entregar una auditoría, si el dueño autorizó documentarla).
Regla: si el repositorio tiene código o migraciones más nuevos que la base de abajo, esa
diferencia tiene estado de producción DESCONOCIDO hasta verificarla (ver `CLAUDE.md`).

## Base de producción verificada
- Commit: `61161712c54e9981db5ad80a01ed52d7e93d0920` (`main`) — DEPLOYED y VALIDATED IN
  PRODUCTION el 2026-10-03; re-verificado en solo lectura el 2026-10-05.
- Base de datos: migraciones aplicadas hasta la 106 (cada una verificada al activarse).
- Conteos registrados en la verificación de 106 (cambian con cada fase; no son invariantes):
  116 funciones · 77 policies · 40 tablas · 39 secuencias · 1 vista.
- Centinelas: `error_log` max id 192 · OV-0086 md5 `c253d4337b2db7c286c08605f94cc8b9` ·
  anon sin acceso a tablas ni funciones. Se revisan con `supabase/tests/prod/conteos.sql`.

## Última fase cerrada
PACKAGING COST — CLOSED IN PRODUCTION · migración `106_costo_empaque_promedio.sql` ·
commit `61161712c54e9981db5ad80a01ed52d7e93d0920`.

## Trabajo actual
**PACKAGING COST BASIS INTEGRITY — AUDITED / DECISION PENDING.** Auditoría de solo lectura
entregada el 2026-10-03 sobre la base 6116171. Nada implementado ni autorizado.
Hallazgo: compras y producción conservan existencia × costo promedio; cuatro rutas no:
reverso de producción (devuelve empaque sin recalcular el promedio), ajuste manual (sin
historial de costo), borrar y recrear un empaque por API, y alta con existencia negativa.
Decisiones pendientes del dueño:
1. Opción A (contención mínima) u Opción B (base coherente en todo evento; recomendada).
2. Reverso de producción: ¿el empaque devuelto reingresa al costo guardado de esa producción?
3. Aumento manual de existencia: heredar el promedio (recomendado), exigir costo o prohibirlo.
4. Empaque nuevo: ¿debe nacer con existencia 0 y entrar inventario solo por compra? (recomendado)
5. CxP de una compra: ¿protegerla ya de borrado/edición de monto? ¿Agendar un contrato de corrección?

Siguiente paso autorizado: ninguno de implementación. Esperar las decisiones.

**Reestructura de contexto.** Fase 1 escrita el 2026-10-05 (`CLAUDE.md`, este archivo, 3
tarjetas, 4 skills, consultas de `supabase/tests/prod/`): solo documentación. No cambia la base
de producción de arriba: un commit de documentación posterior a esa base no es una versión nueva
de la aplicación. Si está en un commit o en el remoto lo dice git (`git log -1 -- docs/STATUS.md`,
`git status -sb`), no este archivo. Fase 2 PENDING y sin autorizar: tarjetas restantes, archivar
documentos obsoletos, reducir memoria privada.

## Residuales abiertos
- Empaque y costo: integridad de la base de costo (arriba); sin corrección ni reverso de compra.
- Inventario: espejo `productos.stock` de producto terminado desfasado (no autoritativo);
  sin reverso de transformación.
- Finanzas: el pago de CxP no rechaza un monto mayor al saldo; costo fijo/variable en dos escrituras no
  transaccionales; `increment_saldo` (solo limpieza); `error_log` (riesgo de observabilidad).
- Devoluciones: reposición bloqueada; sin saldo a favor; sin CFDI de egreso (tipo E); sin reverso.
- Nómina: sin reverso de un periodo pagado.
- Costeo: costo completo de manufactura y margen por SKU no se modelan (decisión, no defecto).
- Operación: sin pruebas E2E de escritura; el `.env` local apunta a producción.

## Cerrado — no reabrir sin evidencia nueva
| Tema | Evidencia (migraciones / suites) | Tarjeta |
|---|---|---|
| Identidad, RLS, privilegios, historia canónica (B3, B4) | 069–071, 073–075, 077–083, 090/091 | `plataforma.md` |
| Producción atómica y reverso; empaque; costo de empaque | 076, 092, 093/094, 106 | `produccion-empaque.md` |
| Resultados vs flujo; día de negocio; caja; pagos de CxP | 086, 088/089, 093, 096–099 | `finanzas.md` |
| Mermas inmutables y reversibles | 072 (parte sustituida por 103 y 106) | pendiente |
| Stock de cuartos y de ruta; carga y cierre de ruta | 084/085, 087, 102/103 | pendiente |
| Nómina canónica | 100/101 | pendiente |
| Devolución de cliente | 104/105 | pendiente |

Sustituciones intencionales (no son regresiones): 095 (`update_stocks_atomic` sin acceso de la
API desde 105) y 072 (merma FIFO entre cuartos retirada en 103; merma sin valuación desde 106).
Sin reparación histórica: OV-0086 y los egresos legados de costo (1400) quedan intactos.
