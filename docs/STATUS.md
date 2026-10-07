# CUBOPOLAR — STATUS (única fuente del estado actual)

Actualizado: 2026-10-07 (WF-0 + PD-01: rol Empleado y reloj checador, 116 activa). Lo actualizan los skills `activar-produccion`
(al cerrar una fase) y `fase-auditoria` (al entregar una auditoría, si el dueño autorizó documentarla).
Regla: si el repositorio tiene código o migraciones más nuevos que la base de abajo, esa
diferencia tiene estado de producción DESCONOCIDO hasta verificarla (ver `CLAUDE.md`).

## Base de producción verificada
- Repositorio desplegado: `dddedeed73c2ffba8b3802392d7428bf78eb497e` (WF-0 + PD-01) — DEPLOYED (Netlify
  `6ac68685e4b00d0008957698`, ready 2026-10-07T17:51Z); bundle vivo verificado (`registrar_entrada`,
  `registrar_salida`, `mi_asistencia`, `asistencia_dia`, `corregir_asistencia`, `vincular_empleado_usuario`,
  `guardar_turno`, `mi-asistencia`). Netlify Functions: solo cambió `admin-create-user` (`790a38e810e0` →
  `2a30a835df62`, intencional: acepta el rol `Empleado`); los otros 16 digests sin cambio. Este commit de
  documentación se publica encima sin cambios de código. Bases anteriores: `95d69a3` (OP-01E),
  `3bdf4ce` (CLOSURE-1), `5f1632b` (OL-04), `c09d82a` (B3.6), `9a94881` (OL-03B), `cfce0f2` (OL-03A).
- Base de datos: migraciones aplicadas hasta la **116** (111 el 2026-10-06T16:27Z, 112 el
  16:29:58Z, 113 el 17:51:58Z, 114 el 18:58:15Z, 115 el 2026-10-07T00:05:37Z, 116 el 2026-10-07T17:48:57Z,
  una vez cada una; se
  aplican con `supabase db query`; no hay tabla de historial: la "cabeza" se verifica por la presencia y
  huella de los objetos). SHA-256 de 114: `c5b5b82f83db1baae5390ccca197244c146881c1a400a9ed437c4060155d623a`;
  de 115: `0b96309f0270256cbfdc3964f6bfd179a278959fd93f05c9d67e09ac4541a4e9`; de 116:
  `66383f4f8c20cc150713dd961771813ac735453c0e82f6efc30eadbbe97e64b4`; 109–115 sin cambio.
- Conteos tras 116 (cambian con cada fase; no son invariantes): 143 funciones · 83 policies ·
  46 tablas · 44 secuencias · 1 vista · 45 triggers en `public` (7 en `ordenes`). El diff de 116 fue
  EXACTAMENTE +14 funciones, +5 policies, +5 tablas, +5 secuencias, el CHECK `usuarios_rol_check` con
  `'Empleado'` y el índice único parcial `empleados_usuario_id_key`; estado de negocio idéntico.
- Huellas (md5 de `pg_get_functiondef`): `completar_venta_directa` (109) `5825f5e3072a1d5a98961752a5eb5cc6` ·
  `ordenes_guard_entrega_directa` (110) `9eac14f606d8c0f0fb4a8851cc32b640` ·
  `reservar_operacion_cfdi` `da2ef2b708a3d459b1fb462092b3225f` · `reservar_complemento_cfdi` (113)
  `5849cb2725be1b15ac69b747574029d4` · `finalizar_operacion_cfdi` (113) `c59548b8c3e2b98e51795dd46c5a6729` ·
  `conciliar_operacion_cfdi` (113) `c23b347279dfdc7e314067961682f32d` · `cfdi_aplicar_resultado` (113)
  `0202dd24c784ef4c83a09c0dd5b86c4a` ·
  `ordenes_guard_facturada` (112) `7e33177cfb5551cfcd602e94b94343ea` · `cerrar_ruta_financiero`
  (112) `bbca26893810c7867be7b2fd33e6fb14` (antes `9b93ce16…`) · `abonar_cxc` (114)
  `8a5a127c3cc45a4db71cf03bb515f185` (antes `b84b1d3a…`, de 088) · 116: `registrar_entrada`
  `8aa2221b6bfc8173f174641724237866` · `registrar_salida` `79237670bbf721e068c769a5a7f0d149` ·
  `corregir_asistencia` `2d537842689bd849ec229ecb0d4a8054` · `asistencia_dia` `7df64f97f31c4842efd94eb45e538e50` ·
  `mi_asistencia` `467ee2f23865af200d632bd837b4cf68` (huella conjunta de las 14 funciones de 116:
  `9bea838385faf7a54384c658dc61d020`).
- `idx_pagos_ref` (114): `CREATE UNIQUE INDEX idx_pagos_ref ON public.pagos USING btree (referencia)
  WHERE (referencia <> ''::text)` — LIVE; 0 referencias no vacías repetidas al activar.
- Webhooks del link desplegados (digest Netlify): stripe `d50a7b654379` · mercadopago `c6ae953b0992`.
- Centinelas: `error_log` max id 192 · auditoría max id 724 · OV-0086 md5
  `c253d4337b2db7c286c08605f94cc8b9` · anon sin acceso a tablas ni funciones · EMP-5 99,000 @ 1 ·
  EMP-25 9,800 @ 2. Se revisan con `supabase/tests/prod/conteos.sql`.

## Fases desde la base anterior (afc545c, 108) — todas en el commit desplegado
| Fase | Commit | Estado verificado |
|---|---|---|
| PACKAGING COST BASIS INTEGRITY (107/108) | afc545c · docs 08184e2 | CLOSED IN PRODUCTION (2026-10-05); intacto |
| Role UI A1/A2 · A3 · A4 · A5 (primitivas, Almacén de Bolsas, Ventas, Producción, Chofer) | fe05e38 · d0ae300 · 13f7855 · 6cce6d7 | DEPLOYED (solo UI) |
| Role UI B · B2 (shell compartido, `navRolLogic`) | 39e3788 · eca353b | DEPLOYED (solo UI) |
| Role UI B3 · B3.1 (barra inferior móvil) | aa4a2ea · 6c87826 | DEPLOYED (solo UI) |
| Role UI B3.2 (Producción por módulo) · B3.4 (Ventas por módulo) | a61445d · fb6b546 | DEPLOYED (solo UI) |
| OL-01A honestidad del cobro del vendedor | a83ccfc | DEPLOYED |
| OL-02B contrato `completar_venta_directa` (109) | 2e513c0 | MIGRATION APPLIED / VERIFIED |
| OL-02C venta directa por el contrato (Ventas y Admin) · OL-02C.1 pagos de órdenes propias | 6906dc5 · 23b3e54 | DEPLOYED / TECHNICALLY VERIFIED |
| OL-02D1 el webhook del link solo registra el pago | 3077aca | DEPLOYED / TECHNICALLY VERIFIED |
| OL-02D2 contención del camino heredado sin ruta (110) | 8b61a2e | MIGRATION APPLIED ONCE + DEPLOYED / TECHNICALLY VERIFIED |
| STATUS reconciliado hasta 110 | 63da5b4 | solo documentación |
| OL-03A contención del timbrado/cancelación de CFDI (servidor, antes del proveedor) | d6375ad · docs cfce0f2 | DEPLOYED / TECHNICALLY VERIFIED; sin migración |
| OL-03B una operación CFDI a la vez por orden (111) y defensa en base de datos (112) | 9a94881 · docs 09be417 | MIGRATIONS APPLIED ONCE (111 → Netlify → 112) + DEPLOYED / TECHNICALLY VERIFIED |
| Role UI B3.6 Ventas como UN espacio de trabajo (filtros Pendientes / Hoy / Todas) | c09d82a · docs a9ce9d7 | DEPLOYED / TECHNICALLY VERIFIED (solo UI; sin migración) |
| OL-04 complementos de pago por pago (113) | 5f1632b | MIGRATION APPLIED ONCE (113 → Netlify) + DEPLOYED / TECHNICALLY VERIFIED |
| CLOSURE-1 referencia de pago única (114; R-01 de la auditoría final) | 3bdf4ce | MIGRATION APPLIED ONCE + DEPLOYED / TECHNICALLY VERIFIED / OWNER ACCEPTED; R-01 CLOSED IN PRODUCTION |
| WF-0 + PD-01 rol Empleado, vínculo empleado ↔ usuario y reloj checador geolocalizado (116) | dddedee | MIGRATION APPLIED ONCE (116 → Netlify) + DEPLOYED / TECHNICALLY VERIFIED; sin cierre del dueño |

B3.3 y B3.5 (Ventas IA) y OL-01 / OL-02 / OL-02D / OL-03 fueron auditorías sin commit. El cierre
del dueño ("CLOSED IN PRODUCTION") no está registrado para las fases de Role UI, OL-02 ni OL-03A/B.

## Ciclo de vida de la orden (vigente, verificado en código y producción)
- **Venta sin ruta** (`Creada`, o `Asignada` sin ruta): la entrega física solo ocurre por
  `completar_venta_directa` (109): asignación explícita por SKU y cuarto (varios cuartos), salida de
  `cuartos_frios.stock`, pago (contado) o CxC a 30 días (crédito), `Entregada`, idempotencia por
  operación y todo en una transacción. Ventas solo sobre sus órdenes; Admin sobre cualquiera.
- **Link de pago:** el webhook registra SOLO el pago (y el método); no entrega ni mueve inventario.
  Pagado ≠ entregado: la entrega es `completar_venta_directa` en modo `pagado_link`.
- **Con ruta:** la entrega física es del chofer (en línea u offline) y del cierre de ruta
  (`cerrar_ruta_financiero`); Admin puede marcar entregada una orden con ruta (dos pasos, ver residuales).
- **110:** fuera del contexto de contrato, nadie (Ventas, Admin ni service role) lleva a `Entregada`
  una orden sin ruta desde `Creada`/`Asignada`/`En ruta`. No vigila `Facturada → Entregada`
  (cancelación de CFDI). Reversión documentada en el encabezado de 110 (reabre el camino heredado).
- "Enviar a ruta" (Ventas) deja la orden `Asignada` SIN ruta; Admin le asigna la ruta después.
- **Facturación (OL-03A, Netlify `billing-create-invoice` / `billing-cancel-invoice`, service role):**
  antes de llamar al proveedor se exige rol Admin/Facturación (toda la empresa) o Ventas (solo SUS
  órdenes: `vendedor_id` = actor; sin vendedor no es de nadie); timbrar solo una orden `Entregada`
  (el pago no se exige: crédito = PPD); cancelar solo una orden `Facturada` con CFDI vigente. El CFDI
  lo arma el servidor (un `facturamaPayload` del cliente se rechaza). Tras el proveedor, UPDATE
  condicional `Entregada → Facturada` / `Facturada → Entregada` con resultado verificado; si la orden
  cambió, responde 409 (sin rollback automático del CFDI).
- **Operaciones CFDI (OL-03B, 111):** antes del proveedor, `reservar_operacion_cfdi` (service role;
  bloquea la orden, revalida estatus/CFDI vigente/dueño) crea la operación en `cfdi_operaciones`; el
  índice único parcial permite UNA operación activa o sin resolver por orden (emisión O cancelación):
  dos timbrados o dos cancelaciones simultáneas → una sola llamada al proveedor. La llamada HTTP
  (tiempo límite 8 s) ocurre fuera de toda transacción; `finalizar_operacion_cfdi` registra el
  resultado y mueve la orden. Resultado desconocido (timeout, red, 5xx, 2xx sin `Id` +
  `Complement.TaxStamp.Uuid`) o lease vencido (120 s) → `incierta`: bloquea todo reintento hasta
  `conciliar_operacion_cfdi` (Admin/Facturación con evidencia). Generación = cancelaciones
  confirmadas + 1 (re-facturación tras cancelación confirmada).
- **Cancelación:** se respeta el estatus del proveedor: `canceled` → `Entregada`; `requested` →
  `cancelacion_pendiente`, la orden SIGUE `Facturada`; `rejected` → sigue `Facturada`; otro →
  `incierta`. Un HTTP 200 no basta.
- **112 (guarda sin exención de rol, ni service role, ni sesión sin JWT, ni `app.fin_ctx`):**
  `→ Facturada` solo desde `Entregada` dentro de `app.cfdi_ctx = 'emision'` (solo el contrato) y con
  `facturama_id` + `facturama_uuid`; `Facturada → Entregada` solo dentro de `app.cfdi_ctx =
  'cancelacion'` fijando `cfdi_cancelado_at`; `Facturada → otro` e `INSERT` como `Facturada`:
  rechazados. El cierre de ruta CONSERVA `Facturada` (también con cancelación pendiente).
- Runbook (solo lectura): `SELECT … FROM cfdi_operaciones WHERE estado IN ('incierta',
  'cancelacion_pendiente','revision') OR (estado = 'en_curso' AND lease_hasta < now())`. Tras la
  activación de OL-04: 0 filas (0 operaciones, 0 complementos).
- **Complementos de pago (OL-04, 113):** el CFDI tipo P se emite POR PAGO (ancla `pagos.id`); el cliente
  manda solo `pagoId` y los montos/saldos/método del cliente se rechazan. `reservar_complemento_cfdi`
  (service role) bloquea la orden (misma serialización de 111), valida dueño (Ventas solo SUS órdenes;
  Admin y Facturación toda la empresa), CFDI vigente emitido **PPD** (registrado al timbrar en
  `cfdi_operaciones.cfdi_metodo_pago`; nunca de `ordenes.metodo_pago`), coherencia del pago y que las
  parcialidades anteriores ya tengan complemento. Monto, saldo anterior/insoluto, fecha (`pagos.fecha`)
  y forma SAT salen del pago; parcialidad = posición del pago en la CxC, reinicia por generación de
  CFDI. Un éxito por pago y CFDI. Payload según la guía oficial de Facturama (`Complemento.Payments`,
  `AmountPaid`, sin Currency/PaymentMethod/PaymentForm generales; Folio + Date fijos por operación).
  Resultado desconocido → `incierta` (sin reintento automático); conciliación manual con evidencia
  (Admin/Facturación). PUE y CFDI cancelado: no elegibles. Pagos anteriores a la factura y pagos de
  webhook o cierre de ruta aparecen como pendientes en Facturación (por pago) sin llamar a Facturama
  desde esos flujos. El complemento no mueve orden, pago, CxC, contabilidad ni inventario.

## Trabajo actual
**ETAPA CUBOPOLAR: CLOSED IN PRODUCTION (2026-10-06).** Auditoría final de cierre COMPLETA (solo
lectura): P0 = 0; su único MUST-FIX (R-01, producción sin `idx_pagos_ref`) quedó cerrado por
CLOSURE-1. Ninguna fase de implementación en curso. Siguiente paso autorizado: ninguno. El trabajo
posterior es desarrollo normal de producto o backlog aceptado cuando el dueño lo priorice (no hay
OL-05, CLOSURE-2 ni otra auditoría pendientes).

| Severidad | Cuenta |
|---|---|
| P0 | 0 |
| P1 | 0 (R-01 CLOSED IN PRODUCTION) |
| Backlog aceptado (P2 8 · P3 24) | 32 |
| Funcionalidades futuras | 5 |

**CLOSURE-1 (114) — DEPLOYED / TECHNICALLY VERIFIED / OWNER ACCEPTED.**
- `idx_pagos_ref` LIVE: una referencia de pago no vacía se registra una sola vez; '' ("sin
  referencia", default de la columna) queda fuera del índice. Respaldo final en base de datos de la
  idempotencia de los webhooks (Stripe `stripe:<session>`, Mercado Pago `mercadopago:<id>`): una
  entrega duplicada simultánea responde `duplicate` (200) sin segundo pago, CxC, saldo ni orden.
- Referencia por omisión de `abonar_cxc`: `Abono CxC #<cxc> pago <pagos.id>` (antes por segundo de
  reloj; dos abonos legítimos de la misma CxC en el mismo segundo ya no chocan).
- **Comportamiento aceptado por el dueño:** una referencia manual/externa no vacía repetida falla
  cerrado y NUNCA se modifica ni se le agrega texto. Cobro de CxC (`abonar_cxc`, también por
  `registrar_pago_orden` con CxC): rechazo claro "la referencia de pago … ya está registrada" (23505)
  antes de cualquier efecto. Contado (`registrar_pago_orden`): resultado existente
  `referencia_existente` (el cierre de ruta la lista como saltada). Webhooks: `duplicate`.
- Activación: pre-chequeo 0 duplicados → 114 una vez (2026-10-06T18:58:15Z) → catálogo cambió
  EXACTAMENTE en `abonar_cxc` e `idx_pagos_ref` (ACL, SECURITY DEFINER, search_path, RLS, grants y
  policies sin cambio; authenticated sigue sin INSERT en `pagos`) → datos de negocio idénticos
  (órdenes, pagos 1, CxC, saldos, movimientos, rutas, cuartos, productos, CFDI 0, `error_log` 192) →
  push `3bdf4ce` → Netlify ready con los mismos digests de funciones.
- Evidencia local: suite `114_referencia_pago_unica_test.sql` (21 casos), runner (paridad: sin
  `idx_pagos_ref` antes de 114; reproducción de R-01; 114 aborta con datos sucios; webhooks reales
  W1–W7; concurrencia C1–C6; reruns 071–113), `src/__tests__/closure1ReferenciaPago.test.js`.
- Reversión (solo emergencia; reabre R-01): `DROP INDEX idx_pagos_ref` y `abonar_cxc` de 088.

**Funcionalidades futuras (5; no impiden el cierre):** F-01 Role UI convergence A→B (C y D no
autorizadas) · F-02 cancelación de complementos + CFDI de egreso (tipo E) y saldo a favor en
devoluciones · F-03 costo completo de manufactura y margen por SKU · F-04 Clientes para Ventas ·
F-05 rastreo de ruta.

Estados previos (sin cambio): DIRECT-SALE P0 contenido (109 + D1 + 110); INVOICING LIFECYCLE BYPASS
contenido (OL-03A y 112); OL-03B, B3.6 y OL-04 DEPLOYED / TECHNICALLY VERIFIED. Reestructura de
contexto: Fase 2 PENDING y sin autorizar.

## Go-live (puesta en operación) — 2026-10-06
Go-Live Readiness (auditoría de solo lectura): **CONDITIONAL GO** · 3 GL-BLOCKERS · 16 tareas
previas. CUBOPOLAR aún no se pone oficialmente a operar en la empresa (los pocos datos de
producción son pruebas previas, no evidencia de adopción). PD-01 y todo desarrollo de producto:
**FROZEN** hasta tener evidencia de operación real.

**GL-1 (credenciales expuestas en el repositorio PÚBLICO): CLOSED — OWNER ACCEPTED SANDBOX
RESIDUAL RISK (2026-10-06).**
- Cuentas e2e de producción (Admin / Ventas / Chofer, `is_test_account`, ids 66–68): **DISABLED**
  — baneadas con la Auth Admin API de Supabase (hasta 2126) con contraseña aleatoria nueva no
  conservada, y `usuarios.estatus = 'Inactivo'`. Login con las contraseñas publicadas: rechazado
  (`user_banned`). Contraseñas e2e expuestas: **INVALIDATED**. Usuarios reales modificados: 0. La
  4.ª cuenta de prueba (`qa-p0-…`, id 70) ya estaba inactiva y no estaba expuesta: sin cambio.
- `RECIBO_SECRET`: estaba configurado con el TEXTO del comando de generación, visible en un
  comentario público (cualquiera podía firmar links de nota). **ROTATED** a 32 bytes aleatorios
  (contexto "all"), redeploy `6ac55626c980d188e9a6329c` ready. Tokens antiguos: **INVALIDATED**
  (403); token con el secreto actual: 200; sin compatibilidad con el secreto anterior.
- Repositorio (HEAD): **SANITIZED** (`docs/e2e-users-setup.sql`, `docs/CUTOVER_PRODUCCION.md`,
  comentario de `netlify/functions/recibo/index.js`). Los valores antiguos siguen en el historial de
  git y ya no son válidos (sin reescritura de historia).
- E2E CI (`e2e-smokes`): **MANUAL ONLY / PRODUCTION PROHIBITED** (sin cron ni push; el job se niega
  a correr contra `sistema.cubopolar.com`). Secretos `E2E_*` de GitHub conservados hasta que exista
  staging. E2E SMOKES MUST NOT RUN AGAINST PRODUCTION.
- Credenciales SANDBOX de Facturama (publicadas en el historial y en uso en Netlify): **OWNER
  ACCEPTED RISK — NOT ROTATED** (decisión del dueño 2026-10-06; NO bloqueante). La aceptación aplica
  solo al SANDBOX, nunca a credenciales LIVE. No se modificó Facturama ni `FACTURAMA_PASSWORD`;
  Facturama LIVE no tocado. Al hacer el corte a producción (GL-3) se usan credenciales LIVE nuevas.
- Datos de negocio de producción: **UNCHANGED** (comparación antes/después idéntica; `error_log` 192).
- Observación (sin tocar): el link bonito `/nota/:id?t=` responde 400; la función directa sí valida.

**GL-2** (Stripe): READY — OWNER LIVE TEST REQUIRED (el dueño configuró en Netlify la llave restringida
LIVE, la publicable LIVE y el secreto del webhook LIVE `cubopolar-webhook` → `/.netlify/functions/billing-webhook-stripe`,
eventos `checkout.session.completed` y `.expired`; redeploy 2026-10-06; los valores secretos no son legibles,
así que el modo LIVE y la coincidencia del secreto se confirman con el primer link real). **GL-3** (Facturama
en sandbox; CP y régimen de la empresa vacíos): OPEN — diferido por el dueño. OL y CLOSURE-1: siguen CLOSED.

## Modelo de barra y Día 0 — 2026-10-07
**OP-01D / OP-01D.1 (modelo de barra de septiembre 2026): IMPLEMENTED · OP-01E: ACTIVE IN PRODUCTION**
(migración 115 + commit `95d69a3`).
- 1 barra física ~50 kg = 1 unidad (`HIB-50K`), producida en **Máquina Barra** sin empaque (excepción
  explícita solo para la barra).
- `registrar_preparacion_barra` (Admin / Producción): N barras enteras → 2N bolsas de picada
  (`HIP-25K`) o triturada (`HIT-25K`) en el mismo cuarto, consumiendo 2N del empaque CONFIGURADO en la
  salida; atómico, idempotente, sin negativos. Vender después lo preparado no vuelve a consumir barra
  ni empaque. `revertir_preparacion_barra` (Admin): reverso único al costo histórico.
- `registrar_produccion` (definición de 106 + un rechazo): `HIP-25K` / `HIT-25K` no se producen por
  máquina (solo nacen de preparar). `conciliacion_empaque` cuenta el empaque de las preparaciones.
- Transformaciones (agosto): SUPERSEDED, fuera de la operación (backend e historial intactos).
- Funciones en producción idénticas (md5) al build que pasó el gate local completo.
- Limitaciones aceptadas: SKUs fijos en el contrato; sin venta de media barra "desnuda" (sin
  inventario fraccionario); el kardex de una preparación se traza por la referencia `preparacion/PB-…`.

**OP-02 Día 0 (2026-10-07T00:16:49Z, una transacción, autorizado por el dueño): CLOSED.** Empaque de
picada, triturada y enfriamiento asignado en OP-03 (2026-10-07T03:18:42Z).

| SKU | Producto | Precio | Empaque | Mínimo |
|---|---|---|---|---|
| HPC-5K | Hielo Purificado en Cubos 5 kg | $31 | EMP-5 | 1500 (sin cambio) |
| HPC-25K | Hielo Purificado en Cubos 25 kg | $92 | EMP-25 | 400 (sin cambio) |
| HPT-5K | Hielo Purificado Triturado 5 kg | $36 | EMP-5 | 50 (sin cambio) |
| HPT-25K | Hielo Purificado Triturado 25 kg | $98 | EMP-25 | 50 (sin cambio) |
| HEC-25K | Hielo en Cubos para Enfriamiento 25 kg (nuevo) | $72 | EMP-25 | 0 |
| HIB-50K | Barra de Hielo ~50 kg | $120 | ninguno (por diseño) | 0 |
| HIP-25K | Picada de Barra ~25 kg | $60 | EMP-25 | 0 |
| HIT-25K | Triturada de Barra ~25 kg | $60 | EMP-25 | 0 |

- `HIT-5K` (Insumo de agosto, sin historia comprobada): eliminado. Sin nombres "Insumo" en el catálogo.
- Inventario físico de producto terminado = **0** en los 3 cuartos, por el contrato de conteo
  (`ajustar_existencia_cuarto`; CF-1 HPC-5K 990→0, CF-2 HPC-25K 100→0, CF-3 HIT-25K 90→0). Sin ventas ni
  mermas fabricadas; la historia previa (producción, mermas, órdenes, pagos, kardex) se conserva.
- Precios especiales ($28 HPC-5K desde 20 bolsas/semana; $87 HPC-25K desde 10 bolsas/semana): **pendientes**
  hasta que el dueño identifique clientes; se capturan por cliente en Precios (sin automatización).
- El espejo `productos.stock` de HIB-50K conserva 100 (no autoritativo; backlog B-25); el inventario real es el de cuartos.

**OP-03 (preparación operativa final): GO-LIVE READY — OWNER OPENING DATA ONLY.**
- Ensayo operativo de punta a punta en local (`supabase/tests/op03_ensayo_operativo_test.sql`, dentro del
  runner tras 115): producción en Máquina 30 y Máquina Barra, preparar picada/triturada, venta de mostrador
  (público $31, barra $120, preparados $60), precio especial por cliente ($28), ruta (carga firmada, cobro,
  merma de ruta, conteo final), merma de cuarto, reverso válido y rechazado. Sin datos de prueba en producción.
- Procedimiento del Día 1: `docs/OPERACION_DIA1.md`.
- **Antes de la primera producción real (procedimiento de apertura, no software):** conteo físico de bolsas
  EMP-5 y EMP-25 (ajuste a la baja o recepción de compra real) y conteo de producto/barras si existen. Las
  existencias actuales de bolsas (99,000 / 9,800) NO están verificadas: **no producir ni preparar antes del conteo.**
- Datos del dueño pendientes: usuario(s) Ventas; confirmar que `daen97` (Chofer) y `david` (Producción) son las
  personas reales; segundo chofer si aplica; camiones reales (el camión `david / nununu / 1234` es de prueba y
  no se puede desactivar desde la interfaz: no usarlo); clientes reales y quién recibe precio comercial.
- Usuarios: Santiago (Admin) listo; E2E (Admin/Ventas/Chofer) y QA inactivos — no usar.

**GL-2:** READY — validación del primer cobro real pendiente. **GL-3** (Facturama LIVE): DEFERRED; no
timbrar hasta cerrarlo. **PD-01:** implementado y activo (ver abajo; el dueño lo autorizó el 2026-10-07).
**PD-02 (calendario):** NO iniciado. OL y CLOSURE-1: CLOSED.

## Personal y asistencia (WF-0 + PD-01, mig 116) — 2026-10-07
**DEPLOYED / TECHNICALLY VERIFIED — CONFIGURACIÓN PENDIENTE DEL DUEÑO (fail closed).**
- **Rol `Empleado`** (WF-0): solo "Mi asistencia"; no carga datos de negocio ni realtime, sin búsqueda, alertas,
  notificaciones, firmas ni "Ver como"; no cae al back office de "Sin asignar". Ningún contrato de escritura de
  negocio acepta el rol (probado: producción, preparación, CxC, venta directa, órdenes por REST → 42501).
- **Vínculo 1 a 1** `empleados.usuario_id` (índice único parcial) por `vincular_empleado_usuario` (Admin, auditado);
  pantalla Asistencia → Accesos. Los demás roles abren "Mi asistencia" desde la cabecera (Chofer: botón en todos sus pasos).
- **Reloj checador:** `registrar_entrada` exige precisión <= `precision_max_m` Y distancia <= `radio_m` (haversine en
  el servidor; nunca distancia − precisión); `registrar_salida` se acepta fuera de la geocerca y queda marcada
  (coordenadas, precisión, distancia, `salida_dentro = false`). Persona, hora y día laboral los decide el servidor
  (America/Mazatlan; turno nocturno = día de la entrada programada; se marca desde 60 min antes). Retardo = después de
  entrada + tolerancia (inclusive). Idempotencia por `operacion_id`; una asistencia por empleado, día y turno.
  Rechazos guardan solo motivo, precisión y distancia (sin coordenadas). Ubicación: una lectura por toque, sin rastreo;
  sin cola offline. **No toca nómina.**
- **Admin:** Asistencia (tabla del día Empleado | Turno | Entrada | Estado | Salida, evidencia con mapa, intentos
  rechazados, corrección con motivo obligatorio; el original queda y el historial es inmutable), Turnos y Centro de trabajo.
- **Estado al activar:** 0 centros, 0 turnos, 0 asistencias, 0 vínculos, ningún usuario `Empleado`. Hasta que Admin
  capture el centro de trabajo (coordenadas y radio reales), los turnos y los accesos, nadie puede marcar y la
  pantalla dice "sin turno (configuración pendiente)". No se inventaron datos.
- Suites: `supabase/tests/116_asistencia_test.sql` (98 aserciones) + concurrencia C116a–d en el runner;
  `src/__tests__/pd01Asistencia.test.jsx`.
- Reversión (sin registros): borrar funciones y tablas de 116, el índice `empleados_usuario_id_key` y volver el CHECK
  de rol sin `'Empleado'` (antes cambiar de rol a quien lo tenga); revertir Netlify a `1a1c1c1`. Con registros: no borrar historia.

## Backlog aceptado (32: P2 8 · P3 24) — no impide el cierre
Clasificado en la auditoría final de cierre (2026-10-06). Ninguno se promueve a MUST-FIX sin
evidencia NUEVA de producción. P2: escritura del webhook en varios pasos sin compensación completa ·
conciliación manual de CFDI inciertos · cancelar CFDI con complementos depende del proveedor · forma
de pago de tarjeta 04 vs 28 · errores de carga mostrados como lista vacía · compras de empaque sin
corrección/reverso y CxP editable por REST · pago de CxP mayor al saldo · sin E2E de escritura /
`.env` local a producción. P3: CHECK `pagos.monto > 0` y FKs de `pagos`/`orden_lineas` ausentes en
producción (0 violaciones; 2 líneas huérfanas legadas) · RFC/CURP únicos de empleados · triggers
`updated_at` e índices de rendimiento ausentes · receptor público en general · ventanas de lectura
500/200 · realtime sin resincronización · `pagos.read_all` · exención de service role en 105 ·
`canAccessOrden` sin vendedor · chofer sobrescribe el método · cierre de ruta escribe `metodo_pago`
en `Facturada` · webhook escribe el método después del pago · entrega de Admin con ruta en dos pasos ·
"Venta directa" manual · "Producido hoy" · tiempo máximo de Netlify supuesto · espejo
`productos.stock` y sin reverso de transformación · costo fijo/variable en dos escrituras ·
`increment_saldo` / `error_log` · nómina sin reverso · devoluciones (reposición, saldo a favor,
reverso) · sin QA visual autenticada / cabecera suelta de Ventas · OV-0085 sin `delivered_at` (legado).
Detalle por tema:

Ciclo de vida de la orden y pagos:
- **Facturación tras OL-03A/B:** conciliación MANUAL de operaciones inciertas (no hay consulta
  automática al proveedor); sin interfaz de operador para `cfdi_operaciones`; el tiempo máximo real
  de las Netlify Functions no está fijado en el repositorio (8 s / 120 s son supuestos documentados);
  en una orden `Facturada` el cierre de ruta todavía actualiza `metodo_pago`. Sin evidencia de daño
  histórico OL-03 en producción (0 `invoice_attempts`, ninguna orden con CFDI).
- **P1-2 Bypass general de service role:** 105 exime a service role/JWT nulo de las transiciones
  fuera de `Facturada`; 110 cubre la entrega sin ruta y 112 la entrada/salida de `Facturada`.
- **Complementos de pago (tras OL-04):** la consulta por folio en Facturama antes de reintentar no está
  automatizada (conciliación manual); no se cancelan complementos y cancelar una factura con
  complementos depende del rechazo del proveedor; si la factura cayó a público general por RFC
  rechazado, el receptor del complemento puede no coincidir (el proveedor lo rechaza); forma de pago de
  tarjeta 04 vs 28 pendiente de confirmación del contador; las devoluciones ajustan la CxC sin CFDI de
  egreso; el modelo de lectura de Facturación carga los últimos 500 pagos de CxC.
- **Ayudante de dueño compartido:** `canAccessOrden` deja a cualquier vendedor una orden sin vendedor
  (checkout, sincronización de pago y recibo); la facturación ya no lo usa.
- **P1-3 Entrega de Admin con ruta en dos pasos** (estatus por REST y luego ingreso/CxC), latente.
- **P1-4 "Venta directa" manual** en Producción (`salida_cuarto_manual`, 103) descuenta cuarto sin
  ligarse a una orden: se puede descontar a mano y además completar la orden por 109.
- Pagos: `pagos.read_all` (todo usuario activo lee todos los pagos, backlog de seguridad); ventana
  de 200 pagos en el cliente; el webhook escribe el método después de insertar el pago; el chofer
  puede sobrescribir el método de una orden con ruta ya pagada por link.
- Confiabilidad: el realtime no resincroniza tras reconectar (`subscribe()` sin estado; el evento
  `online` solo muestra el aviso).
Otros:
- Producción: "Producido hoy" suma todas las filas de `produccion` del día, incluidas
  transformaciones y producciones revertidas.
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
- Asistencia (tras PD-01): las policies `read_all` heredadas dejan a todo usuario activo (también `Empleado`) leer por
  API muchas tablas de negocio; la interfaz no las carga para Empleado y ningún contrato de escritura lo acepta, pero el
  aislamiento de LECTURA por API no está cerrado (mismo backlog que `pagos.read_all`). Sin QA visual autenticada en
  producción (no se crean usuarios ni marcas de prueba). Sin consulta automática de la marca olvidada (> 24 h): la cierra
  Admin con una corrección. Las correcciones no se reintentan con la misma operación (un reintento tras perder la
  respuesta agrega otra fila al historial).
- Documentación: `finanzas.md` no lista `completar_venta_directa`; no hay tarjeta de órdenes/rutas.
- UI (tras B3.6): Clientes para Ventas sigue diferido; la cabecera suelta (fuera del shell) de la vista
  de Ventas ya no se usa y sigue en el código; no se hizo QA visual autenticada en producción (la
  evidencia es de pruebas de render estático y de navegación).

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

Verificado técnicamente, sin cierre del dueño: venta directa atómica y su contención (109, 110;
suites `109_venta_directa_test.sql`, `110_contencion_entrega_directa_test.sql`); facturación por
operaciones CFDI y su guarda (111, 112; suites `111_operaciones_cfdi_test.sql`,
`112_contencion_facturada_test.sql`, `src/__tests__/ol03a*`/`ol03b*` y la integración de handlers
con Postgres del runner local); complementos de pago por pago (113; suite
`113_complementos_pago_test.sql`, `src/__tests__/ol04Complementos.test.js` y la integración de handlers
de complemento con Postgres).
Reversión OL-04: 113 es aditiva y compatible con el código anterior (el código de OL-03B pasa sus
pruebas con 113). Sin operaciones de complemento: se puede revertir Netlify a `a9ce9d7` dejando 113
como infraestructura sin uso (eso reabre los riesgos del complemento anterior: solo de emergencia).
Con cualquier operación de complemento: no quitar 113 ni borrar historia; resolver las sin resolver.
Reversión OL-03B (en este orden): quitar la guarda 112 y volver a la definición de
`cerrar_ruta_financiero` de 090 → verificar que no hay operaciones `en_curso`/`incierta`/
`cancelacion_pendiente`/`revision` (resolverlas, nunca borrarlas) → solo entonces revertir Netlify →
conservar la tabla 111 como historia. Nunca correr el código de OL-03A con 112 activa.

Sustituciones intencionales (no son regresiones): 095 (`update_stocks_atomic` sin acceso de la
API desde 105), 072 (merma FIFO entre cuartos retirada en 103; merma sin valuación desde 106),
106 (apertura declarada al dar de alta un empaque, sustituida por 108: nace en 0), 110 (la entrega
sin ruta en dos pasos de Ventas/Admin/service role, sustituida por `completar_venta_directa`) y 112
(escrituras directas de `Facturada` del backend, sustituidas por los contratos CFDI de 111; el cierre
de ruta ya no baja `Facturada` a `Entregada`).
Sin reparación histórica: OV-0086 y los egresos legados de costo (1400) quedan intactos.
