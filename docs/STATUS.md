# CUBOPOLAR — STATUS (única fuente del estado actual)

Actualizado: 2026-10-09 (ZONA-1: zona del negocio = Durango, mig 122 aplicada y frontend `28a2024` desplegado; GER-1 activo; Santiago es Dueño). Lo actualizan los skills `activar-produccion`
(al cerrar una fase) y `fase-auditoria` (al entregar una auditoría, si el dueño autorizó documentarla).
Regla: si el repositorio tiene código o migraciones más nuevos que la base de abajo, esa
diferencia tiene estado de producción DESCONOCIDO hasta verificarla (ver `CLAUDE.md`).

## Base de producción verificada
- Repositorio desplegado: `28a2024` (ZONA-1 docs sobre `8f18d75` feat(122) y `5913523` recordatorio de asistencia) — DEPLOYED (Netlify
  `6ac97f5dece4b70008f29f2c`, ready 2026-10-09T23:57:49Z, `commit_ref` = `28a2024`); bundle vivo verificado a las 23:58Z (49 archivos js):
  `America/Monterrey` 1 archivo, `America/Mazatlan` 0, "hora de Durango" 1, "Cubo Polar · Durango" 1, `-06:00` 1, `recordatorio-asistencia` 1.
  Base anterior: `afad162` (GER-1) — DEPLOYED (Netlify `6ac95f9464056c0008f6049b`, ready 2026-10-09); bundle vivo
  verificado (`guardar_usuario`, `confirmar_cambio_password`, `panel-dueno`, `cambio-obligatorio`, `admin-reset-password`;
  0 archivos con `from('usuarios').update`). Netlify Functions: **18** (nueva `admin-reset-password`; cambian las que usan
  `_lib/auth.js` y `admin-create-user`: los digests anteriores ya no aplican). Entre `f7d5e66` y `afad162` (solo UI, DEPLOYED):
  `3aab478` sistema de diseño 2026, `7d36760` bloque A, `bb0d15d` bloque B, `feb3721` favicon. Base anterior: `f7d5e66`
  (revisión mobile-first, solo UI) — DEPLOYED (Netlify `6ac938a39008ec0008871a75`,
  2026-10-09); bundle vivo verificado (`boton-avisos`, `topbar-titulo`, `drawer-movil`, `saludo-rol`, "Mi espacio"; sin
  `modo-prueba-banner` ni "MODO PRUEBA"); 17 digests de Netlify Functions sin cambio. Base anterior:
  `089c521ef460d66ec664eb86abd73bee08b58843` (WF-0.1 + PD-02) — DEPLOYED (Netlify
  `6ac68d97adc0a60008b1d4d9`, ready 2026-10-07T18:21Z); bundle vivo verificado (`completar_ocurrencia`,
  `guardar_actividad`, `editar_ocurrencia`, `desactivar_actividad`, `p_solo_abiertas`, `mis-actividades`,
  `actividades-vencidas`, `dashboard-calendario`). Netlify Functions: los 17 digests idénticos al deploy anterior
  (`admin-create-user` `2a30a835df62`, stripe `d50a7b654379`, mercadopago `c6ae953b0992`). Este commit de
  documentación se publica encima sin cambios de código. WF-0.2 (119) no cambió el frontend: su commit (migración,
  pruebas, runner y STATUS) se publica sobre el mismo código. Bases anteriores: `dddedee` (WF-0 + PD-01), `95d69a3` (OP-01E),
  `3bdf4ce` (CLOSURE-1), `5f1632b` (OL-04), `c09d82a` (B3.6), `9a94881` (OL-03B), `cfce0f2` (OL-03A).
- Base de datos: migraciones aplicadas hasta la **122** (122 zona del negocio el 2026-10-09 entre 22:05Z y 23:51Z, por el dueño en el SQL
  Editor; SHA-256 `06cef88222e8b6ac4f68fa01300e74ce187b247a239dcb41b8786cdc528de05e`; md5 de `fin_zona_negocio`
  `776af6e18276586f82b16cc1a2de8474`). En el mismo intervalo el dueño aplicó la migración MULTISUCURSAL de otra sesión (archivo aún sin
  commit, llamado `122_multisucursal.sql` en su árbol; entrará al repositorio como 123): `sucursales` (217 principales), 9 funciones,
  `crear_orden`, `update_orden_atomic`, `precio_canonico`, `lineas_canonicas`, 1 policy, 5 triggers; conteos a las 23:51Z: 181 funciones ·
  88 policies · 51 tablas · 48 secuencias. Su verificación y STATUS los documenta esa fase. 120 y 121 el 2026-10-09, por el dueño en el
  SQL Editor de Supabase, una vez cada una; SHA-256 de 120 `a7cbfda218d2996bfb1931bdf659f0b53bc768f18ebc3b052914b2acd15850a3`, de 121
  `ee2316afc519f9ddbc9e2f6984b286d828592916f983f2ebb220f8fb727b91e4`). Anteriores: hasta la 119 (111 el 2026-10-06T16:27Z, 112 el
  16:29:58Z, 113 el 17:51:58Z, 114 el 18:58:15Z, 115 el 2026-10-07T00:05:37Z, 116 el 2026-10-07T17:48:57Z,
  117 el 18:19:21Z, 118 el 18:19:56Z, 119 el 19:32:05Z, una vez cada una; se
  aplican con `supabase db query`; no hay tabla de historial: la "cabeza" se verifica por la presencia y
  huella de los objetos). SHA-256 de 114: `c5b5b82f83db1baae5390ccca197244c146881c1a400a9ed437c4060155d623a`;
  de 115: `0b96309f0270256cbfdc3964f6bfd179a278959fd93f05c9d67e09ac4541a4e9`; de 116:
  `66383f4f8c20cc150713dd961771813ac735453c0e82f6efc30eadbbe97e64b4`; de 117:
  `45f027956dcae88dd93d0588692078995bedf48088a5b6a548273c02ff111fbb`; de 118:
  `b4d2a77b730b99b999548408b37f5b763cbe4e8520d4228291a26f0c64923a8e`; de 119:
  `cd499211b5d47eed71142401789d455a323a3007ab92cd72f3190127fc67f0ad`; 109–118 sin cambio.
- Corrección puntual de 056 (2026-10-09, por el dueño en el SQL Editor): producción tenía `clientes.numero_interior` y
  `configuracion_empresa.numero_exterior` pero NO `configuracion_empresa.numero_interior` (056 aplicada a medias; Ajustes
  fallaba al guardar con "Could not find the 'numero_interior' column"). Se agregó solo esa columna (`ADD COLUMN IF NOT
  EXISTS numero_interior TEXT`); verificada en solo lectura. Sin código, deploy, datos, RLS ni grants afectados.
- Conteos tras 121 (cambian con cada fase; no son invariantes): 170 funciones · 87 policies · 50 tablas · 62 triggers en
  `public`; 92 funciones ejecutables por authenticated. Diff de 120: +8 funciones, +3 policies (`usuarios.admin_read`,
  `bitacora_cambios.dueno_read` / `desde_disparador`), +2 tablas (`bitacora_cambios`, `usuarios_password_temporal`), +15 triggers,
  3 columnas en `usuarios`, cuerpo de `erp_actor`, `fin_actor_permitido`, `fin_orden_operable` y `completar_venta_directa`, USING de 4
  policies de Ventas. Diff de 121: −1 policy (`usuarios.admin_all`), sin INSERT/UPDATE/DELETE ni secuencia de `usuarios` para
  authenticated. Estado de negocio idéntico antes y después (comparación de `estado_negocio.sql`). Tras 119: 162 funciones · 85 policies ·
  48 tablas · 46 secuencias · 1 vista · 47 triggers en `public` (7 en `ordenes`). Diff de 116: +14 funciones,
  +5 policies, +5 tablas, +5 secuencias, CHECK de rol con `'Empleado'` e índice `empleados_usuario_id_key`.
  Diff de 117: +1 función (`erp_lector_negocio`) y el USING de 24 policies (mismo nombre, comando, roles y tipo).
  Diff de 118: +17 funciones, +2 policies, +2 tablas, +2 secuencias, +2 triggers. Diff de 119: cuerpo de 5 funciones
  (mismo ACL) + `erp_exigir_no_empleado` (sin EXECUTE para authenticated); policies y grants sin cambio (87 funciones
  ejecutables por authenticated antes y después). Estado de negocio idéntico en cada paso.
- Huellas tras 120 (md5; idénticas a la base local que pasó el gate): `completar_venta_directa` `63eaffba02340da67a660429bac1470e` ·
  `erp_actor` `27277fcf645f05134275473c7892b769` · `fin_actor_permitido` `87a92520544d6b06fca4aa95bbecd7db` · `fin_orden_operable`
  `ad5b88daba4e7ea6cbff1837c2c7f729` · `guardar_usuario` `2b32868497e95e5deaf91af26619ec97` · `confirmar_cambio_password`
  `e7e488614bbc10b476caccc996b2d539` · `fijar_password_temporal` `a0d2b7c951921efd6caa45d958bb0c6e` · `erp_roles_activos`
  `53c2999e3a7e19c781999d73ea052c68` · `erp_tiene_rol` `b65845d7ca3adf2607a19e766ed85a8c` · `erp_es_dueno` `6c45d12f133889e03d9d51321135fab2`.
- Huellas anteriores (md5 de `pg_get_functiondef`): `completar_venta_directa` (109, sustituida por 120) `5825f5e3072a1d5a98961752a5eb5cc6` ·
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
  `9bea838385faf7a54384c658dc61d020`) · 117: `erp_lector_negocio` `d97f617862eda14b2d86100221e9885b` · 118:
  `calendario` `6b36ccfd86de471c73c16edd5d2ec28d` · `completar_ocurrencia` `7aae67bba2c0ce36ce4339f662813e9b` ·
  `guardar_actividad` `23237091c7e62056cf1eafad8cc4244b` · `editar_ocurrencia` `244157be727c6e9ec7884c94d063bb2d` ·
  `desactivar_actividad` `a951db0f61f5601f40302268faac5f9e` (huella conjunta de 118: `2add50fa4f4e64be367a509b40d61098`) ·
  119: `erp_es_activo` `1e94bc1d08b13cd559e7e678c7e6347e` (antes `76b7c3fb…`) · `erp_exigir_no_empleado`
  `51882a9b70cd7451ee315021c6db7bf0` · `cuarto_tiene_historia` `fc0be68ada0d71b41274c3d6e5f004d5` · `empaque_tiene_dependencias`
  `0d9bbf77ae59aa1793079dd7ed66cf8d` · `b4_ruta_con_historia` `b4df8086727901167580ff9d2397b4d5` · `erp_foto_merma_en_uso`
  `06f7fa1db7a55c57834ce1228b6c29b7` (idénticas a la base local que pasó el gate).
- `idx_pagos_ref` (114): `CREATE UNIQUE INDEX idx_pagos_ref ON public.pagos USING btree (referencia)
  WHERE (referencia <> ''::text)` — LIVE; 0 referencias no vacías repetidas al activar.
- Webhooks del link desplegados (digest Netlify): stripe `d50a7b654379` · mercadopago `c6ae953b0992`.
- Centinelas (2026-10-09, tras 121): `error_log` max id 253 · auditoría max id 762 · `bitacora_cambios` 0 filas. Anteriores: `error_log` max id 192 · auditoría max id 724 · OV-0086 md5
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
| WF-0.1 aislamiento de lectura del Empleado (117) + PD-02 calendario operativo (118) | 089c521 | MIGRATIONS APPLIED ONCE (117 → 118 → Netlify) + DEPLOYED / TECHNICALLY VERIFIED |
| WF-0.2 cierre de la superficie de API del Empleado (119) | 17c6b05 | MIGRATION APPLIED ONCE (sin cambio de frontend) / TECHNICALLY VERIFIED |
| UI mobile-first: sin banner global de modo prueba (aviso solo en Facturación), cabecera con una campana "Avisos", "Mi espacio" en el menú, menú móvil oscuro con íconos, bienvenida por rol, emojis → SVG, Chofer sin encimados; corrige ciclo infinito de entregas en ChoferView | f7d5e66 | DEPLOYED / TECHNICALLY VERIFIED (solo UI; revisada con capturas WebKit iPhone 14 de los 7 roles con datos de ejemplo); QA del dueño en su iPhone PENDIENTE |

| UI: sistema de diseño 2026 · bloque A (detalle de venta, avisos, ventas que esperan ruta, título único) · bloque B (guías) · favicon | 3aab478 · 7d36760 · bb0d15d · feb3721 | DEPLOYED (solo UI); QA del dueño en su iPhone PENDIENTE |
| GER-1 Dueño, accesos por persona, contraseña temporal, usuarios por contrato y bitácora (120 + 121) | afad162 | MIGRATIONS APPLIED ONCE (120 → Dueño → Netlify → 121) + DEPLOYED / TECHNICALLY VERIFIED; usuarios del equipo PENDIENTES del dueño |

**Clasificación final (2026-10-07):** **WF-0 = CLOSED PROD** · **PD-01 = CLOSED PROD / CONFIGURATION PENDING** (solo
centro de trabajo real, geocerca, turnos reales y vínculos empleado ↔ usuario) · **PD-02 = CLOSED PROD / OWNER DATA
PENDING** (solo actividades reales, responsables, ventanas y visibilidad). Son datos de operación, no software pendiente.

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
CLOSURE-1. El trabajo posterior es desarrollo normal de producto o backlog aceptado cuando el dueño lo priorice (no hay
OL-05, CLOSURE-2 ni otra auditoría pendientes).

**Fase en curso: MULTISUCURSAL (mig 123 + correcciones 124 y 125) — MIGRATIONS APPLIED TO PRODUCTION (por el dueño; 123 el
2026-10-09 ~23:51Z con el nombre `122_multisucursal.sql`, 124 y 125 el 2026-10-10) / VERIFIED (md5 y llaves idénticos a la base
local) / frontend DEPLOYED (commit `6c52cb3`, push del dueño 2026-10-10; bundle vivo verificado: `Fusionar un cliente existente`,
`Nueva sucursal`, `guardar_sucursal`, `toda la cadena`). LEVIN (12 sucursales) y VENEGAS (4) FUSIONADOS en producción el 2026-10-10 con SQL del dueño sobre el contrato
`fusionar_cliente_en_sucursal` (14 clientes absorbidos Inactivos con `fusionado_en`, 14 renglones de auditoría, 217 sucursales,
0 clientes sin principal, 0 sucursales en clientes fusionados; verificado en solo lectura). Los 16 locales no tienen domicilio
capturado (la lista original no lo traía): pendiente del dueño en Clientes → Sucursales.** Ver su sección abajo. Siguiente paso autorizado: ninguno (commit, push y deploy requieren autorización del dueño).

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

## Zona horaria del negocio = Durango (ZONA-1, mig 122) — 2026-10-09
**DEPLOYED / TECHNICALLY VERIFIED (2026-10-09): migración 122 aplicada por el dueño (SQL Editor, entre 22:05Z y 23:51Z) y validada en
solo lectura (23:51Z y 23:57Z: `error_log` 254 sin filas nuevas); frontend `28a2024` desplegado (Netlify `6ac97f5dece4b70008f29f2c`) con
el bundle vivo verificado. Sin cierre del dueño registrado ("CLOSED IN PRODUCTION" pendiente de su palabra).** El
clasificador de permisos de la sesión bloqueó `supabase db query` contra producción ("Production Deploy"); el dueño aplicó el SQL.
- **Verificado en producción (23:51Z):** `fin_zona_negocio()` = `America/Monterrey`, md5 `776af6e18276586f82b16cc1a2de8474`
  (antes `7688ea0b…`), IMMUTABLE, `search_path=public, pg_temp`, EXECUTE para authenticated y service_role, sin anon; `fin_hoy()` =
  día de Durango; hora del negocio 17:51 a las 23:51Z (UTC-6). Catálogo: de mi fase cambió EXACTAMENTE `fin_zona_negocio`. El
  mismo intervalo incluye la migración multisucursal de la otra sesión (también aplicada por el dueño: `sucursales`, 9 funciones
  nuevas, `crear_orden`, `update_orden_atomic`, `precio_canonico`, `lineas_canonicas`; 181 funciones · 88 policies · 51 tablas ·
  48 secuencias) y actividad del dueño en la app (órdenes, pagos, kardex 33 → 34, `error_log` 253 → 254, auditoría 775 → 796);
  122-zona no escribe datos.
- **Hallazgo (auditoría de solo lectura, 2026-10-09):** 096 fijó `fin_zona_negocio()` = `America/Mazatlan` suponiendo Culiacán; la
  planta está en Durango, Dgo. (El Alacrán 103, Campo Alegre, C.P. 34186; zona Centro, UTC-6, sin horario de verano). Efecto: un turno
  de 08:00 se evaluaba a las 09:00 de Durango (un retardo de 50 min no contaba) y el día de negocio (caja, reportes, calendario)
  cambiaba a la 01:00. Contradicción con la decisión cerrada de 096/098 por error de hecho, no cambio de criterio.
- **Impacto histórico:** 0 filas. Todas las columnas `created_at`, `delivered_at` y `cierre_at` de las 30 tablas con datos (22:05Z):
  ninguna cae en la hora en que Mazatlán y la zona Centro difieren; 0 asistencias, 0 turnos, 0 ocurrencias. Nada se reinterpreta.
- **122** (SHA-256 `06cef88222e8b6ac4f68fa01300e74ce187b247a239dcb41b8786cdc528de05e`): una sola sentencia, `CREATE OR REPLACE` de
  `fin_zona_negocio()` → `'America/Monterrey'` (zona IANA de Durango; igual a `America/Mexico_City` desde 2022). Misma firma,
  IMMUTABLE, ACL y search_path. md5 en producción ANTES: `7688ea0bc1e52c60bc1ffc322cfd5cb5` (= paridad del runner). Sin índices ni
  columnas generadas que la usen. Reversión: la misma sentencia con `'America/Mazatlan'`.
- **Cliente (commit `8990003`):** una sola fuente `ZONA_NEGOCIO` en `src/utils/fechas.js` (asistencia, saludo, crons y Dueño la
  importan); desfase por omisión `-06:00`; textos "hora de Durango" y "Cubo Polar · Durango". Mientras el bundle nuevo NO esté
  desplegado, el cliente actual sigue mostrando hora de Mazatlán: aplicar 122 y publicar el commit deben ir juntos (mismo día).
- **Gate local (RESULTADO OK, 2026-10-09):** paridad pre-122 con producción; residual reproducido (08:00 → 15:00 UTC); 122 ×2; suite
  `122_zona_negocio_test.sql` (8); 43 suites re-corridas tras 122 (071–121 y 111); concurrencia 116 con la zona nueva; ensayo OP-03;
  SEARCH_PATH 119/119. Suites 096/098/100/116/118/119 y el runner derivan ahora sus instantes frontera de `fin_zona_negocio()` (corren
  antes y después de 122). Vitest 1,481 en UTC / Mazatlán / CDMX / Madrid; lint, typecheck, build y `diff --check` limpios.
  Runner: `PG_PORT` opcional (dos gates a la vez).
- **Activación (completa):** 1) 122 aplicada por el dueño ✔ → 2) verificación de solo lectura ✔ → 3) push `28a2024` por el dueño (el
  clasificador bloqueó el push de la sesión) ✔ → 4) bundle vivo con `America/Monterrey` y sin `America/Mazatlan` ✔ → 5) STATUS ✔.
- **Numeración:** la migración multisucursal de la otra sesión también se llamó 122 en su árbol de trabajo (sin commit); ambas se
  aplicaron en producción. En el repositorio 122 = zona; la multisucursal debe entrar como 123 (aviso enviado a esa sesión).
- **Turnos de asistencia:** ya se pueden capturar en hora de Durango. Centro de trabajo ya
  registrado (id 1, 23.983809, -104.665219, radio 100 m, precisión 50 m; auditoría 762).
- **Fuera de alcance, observado en solo lectura (2026-10-09):** `error_log` llegó a 253 (STATUS registraba 192) y hubo 3 intentos de
  timbrado fallidos (órdenes 46 y 56) con GL-3 abierto; el dueño declaró que todos los datos actuales de producción son de prueba
  y que se borrarán antes del lanzamiento, salvo clientes y catálogo.

## Dueño, accesos y usuarios (GER-1, mig 120/121) — 2026-10-09
**DEPLOYED / TECHNICALLY VERIFIED — ALTA DEL EQUIPO PENDIENTE DEL DUEÑO.** Detalle y decisiones cerradas: `docs/sistema/plataforma.md`.
- **Auditoría GER-0 (solo lectura):** Admin cambiaba cualquier usuario por REST (rol y estatus), creaba y pagaba cuentas por pagar,
  cambiaba salarios y precios, y nada de eso dejaba rastro del servidor. Diseño aceptado por el dueño: 4 capas (imposible para Admin ·
  rastro inmutable · aprobación previa solo en salidas de dinero y faltantes grandes · revisión posterior).
- **Activo:** Dueño = Admin + `es_dueno` (Santiago Mier, id 45, marcado por el dueño con SQL); accesos adicionales por persona (Ventas /
  Almacén Bolsas) que solo asigna el Dueño; contraseña temporal con cambio obligatorio (sin autoridad en el servidor hasta cambiarla);
  "Mi cuenta" para todos los roles; usuarios solo por `guardar_usuario` / `admin-create-user` / `admin-reset-password` (sin DML REST);
  `bitacora_cambios` (escrituras REST directas en 14 tablas, antes/después, solo la lee el Dueño); Panel del dueño.
- **Pendiente del dueño (datos, no software):** crear en Panel del dueño → Usuarios y accesos: Jessica Muñoz Gurrola (Admin),
  Daniela Guadalupe Candia González (Admin) y María de Jesús Ibarra Fernández (Almacén Bolsas + acceso Ventas); correos
  `nombre.apellido.rol@cubopolar.com`, contraseña temporal elegida por el dueño. Las tres existen como empleadas sin usuario.
- **No incluido (PROPOSED, sin autorizar):** GER-2 aprobaciones del Dueño con umbrales (pago a proveedor > $5,000, devolución en efectivo,
  cancelar venta cobrada / anular CxC, nómina por periodo, ajuste de inventario a la baja > 50 bolsas, diferencia de caja > $200, precio
  público y precio especial > 10 % abajo); GER-3 cerrar el REST de cuentas por pagar, precios, salarios y asientos manuales.
- **Decisión del dueño (2026-10-09):** el cambio obligatorio de contraseña es opcional y nace apagado (casilla en el alta y al
  restablecer); la contraseña inicial sirve hasta que alguien la cambie. OWNER ACCEPTED RISK.
- **Residuales aceptables:** la contraseña inicial es conocida (cualquiera que la conozca entra a esa cuenta); el acceso adicional de Ventas no factura;
  el Chofer no muestra accesos adicionales; `service_role` / SQL de confianza tienen la autoridad del Dueño.
- **Observación (sin tocar):** el usuario de Producción que estaba activo el 2026-10-09 temprano ya no lo está (activos: Admin 1, Chofer 1;
  6 usuarios en total, antes 7). No es efecto de GER-1 (estado de negocio idéntico antes y después de 120 y 121).
- Evidencia: runner local RESULTADO OK (paridad pre-120, H1 reproducido, 120 y 121 ×2, suites `120_ger1_dueno_accesos_test.sql` (59) y
  `121_ger1_contencion_usuarios_test.sql` (7), 41 suites anteriores tras cada una, C120a/b, ensayo OP-03); `src/__tests__/ger1DuenoAccesos.test.jsx`.
- Reversión: encabezados de 120 y 121 (121 primero: recrear `admin_all` y sus grants; después Netlify a `feb3721`; 120 al final).

## Multisucursal por cliente (mig 123) — 2026-10-09 — DEPLOYED / TECHNICALLY VERIFIED (LEVIN y VENEGAS fusionados; domicilios de sus sucursales pendientes del dueño)
**Migraciones y frontend en producción** (commit `6c52cb3`). El trabajo en curso de otra sesión (alta de cliente por el chofer, 127) quedó fuera de ese commit. El dueño pegó el SQL en Supabase el 2026-10-09 (~23:51Z) con el nombre
`122_multisucursal.sql`, junto con `122_zona_negocio_durango.sql` de otra sesión, ANTES de que el gate local terminara (la única
falla del gate en ese momento era una aserción mal escrita de la suite, no la migración). Verificado en solo lectura después:
tabla `sucursales` con 217 filas = 217 principales (0 clientes vigentes sin principal; 18 con domicilio), `ordenes.sucursal_id` y
`precios_esp.sucursal_id`, 4 índices únicos (sin la constraint vieja), 5 disparadores, 1 policy de lectura, authenticated solo
SELECT, anon nada, realtime activo; 181 funciones · 51 tablas; md5 de las 15 definiciones de 123 en producción IDÉNTICOS a la
base local del gate (el runner lo comprueba en `MULTISUCURSAL_PROD_CHECK`). Ya existe 1 orden con sucursal (principal), creada
por el frontend anterior a través de `crear_orden`. Autorizada por el dueño (por medio de David) el 2026-10-09 tras la auditoría
de solo lectura del mismo día (217 clientes, una sucursal = un cliente; LEVIN 12 y VENEGAS 4 cargados como clientes separados).
- **Decisiones del dueño:** crédito, límite, saldo y CxC **por cadena (cliente)**; precio especial **por sucursal** (respaldo: precio del
  cliente; al final, lista); factura siempre a la razón social del cliente; LEVIN y VENEGAS se fusionan como sucursales. Por omisión
  (sin objeción): sucursales las crean Admin y Ventas; fusionar, solo Admin; la venta exprés del chofer sigue por cliente (sin sucursal).
- **Modelo (123, aditiva e idempotente; 122 es la zona de negocio Durango de otra sesión):** `sucursales` (una **principal** por cliente = domicilio del cliente; backfill de las 217 y
  sincronía clientes → principal por disparador; sin DML REST: lectura `erp_lector_negocio` y contrato `guardar_sucursal`);
  `ordenes.sucursal_id` (debe ser del cliente; inmutable por REST; `crear_orden` / `update_orden_atomic` la aceptan, sin ella usan la
  principal, y **copian** la dirección y coordenadas de la sucursal a la orden cuando no viene dirección propia);
  `precios_esp.sucursal_id` (NULL = cadena; únicos por (cliente, sku) sin sucursal y por (sucursal, sku); `precio_canonico(cliente,
  sucursal, sku)`; las firmas de 088 siguen y equivalen a "sin sucursal": 112 no cambia); `clientes.fusionado_en`;
  `fusionar_cliente_en_sucursal(origen, destino, nombre)` (Admin: la principal del origen pasa a sucursal del destino; órdenes, CxC,
  pagos, devoluciones, comodatos y precios se **reapuntan** sin reescribir montos ni la foto del nombre; saldo sumado al destino; origen
  Inactivo; reintento = misma respuesta; RFC nominativo distinto → rechazo; CFDI sin resolver → rechazo). `crear_orden` bloquea al
  cliente (FOR UPDATE) y rechaza un cliente fusionado: una fusión y una venta simultáneas no dejan órdenes huérfanas.
- **Frontend:** `src/data/sucursalLogic.js` (sucursal → cliente → lista; `resolverEntrega` orden → sucursal → cliente, compartida por
  Chofer, Rutas y Ventas — corrige que Rutas ignoraba la dirección propia de la orden); Clientes → Sucursales (`SucursalesModal`: alta,
  edición, desactivar, fusionar para Admin); selector de sucursal en Nueva venta y Editar venta solo si el cliente tiene más de una;
  Precios especiales por sucursal; "Cliente · Sucursal" en Chofer, Rutas y Detalle; realtime de `sucursales` en el núcleo.
- **Evidencia local:** suite `123_multisucursal_test.sql` (catálogo, principal y sincronía, contrato, precio, crear/editar orden, crédito
  por cadena, REST, fusión e idempotencia); runner: paridad pre-123 con producción (md5 de `precio_canonico`, `lineas_canonicas`,
  `crear_orden`, `update_orden_atomic`), 123 ×2, RLS, C123a–c (crédito por cadena simultáneo, fusión + venta, dos fusiones), suites
  anteriores; 088-05 consciente de 123 (constraint → índice único parcial). Vitest `src/__tests__/multisucursal.test.js`; lint,
  typecheck y build en verde; 2,977 tests en 4 zonas (los 3 archivos `.claude/worktrees/zona-durango/e2e/*.spec.js` de otro
  árbol de trabajo no son de esta fase). **Gate SQL: RESULTADO OK (2026-10-10)** con 122 (zona) + 123 + 124 + 125: suite 123 (75
  comprobaciones), C123a–c, `MULTISUCURSAL_PROD_CHECK` (md5 local = producción), 117-00b y 090-04 conscientes de sucursales,
  `UNQUALIFIED_RESOLUTION` PASS y las 42 suites anteriores tras 123. LOCAL-VALIDATED.
- **124 (`124_multisucursal_cambio_cliente.sql`) — MIGRATION APPLIED TO PRODUCTION (dueño, 2026-10-10) / VERIFIED (md5 de
  `update_orden_atomic` en producción `443fcb9caf68aa44f1c3f595103ad63d` = base local; SECURITY DEFINER, `search_path` fijo, ACL igual):** solo redefine
  `update_orden_atomic` (misma firma y ACL). Defecto de 123 hallado por la suite (123-05d), no por producción: al editar una orden
  cambiando `cliente_id`, el UPDATE escribía el cliente nuevo con la sucursal del anterior y la guarda lo rechazaba. El frontend
  desplegado no cambia el cliente al editar, así que ninguna orden quedó afectada. Hasta aplicar 124, producción rechaza (no
  corrompe) ese caso. Se aplica con `supabase db query --linked -f supabase/124_multisucursal_cambio_cliente.sql` tras
  autorización del dueño; el runner la aplica ×2 antes de la suite 123.
- **125 (`125_multisucursal_borrado_cliente.sql`) — MIGRATION APPLIED TO PRODUCTION (dueño, 2026-10-10) / VERIFIED (llaves
  `sucursales_cliente_id_fkey` ON DELETE CASCADE y `sucursales_origen_cliente_id_fkey` ON DELETE SET NULL; 217 clientes / 217
  principales intactos):** `sucursales.cliente_id`
  pasa a ON DELETE CASCADE y `origen_cliente_id` a ON DELETE SET NULL. Defecto de 123 que destapó el gate (re-corrida de la suite
  088 tras 123): como todo cliente tiene principal, **DELETE de un cliente fallaba siempre** (23503), también sin historia; en la
  app "Eliminar permanentemente" de Clientes respondía "Usa Desactivar" para todos. Con 125, borrar un cliente sin historia borra
  su principal; la historia sigue protegida (órdenes → sucursal, y órdenes/pagos/CxC/comodatos → cliente). Se aplica con
  `supabase db query --linked -f supabase/125_multisucursal_borrado_cliente.sql`; el runner la aplica ×2 (`MULTISUCURSAL_125`) y la
  suite 123 la exige (123-01g).
- **No incluido:** sucursal en la venta exprés del chofer (precio del cliente); crédito/precio por sucursal con límite propio;
  `rutas.clientes_asignados` no se reescribe en la fusión (solo cuenta clientes); 2 líneas de la bitácora de REST no aplican
  (sucursales no tienen REST).
- Nota: el archivo `123_multisucursal.sql` del repositorio lleva dos `REVOKE` explícitos (`sucursal_direccion_texto`,
  `sucursal_con_domicilio`) añadidos tras el gate local; en producción esas funciones ya estaban sin EXECUTE para `anon` y
  `authenticated` (privilegios por defecto de `postgres`; verificado en solo lectura), así que el archivo y producción coinciden.
- Reversión: encabezado de 123 (sin órdenes con sucursal ni fusiones). Con historia: no borrar.

## Tanda 3 de correcciones de la revisión profunda (mig 136) — 2026-10-10 — COMMITTED / LOCAL-VALIDATED (migración y deploy PENDIENTES)
**Estado: en git local (rama `tanda3-arreglos`). 136 NO aplicada en producción; frontend y funciones NO desplegados.** Autorizada por el
dueño ("dale", 2026-10-10). Orden de activación: 136 (aditiva, compatible con el frontend desplegado) → verificación de solo lectura → push.
- **136** (`136_correcciones_tanda3.sql`, SHA-256 `76c145d6479f4ebf1e9c9e6fad0459d2aba192021a05e4bb07c235692c10b9eb`; idempotente, mismas firmas y permisos, una función nueva):
  (1) `mi_asistencia` — al terminar el turno conserva la entrada y la salida del día (antes "Fuera de horario" en blanco), y una salida
  olvidada de un turno anterior ya no bloquea la entrada de hoy ni se cierra con la hora de hoy (queda como salida olvidada para Admin);
  (2) `registrar_asistencia_manual` (NUEVA, solo Admin, motivo obligatorio, idempotente) — captura la asistencia de quien trabajó y no
  pudo marcar; queda como corregida, en `asistencia_correcciones` y en auditoría; cuenta para el bono; (3) `asistencia_generar_avisos` —
  el aviso "antes de tu entrada" también para turnos que empiezan a medianoche, y nada a un usuario dado de baja;
  (4) `nomina_asistencia_semana` — no cuenta faltas de turnos que la persona no podía marcar (sin usuario ligado o centro inactivo);
  (5) `cerrar_ruta_financiero` — rechaza una orden que ya es de OTRA ruta (22023).
- **Facturación (Netlify `billing-create-invoice`):** el servidor ya NO cambia de receptor en silencio. Cliente con RFC propio y datos
  incompletos (régimen ausente o 616, CP fiscal, uso de CFDI inválido) → 422 `DATOS_FISCALES_INCOMPLETOS` antes del proveedor; RFC
  rechazado por el SAT → 422 `RFC_RECHAZADO` (una sola llamada; antes reintentaba solo a público en general); si no se pudo leer al
  cliente no se timbra. Público en general solo si el cliente no tiene RFC propio o el operador lo elige (`publicoGeneral: true`; la
  pantalla pregunta). Receptor genérico con el CP del lugar de expedición; mes y año de la factura global en la zona del negocio.
- **Clientes:** régimen y uso por omisión según el RFC (moral 601, física 612, sin RFC 616 + S01; antes 616 + G03 para todos); se quitó
  "P01"; CP fiscal (`clientes.cp`) separado del de entrega (`codigo_postal`, que antes no se guardaba); ya no se inventa "34000". Al dar
  de alta un cliente con RFC propio se exigen régimen y CP fiscal; al editar uno existente solo se avisa.
- **Ventas:** Admin también puede marcar "Facturar" (antes sus ventas nunca llegaban a Pendientes de timbrar). Vista previa de factura
  con el receptor real, sin datos fijos.
- **Usuarios:** un usuario dado de baja no entra (ni con sesión guardada); crear usuario y restablecer contraseña dejan rastro en
  `auditoria` (`_lib/rastro.js`; nunca la contraseña).
- **Avisos:** al cerrar sesión el aparato se desliga de quien sale y al entrar se liga a quien entra (teléfono compartido).
- **Validación:** suite `136_correcciones_tanda3_test.sql` (24) + re-corridas en verde tras 136: 116, 131, 130, 135, 112, 119, 086, 087,
  110, 128 (base local con migraciones hasta 136; sin el ensayo completo, por decisión del dueño mientras no hay operación real);
  `src/__tests__/tanda3Arreglos.test.js`; Vitest 1,682 en 4 zonas; lint, typecheck, build, `diff --check`.
- **Comportamiento que cambia a propósito:** una factura cuyo RFC rechaza el SAT ya no sale sola a público en general (pruebas de
  OL-03B actualizadas); la suite 135 liga un usuario a su empleado de prueba (desde 136 solo se cuentan faltas a quien puede marcar).
- **Pendiente de esta revisión (no programado):** cola offline del chofer tras 5 intentos fallidos; estatus "Completada" al editar ruta;
  popups del mapa; estados de revisión de `payment_intents`; forma de pago 99 en pagos por link (contador); motivo 01 de cancelación.
- Reversión: encabezado de 136; Netlify al commit anterior (`821f7b9`).

## Tanda 2 de correcciones de la revisión profunda — 2026-10-10 — DEPLOYED / TECHNICALLY VERIFIED (sin migración)
**Frontend y `billing-pay` `821f7b9` DEPLOYED (push autorizado por el dueño; Netlify `6aca84f055f2640008307847`, ready 2026-10-10T18:33:52Z); bundle
vivo verificado; `/pagar/<inexistente>` responde 404.** Solo frontend y una función de Netlify.
- **Ventas:** "Cancelar orden" de una Asignada ahora cancela (el contrato `cancelar_orden_asignada` solo desasigna; faltaba el segundo paso
  Creada → Cancelada; comprobado contra las guardas en la base local); renglones del mismo SKU se juntan antes de enviar; referencia de
  pago repetida con mensaje claro y el campo pide la referencia completa; editar exige fecha.
- **Permisos:** `requireRol` del store reconoce los accesos adicionales (120), como `fin_actor_permitido`; los vendedores ven todo el
  catálogo de clientes (sus órdenes y pagos siguen recortados). El recorte de clientes era un defecto, no una regla del dueño (F-04 sigue
  siendo el MÓDULO de Clientes para Ventas).
- **Cobros / finanzas:** Por cobrar solo dice "Cobro registrado" si el servidor aceptó; exportación de Movimientos con los datos correctos;
  `/pagar/:id` (billing-pay) solo redirige si la venta sigue cobrable y el importe del link es lo pendiente (antes un link viejo cobraba
  un importe que el sistema no registraba).
- **Rutas / producción / inicio:** el cierre del chofer traduce "Transferencia SPEI" / "Tarjeta (terminal)" / "Crédito (fiado)"; "Qué
  necesitas producir" resta solo rutas Programada y Pendiente firma; "Hecho hoy" usa el día de negocio.
- **Carga de datos:** `clientes`, `sucursales` y `orden_lineas` se leen por páginas de 1,000 (tope de la API); `ordenes` trae `rutaId`.
- **Descartado tras verificar:** "editar el monto de una CxP no hace nada" (el campo solo existe al crear).
- **Validación:** `src/__tests__/tanda2Arreglos.test.js`; Vitest 1,654 en 4 zonas; lint, typecheck, build.

## Revisión profunda con agentes (2026-10-10) y tanda 1 de correcciones (mig 135) — DEPLOYED / TECHNICALLY VERIFIED
**Auditoría de solo lectura** de ventas, rutas y chofer, producción y almacén, cobros, facturación, nómina, asistencia, permisos y el
frontend compartido: ~45 hallazgos, ningún daño en datos (aún sin operación real). Se corrigen en tres tandas. **Tanda 1 en producción:** frontend `ddea3f2` (Netlify `6aca7b37f6bb2a00088ad869`, ready
2026-10-10T17:52:22Z; bundle vivo verificado) y 135 aplicada por el dueño en el SQL Editor (SHA-256 `d8aad35f9a9602da43650b3061ff613116932f2579b02f5dd86b38fea27cc0ec`),
verificada en solo lectura: md5 de `nomina_comision_linea`, `nomina_proponer_recibo` y `completar_venta_directa` (`2107586c…`) y la policy
`evidencias_read` idénticos a la base local; sin cambio `crear_orden`, `pagar_nomina`, `aplicar_conceptos_nomina`. Sin cierre del dueño.
- **Tanda 1 (este cambio).** Servidor, 135: (a) comisiones — lo entregado en OTRA semana en borrador ya no se lo lleva la semana nueva;
  (b) recalcular — si lo ganado baja, el descuento se recorta a lo disponible en vez de abortar la semana por neto negativo, y un renglón
  que fue automático se recalcula al quitarle la regla; (c) `completar_venta_directa` bloquea bolsa → cuarto (como Producción; evitaba un
  posible deadlock); (d) `orden_evidencias` la leen Admin o quien subió. Frontend: Chofer — ruta activa por `rutaActivaDelChofer` (la ya
  empezada manda aunque cambie el día o le creen otra; una Programada se ve desde su fecha), el estado en memoria se reinicia al cambiar
  de ruta (antes las entregas y ventas exprés de una ruta se enviaban en el cierre de otra), crédito validado ANTES de marcar la entrega,
  venta exprés sin "link de pago" y con crédito validado, importe = total registrado de la venta (precio por sucursal), el segundo envío
  del cierre financiero reutiliza las entregas del primero, las fotos sobreviven al refresco y se reintentan al minuto; Rutas — las
  órdenes traen `rutaId` (toda ruta decía "0 órdenes"), editar conserva carga autorizada y extra; resumen del cierre — manda cómo se
  cobró; Nómina — Pagar recalcula también con conceptos automáticos creados después; Facturación — "Ver PDF" abre la pestaña en el toque.
- **Validación local:** runner completo hasta 134 en verde sobre el `main` actual (primera corrida completa con 127–134; la única falla fue
  una re-corrida de la suite 072 que yo había añadido y que no es re-corrible tras 103/106: quitada). 135 ×2; suite
  `135_correcciones_tanda1_test.sql` (10); tras 135: 100, 109, 115, 128, 129, 130, 133, 134 OK. Vitest 1,642 en 4 zonas; lint, typecheck, build.
- **Pendiente (tandas 2 y 3, PROPOSED):** "Cancelar orden" de una Asignada no cancela; accesos adicionales bloqueados en el cliente
  (`requireRol` solo ve el rol principal); Ventas solo ve clientes a los que ya vendió; "Cobro registrado" aunque falle; Dashboard "Hecho
  hoy" en 0; exportación de Movimientos vacía; "Qué necesitas producir" resta dos veces la carga en ruta; editar monto de CxP no hace nada;
  link de pago viejo cobrado sin registro; `cerrar_ruta_financiero` no comprueba que la orden sea de la ruta; timbrado que cae a público
  en general sin avisar; clientes con régimen 616 / uso G03 por omisión; CP fiscal = CP de entrega; suscripción push que sobrevive al
  cierre de sesión; reloj checador (día "fuera de horario" tras la salida, entrada perdida sin corrección); usuario Inactivo entra;
  alta de usuario y restablecer contraseña sin rastro; lecturas sin paginar (`orden_lineas`).

## Factura oficial: enviar por correo y ver / descargar PDF y XML — 2026-10-10 — DEPLOYED / TECHNICALLY VERIFIED (sin migración)
**Frontend y funciones `7307240` DEPLOYED (push autorizado por el dueño; Netlify `6ac9e2d50d227c0008b14651`, ready 2026-10-10T07:02:19Z); bundle vivo
verificado y las dos funciones responden 401 sin sesión. Un envío o descarga real NO está verificado.** Pedido del dueño: que la factura se mande por correo y se pueda ver, como en su otro sistema.
- **Netlify (2 funciones nuevas; Functions 19 → 21):** `billing-send-invoice` (POST `{ordenId, email?}`: Facturama envía el CFDI vigente al correo
  escrito o al del cliente; éxito solo con 2xx Y `success === true`; bitácora en `invoice_attempts` con provider `facturama-email`) y
  `billing-download-invoice` (POST `{ordenId, formato: pdf|xml}` → `{filename, contentType, base64}`; también de un CFDI cancelado). Misma
  autorización que timbrar y cancelar (`facturacionGuard`: Admin y Facturación toda la empresa; Ventas solo SUS órdenes), evaluada antes del
  proveedor. No cambian orden, CFDI, pagos ni inventario.
- **Frontend:** en Facturación, cada factura timbrada tiene "Ver PDF", "XML" y "Enviar por correo" (correo del cliente precargado, editable
  solo para ese envío). La "Vista previa" anterior al timbrado no cambia.
- **Validación:** `src/__tests__/facturaDocumento.test.js` (handlers con base en memoria y proveedor falso); Vitest 1,624 en 4 zonas; lint,
  typecheck, build. Rutas del sandbox comprobadas sin credenciales (401 = existen; una ruta inventada da 404).
- **No verificable desde aquí:** un envío o descarga real (las credenciales viven en Netlify); se prueba con la primera factura del sandbox.
- **Datos de la empresa (2026-10-10, SQL del dueño, verificado en solo lectura):** razón social `FABRICA DE PRODUCTOS DE HIELO`, régimen `601`,
  domicilio según la Constancia de Situación Fiscal; datos bancarios BBVA (CLABE validada). La nota pública muestra ahora la razón social.

## Evidencias de la venta: fotos del Chofer en el sistema (mig 134) — 2026-10-10 — DEPLOYED / TECHNICALLY VERIFIED
**Frontend `e9f554b` DEPLOYED (push autorizado por el dueño; Netlify `6ac9dd2e4c12830008654351`, ready 2026-10-10T06:38:10Z); bundle vivo verificado
(`registrar_evidencia_orden`, "Fotos de la venta", `orden_evidencias`). Sin cierre del dueño; la subida desde un teléfono en ruta NO está verificada.**
**134 aplicada por el dueño en el SQL Editor (2026-10-10; SHA-256 `70e4aeb2dbb4c653e81efe94edce3b4b0a3d7229f02eb997aee1509196a54a0d`) y verificada en solo
lectura: md5 y permisos de `registrar_evidencia_orden` (`937fb9f2…`), `erp_foto_merma_en_uso` (`34c27b00…`) y la guarda, RLS, policy, grants, CHECK,
llaves y trigger de `orden_evidencias` idénticos a la base local (la única diferencia es que Postgres 18 local lista los NOT NULL como
constraints); 0 evidencias.** Cierra el hallazgo de la fase anterior: la foto del comprobante de
transferencia y la de la entrega se quedaban en el teléfono del Chofer.
- **134 (aditiva):** `orden_evidencias` (tipo `comprobante_pago` / `entrega`, ruta en el bucket privado `mermas`, referencia, quién la subió;
  inmutable, sin DML por API; lectura Admin y Facturación o quien la subió) y `registrar_evidencia_orden` (Admin cualquier orden, Ventas las
  suyas, Chofer las de su ruta; exige archivo existente en `<uid>/ordenes/<orden>/`; idempotente por ruta). `erp_foto_merma_en_uso` (119)
  ahora también protege estas fotos del borrado (la policy de borrado del bucket la consulta; md5 antes `06f7fa1d…`). No toca orden, pagos ni CxC.
- **Frontend:** el Chofer sube las fotos solo en cuanto hay señal (al entregar, al reconectar y al reabrir la app) y ve si ya quedaron
  guardadas; Admin las ve en el detalle de la venta (Órdenes). Almacenamiento verificado en producción (solo lectura): bucket `mermas`
  privado, 5 MB, JPEG/PNG/WebP/HEIC, con las 3 policies de 072.
- **Validación local:** 134 ×2; suite `134_evidencias_orden_test.sql` (19); 117 y 119 OK tras 134. Vitest 1,609 en 4 zonas; lint, typecheck, build.
- **No incluye:** adjuntar comprobante desde Ventas / Admin al cobrar (el contrato ya lo permite; falta la pantalla); fotos de la venta
  exprés (no tiene orden hasta el cierre); fotos de entregas anteriores a este cambio (ya no están en los teléfonos).
- **No verificable sin operación real:** la subida desde un teléfono en ruta.

## Arreglos de campo (2026-10-09): venta de barra contra la barra entera (133), datos bancarios (132) y correcciones de Chofer/Rutas — DEPLOYED / TECHNICALLY VERIFIED
**Frontend `67a63fc` DEPLOYED (push autorizado por el dueño; Netlify `6ac9d96d8f025200089f111e`, ready 2026-10-10T06:22:10Z); bundle vivo verificado
(52 archivos js: "Enviar ticket por WhatsApp", "Datos para transferencias", "Abrir cámara", `ocultar-mapa-pedidos`, "No hay barra suficiente");
`/nota/1?t=x` responde 403 (firma inválida) en vez del 400 anterior: el id ya llega por la ruta. Sin cierre del dueño.** 132 y 133 aplicadas por el dueño en el SQL Editor (2026-10-10, un solo pegado; SHA-256 de 132 `88fa96f5a6ce444e7b5efb9b960ffc30b3362336075bec06525d9cdee26374c5`,
de 133 `354ed14588f0829ed56bd834d0934114b0f42c19f3120be58261fd8c1e9c2c3d`) y verificadas en solo lectura: md5, EXECUTE y SECURITY DEFINER de
`crear_orden` (`55716866…`), `completar_venta_directa` (`87acbd90…`), `barra_exigir_disponible`, `barra_surtir_cuarto` y la guarda bancaria,
columnas, CHECK y triggers de `configuracion_empresa` IDÉNTICOS a la base local que pasó las suites; sin cambio: `partir_barra`,
`registrar_preparacion_barra`, `registrar_preparacion_media`, `confirmar_carga_ruta`, `update_orden_atomic`.** Lista reportada por el dueño (por medio de David).
- **133 — cambio de criterio del dueño (sustituye "Ventas no prepara" de 129):** vender media barra, picada o triturada depende SOLO de
  que haya barra entera. Regla única `barra_exigir_disponible` (1 barra = 2 medias; 1 media = 1 bolsa; lo ya partido o preparado se usa
  primero). `crear_orden` (123) la aplica sobre toda la planta; `completar_venta_directa` (120) por cuarto y, dentro de la misma
  transacción, parte / prepara lo que falte en ese cuarto con los contratos de Producción (`partir_barra`,
  `registrar_preparacion_barra`, `registrar_preparacion_media`): mismas filas de producción, kardex y consumo de empaque; sin bolsas
  la entrega falla completa. Mismas firmas, respuestas y permisos. NO cambia la carga de ruta (`confirmar_carga_ruta`: al camión se
  sube lo ya preparado por Producción) ni `update_orden_atomic`. Producción antes de 133 (solo lectura): md5 de `crear_orden`
  `a090f0c6…` y `completar_venta_directa` `63eaffba…` = base local.
- **132:** `configuracion_empresa.banco / clabe / beneficiario / cuenta_bancaria`; por API solo el Dueño los cambia (trigger); CHECK de
  CLABE de 18 números; el cambio queda en `bitacora_cambios`. Pantallas: Ajustes → Datos para transferencias; "Enviar por WhatsApp" en el
  cobro por transferencia de Chofer, Ventas y Admin.
- **Sin migración (Netlify + frontend):** el link público `/nota/:id?t=` respondía 400 (el id ahora se toma de la ruta); Chofer: ticket
  para WhatsApp al terminar cada entrega (con el motivo si falla) y mapa de la parada dentro de la app; resumen económico del cierre
  de ruta calculado de las órdenes entregadas (`rutas.total_cobrado` / `total_credito` no se escriben desde 087: salía $0); la hoja de
  firma de carga va en un portal con alto máximo (la barra inferior tapaba Confirmar); el mapa de pedidos de Rutas trae su botón
  para ocultarlo y ya no se encima; foto de evidencia con "Abrir cámara" o "Elegir foto" en las 5 capturas.
- **Validación local (sin corrida completa del runner, por decisión del usuario):** 132 y 133 ×2; suites `133_venta_barra_desde_entera_test.sql`
  (18) y `132_datos_bancarios_test.sql` (5); re-corridas tras 133: 109, 110, 115, 120, 123, 129 OK. Vitest 1,603; lint, typecheck, build.
- **Hallazgo sin resolver:** la foto del comprobante de transferencia y la foto de entrega del Chofer NUNCA se suben al servidor (quedan
  en el teléfono); Ventas y Admin no tienen dónde adjuntar comprobante. Requiere almacenamiento y contrato nuevos (PROPOSED).

## Nómina automática (NOM-2, mig 130) y avisos de asistencia (PD-01.1, mig 131) — 2026-10-09 — DEPLOYED / TECHNICALLY VERIFIED
**130 y 131 aplicadas por el dueño en el SQL Editor (2026-10-10 ~02:23Z, un solo pegado; SHA-256 de 130
`544cbf1e018ff045272f21ed39b50b1c7b73e9c55b9bf44eb396c67399120b5b`, de 131 `3a7de3cc3ab80184a22ebb08e16da598e0ecfb0f3366f67bd25ecdcad1f95056`)
y verificadas en solo lectura:** md5 de las 28 funciones `*nomina*` / `*avisos*`, sus EXECUTE, los CHECK de `nomina_conceptos`, RLS, policies y
grants de las 3 tablas nuevas IDÉNTICOS a la base local que pasó las suites; `asistencia_avisos_config` con los valores por omisión;
0 conceptos, 0 periodos, 0 renglones, 0 avisos. Frontend `74a4569` DEPLOYED (push autorizado por el dueño; Netlify
`6ac9a22e4509ac000855e631`, ready 2026-10-10T02:26:27Z); bundle vivo verificado (50 archivos js: `guardar_avisos_asistencia`, `regla_asistencia`,
`porcentaje_ventas`, "Actualizar cálculos"); Netlify Functions 19 con `cron-avisos-asistencia`. Sin cierre del dueño. La entrega real del
push en teléfonos NO está verificada. Pedido del dueño (por medio de David,
2026-10-09): avisos, comisiones y bono "lo más pro, siempre modificable"; diseño delegado.
- **130 (aditiva):** comisiones calculadas con lo ENTREGADO (% del importe, $ por bolsa, $ por entrega; como vendedor, chofer o ayudante;
  opcional por producto), tabla `nomina_linea_ordenes` (una orden se comisiona una sola vez por concepto y persona), percepciones
  condicionadas a la asistencia de la semana (retardos y faltas permitidos), `nomina_recibo_lineas.detalle` y recálculo del borrador
  en `aplicar_conceptos_nomina` (respeta lo editado a mano). No redefine `generar_recibos_nomina`, `guardar_recibo_nomina`,
  `editar_recibo_nomina`, `pagar_nomina` ni `nomina_recalcular_recibo` (la suite lo comprueba por md5). Tarjeta: `docs/sistema/nomina.md`.
- **131 (aditiva):** `asistencia_avisos_config` (una fila; nace encendida), `asistencia_avisos` (uno por tipo, persona, turno y día),
  `asistencia_generar_avisos` (solo service_role) y contratos de Admin `avisos_asistencia` / `guardar_avisos_asistencia`. No escribe
  asistencias. Netlify: función programada nueva `cron-avisos-asistencia` (cada 5 min; Functions 18 → 19) y `cron-push` ahora manda las
  notificaciones del negocio solo a Admin y Facturación (antes a TODO dispositivo suscrito).
- **Frontend:** Nómina → Conceptos (formas de cálculo, "qué cuenta", productos, condición de asistencia), explicación en cada renglón,
  "Actualizar cálculos" y recálculo automático al tocar Pagar; Asistencia → Avisos (Admin); botón de avisos en "Mi asistencia" (todos).
- **Validación local (2026-10-09; sin corrida completa del runner, por decisión del usuario mientras no haya operación real):** 130 y 131
  aplicadas ×2 sobre la base local con 123–129; suites `130_nomina_automatica_test.sql` (39) y `131_avisos_asistencia_test.sql` (21) OK;
  re-corridas tras ambas: 100, 116, 117, 119, 120, 128 OK. Vitest 1,577 en UTC / Mazatlán / CDMX / Madrid; lint, typecheck y build limpios;
  capturas WebKit iPhone 14 de las pantallas nuevas. Fases integradas al runner (sin ejecutar completo).
- **Activación:** 1) aplicar 130 y 131 (compatibles con el frontend desplegado) ✔ → 2) verificación de solo
  lectura ✔ → 3) push del frontend ✔ → 4) bundle vivo y función programada en Netlify.
- **No verificable sin operación real:** la entrega del push en teléfonos (iPhone exige la app en la pantalla de inicio) y que las
  variables VAPID estén vigentes en Netlify (producción tiene 2 suscripciones registradas).

## Conceptos de nómina (NOM-1, mig 128) — 2026-10-09 — DEPLOYED / TECHNICALLY VERIFIED
**Migración 128 aplicada por el dueño en el SQL Editor (2026-10-10, antes de 01:32Z; SHA-256
`c2c814012aaad9b5f1d2692be5a1b109ede0fc58f243ed7b96061eef760594d5`) y verificada en solo lectura a las 01:32Z:** tablas
`nomina_conceptos`, `nomina_concepto_empleados` y `nomina_recibo_lineas` (RLS activa, policy `admin_read` = `erp_rol_activo() = 'Admin'`,
authenticated solo SELECT, anon nada, 0 filas); md5 de las 20 funciones `*nomina*` de producción IDÉNTICOS a la base local que pasó las
suites (entre ellas `guardar_concepto_nomina` `81a069c27d74bfc7ed1bb7247e5c4df9`, `guardar_recibo_nomina`
`bd8d67c86c3b2caced7191207bc191cc`, `aplicar_conceptos_nomina` `897b3ddcb3debc220b98a8c9b66f4e28`, `generar_recibos_nomina`
`ab1723f5b1d0c63082469ad31e73588b`, `editar_recibo_nomina` `ff72121e92018ceea6aade9ed5ec6a12`); sin cambio: `pagar_nomina`
`c4504312dd00137c00d570e4bb66ed1d`, `nomina_recalcular_periodo`, `nomina_recibos_guard`, `nomina_periodos_guard`. 0 periodos y 0 recibos
antes y después. Conteos a esa hora (incluyen fases de otras sesiones): 196 funciones · 91 policies · 54 tablas. Frontend `f9b5607` DEPLOYED (push autorizado por el dueño; Netlify
`6ac9962f5490440008be2f6e`, ready 2026-10-10T01:35:12Z, `commit_ref` = `f9b5607`); bundle vivo verificado (50 archivos js):
`guardar_recibo_nomina`, `guardar_concepto_nomina`, `aplicar_conceptos_nomina`, `nomina_acumulados`, 1 archivo cada una. Sin cierre
del dueño registrado. Sin corrida completa del runner sobre la base con 127 y 129 (fase validada con sus suites 128 y 100 directas). Tarjeta: `docs/sistema/nomina.md`.
- **Pedido del dueño:** que Admin dé de alta los bonos, comisiones y descuentos y a quién aplican (ejemplo: puntualidad $200 por
  semana), en vez de teclearlos persona por persona cada semana. Diseño delegado ("que quede lo mejor posible").
- **Qué agrega:** catálogo `nomina_conceptos` (monto fijo o % del salario diario; todos / un área / personas; monto propio y tope
  por persona), desglose `nomina_recibo_lineas` (foto por renglón) y los contratos `guardar_concepto_nomina`,
  `guardar_recibo_nomina`, `aplicar_conceptos_nomina`, `nomina_acumulados`; `generar_recibos_nomina` propone los conceptos al crear.
- **Qué NO cambia (md5 idénticos a producción antes y después):** `pagar_nomina`, `nomina_recalcular_periodo`, las guardas y los
  20 constraints de 100. Las casillas del recibo pasan a ser la suma de sus renglones; `editar_recibo_nomina` conserva firma y respuesta.
- **Producción antes de 128 (solo lectura, 2026-10-09):** 0 periodos y 0 recibos (tras la limpieza de datos del dueño); md5 de
  `generar_recibos_nomina` `f829cbdd…` y `editar_recibo_nomina` `7a4bbab5…` = base local (paridad en el runner).
- **Activación:** 1) aplicar 128 (aditiva, compatible con el frontend desplegado) ✔ → 2) verificación de
  solo lectura ✔ → 3) push del frontend ✔ → 4) bundle vivo ✔. Sin migración de contención: las tablas nuevas nacen sin DML por API.
- **No incluye:** comisiones calculadas con ventas, puntualidad automática con el reloj checador, reverso de un periodo pagado,
  recibo imprimible.

## Alta de cliente por el chofer (127) y media barra (129) — 2026-10-10 — MIGRATIONS APPLIED TO PRODUCTION / VALIDATED LOCALLY / FRONTEND PUSHED
**127 y 129 aplicadas por el dueño en el SQL Editor (2026-10-10); frontend en `main` (127: `6628b8e`; venta de barra: `c4e2389`;
129: `482a697`). Gate local: suites 127 (22) y 129 (31) en verde, y 115, 106, 092 y 093 en verde con 129 aplicada. Verificación en
producción de solo lectura: producto `HIB-25K` ($60, sin empaque, stock 0) presente; permisos de las funciones de 129 pendientes de
pegar por el dueño. Falta la prueba real del desglose y del alta de cliente por el chofer tras el deploy.**
- **127 `crear_cliente_chofer(p_datos)`:** solo Chofer activo (o service_role / contexto de contrato); exige nombre, RFC nominativo
  (12–13 caracteres, no XAXX/XEXX), régimen SAT de 3 dígitos, uso de CFDI, CP de 5 dígitos y correo; el cliente nace Activo, sin saldo ni
  crédito; idempotente por RFC (devuelve el existente sin modificarlo); auditado. Sin escritura REST nueva: el Chofer sigue sin INSERT/UPDATE
  en `clientes`. Pantalla: "Registrar cliente nuevo" en la venta rápida con factura. Reversión: DROP FUNCTION (los clientes se conservan).
- **Venta de barra (frontend, sin migración):** Nueva venta captura "Barra entera / Media barra" y la entrega (sin preparar, picada o
  triturada); HIP y HIT ya no se ofrecen como productos sueltos y su stock se ve junto a la elección. Las líneas siguen por SKU: entera
  picada o triturada = 2 bolsas ($60 c/u), media = 1 bolsa; el chofer nunca prepara. "Nueva venta" tiene canal A domicilio / Mostrador
  (Mostrador abre el cobro al crear; sin la calculadora de cambio). No se tocaron `completar_venta_directa` ni `crear_orden`.
- **129 media barra:** producto `HIB-25K` ($60, Producto Terminado, sin empaque; el stock vive en `cuartos_frios.stock`);
  `partir_barra(op, cuarto, barras)` (Admin / Producción; barra −N, media +2N, fila `produccion` tipo `Partido`, sin costo);
  `revertir_partir_barra` (solo Admin; falla si las medias ya se vendieron o prepararon); `registrar_preparacion_media(op, salida, cuarto,
  medias)` (media → 1 bolsa de picada o triturada, consume 1 empaque; fila `Preparacion` con `input_sku = HIB-25K`, reversible con
  `revertir_preparacion_barra` de 115; la conciliación de empaque la cuenta sin cambios); `registrar_produccion` rechaza `HIB-25K`.
  Decisión del dueño: **Producción decide** qué queda de cada mitad (media barra, picada o triturada) al desglosar; Ventas no prepara.
  Pantalla: Producción → Preparar → "Desglosar barra". Las filas `Partido` y `Preparacion` no cuentan como "producido hoy".
- **Residuales:** "Editar venta" y la venta rápida del chofer siguen listando HIP/HIT/HIB tal cual; el desglose son varias llamadas
  atómicas e idempotentes (si una falla a medias, reintentar con los mismos ids continúa); no hay aviso a Producción de pedidos que
  necesitan preparación; `registrar_preparacion_barra` (115, barra entera → 2 bolsas iguales) no cambia.
- **Numeración:** 128 es nómina (otra sesión); 127 y 129 son de esta fase.

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
| HEC-25K | Hielo en Cubos para Enfriamiento 25 kg (nuevo) | $72 | EMP-25-SL (sin logo, desde 2026-10-09) | 0 |
| HIB-50K | Barra de Hielo ~50 kg | $120 | ninguno (por diseño) | 0 |
| HIP-25K | Picada de Barra ~25 kg | $60 | EMP-25-SL (sin logo, desde 2026-10-09) | 0 |
| HIT-25K | Triturada de Barra ~25 kg | $60 | EMP-25-SL (sin logo, desde 2026-10-09) | 0 |

- **Bolsas de 25 kg con logo / sin logo (2026-10-09, SQL aplicado por el dueño en Supabase, auditoría id 734):**
  `EMP-25` = "Bolsa 25 kg con logo" (consumo: HPC-25K, HPT-25K; 9,800 @ 2 sin cambio, siguen sin verificar);
  `EMP-25-SL` = "Bolsa 25 kg sin logo" nueva (nace 0 @ 0, Apertura 0) para HEC-25K enfriamiento, HIP-25K picada y
  HIT-25K triturada de barra. Sin código ni migración: producción y "Preparar barra" ya descuentan el empaque
  configurado en el producto y lo guardan en cada registro. Verificado en solo lectura: solo cambiaron esos productos,
  la secuencia/auditoría y el nuevo historial de apertura; `error_log` 192. **Pendiente del dueño:** recepción de compra
  real de `EMP-25-SL` (sin ella no se produce enfriamiento ni se prepara barra) y conteo de apertura de `EMP-25`.
  Bolsas de 5/20 kg con o sin logo: mismo mecanismo cuando se definan (20 kg requiere productos nuevos).
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
**PD-02 (calendario):** implementado y activo (ver abajo). OL y CLOSURE-1: CLOSED.

## Superficie de API del Empleado (WF-0.2, mig 119) — 2026-10-07 — CLOSED PROD
- Contrato del rol: sesión, perfil propio, Mi asistencia y Mis actividades. Nada más, en la base de datos.
- Residuales verificados (reproducidos en el runner antes de 119): INSERT directo en `auditoria` y `notificaciones`,
  UPDATE de `notificaciones`, subir/leer/borrar en su carpeta del bucket `mermas`, y 4 helpers sí/no de historia
  (`cuarto_tiene_historia`, `empaque_tiene_dependencias`, `b4_ruta_con_historia`, `erp_foto_merma_en_uso`).
- Cierre: `erp_es_activo()` = activo y rol ≠ Empleado (sus 6 consumidores son esas policies, 3 de `storage.objects`
  que una migración no puede alterar; el texto de las policies no cambia y los demás roles no cambian); los 4 helpers
  llaman a `erp_exigir_no_empleado()` (42501 solo para el Empleado; conservan su EXECUTE para los triggers de Admin).
- Superficie para el Empleado (87 funciones ejecutables por authenticated): A requeridas 6 (`mi_asistencia`,
  `registrar_entrada`, `registrar_salida`, `asistencia_empleado_actual`, `calendario`, `completar_ocurrencia`);
  B plataforma 22 (identidad propia que también evalúan las policies, fecha/zona de negocio y cálculo puro); C negocio
  58: todas rechazan al Empleado con 42501 (sondeo permanente en `119_cierre_api_empleado_test.sql`); 1 disparador de evento.
- La auditoría de los contratos (asistencia, calendario, también la del Empleado al completar) sigue igual.

## Calendario operativo (PD-02, mig 118) y aislamiento del Empleado (WF-0.1, mig 117) — 2026-10-07
**DEPLOYED / TECHNICALLY VERIFIED — ACTIVIDADES REALES PENDIENTES DEL DUEÑO (0 actividades en producción).**
- **WF-0.1:** las 24 policies de SELECT con `erp_es_activo()` usan `erp_lector_negocio()` (activo y rol ≠ `Empleado`).
  El Empleado ya no lee por API clientes, órdenes, pagos, CxC/CxP, inventario, producción, rutas, costos,
  configuración ni notificaciones (además de lo que ya era solo de Admin). Conserva su perfil, su asistencia y sus
  actividades. Para los demás roles la condición es idéntica (suite 117: cada rol ve exactamente el total).
- **Modelo:** `actividades` = plantilla versionada (trigger: la definición no se sobrescribe ni se borra);
  `actividad_ocurrencias` = solo lo que pasó (completada o editada; trigger: una completada es inmutable). Las
  ocurrencias se calculan al leer (`calendario(desde, hasta)`, máx. 1,100 días): no hay filas futuras ni procesos.
- **Recurrencia:** única, semanal, mensual, anual, con ventana (inicio → límite). Si el día límite es menor que el de
  inicio, termina en el periodo siguiente; la ocurrencia pertenece al periodo en que EMPIEZA (28 oct → 3 nov = octubre).
  Día inexistente → último día del mes (31 → 30/28; 29 feb → 28 en años no bisiestos).
- **Estado (servidor, `fin_hoy()` Mazatlán):** próxima / pendiente / vencida / completada; al completar se guardan la
  hora del servidor, la fecha de negocio, quién, notas y la clasificación anticipada / en_ventana / tardía.
- **Versiones:** "editar de aquí en adelante" cierra la versión y crea la sucesora a partir del periodo siguiente al
  último ya iniciado o completado (una sola ocurrencia por periodo); "editar solo esta" guarda la ventana nueva con la
  original y el motivo; "desactivar" deja de generar periodos futuros y conserva lo iniciado, vencido o completado.
  Una edición individual de un periodo futuro queda sin efecto si después se editan las futuras (la nueva versión manda).
- **Permisos:** crear/editar/desactivar solo Admin; el responsable (persona o rol) ve y completa lo suyo si
  `asignado_puede_completar`; `visibilidad = 'admin'` (pagos, administrativas) solo Admin, también por API; sin
  responsable = solo Admin. Completar no crea pagos ni movimientos ni toca máquinas, camiones o costos fijos.
- **UX:** Calendario (Admin, área Operación: Mes, Próximas, Vencidas, Completadas, detalle, completar, editar,
  desactivar); Mis actividades (Empleado como módulo; los demás roles con el botón del calendario en la cabecera; Chofer
  con "Actividades" en todos sus pasos); Dashboard: una tarjeta compacta (pendientes hoy / por vencer ≤ 3 días /
  vencidas); Bandeja: detector "actividades vencidas". Sin notificaciones.
- Suites: `117_aislamiento_lectura_empleado_test.sql` (25), `118_calendario_operativo_test.sql` (79) + concurrencia
  C118a/b en el runner; `src/__tests__/pd02Calendario.test.jsx`.
- Reversión (sin actividades): DROP de funciones, triggers y tablas de 118; 117: ALTER POLICY … USING
  (erp_es_activo()) en las 24 y DROP FUNCTION `erp_lector_negocio()` (reabre la lectura amplia del Empleado);
  Netlify a `b3c324f`. Con actividades: no borrar historia.

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
- Asistencia (tras PD-01): la superficie de API del Empleado quedó CERRADA (117 lectura, 119 escritura y helpers).
  Sigue abierta la lectura amplia de los demás roles operativos (`pagos.read_all` y similares: backlog de seguridad,
  fuera de WF). PD-02: una edición individual de un periodo futuro queda sin efecto si después se editan las futuras
  (limitación aceptada). Sin QA visual autenticada en
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
