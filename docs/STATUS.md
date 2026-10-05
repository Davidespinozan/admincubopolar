# CUBOPOLAR — STATUS (única fuente del estado actual)

Actualizado: 2026-10-05. Lo actualizan los skills `activar-produccion` (al cerrar una fase)
y `fase-auditoria` (al entregar una auditoría, si el dueño autorizó documentarla).
Regla: si el repositorio tiene código o migraciones más nuevos que la base de abajo, esa
diferencia tiene estado de producción DESCONOCIDO hasta verificarla (ver `CLAUDE.md`).

## Base de producción verificada
- Commit: `afc545caa75bc10493dfda5ae2e5c1c552de3a1f` (`main`) — DEPLOYED (Netlify
  `6ac3e2470e05bf0009ed053b`, ready 2026-10-05) y VALIDATED IN PRODUCTION el 2026-10-05.
- Base de datos: migraciones aplicadas hasta la 108 (cada una verificada al activarse).
- Conteos registrados en la verificación de 108 (cambian con cada fase; no son invariantes):
  118 funciones · 77 policies · 40 tablas · 39 secuencias · 1 vista.
- Centinelas: `error_log` max id 192 · OV-0086 md5 `c253d4337b2db7c286c08605f94cc8b9` ·
  anon sin acceso a tablas ni funciones. Se revisan con `supabase/tests/prod/conteos.sql`.

## Última fase cerrada
PACKAGING COST BASIS INTEGRITY — CLOSED IN PRODUCTION (2026-10-05) · migraciones
`107_base_costo_empaque_reverso.sql` y `108_contencion_base_costo_empaque.sql` · commit de
implementación y desplegado `afc545caa75bc10493dfda5ae2e5c1c552de3a1f`. Invariante: ninguna
unidad de empaque entra fuera de una recepción de compra (o del reverso de una producción, al
costo unitario guardado); el empaque solo baja por ajuste; su existencia nunca es negativa; un
empaque nuevo nace en 0 y sin costo; un empaque con existencia, uso o historia no se borra por
API. Sustituye hacia adelante la apertura declarada al dar de alta de 106; sin reparación
histórica: las aperturas de EMP-5 (99,000 @ 1) y EMP-25 (9,800 @ 2) quedan intactas.
Anterior: PACKAGING COST (106, commit 6116171).

## Trabajo actual
Ninguna fase de implementación en curso. Siguiente paso autorizado: ninguno.

**ROLE UI CONVERGENCE — AUDITED / DESIGN PROPOSED / NOT STARTED** (auditoría de solo lectura
2026-10-05, comparada con el repositorio Renovacell). Dirección aprobada solo como rumbo: Opción A
(primitivas visuales compartidas) → Opción B (shell compartido + navegación por rol). NO
autorizado: Opción C, Opción D, cambiar Facturación / Sin asignar, unificar los textos de método
de pago, tocar permisos, RLS, RPC, semántica de `supaStore`, scoping de datos ni workflows.
Se abre como bloque independiente cuando el dueño lo autorice.

**Reestructura de contexto.** Fase 1 COMMITTED localmente (commit `092b1f5`, solo documentación:
no es una versión nueva de la aplicación ni cambia la base de producción). Fase 2 PENDING y sin
autorizar: tarjetas restantes, archivar documentos obsoletos, reducir memoria privada.

## Residuales abiertos
- Empaque y costo: sin corrección ni reverso de compra; la CxP de una compra todavía se puede
  editar o borrar por REST.
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
| Producción atómica y reverso; empaque; costo de empaque y su base | 076, 092, 093/094, 106, 107/108 | `produccion-empaque.md` |
| Resultados vs flujo; día de negocio; caja; pagos de CxP | 086, 088/089, 093, 096–099 | `finanzas.md` |
| Mermas inmutables y reversibles | 072 (parte sustituida por 103 y 106) | pendiente |
| Stock de cuartos y de ruta; carga y cierre de ruta | 084/085, 087, 102/103 | pendiente |
| Nómina canónica | 100/101 | pendiente |
| Devolución de cliente | 104/105 | pendiente |

Sustituciones intencionales (no son regresiones): 095 (`update_stocks_atomic` sin acceso de la
API desde 105), 072 (merma FIFO entre cuartos retirada en 103; merma sin valuación desde 106) y
106 (apertura declarada al dar de alta un empaque, sustituida por 108: nace en 0).
Sin reparación histórica: OV-0086 y los egresos legados de costo (1400) quedan intactos.
