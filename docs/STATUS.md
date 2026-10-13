# CUBOPOLAR — STATUS (única fuente del estado actual)

Actualizado: 2026-10-13 (Tiendas propias E1–E9, migs 143–150: SOLO LOCAL, sin desplegar; producción sigue en la 142 — ver su sección). Antes: 2026-10-09 (ZONA-1: zona del negocio = Durango, mig 122 aplicada y frontend `28a2024` desplegado; GER-1 activo; Santiago es Dueño). Lo actualizan los skills `activar-produccion`
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

## Tiendas propias (E1–E9, migs 143–150) — 2026-10-13 — CLOSED LOCAL · NO DESPLEGADO · producción sigue en la 142
**Nada de este programa está en producción.** Estado por columna (ningún estado implica el siguiente):

| Bloque | Qué es | Migración · SHA-256 | Commit local | CLOSED LOCAL | DEPLOYED PROD | VALIDATED PROD | PENDING FIELD VALIDATION |
|---|---|---|---|---|---|---|---|
| E1 | Establecimientos e interruptor global (apagado) | 143 · `afb100ab…46f7a0f` | `2083c93` | sí | no | no | sí |
| E2 | Las operaciones centrales usan solo inventario del CEDIS | 144 · `d050d977…e8a2b94` | `b2cc8bf` | sí | no | no | sí |
| E3 | Seguridad por establecimiento; perfil efectivo "Ventas Tienda" | 145 · `fd1dd9bb…81f61f10` | `fd7fef3` | sí | no | no | sí |
| E4 | POS: cajas, turnos, venta atómica, corrección y reembolso | 146 · `8e03f75e…c30ac496` | `dd8d5f2` | sí | no | no | sí |
| E5 | Interfaz del punto de venta; perfil de tienda en Netlify (`_lib/auth.js`) | sin migración | `15e3224` | sí | no | no | sí |
| E6 | Configuración y activación controlada de una tienda | 147 · `d80d50d5…853a9fcf` | `3a387e2` | sí | no | no | sí |
| E7 | Tiendas remotas y traspasos con tránsito | 148 · `ac60223c…e56e3537` | `4f2ceaa` | sí | no | no | sí |
| E8 | Reportes por establecimiento y consolidados | 149 · `a7492b55…44e2704` | `a8ad876` | sí | no | no | sí |
| E9 | Último cajero por disparador, conciliación de reembolsos, validación integrada | 150 · `4fdf8993…a95ad2af0` | sin commit (árbol de trabajo, rama `tiendas-e9-cierre-integral`) | implementado y verificado; commit pendiente de autorización | no | no | sí |

SHA-256 completos: 143 `afb100ab1c515dd10a6cda376405facd35935b26f4b18abce0ef1fd0c46f7a0f` · 144 `d050d9774cac88c2ab61a9c69cb569d234f1222ed46276480031ebf8de8a2b94` ·
145 `fd1dd9bbedba9d4f0b141f383e3c312d3787e73ae3552295a2106d5981f61f10` · 146 `8e03f75ee0bfa33693ec22c93d6c1c087353b9aa367d907192944c8bc30ac496` ·
147 `d80d50d5ff0b3d92ec92e42f150bd0d032297d3cb4cbc6b1090c3fb8853a9fcf` · 148 `ac60223c4507554af37f04eacea13dcbb0f373e98f6ae0e435407c4de56e3537` ·
149 `a7492b55f347d08c3e5b91aeb3a4582f08266bf6e6bc70a797b7fc6a844e2704` · 150 `4fdf8993459c3d0f1f50af693af92b4a2fb7056d184cb399d53efb5a95ad2af0`.

- **Decisiones cerradas (D-S1 a D-S10):** establecimientos como entidad; rutas solo desde el CEDIS; rol guardado Ventas + perfil efectivo "Ventas
  Tienda" por asignación; la tienda de fábrica vende del CEDIS solo con permiso explícito; sin descuentos; aislamiento por establecimiento;
  traspasos aparte de las rutas de clientes; cobro inmediato, sin CxC; varias cajas por tienda; el POS elige clientes elegibles con datos mínimos.
- **E9 (150, aditiva; `guardar_usuario` de 120 NO cambia, md5 `2b328684…`):** (1) dos disparadores sin exención de rol ni de sesión
  (`usuarios`: UPDATE de rol/estatus y DELETE; `usuario_establecimientos`: DELETE y cambio de llaves) impiden dejar una tienda ACTIVA sin cajero
  habilitado (22023, `ULTIMO_CAJERO`); la salida es asignar otro cajero o desactivar la tienda. (2) `reporte_reembolsos_tiendas` (solo lectura,
  Admin): egreso contable (día de la devolución) aparte del dinero entregado (día de la entrega), pendientes al corte e inconsistencias.
  (3) `GRANT EXECUTE` explícito de `erp_usuario_de_tienda` a `service_role` (Netlify). Frontend: conciliación de reembolsos en Tiendas →
  Reportes → Cajas; el aviso "cobro sin confirmar" ya no aparece mientras el cobro va en camino por primera vez.
- **Evidencia local:** gate local completo RESULTADO OK (2026-10-13): 150 ×2, suite `150_cierre_integral_tiendas_test.sql` (69), 65 suites re-corridas tras 150, concurrencia C150 (8: dos bajas simultáneas, baja contra retiro, baja contra activación, candados cruzados) y C144/C146/C147/C148, SEARCH_PATH 208/208, UNQUALIFIED_RESOLUTION PASS. La suite 146 se hizo consciente de 150 (un montaje quitaba por SQL directo al último cajero de una tienda activa). El ensayo de reversión de 069 se corrió aparte, al final (aplica; no conoce las dos policies `tienda_read` de 145 en `ordenes` y `pagos`, igual que en E8). Vitest 1,984 en UTC / Mazatlán / CDMX / Madrid; lint, typecheck, build y `diff --check` limpios. Navegador: `e2e/local/tiendas_bd_real.mjs` (28) y `e2e/local/pos_tienda_simulado.mjs` en verde.
- **Validación integrada — qué SÍ se probó:** los 15 pasos (alta de tienda de fábrica y remota, cajeros, permisos de inventario, cajas,
  activación, abastecimiento y recepción, turno, venta, cobro y reintento, cierre, devolución, reembolso, reportes, desactivación) en la suite
  150 con los contratos reales; y en un navegador (Chromium) contra la base LOCAL real a través de PostgREST (`e2e/local/tiendas_bd_real.mjs`):
  cajera (recepción, turno, venta, respuesta perdida y reintento, cierre a ciegas) y Administración (Reportes), con RLS y errores reales.
- **Qué NO se probó (PENDING FIELD VALIDATION):** inicio de sesión real (Supabase Auth; en local se simula el token); Netlify Functions
  desplegadas con el perfil de tienda (solo pruebas con base en memoria); realtime; pantallas de configuración de tienda, corrección de venta y
  confirmación de reembolso en navegador contra base real (probadas por API real y por render); aparatos reales (teléfono / tableta de caja,
  impresión); nada contra producción.
- **Plan de despliegue (cada paso con autorización INDEPENDIENTE del dueño; ninguno ejecutado):**
  1. Precondiciones de solo lectura en producción: md5 de los contratos que 144–150 comprueban o redefinen (`erp_actor`, `erp_roles_activos`,
     `erp_lector_negocio`, `erp_es_activo`, `erp_exigir_no_empleado`, `completar_venta_directa`, `guardar_usuario`, `registrar_devolucion`) iguales a
     la base local; fotografía de `catalogo_huella.sql` y `estado_negocio.sql`.
  2. Migraciones 143 → 150, en orden, una vez cada una, con el SHA-256 de arriba; tras cada una, verificación de solo lectura (catálogo cambió
     exactamente en sus objetos; datos de negocio idénticos). Todas son compatibles con el frontend desplegado, que no las usa.
  3. Tras 145 y 150: funciones de identidad (md5 = base local) y que un usuario Ventas, Admin, Chofer, Producción y Empleado real conserven su
     perfil (`erp_actor`); `has_function_privilege('service_role', 'erp_usuario_de_tienda(bigint)', 'EXECUTE')` = true; anon sin nada.
  4. Interruptor global: `tiendas_activacion.habilitada` = false verificado ANTES de publicar el frontend (con él apagado el menú Tiendas no
     opera y ningún contrato de tienda acepta nada).
  5. Autorización aparte → push del frontend y Netlify; bundle vivo (`vender_en_tienda`, `reporte_reembolsos_tiendas`, `pos-tienda`); Netlify
     Functions responden; un usuario Ventas central sigue facturando y generando links (perfil efectivo sin tienda = Ventas).
  6. Autorización aparte → el dueño enciende el interruptor con SQL (no hay contrato que lo haga).
  7. Configuración de la PRIMERA tienda por Administración (Tiendas → Configuración): congelador, caja, cajero(s), permisos explícitos, clientes.
  8. Activación explícita de esa tienda (lista de verificación del servidor en verde).
  9. Prueba operativa supervisada con el dueño: un traspaso, un turno, una venta por cada forma de pago, una devolución, un cierre, y revisar
     Reportes. Es operación real, no datos de prueba.
  10. Contención / reversión: apagar el interruptor (SQL del dueño) detiene todos los contratos de tienda sin tocar lo central; desactivar la
      tienda con su motivo; Netlify al commit anterior. Las migraciones NO se retiran si ya hay ventas, turnos o traspasos de tienda (historia).
- **Condiciones obligatorias antes de activar una tienda real:** (a) 143–150 aplicadas y verificadas por huella; (b) frontend y Netlify
  publicados y verificados; (c) rol de servicio con EXECUTE sobre `erp_usuario_de_tienda`; (d) al menos DOS cajeros por tienda (con uno solo,
  su baja exige desactivar la tienda); (e) conteo físico del congelador de la tienda en cero o por traspaso recibido (nunca ajuste directo);
  (f) contador de acuerdo con que la devolución registra el egreso el día de la devolución aunque el dinero salga después; (g) prueba
  operativa supervisada aceptada por el dueño.
- **Residuales:** los reportes centrales históricos (`reporte_financiero`, caja) mezclan las ventas de tienda con las centrales y cuentan el
  egreso de una devolución el día en que se registra (no se tocaron: la separación y la conciliación están en los reportes nuevos); reintentar
  un cobro de resultado incierto lo reenvía (idempotente por operación); el despacho de traspasos es solo de Administración; un cajero con
  turno abierto se puede dar de baja (decisión: una baja urgente no espera un conteo) y su turno lo cierra Administración; retiro y baja
  simultáneos de la MISMA persona pueden terminar en un aborto limpio (40P01) que se reintenta; antes de iniciar sesión la aplicación hace
  su carga anónima de siempre (la base la rechaza).

## T5-D2 · Recuperación administrativa y cierre seguro de rutas (mig 142) — 2026-10-12 — CLOSED IN PRODUCTION (cierre técnico; validación operativa pendiente)
**Cierre técnico registrado conforme al documento del dueño "T5-D2 — FRONTEND PRODUCTION DEPLOY" (deploy y verificaciones en PASS).
142 aplicada por el dueño en el SQL Editor (2026-10-12, una vez; SHA-256
`3eb47a4b1470f56d02bc2fadc604a0a34367ab582f70701acf3ca651c85b7a31`) y verificada en solo lectura (POST-MIGRATION 142 VERIFICATION = PASS):
5 funciones con md5 IDÉNTICOS a la base local, SECURITY DEFINER, `search_path` fijo, sin anon ni PUBLIC (el helper interno sin EXECUTE
para authenticated); tablas `ruta_intervenciones` y `ruta_faltantes` con RLS, 0 policies, sin grants y 0 filas; catálogo: +5 funciones
(221 → 226), +2 tablas (60 → 62), +1 secuencia, 96 policies y NINGUNA otra diferencia; 17 contratos cerrados con su md5 (incluida la
sobrecarga antigua de 4 parámetros de `cerrar_ruta_financiero`, anterior a esta fase y sin tocar). Frontend DEPLOYED con autorización
APARTE: push `a1e3d34` (código = `37f7d12`, más documentación `62e4e83`, `4d25230`, `a1e3d34`); Netlify `6acd4fa26b5cc1863ad1d46d`, ready
2026-10-12T21:23:13Z, `commit_ref` = `a1e3d34`, sin error de build, 21 funciones. Bundle vivo (52 archivos js): `cerrar_ruta_admin`,
`iniciar_ruta_admin`, `conciliacion_ruta`, `ruta_cobros_pendientes`, "El camión NO salió", "El camión SÍ salió", "FALTANTE NO
JUSTIFICADO", "Links de pago pendientes", "Motivo de la intervención", "El efectivo todavía NO está conciliado", `links-pago-pendientes`,
"Entrega de la orden" / "No entrega de la orden" (revisión) presentes; "Cierre forzado por admin" y "Pídele al chofer que envíe su
reporte primero" en 0 archivos (el forzar por REST ya no existe en el cliente). Sitio, JS y CSS 200; funciones del servidor responden
(401 sin sesión). Datos de negocio IDÉNTICOS antes de 142, después de 142 y después del deploy (1 ruta Cerrada, 2 órdenes, 2 pagos $550,
0 CxC, kardex 31, 1 merma, 1 cierre financiero, 1 cierre de inventario, 0 cierres de caja, 0 ventas rápidas; `estado_negocio.sql`
idéntico); `error_log` máx 4, 0 en 24 h; 0 intervenciones y 0 faltantes. Sin operaciones de prueba en producción.**
**Validación operativa PENDIENTE (no verificable en solo lectura; nada de esto se probó con sesión real):** abrir "Cerrar ruta (admin)"
con sesión de Admin en una ruta real (conciliación, órdenes una por una, faltante, motivo), los casos "no salió" y "salió sin iniciar",
el aviso de links pendientes en la bandeja, la continuación del cierre del chofer con una marca financiera ajena y el aviso de revisión
de una entrega tardía en el teléfono.
**Gate local completo RESULTADO OK: 142 ×2, RLS_CHECK PASS, suite 142 (89), 16
suites re-corridas tras 142 (086, 087, 088, 090, 078, 096, 104, 109, 114, 119, 136–141), C142a–g (9 carreras), OP-03, SEARCH_PATH
154/154, UNQUALIFIED_RESOLUTION PASS. Vitest 1,851 en UTC / Mazatlán / CDMX / Madrid; lint, typecheck, build y `diff --check` limpios.**
Origen: auditoría T5-D2, "FINAL DESIGN VALIDATION REPORT" y documento "T5-D2 IMPLEMENTACIÓN LOCAL" (decisiones D2-1 a D2-6).
- **Defectos corregidos:** A) "Cerrar ruta (admin)" eran dos llamadas (marca financiera vacía y después inventario): si el conteo fallaba
  la marca quedaba y el chofer ya no podía cerrar; B) una ruta Cargada con el chofer ausente no tenía salida; C) con órdenes pendientes
  el cierre mandaba a un callejón y existía un "forzar" inalcanzable que escribía órdenes por REST; D) Admin cerraba sin ver dinero ni
  pendientes; E) entregas y no entregas sin señal quedaban varadas si Admin cerraba.
- **142 (SHA-256 `3eb47a4b1470f56d02bc2fadc604a0a34367ab582f70701acf3ca651c85b7a31`, 461 líneas; aditiva, sin datos):** tablas
  `ruta_intervenciones` y `ruta_faltantes` (RLS sin policies ni grants) y cinco funciones SECURITY DEFINER con `search_path` fijo, sin
  anon: `cerrar_ruta_admin(op, ruta, tipo, conteo, faltantes, motivo)` `d25f37e2…` · `iniciar_ruta_admin(op, ruta, motivo)` `1a3d9d25…`
  · `conciliacion_ruta(ruta)` `29f87a6f…` · `ruta_cobros_pendientes(ruta)` `db22ba66…` (Admin, o el Chofer de esa ruta) ·
  `ruta_cobros_pendientes_interno` `7079a15c…` (sin EXECUTE por API). md5 completos en el runner (`gate_t5d2.log`).
- **Cierre atómico:** candado de la ruta → reintento por operación y huella → estado → órdenes pendientes (rechazo; en "no salió" se
  liberan a Creada) → entregas sin registro financiero (rechazo; un link pendiente NO bloquea) → marca financiera (la existente se
  reutiliza; si no hay, `cerrar_ruta_financiero` con lista vacía DENTRO de la transacción) → faltante declarado = faltante real →
  `finalizar_inventario_ruta` → intervención y auditoría. Un fallo no deja nada (142-31, 142-53, 142-77; C142d/e/f).
- **Contratos existentes sin cambio (md5 = producción):** `cerrar_ruta_financiero`, `finalizar_inventario_ruta`, `registrar_merma`,
  `revertir_merma`, `registrar_no_entrega`, `diagnostico_ruta`, `entregar_orden_ruta`, `registrar_venta_rapida_ruta`, `crear_cxc_orden`,
  `registrar_pago_orden` y las guardas de 138/139.
- **B1 / B2:** "Cargada" = firma + producto fuera del cuarto; "En progreso" = solo un estatus (la tabla `rutas` no registra hora de
  salida). B1 (`tipo no_salio`): solo desde Cargada y sin operaciones; libera las órdenes a Creada, exige conteo, devuelve la carga y
  cierra; el paso por En progreso ocurre dentro de la transacción y no deja evento. B2 (`iniciar_ruta_admin`): Cargada → En progreso
  con motivo, registrado como intervención de Administración; la ruta sigue su flujo normal.
- **Faltante no justificado (D2-1):** cuadra el balance con una fila de `mermas` (sin egreso contable ni cambio de costo desde 106) y
  queda distinguido ESTRUCTURALMENTE por su fila en `ruta_faltantes` (motivo, Admin, hora, operación); debe coincidir exactamente con el
  faltante del conteo. No se puede revertir: nace en la transacción que cierra la ruta y `revertir_merma` (087, sin cambio) rechaza las
  mermas de una ruta cerrada (142-49/50).
- **Cobros pendientes (D2-2):** una entrega con link sin cobrar no bloquea, no se cobra ni se fía; queda en la conciliación, en la
  fotografía de la intervención y en el aviso de la bandeja de Admin hasta que el estado real cambie (webhook tardío sin duplicar:
  142-70; cobro por otro método con el contrato de 139 y la ruta cerrada: 142-71).
- **Frontend:** `conciliacionRutaLogic.js`, `CierreRutaAdminModal.jsx` (conciliación, órdenes una por una con su contrato, elección
  B1/B2, conteo, merma con causa o faltante reconocido, motivo obligatorio), `RutasView.jsx` (cierre disponible también en Cargada),
  `supaStore.js` (`cerrarRuta` = una llamada a `cerrar_ruta_admin`; se retiró el "forzar"; `iniciarRutaAdmin`, `conciliacionRuta`,
  `rutaCobrosPendientes`; `prepararCierreRuta` ya no se atora con una marca ajena: pregunta al servidor qué falta), `ChoferView.jsx` y
  `ventaRapidaLogic.js` (entregas y no entregas tardías → "Requiere revisión administrativa", con su tipo; un fallo de red no es
  rechazo), `bandejaLogic.ts` (avisos de links pendientes y entregas sin registro). Pruebas `t5d2RecuperacionRutas.test.jsx` (54).
- **Diferencias frente al diseño:** `cierre_admin` exige En progreso (una ruta Cargada primero se declara "no salió" o "salió");
  `conciliacion_ruta` reutiliza `diagnostico_ruta` por dentro; si el chofer encuentra entregas sin registro, la pantalla le dice cuáles
  y las resuelve Administración (no se agregó captura de cobro en el teléfono).
- **Activación propuesta:** 1) 142 una vez (compatible con el frontend desplegado, que no la usa) → 2) verificación de solo lectura →
  3) autorización APARTE → push del frontend → 4) bundle vivo.
- **Residuales:** lo que solo existió en un teléfono perdido no es recuperable; B1 contra B2 lo decide Administración por evidencia
  física; las operaciones en revisión siguen sin resolución dentro del sistema; un teléfono con la versión anterior conserva el mensaje
  viejo del defecto A; la carga mal registrada sigue sin corrección; el efectivo se concilia en un paso aparte; sin prueba con sesión real.
- Reversión: sin intervenciones, `DROP` de las funciones y las dos tablas y frontend anterior; con intervenciones, conservar las tablas.

## T5-D1 · Venta rápida registrada al capturarla (mig 141) — 2026-10-12 — CLOSED IN PRODUCTION (cierre técnico; validación operativa pendiente)
**Cierre del dueño (2026-10-12): "Acepto T5-D1 como CLOSED PROD técnico, con validación operativa pendiente." Riesgos residuales que el
dueño pidió mantener explícitos: (1) las ventas sin señal que pasan a REVISIÓN no tienen resolución administrativa dentro del sistema;
(2) un teléfono con la versión anterior sigue por el camino viejo hasta actualizarse; (3) ese camino viejo crea el fiado de venta rápida
a 15 días (`cerrar_ruta_financiero` no se tocó); (4) la cancelación de una orden nacida de venta rápida no está auditada.**
**141 aplicada por el dueño en el SQL Editor (2026-10-12, una vez; autorización "GO MIGRACIÓN 141") y verificada en solo lectura: tabla
`ventas_rapidas_ruta` (RLS activa, 0 policies, sin SELECT/INSERT/UPDATE/DELETE para anon ni authenticated, 0 filas) y las dos funciones
con md5 IDÉNTICOS a la base local (`registrar_venta_rapida_ruta` `68c38f48…`, `ventas_rapidas_de_ruta` `32c24343…`; SECURITY DEFINER,
`search_path` fijo, sin anon ni PUBLIC); catálogo: +2 funciones (219 → 221), +1 tabla (59 → 60) y NINGUNA otra diferencia; sin cambio
`cerrar_ruta_financiero`, `finalizar_inventario_ruta`, `entregar_orden_ruta`, `crear_cxc_orden`, `registrar_pago_orden`, `abonar_cxc`,
`fin_validar_credito` ni las guardas de 138/139. Frontend DEPLOYED con autorización APARTE ("GO DEPLOY FRONTEND"): push `ff2f862`
(código = `15c76d0`, más los commits de documentación `287ec09`, `b1225c9` y `ff2f862`); Netlify `6acd32d09f723cd4adb78da3`, ready
2026-10-12T19:20:15Z, `commit_ref` = `ff2f862`. Bundle vivo (52 archivos js): `registrar_venta_rapida_ruta`, `ventas_rapidas_de_ruta`,
`venta_rapida`, `ventas_rapidas_revision`, "Solo en este teléfono", "Todavía no está registrada", "Faltan ventas por enviar al sistema",
"Pasar a revisión de Administración", "Ventas rápidas registradas", "pregúntale antes de cerrar" (1 archivo cada uno), "Requiere
revisión administrativa" (2), y ya SIN el aviso anterior "Venta exprés: " (0). Sitio 200; funciones del servidor responden (401 sin
sesión); 21 Netlify Functions. Datos de negocio IDÉNTICOS antes de 141, después de 141 y después del deploy (`estado_negocio.sql`);
`error_log` máx 4; 0 ventas rápidas registradas. Sin operaciones de prueba en producción.**
**Pendiente (validación operativa, no verificable en solo lectura):** primera venta rápida real con sesión de Chofer (con señal, sin señal
y su sincronización), venta después de "Registrar ventas y mermas", aviso de revisión con una ruta cerrada, y la lista de ventas rápidas
en "Cerrar ruta" de Admin. Hasta entonces el comportamiento en pantalla está probado solo en local (suite 141, C141, Vitest).
**Gate local completo
RESULTADO OK: 141 ×2, RLS_CHECK PASS, suite 141 (72), 15 suites re-corridas tras 141 (086, 087, 088, 090, 078, 096, 104, 109, 114, 119,
136–140), C141a–g, OP-03, SEARCH_PATH 149/149, UNQUALIFIED_RESOLUTION PASS. Vitest 1,797 en UTC / Mazatlán / CDMX / Madrid; lint,
typecheck, build y `diff --check` limpios.** Origen: auditoría T5-D1 (solo lectura) y documento "T5-D1 — DECISIONES CERRADAS".
- **Causa raíz corregida:** la venta rápida vivía solo en el teléfono hasta "Registrar ventas y mermas" y `cerrar_ruta_financiero` acepta
  un registro por ruta; una venta posterior se borraba al volver a registrar (`ChoferView` filtraba todo lo que no fuera orden), se
  convertía en merma por el faltante del conteo, o se destruía al cerrar. También se perdían todas si Administración cerraba primero.
- **Decisiones del dueño:** D1 sin señal se permite en contado y queda PENDIENTE (crédito sin señal sigue prohibido); D2 el fiado de venta
  rápida vence a 30 días; D3 una venta pendiente que llega con la ruta cerrada se rechaza, se conserva en el teléfono como REQUIERE
  REVISIÓN ADMINISTRATIVA y no se borra sola (la resolución administrativa queda fuera de T5-D1).
- **141 (SHA-256 `0a7d301b613bd3539c39bf11cf577d0a93e90c78d412ef84c2c4b87add718c45`, 268 líneas; aditiva, sin datos):** tabla `ventas_rapidas_ruta` (operación, ruta, orden, huella, hora de
  captura, actor; RLS sin policies ni grants) y dos funciones SECURITY DEFINER con `search_path` fijo, sin anon:
  `registrar_venta_rapida_ruta(op, ruta, cliente, nombre, productos, método, factura, referencia, capturada)` (Admin o el Chofer de la
  ruta; candado de ruta → En progreso con carga → precio del servidor → orden Entregada + líneas → pago o cuenta por cobrar a 30 días con
  crédito validado → regla de carga de 138; reintento = misma respuesta, también con la ruta cerrada; códigos `RUTA_CERRADA`,
  `RUTA_NO_INICIADA`, `CARGA_INSUFICIENTE`, `CREDITO_RECHAZADO`, `PRECIO_CAMBIO`, `REFERENCIA_REPETIDA`) y `ventas_rapidas_de_ruta(ruta)`
  (lectura, Admin). md5 locales: `68c38f4847373536ee80b5ff3a981311` y `32c24343c9a23446c6b1bdecad42dbec`.
- **Convivencia financiera (probada, sin tocar contratos cerrados):** `cerrar_ruta_financiero`, `finalizar_inventario_ruta`,
  `entregar_orden_ruta`, `crear_cxc_orden`, `registrar_pago_orden`, `fin_validar_credito` y las guardas de 138/139 conservan su md5. Una
  venta registrada es una orden de la ruta: el balance y el conteo la incluyen sin volver a consolidar; si el cierre la recibe como
  orden, no repite pago ni cuenta (141-56). Venta después del cierre financiero: aceptada, y el conteo que la ignora se rechaza por
  sobrante en vez de volverse merma (141-57 a 59). Un teléfono sin actualizar sigue por el camino viejo sin doble registro (141-64).
- **Fecha:** la orden lleva el día de negocio de la hora de captura (acotada entre la salida de la ruta y la hora del servidor); el pago,
  la fecha en que el servidor lo recibió. Cruce de medianoche probado (141-65 a 67).
- **Frontend:** `src/data/ventaRapidaLogic.js`; `ChoferView.jsx` (registro al capturar; sin señal → cola con identificador y estado
  "Solo en este teléfono — falta enviarla"; sin respuesta → reenvío con el MISMO identificador; se eliminó el borrado al registrar el
  cierre; el cierre final exige señal, cola vacía y ninguna venta por enviar; con el conteo abierto se refresca el balance; ventas de
  la versión anterior se adoptan a la cola; ventas en la cola de otra ruta se envían o pasan a revisión; aviso permanente "Requiere
  revisión administrativa" con productos, importe, método, fecha e identificador, sin botón de borrar); `colaOfflineLogic.ts` (tipo
  `venta_rapida`); `supaStore.js` (`registrarVentaRapidaRuta`, `ventasRapidasDeRuta`; al cierre solo van órdenes del servidor);
  `VentasRapidasRuta.jsx` en "Cerrar ruta" de Admin. Pruebas `src/__tests__/t5d1VentaRapida.test.jsx` (38).
- **Activación propuesta:** 1) 141 una vez (compatible con el frontend desplegado, que no la usa) → 2) verificación de solo lectura →
  3) autorización APARTE → push del frontend → 4) bundle vivo.
- **Residuales:** lo guardado sin señal en un teléfono perdido, ajeno o con datos borrados no lo conoce el servidor (no hay garantía
  posible; Admin lo ve solo como faltante al contar); las ventas en revisión no tienen todavía resolución dentro del sistema y el aviso
  permanece en el teléfono; el camino viejo (venta rápida dentro del cierre, teléfono sin actualizar) sigue creando el fiado a 15 días
  porque `cerrar_ruta_financiero` no se tocó; un pendiente capturado por error se puede quitar del teléfono (si ya había llegado al
  servidor reaparece como venta registrada); la cancelación de una orden nacida de venta rápida no se revisó.
- Reversión: sin ventas registradas, `DROP` de las dos funciones y la tabla y frontend anterior; con ventas, conservar la tabla.

## T5-C · Conteo físico de empaques (mig 140) — 2026-10-11 — CLOSED IN PRODUCTION (cierre técnico; validación visual autenticada pendiente)
**Cierre del dueño (2026-10-11): "Acepto T5-C como CLOSED PROD técnico, con validación visual de la pantalla autenticada pendiente."
Pendiente del dueño: ver Insumos (Bolsas) → Empaques con sesión y capturar el conteo real de apertura. Regla para futuras activaciones
(dueño, 2026-10-11): aplicar una migración y publicar el frontend requieren autorizaciones INDEPENDIENTES; un "SUCCESS" del SQL Editor
no autoriza el deploy (en T5-C el frontend se publicó tras el "SUCCESS", apoyado en el documento GO).**
**140 aplicada por el dueño en el SQL Editor (2026-10-11, una vez) y verificada en solo lectura: las 3 funciones con md5 IDÉNTICOS a la
base local (`empaques_para_conteo` `174b1bfb…`, `registrar_conteo_empaque` `4c086650…`, `historial_empaque` `85ba5ec9…`), SECURITY
DEFINER, `search_path=public, pg_temp`, EXECUTE para authenticated y service_role, sin anon ni PUBLIC; catálogo: +3 funciones (216 → 219)
y NINGUNA otra diferencia (96 policies, 59 tablas, 11 disparadores en `ordenes`; `ajustar_existencia` `def11d26…` sin cambio; T5-A y T5-B
intactas). Frontend `dbdc153` DEPLOYED (autorización: documento "T5-C — GO ACTIVACIÓN CONTROLADA"; Netlify `6acbe0e6592b720008547bd2`,
ready 2026-10-11T19:18:27Z, `commit_ref` = `dbdc153`); bundle vivo (52 archivos js): `registrar_conteo_empaque`, `empaques_para_conteo`,
`historial_empaque`, "Registrar conteo" y `conteo-empaques` en 1 archivo cada uno; sitio 200. Datos de negocio IDÉNTICOS antes de 140,
después de 140 y después del deploy (`estado_negocio.sql`): EMP-5 122,080 · EMP-25 13,920 · EMP-25-SL 5,293, mismos costos, kardex 31
movimientos (mismo md5), 0 ajustes, 6 renglones de historial de costo, 9 producciones, `error_log` máx 4. Sin conteos ni movimientos de
prueba en producción. La interfaz autenticada no se abrió en producción (QA de solo lectura): la revisa el dueño al capturar el conteo
real. Regla 107/108 conservada: el conteo solo ajusta a la baja.**
**Gate local completo
RESULTADO OK (2026-10-11): 140 ×2, RLS_CHECK PASS, suite 140 (49), 10 suites re-corridas tras 140 (092, 093, 106, 107, 115, 129, 090, 119,
138, 139), C140a–f, OP-03, SEARCH_PATH 147/147, UNQUALIFIED_RESOLUTION PASS. Vitest 1,759 en UTC / Mazatlán / CDMX / Madrid; lint,
typecheck, build y `diff --check` limpios.** Origen: auditoría final (2026-10-10, "no hay pantalla para el conteo de bolsas");
instrucción del dueño: documento "CUBOPOLAR · T5-C".
- **Causa raíz:** el contrato `ajustar_existencia` (107/108, Admin) existía y el store lo exponía (`ajustarExistenciaManual`), pero
  ninguna pantalla lo usaba para empaques; además recibe un valor absoluto sin saber qué existencia vio quien contó, así que un conteo
  hecho mientras Producción consumía habría pisado ese consumo.
- **140 (SHA-256 `ae5aa92880cf14975d8cc0a2f41839c380e61d7a50c7f8b6cdff6fe22fa51f7e`, 170 líneas; aditiva, sin datos, sin tablas, sin
  policies, sin disparadores):** 3 funciones nuevas, solo Admin, SECURITY DEFINER con `search_path` fijo, sin anon:
  `empaques_para_conteo()` (existencia, costo, último movimiento y `revision` = último id de kardex del empaque),
  `registrar_conteo_empaque(op, sku, existencia_vista, revision_vista, conteo, motivo)` y `historial_empaque(sku, limite)`. md5 locales:
  `registrar_conteo_empaque` `4c0866500038522e1957e0ab077fce9a` · `historial_empaque` `85ba5ec934ede5415942b93368001f84` ·
  `empaques_para_conteo` `174b1bfbd177ff286d3b95c34a91d1a5`. **`ajustar_existencia` NO cambia** (md5 `def11d269c049c7301dfa568a96c529f` = producción).
- **Sin segundo ledger:** el conteo es un ajuste de `productos.stock` con su fila de `inventario_mov` y su `stock_operaciones`
  (`ajuste_existencia`, motivo "Conteo físico: …", existencia anterior y resultante, actor y hora del servidor). Un conteo sin
  diferencia queda registrado en `stock_operaciones` sin fila de kardex.
- **Reglas del servidor:** piezas enteras ≥ 0; motivo ≥ 5 letras; idempotente por operación (doble clic = misma respuesta; la misma
  operación con otra cantidad se rechaza); candado sobre el producto; `CONTEO_OBSOLETO` si la existencia o la revisión cambiaron desde
  que se abrió el conteo (producción, compra u otro ajuste): no aplica nada y la pantalla recarga y pide confirmar otra vez;
  `CONTEO_MAYOR` si se contó más de lo registrado: los empaques solo se ajustan a la baja (decisión cerrada de 107/108; lo que sobra
  entra por compra recibida, que es lo que conserva la base de costo). El costo unitario no cambia con un conteo.
- **Pantalla (solo Admin):** Insumos (Bolsas) → sección "Empaques": SKU, empaque, existencia registrada, unidad, costo unitario, último
  movimiento, "Ver historial" y "Registrar conteo" (existencia registrada, cantidad contada, diferencia calculada, motivo obligatorio y
  casilla de confirmación; nada se aplica solo). Tarjetas en móvil, tabla en escritorio. Los demás roles no ven la sección ni el costo, y
  el servidor los rechaza (42501). Archivos: `src/data/conteoEmpaqueLogic.js`, `src/components/ConteoEmpaques.jsx`,
  `AlmacenBolsasView.jsx`, 3 acciones en `supaStore.js`; pruebas `src/__tests__/t5cConteoEmpaques.test.jsx` (27).
- **Producción (solo lectura, 2026-10-11, antes de 140):** `EMP-5` 122,080 · `EMP-25` 13,920 · `EMP-25-SL` 5,293 (recepciones de compra
  del 2026-10-10 y consumo de producción; los 99,000 / 9,800 de secciones anteriores ya no son la existencia vigente). Sin negativos.
  No se ejecutó ningún conteo ni movimiento en producción; la migración no ajusta inventario.
- **Activación propuesta:** 1) 140 una vez (aditiva; compatible con el frontend desplegado, que no la usa) → 2) verificación de solo
  lectura (md5, ACL, datos idénticos) → 3) push del frontend → 4) bundle vivo → 5) el dueño captura el conteo real de apertura.
- **Residuales:** un sobrante no se captura como conteo (va por compra recibida, que pide costo); `productos` no tiene bandera de
  activo/inactivo (se listan todos los empaques); el kardex no guarda existencia anterior/resultante salvo en ajustes; no hay conteo de
  varios empaques en una sola operación ni conteo por ubicación (almacén vs Producción).
- Reversión: `DROP FUNCTION` de las tres (los conteos ya aplicados quedan como ajustes normales del ledger); frontend al commit anterior.

## T5-B · Entrega de ruta y fiado atómicos (mig 139) — 2026-10-11 — DEPLOYED / TECHNICALLY VERIFIED (sin cierre del dueño)
**Frontend `7ab079f` DEPLOYED (push autorizado por el dueño: "dale"; Netlify `6acbd9bee0c1ac0008cf615b`, ready 2026-10-11T18:47:53Z); bundle
vivo verificado: `entregar_orden_ruta` 1 archivo, "Sin señal no se puede fiar" 1, "su límite es $0" 1, y ya SIN `crear_cxc_orden` ni "No se
pudo sincronizar el cobro" (0 archivos: las dos escrituras ya no existen en el cliente); sitio y funciones 200. Datos de negocio sin
cambio tras el deploy; `error_log` máx 4; 0 entregas a crédito sin cuenta por cobrar. Sin operaciones de prueba en producción. La regla
"sin señal no se fía" quedó publicada sin objeción del dueño (ajustable).**
**139 aplicada por el dueño en el SQL Editor (2026-10-11) y verificada en solo lectura: `entregar_orden_ruta`
`29967d7a0208ae34f279838a35e87f04` y `ordenes_guard_credito_entrega` `a9c59333122fc17f8efb86fd1fe3cc6e` IDÉNTICOS a la base local (SECURITY
DEFINER, `search_path` fijo, sin anon); disparador `trg_ordenes_guard_credito_entrega` presente (ordenes 10 → 11); 214 → 216 funciones,
policies 96 y tablas 59 sin cambio; sin cambio `fin_validar_credito`, `crear_cxc_orden`, `registrar_pago_orden`, `abonar_cxc`,
`cerrar_ruta_financiero`, `completar_venta_directa` ni las funciones de 138; datos de negocio IDÉNTICOS a los de tras T5-A
(`estado_negocio.sql`); `error_log` máx 4. **
**Estado: en git local (rama `t5b-credito-atomico`). 139 NO aplicada en producción; frontend NO desplegado. La activación requiere
autorización explícita del dueño. Gate local completo RESULTADO OK (2026-10-11): 139 ×2, RLS_CHECK PASS, suite 139, 15 suites re-corridas
tras 139 (incluida 138), C138a–f y C139a–f, OP-03, SEARCH_PATH 144/144, UNQUALIFIED_RESOLUTION PASS.** Origen: auditoría final (2026-10-10); instrucción del dueño: documento "CUBOPOLAR · T5-B".
- **Causa raíz:** la entrega de una orden de ruta eran DOS escrituras del cliente (`updateOrdenEstatus`): UPDATE a `Entregada` y después
  `crear_cxc_orden` (fiado) o `registrar_pago_orden` (contado). Si la segunda fallaba (cliente sin crédito, con límite 0 o en su límite), el
  cliente intentaba regresar el estatus y la guarda de 105 lo prohíbe: quedaba Entregada con método Crédito, sin deuda ni cobro, y el cierre
  financiero abortaba al reintentar el fiado. El teléfono del chofer trataba límite 0 como "sin límite" y Admin ("Cobrar entrega") no
  revisaba el crédito antes.
- **Producción (solo lectura, 2026-10-11):** 2 órdenes Entregadas, 0 a crédito; **0 entregas a crédito sin cuenta por cobrar** y 0 de contado
  sin pago; 200 clientes activos, ninguno con crédito autorizado. Sin herramienta de reparación (no hace falta). md5 = base local:
  `fin_validar_credito` `7bb429dd…`, `crear_cxc_orden` `bee6bcb2…`, `registrar_pago_orden` `add148ab…`.
- **Regla (decisión del dueño):** crédito autorizado explícito; **límite 0 = sin capacidad** (el servidor ya lo calculaba así:
  `fin_validar_credito` NO cambia); el crédito lo valida el servidor con el cliente bloqueado, contra las cuentas por cobrar vigentes;
  insuficiente = rechazo ANTES de confirmar la entrega; nunca se registra un cobro que no ocurrió.
- **139** (`139_entrega_ruta_atomica.sql`, SHA-256 `4063868565ba73b8b9064d02a4a89f62a25510683040788e34d1d34bec60771f`; idempotente):
  (1) `entregar_orden_ruta(operación, orden, método, nota, referencia)` — NUEVO; Admin o el Chofer de esa ruta. Una transacción: candado
  ruta → orden → `Entregada` (pasa por la guarda de carga de 138) → `crear_cxc_orden` (fiado, 30 días) o `registrar_pago_orden` (contado) o
  nada (link: lo registra el webhook). Si algo falla no queda NADA (`CREDITO_RECHAZADO`, `CARGA_INSUFICIENTE`, `REFERENCIA_REPETIDA` en
  `DETAIL`). Idempotente por el estado de la orden: repetir no duplica deuda ni cobro ni cambia la modalidad. Una orden ya Entregada SIN
  registro financiero (estado anterior, o entrega por link que no se pagó) se **resuelve** con la misma llamada eligiendo el método
  ("Resolver cobro de entrega" en auditoría): esa es la salida sin SQL. Normaliza las etiquetas largas de Admin ("Crédito (fiado)" →
  "Crédito"). (2) `ordenes_guard_credito_entrega`, BEFORE UPDATE en `ordenes` sin exención de rol: fuera de un contrato ninguna escritura
  deja una orden Entregada/Facturada con método de crédito (ni al entregar ni cambiando el método después).
- **Md5 esperados tras 139 (base local):** `entregar_orden_ruta` `29967d7a0208ae34f279838a35e87f04` · `ordenes_guard_credito_entrega`
  `a9c59333122fc17f8efb86fd1fe3cc6e`. Diff esperado: +2 funciones, +1 disparador en `ordenes` (10 → 11). Sin tablas, policies ni datos.
- **No cambia:** `fin_validar_credito`, `crear_cxc_orden`, `registrar_pago_orden`, `abonar_cxc`, `cerrar_ruta_financiero` (ya era atómico),
  138 (guarda de carga y reversión), `completar_venta_directa` (mostrador), saldos y cuentas existentes. El contado por la vía anterior
  (UPDATE directo) no se prohíbe: su cobro lo completa de forma idempotente el cierre de ruta.
- **Frontend:** `updateOrdenEstatus(…, 'Entregada')` → `entregarOrdenRuta` (un contrato; se quitaron las dos escrituras y el "regresar el
  estatus"); regla única `motivoNoFiar` (`recuperacionRutaLogic.js`) para Chofer y Admin: límite 0 = sin capacidad, cuenta lo que ya debe;
  **sin señal no se fía** (el crédito solo lo aprueba el servidor: un fiado nunca entra a la cola sin señal); rechazo del servidor → mensaje
  accionable y el diálogo sigue abierto para cobrar de otra forma; venta rápida fiada: mismo aviso contando lo fiado que aún está en el
  teléfono (se valida de verdad en el cierre, atómico).
- **Compatibilidad con el frontend desplegado (`aef7e1e`):** con 139 aplicada y el bundle viejo, un fiado de ruta se rechaza ("Error al
  actualizar orden", falla cerrado) y el contado sigue igual. Hoy no hay clientes con crédito: aplicar 139 y publicar el mismo día.
- **Decisión tomada por omisión (a confirmar por el dueño):** sin señal el chofer NO puede fiar una entrega (antes se encolaba y podía
  rechazarse después de haber dejado el producto). Alternativa descartada por riesgosa: encolar el fiado "por confirmar".
- **Evidencia:** suite `139_entrega_ruta_atomica_test.sql` (45: los 28 escenarios pedidos y más); concurrencia con dos conexiones
  `c139_concurrencia.mjs` C139a–f (dos choferes y un solo crédito, abono + venta, misma operación dos veces, fiado vs efectivo sobre la
  misma orden, entrega + cierre sin interbloqueo, invariante global); 138 hecha consciente de 139; `src/__tests__/t5bCreditoAtomico.test.js`;
  4 pruebas anteriores actualizadas por el cambio intencional; Vitest 1,732 en 4 zonas; lint, typecheck, build, `diff --check`.
- **Residuales:** el crédito se valida al ENTREGAR, no al levantar el pedido (dos pedidos a crédito pueden caber al levantarse y el segundo
  rechazarse al entregar: ahora con mensaje y sin estado a medias); plazo 30 días en la entrega y 15 en el fiado registrado solo en el
  cierre (hallazgo aparte); una entrega por link no pagado queda Entregada sin cobro hasta que llegue el webhook o se resuelva con otro
  método; el contado por UPDATE directo sigue permitido (lo completa el cierre); la venta rápida fiada se valida en el cierre.
- Reversión: encabezado de 139 (reabre el P0); Netlify a `aef7e1e`.

## T5-A · Recuperación del cierre de ruta (mig 138) — 2026-10-11 — DEPLOYED / TECHNICALLY VERIFIED (sin cierre del dueño)
**Activación (GO del dueño, 2026-10-11): 138 aplicada UNA vez por el dueño en el SQL Editor (el clasificador de la sesión bloqueó la
escritura a producción), antes de 18:10Z, con el hash aprobado. Verificado en solo lectura (18:10Z): las 9 funciones de 138 con md5
IDÉNTICOS a la base local; sin cambio `balance_ruta_interno`, `finalizar_inventario_ruta`, `registrar_no_entrega`, `confirmar_carga_ruta`,
`registrar_pago_orden`, `crear_cxc_orden`, `abonar_cxc`, `anular_cxc_orden`; disparador `trg_ordenes_guard_carga_ruta` activo; tabla
`ruta_entregas_revertidas` (RLS, lectura Admin, 0 filas). Diff de catálogo EXACTO: +5 funciones, 4 cuerpos, +1 tabla, +1 policy, +1
secuencia, +1 disparador (ordenes 9 → 10); 214 funciones · 96 policies · 59 tablas · 53 secuencias. Datos de negocio IDÉNTICOS antes y
después (`estado_negocio.sql`; `error_log` máx 4 sin cambio; 1 ruta, Cerrada). Actividad ajena en el intervalo (no es de 138): 3 avisos de
asistencia del cron y 2 eventos de webhook. Frontend `aef7e1e` DEPLOYED (Netlify `6acbd17a20433700082041b5`, ready 2026-10-11T18:12:39Z);
bundle vivo verificado (`recuperacion-ruta`, `revertir_entrega_ruta`, `diagnostico_ruta`, "Revisar inventario de la ruta",
`quitar-express`, "No alcanza lo que traes en el camión"); sitio y funciones responden 200. Sin operaciones de prueba en producción.**
**Estado anterior a la activación: en git local (rama `t5a-cierre-ruta`). Gate local completo RESULTADO OK (2026-10-10): 138 ×2, RLS_CHECK PASS, suite 138, 18 suites re-corridas tras 138, C138a–f, OP-03, SEARCH_PATH 142/142, UNQUALIFIED_RESOLUTION PASS.** Origen: auditoría final de
solo lectura del 2026-10-10 (7 agentes; hallazgo P0 confirmado en código). Instrucción del dueño: documento "CUBOPOLAR · T5-A".
- **Causa raíz:** marcar una orden de ruta como Entregada era un UPDATE directo sin revisar lo que traía el camión. Si el producto no se
  había cargado o no alcanzaba, el balance canónico de 087 fallaba cerrado ("entregado supera lo cargado") en el cierre del chofer Y en el
  de Admin; una ruta cargada no se cancela (087) y una Entregada no se revierte (105): solo SQL. Se llegaba fácil: "+ Órdenes" seguía
  disponible con el camión cargado y agregar una orden no sube la carga autorizada; las ventas exprés solo se topaban en el teléfono.
- **Producción (solo lectura, 2026-10-10):** 1 ruta, Cerrada; 0 rutas abiertas, 0 rutas con exceso, 0 órdenes Asignadas en ruta cargada. md5
  ANTES de 138 = base local: `asignar_orden` `d9e6ce16…`, `asignar_ordenes_a_ruta` `3fc56dae…`, `cerrar_ruta_financiero` `9b80d0e9…`,
  `ordenes_delivered_at` `00517e63…`; sin cambio antes y después: `balance_ruta_interno` `d73858db…`, `finalizar_inventario_ruta`
  `6df6f778…`, `registrar_no_entrega` `19438688…`.
- **138** (`138_recuperacion_cierre_ruta.sql`, SHA-256 `508666f9f9d124d69a31fd9b5935c487c9b17f2559f44f50a35e2245eb5bdad5`; idempotente):
  **Prevención** — (1) `ordenes_guard_carga_ruta`, disparador AFTER UPDATE en `ordenes` sin exención de rol ni de contexto: una orden de
  una ruta con carga estructurada solo pasa a Entregada si cargado ≥ entregado + merma + devuelto por cada producto suyo; bloquea la fila de
  la ruta (dos entregas simultáneas no consumen la misma carga); vale para el UPDATE del chofer o de Admin, la cola sin señal y el cierre
  financiero; el rechazo (22023, `DETAIL` JSON `CARGA_INSUFICIENTE`) revierte la sentencia. (2) `cerrar_ruta_financiero` verifica la ruta
  entera al final (ventas exprés): si no cuadra no registra NADA. (3) `asignar_ordenes_a_ruta` / `asignar_orden` rechazan agregar pedidos a
  una ruta con carga capturada (Pendiente firma) o confirmada; antes de cargar sí, y la respuesta trae `sin_cubrir` (la carga autorizada NO
  sube sola). **Recuperación (solo Admin, motivo, auditada, idempotente)** — (4) `diagnostico_ruta` (lectura). (5) `revertir_entrega_ruta`:
  la orden vuelve a Asignada en su ruta; sin kardex (la entrega de ruta sale del balance, no mueve inventario); CxC sin abonos → anulada con
  el contrato de 090; con abonos → rechazo; un cobro NO se borra: se conserva y Admin lo reconoce (`p_conservar_cobro`, código
  `COBRO_REGISTRADO`); rechazo si Facturada, con devolución, CFDI sin resolver, comisión ya pagada o ruta Cerrada. Evidencia en
  `ruta_entregas_revertidas` (antes/después, quién, cuándo, por qué; RLS, lectura Admin, sin DML por API) y `auditoria`.
  (6) `ordenes_delivered_at` limpia la fecha de entrega solo dentro de esa reversión.
- **Md5 esperados tras 138 (base local):** `ordenes_guard_carga_ruta` `f9669b57ee94de6905f6eb3ddb4c8473` · `ruta_inventario_resumen`
  `8e7a3ec0483b383cb09858c9dbe7bff2` · `asignar_orden` `62945d7ad3f93e9fc5a90915170f980a` · `asignar_ordenes_a_ruta`
  `cc35220b8b28eb9087984c6119a410a6` · `cerrar_ruta_financiero` `a4e627685850db7af897d3239e1a0dc5` · `ordenes_delivered_at`
  `90583139f3500759fd2e432af2fd5e4d` · `ruta_entrega_no_reversible` `76d9c267c9634f284a0fc72bf497c0aa` · `diagnostico_ruta`
  `8db8d2594efc9288ef64f84d4415d489` · `revertir_entrega_ruta` `6e07b49a38d7a85956f42d32bbafc466`. Diff de catálogo esperado: +5 funciones,
  +1 tabla, +1 policy, +1 secuencia, +1 disparador en `ordenes`, cuerpo de 4 funciones.
- **No cambia:** balance y finalización de 087, carga (084/085), cobros y CxC (088/114), rutas sin carga estructurada (camino anterior a
  087: la guarda no interviene). No repara rutas existentes.
- **Frontend:** `src/data/recuperacionRutaLogic.js`; Chofer — aviso previo si la orden no cabe en lo que trae (también sin señal), motivo
  del servidor, "Quitar" una operación rechazada la saca de Entregadas, un cierre rechazado devuelve la orden a Por entregar, botón "Quitar"
  (dos toques) en una venta rápida local; Rutas (Admin) — "+ Órdenes" solo antes de la carga, etiquetas "Carga por firmar" / "Camión
  cargado", aviso si la carga autorizada no cubre los pedidos, y "Revisar inventario de la ruta" (`RecuperacionRutaModal`: cargado vs
  entregado, revertir entrega, marcar no entregada).
- **Compatibilidad con el frontend desplegado:** sí. Con 138 aplicada y el bundle viejo, una entrega que no cabe se rechaza con el aviso
  genérico "Error al actualizar orden" (falla cerrado); lo demás igual. Orden de activación: 138 → verificación → push.
- **Evidencia:** suite `138_recuperacion_cierre_ruta_test.sql` (51); concurrencia con dos conexiones `c138_concurrencia.mjs` C138a–f
  (entregas simultáneas, entrega + cierre, asignación + carga, reversiones simultáneas, reversión + entrega, candados cruzados → 40P01
  limpio); suites históricas re-corridas tras 138 (078, 080, 081, 084–088, 090, 093, 096, 100, 104, 109–114, 117, 119, 123, 127–130,
  133–137, OP-03); 087 y 081 hechas conscientes de 138 (corren antes y después); `src/__tests__/t5aCierreRuta.test.js`; Vitest 1,719 en
  4 zonas; lint, typecheck, build, `diff --check`.
- **Residuales:** el plazo, el fiado con límite 0 (T5-B) y los demás hallazgos de la auditoría final siguen abiertos; la reversión conserva
  el cobro (un efectivo que no se recibió sale como faltante en el corte de caja de la ruta: visible, no silencioso); una orden revertida y
  luego No entregada con cobro sigue sin salida de reembolso (hallazgo aparte); una venta exprés ya registrada en el servidor en una ruta
  inconsistente anterior a 138 se revierte a Asignada como cualquier orden (0 casos en producción); entrega y cierre de la MISMA orden a la
  vez → una transacción se aborta con 40P01 (el reintento funciona); sin segunda carga del camión (decisión operativa futura); el aviso
  previo del teléfono usa su cuenta local, la autoridad es el servidor.
- Reversión: encabezado de 138 (reabre el P0); Netlify al commit anterior (`c5129ba`).

## Pedido sin existencia (mig 137) — 2026-10-10 — DEPLOYED / TECHNICALLY VERIFIED
**Frontend `c5129ba` DEPLOYED (push autorizado por el dueño; Netlify `6acac5c5cfef52000723f813`, ready 2026-10-10T23:10:26Z); bundle vivo verificado (`aviso-sin-existencia`, "Crear pedido por surtir", `permitir_sin_stock`). Sin cierre del dueño; sin prueba con un pedido real.**
**137 aplicada en producción el 2026-10-10 desde esta sesión con `supabase db query --linked -f` (autorizada por el dueño: "DALE" tras revisar el SQL; esta vez el clasificador no la bloqueó), una vez; verificada en solo lectura: md5 de `crear_orden` `ef8e49a380d52f870aaccc1bf2ef323c` = base local, SECURITY DEFINER, `search_path` fijo, sin anon, una sola firma; `completar_venta_directa` sin cambio (`2107586c…`).** Pedido y autorizado por el
dueño el 2026-10-10 ("me gusta, dale"). Orden de activación: 137 (compatible con el frontend desplegado: sin la bandera nada cambia) →
verificación de solo lectura → push.
- **Antes (auditado en solo lectura):** `crear_orden` (133) y la pantalla rechazaban TODA venta cuya cantidad superara la existencia del
  momento, igual en mostrador que en un pedido para otro día. La orden nunca apartó inventario (solo baja al entregar o cargar el camión).
- **Regla nueva:** **Mostrador** (se entrega ahí mismo): sin existencia no se vende (sin cambio). **A domicilio**: el pedido se levanta
  aunque falte; la pantalla avisa cuánto hay que producir y el botón dice "Crear pedido por surtir".
- **137** (`137_pedido_sin_existencia.sql`, SHA-256 `d7dce63ad2c3281d826f27f73801c63fa28e73a32af941ec13b3ccd332e05416`; idempotente, misma firma y permisos): `crear_orden` acepta
  `p_orden.permitir_sin_stock = true`; entonces no rechaza por existencia, devuelve `faltantes` (sku, pedido, disponible, falta) y
  `falta_barra` (la regla de 133 como aviso) y deja en `auditoria` "Pedido sin existencia" con quién y cuánto. Sin la bandera el cuerpo es
  el de 133. md5 en producción ANTES: `557168664182191ef86519f55452ef32` (= definición de 133); DESPUÉS esperado (base local):
  `ef8e49a380d52f870aaccc1bf2ef323c`.
- **No cambia:** crédito, precios, folio, sucursal; `completar_venta_directa`, la carga del camión y el cierre de ruta siguen exigiendo
  que el producto exista (suite 137-15: el pedido sin existencia no se puede entregar hasta producirlo). La orden sigue sin apartar
  inventario. Producción ya ve los pedidos pendientes en "Qué necesitas producir" (sin cambio).
- **Decisiones tomadas por omisión (el dueño no las respondió; ajustables):** lo puede hacer cualquier Admin o Ventas (los mismos que ya
  levantan ventas) y sin tope de cantidad; queda rastro en auditoría.
- **Frontend:** `src/data/pedidoStockLogic.js` (`revisarExistencia`); Nueva venta (aviso ámbar, bloqueo solo en mostrador); Editar venta
  ya no se bloquea por existencia (solo avisa; el servidor nunca la revisó al editar).
- **Validación:** suite `137_pedido_sin_existencia_test.sql` (17) + re-corridas en verde: 133, 123, 109, 129, 135, 088, 110;
  `src/__tests__/pedidoSinExistencia.test.js`; Vitest 1,702 en 4 zonas; lint, typecheck, build, `diff --check`. Sin el ensayo completo.
- **No incluido:** apartar inventario por pedido; tope por capacidad de la planta; aviso automático a Producción; la venta exprés del chofer.
- Reversión: volver a aplicar `crear_orden` de 133; Netlify al commit anterior (`a515335`).

## Tanda 4 de correcciones de la revisión profunda — 2026-10-10 — DEPLOYED / TECHNICALLY VERIFIED (sin migración)
**Frontend `a515335` DEPLOYED (push autorizado por el dueño; Netlify `6aca8d414698390008bfc47f`, ready 2026-10-10T19:09:17Z); bundle vivo verificado (`cola-fallidas`, `pagos-en-revision`, "Quitar (ya lo resolví)"). Solo frontend; sin SQL ni funciones de Netlify. Sin cierre del dueño.** Autorizada por el dueño ("dale con la
tanda 4", 2026-10-10).
- **Cola sin señal del chofer:** un fallo de RED ya no gasta intentos (antes, 5 intentos con mala señal dejaban la operación fallida para
  siempre y se borraba al cerrar la ruta). Solo cuentan los rechazos del servidor; la rechazada guarda su motivo, se ve en un aviso rojo
  con "Reintentar" y "Quitar (ya lo resolví)", y la ruta NO se cierra mientras exista.
- **Rutas:** el estatus ya no se edita a mano en "Editar ruta" (una ruta puesta en "Completada" o "Cerrada" quedaba atorada, sin cierre
  de caja ni devolución del camión); `updateRuta` ya no escribe `estatus`. Avanza solo por Cargar / Iniciar / Cerrar / Cancelar.
- **Pagos por link en revisión:** Por cobrar muestra (Admin y Facturación; policy `payment_intents_read_fin` de 090) los pagos que el
  proveedor cobró y el webhook dejó en `payment_intents` como `review:*` sin registrar (importe distinto, venta cancelada…), con motivo y
  qué hacer. Solo lectura; se resuelven a mano. Producción hoy: 0 filas (verificado en solo lectura).
- **No incluido (decisión del contador):** forma de pago SAT de un cobro por link (hoy 99 "por definir"); motivo 01 de cancelación de CFDI.
- **Validación:** `src/__tests__/tanda4Arreglos.test.js`; Vitest 1,692 en 4 zonas; lint, typecheck, build, `diff --check`.

## Tanda 3 de correcciones de la revisión profunda (mig 136) — 2026-10-10 — DEPLOYED / TECHNICALLY VERIFIED
**136 aplicada por el dueño en el SQL Editor (2026-10-10) y verificada en solo lectura: md5 de `mi_asistencia` `575bf117fc9ec695bdf43aa066c0022b`, `registrar_asistencia_manual` `b24a8507a4f22915542471b89b63b6cc`, `asistencia_generar_avisos` `4421305a267c4dc6e465bb596b9fe672`, `nomina_asistencia_semana` `626c3193c0cf972f2d11d721ea92e69d` y `cerrar_ruta_financiero` `9b80d0e98779c21a547c5010a109059a` IDÉNTICOS a la base local; SECURITY DEFINER y permisos iguales (anon nada); 209 funciones; 0 asistencias. Frontend y funciones `8d5dba2` DEPLOYED (push autorizado por el dueño; Netlify `6aca8ac2c3af350008b6cd33`, ready 2026-10-10T18:58:42Z); bundle vivo verificado (`registrar_asistencia_manual`, "Facturar a público en general", "CP fiscal", "Tu usuario está dado de baja", "Capturar asistencia"). Sin cierre del dueño. No verificable desde aquí: timbrado real, avisos en un teléfono real.** Autorizada por el
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
