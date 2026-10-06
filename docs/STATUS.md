# CUBOPOLAR — STATUS (única fuente del estado actual)

Actualizado: 2026-10-06 (activación B3.6). Lo actualizan los skills `activar-produccion`
(al cerrar una fase) y `fase-auditoria` (al entregar una auditoría, si el dueño autorizó documentarla).
Regla: si el repositorio tiene código o migraciones más nuevos que la base de abajo, esa
diferencia tiene estado de producción DESCONOCIDO hasta verificarla (ver `CLAUDE.md`).

## Base de producción verificada
- Código de la aplicación: `c09d82a00fd8423e3decedab3e470c033bd7bb22` (B3.6, solo frontend) — DEPLOYED
  (Netlify `6ac528ef37388600080f70d9`, ready 2026-10-06T16:59Z) y verificado en solo lectura (bundle
  vivo y digests de las 17 Functions idénticos a OL-03B); este commit de documentación se publica
  encima sin cambios de código. Bases anteriores: `9a94881` (OL-03B, Netlify
  `6ac521a708997e00090cd30a`), `cfce0f2` (OL-03A), `8b61a2e` (110).
- Base de datos: migraciones aplicadas hasta la **112** (111 el 2026-10-06T16:27Z, 112 el
  16:29:58Z, una vez cada una; se aplican con `supabase db query`; no hay tabla de historial: la
  "cabeza" se verifica por la presencia y huella de los objetos).
- Conteos tras 112 (cambian con cada fase; no son invariantes): 126 funciones · 78 policies ·
  41 tablas · 39 secuencias · 1 vista · 45 triggers en `public` (7 en `ordenes`).
- Huellas (md5 de `pg_get_functiondef`): `completar_venta_directa` (109) `5825f5e3072a1d5a98961752a5eb5cc6` ·
  `ordenes_guard_entrega_directa` (110) `9eac14f606d8c0f0fb4a8851cc32b640` ·
  `reservar_operacion_cfdi` `da2ef2b708a3d459b1fb462092b3225f` · `finalizar_operacion_cfdi`
  `e8086c8cd8e33d4b457d28781228fbc5` · `conciliar_operacion_cfdi` `301d2db4f901c8354cd1006b0ee9e535` ·
  `ordenes_guard_facturada` (112) `7e33177cfb5551cfcd602e94b94343ea` · `cerrar_ruta_financiero`
  (112) `bbca26893810c7867be7b2fd33e6fb14` (antes `9b93ce16…`).
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
| Role UI B3.6 Ventas como UN espacio de trabajo (filtros Pendientes / Hoy / Todas) | c09d82a | DEPLOYED / TECHNICALLY VERIFIED (solo UI; sin migración) |

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
  activación: 0 filas.

## Trabajo actual
Ninguna fase de implementación en curso. Siguiente paso autorizado: ninguno.
- **DIRECT-SALE P0:** CONTAINED FOR UI / REST / WEBHOOK (109 + D1 + 110).
- **INVOICING LIFECYCLE BYPASS (OL-03):** CONTAINED SERVER-SIDE (OL-03A) AND AT THE DATABASE (112).
- **OL-03B:** DEPLOYED / TECHNICALLY VERIFIED: timbrado y cancelación simultáneos serializados por
  la reserva de la base ANTES del proveedor; resultados desconocidos bloqueados para reintento
  automático; `requested` conserva `Facturada`; el cierre de ruta conserva `Facturada`. La
  activación no cambió datos de negocio (0 operaciones CFDI, 0 sin resolver).
- **ORDER LIFECYCLE INTEGRITY:** NO cerrado. **INVOICING INTEGRITY:** NO cerrado (residuales abajo).
- **Siguiente fase:** revisión del dueño → OL-04 (complementos de pago).
- **B3.6 (Ventas como un solo espacio de trabajo):** DEPLOYED / TECHNICALLY VERIFIED. Ventas tiene UN
  módulo en el menú; filtros internos Pendientes (`#/ventas`) / Hoy (`#/ventas-hoy`) / Todas
  (`#/ventas-todas`); `#/ventas-cobrar` (B3.4) es alias de `#/ventas`. Pendientes = la tarjeta ofrece
  Cobrar / Cobrar entrega (Creada, o Asignada sin ruta), en dos grupos (por cobrar / pagadas por link
  por entregar); las que tiene el chofer solo como dato. Escritorio y móvil con el mismo espacio de
  trabajo; sin barra inferior para Ventas (un solo módulo); Nueva venta como acción principal de tamaño
  normal. "Ver como" de Admin, alcance por vendedor, venta directa, links de pago, ruta/Chofer, OL-03A y
  OL-03B sin cambio; base de datos hasta 112 sin cambio; sin mutación de datos de negocio.
- **ROLE UI CONVERGENCE:** A1–B3.6 desplegadas; el programa NO se declara cerrado (residuales de UI
  abajo). Opción C y D siguen NO autorizadas; Facturación / Sin asignar sin cambio.
- **Reestructura de contexto:** Fase 2 PENDING y sin autorizar.

## Residuales abiertos
Ciclo de vida de la orden y pagos:
- **Facturación tras OL-03A/B:** conciliación MANUAL de operaciones inciertas (no hay consulta
  automática al proveedor); sin interfaz de operador para `cfdi_operaciones`; el tiempo máximo real
  de las Netlify Functions no está fijado en el repositorio (8 s / 120 s son supuestos documentados);
  en una orden `Facturada` el cierre de ruta todavía actualiza `metodo_pago`. Sin evidencia de daño
  histórico OL-03 en producción (0 `invoice_attempts`, ninguna orden con CFDI).
- **P1-2 Bypass general de service role:** 105 exime a service role/JWT nulo de las transiciones
  fuera de `Facturada`; 110 cubre la entrega sin ruta y 112 la entrada/salida de `Facturada`.
- **Complementos de pago (OL-04):** `billing-create-complemento` no revisa dueño, confía en
  montos/saldos enviados por el cliente y no tiene control de concurrencia.
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
con Postgres del runner local).
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
