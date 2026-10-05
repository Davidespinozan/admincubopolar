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
**PACKAGING COST BASIS INTEGRITY — DECISIONS APPROVED · IMPLEMENTED IN THE REPOSITORY ·
LOCAL-VALIDATED · NOT PUSHED · NOT DEPLOYED · MIGRATIONS 107/108 NOT APPLIED TO PRODUCTION.**
Producción no ha cambiado: sigue en la base de arriba (migraciones hasta 106).
Decisiones aprobadas por el dueño el 2026-10-05:
1. Reverso de producción: el empaque devuelto reingresa al promedio al costo unitario GUARDADO
   en esa producción; con existencia 0 el promedio es ese costo. Resultados (093/094) sin cambio.
2. Baja manual de empaque: permitida, nunca bajo cero, el promedio no cambia.
3. Alza manual de empaque: prohibida (entra solo por recepción de compra).
4. En existencia 0 el último promedio queda de referencia; la siguiente compra fija uno nuevo.
5. Existencia negativa de empaque: estado inválido (CHECK; también para SQL de confianza).
6. Un empaque con existencia, uso o historia no se borra por API (no se borra y recrea).
7. Un empaque nuevo nace con existencia 0 y sin costo (sustituye, hacia adelante, la apertura
   declarada al dar de alta de 106). Las aperturas de EMP-5 y EMP-25 no se tocan.

En el repositorio (commit local posterior a la base; ver `git log`): `107_base_costo_empaque_reverso.sql`
(aditiva), `108_contencion_base_costo_empaque.sql` (contención), frontend (ajuste de empaque solo a
la baja; alta sin existencia ni costo) y suite `107`. Precondiciones de solo lectura verificadas el
2026-10-05: catálogo y estado iguales a la foto de 106; sin empaque negativo; ninguna producción
revertida ni reversible con empaque (no hay historia que reparar).
Siguiente paso: autorización del dueño para activar con `activar-produccion`: 107 → push a `main`
(deploy) → bundle vivo → 108 → verificación de solo lectura. Hasta entonces: nada en producción.

**Reestructura de contexto.** Fase 1 COMMITTED localmente (commit `092b1f5`, solo documentación:
no es una versión nueva de la aplicación ni cambia la base de producción). Fase 2 PENDING y sin
autorizar: tarjetas restantes, archivar documentos obsoletos, reducir memoria privada.

## Residuales abiertos
- Empaque y costo: base de costo (arriba, pendiente de activar); sin corrección ni reverso de compra;
  la CxP de una compra todavía se puede editar o borrar por REST.
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
