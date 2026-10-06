# CUBOPOLAR — STATUS (única fuente del estado actual)

Actualizado: 2026-10-06 (activación OL-03A). Lo actualizan los skills `activar-produccion`
(al cerrar una fase) y `fase-auditoria` (al entregar una auditoría, si el dueño autorizó documentarla).
Regla: si el repositorio tiene código o migraciones más nuevos que la base de abajo, esa
diferencia tiene estado de producción DESCONOCIDO hasta verificarla (ver `CLAUDE.md`).

## Base de producción verificada
- Código de la aplicación: `d6375ad` (OL-03A, solo Netlify Functions de facturación), publicado
  junto con este commit de documentación (`main` = `origin/main`). El id del deploy de Netlify y su
  verificación quedan en el reporte de activación de OL-03A (2026-10-06). Base anterior verificada:
  `8b61a2eb25f02ec2143dd8c3d3b51bac3b1bd6ff` (Netlify `6ac464890642ca0008522841`).
- Base de datos: migraciones aplicadas hasta la **110**, sin cambio en OL-03A (se aplican con `supabase db query`; no hay
  tabla de historial: la "cabeza" se verifica por la presencia y huella de los objetos).
- Conteos tras 110 (cambian con cada fase; no son invariantes): 120 funciones · 77 policies ·
  40 tablas · 39 secuencias · 1 vista · 44 triggers en `public` (6 en `ordenes`).
- Huellas (md5 de `pg_get_functiondef`): `completar_venta_directa` (109) `5825f5e3072a1d5a98961752a5eb5cc6` ·
  `ordenes_guard_entrega_directa` (110) `9eac14f606d8c0f0fb4a8851cc32b640`.
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
| OL-03A contención del timbrado/cancelación de CFDI (servidor, antes del proveedor) | d6375ad | DEPLOYED con esta activación; sin migración |

B3.3 y B3.5 (Ventas IA) y OL-01 / OL-02 / OL-02D / OL-03 fueron auditorías sin commit. El cierre
del dueño ("CLOSED IN PRODUCTION") no está registrado para las fases de Role UI, OL-02 ni OL-03A.

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
  cambió, responde 409 y la bitácora queda `review:orden_no_actualizada` (sin rollback automático del
  CFDI). La base de datos todavía NO impone `Facturada` solo desde `Entregada` (OL-03B).

## Trabajo actual
Ninguna fase de implementación en curso. Siguiente paso autorizado: ninguno.
- **DIRECT-SALE P0:** CONTAINED FOR UI / REST / WEBHOOK (109 + D1 + 110).
- **INVOICING LIFECYCLE BYPASS (OL-03):** CONTAINED SERVER-SIDE IN OL-03A BEFORE PROVIDER.
- **DATABASE DEFENSE IN DEPTH:** PENDING OL-03B (migración 111 no creada).
- **INVOICING CONCURRENCY:** dos solicitudes realmente simultáneas todavía pueden emitir DOS CFDI en
  el proveedor; la segunda escritura local se rechaza (409) y queda marcada para revisión. OL-03B
  debe resolverlo ANTES de llamar al proveedor.
- **ORDER LIFECYCLE INTEGRITY:** NO cerrado. **INVOICING INTEGRITY:** NO cerrado.
- **Siguiente fase:** OL-03B, primero diseño/auditoría de solo lectura (defensa en base de datos
  `Entregada ↔ Facturada` y serialización/idempotencia previa al proveedor).
- **B3.6 (Ventas como un solo espacio de trabajo):** bloqueo de ciclo de vida CERRADO; NOT STARTED;
  alcance recomendado en la auditoría post OL-02 (2026-10-06), pendiente de revisión del dueño.
- **ROLE UI CONVERGENCE:** Opción C y D siguen NO autorizadas; Facturación / Sin asignar sin cambio.
- **Reestructura de contexto:** Fase 2 PENDING y sin autorizar.

## Residuales abiertos
Ciclo de vida de la orden y pagos:
- **P1-1 Facturación (OL-03):** el bypass (timbrar cualquier estatus → `Facturada` con fecha de
  entrega e ingreso; cancelar → `Entregada`; cruce de vendedores; CFDI del cliente) está contenido en
  el servidor por OL-03A. Abierto (OL-03B): ventana de CFDI duplicado con solicitudes simultáneas
  (no hay candado previo al proveedor) y ninguna regla de base de datos sobre `Facturada`.
  Sin evidencia de daño histórico en producción (0 `invoice_attempts`, ninguna orden con CFDI).
- **P1-2 Bypass general de service role:** 105 exime a service role/JWT nulo de todas las
  transiciones; 110 solo cubre la entrega sin ruta.
- **Complementos de pago:** `billing-create-complemento` no revisa dueño y confía en montos/saldos
  enviados por el cliente (sin cambio en OL-03A).
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
suites `109_venta_directa_test.sql`, `110_contencion_entrega_directa_test.sql`).

Sustituciones intencionales (no son regresiones): 095 (`update_stocks_atomic` sin acceso de la
API desde 105), 072 (merma FIFO entre cuartos retirada en 103; merma sin valuación desde 106),
106 (apertura declarada al dar de alta un empaque, sustituida por 108: nace en 0) y 110 (la entrega
sin ruta en dos pasos de Ventas/Admin/service role, sustituida por `completar_venta_directa`).
Sin reparación histórica: OV-0086 y los egresos legados de costo (1400) quedan intactos.
