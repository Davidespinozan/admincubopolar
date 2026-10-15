# P4-H3D — Inventario central sin "Ajustar stock" para congeladores de tienda

Fecha: 2026-10-15. Estado: **IMPLEMENTED LOCAL · VERIFIED LOCAL · NOT DEPLOYED** (solo frontend; sin SQL, migración, RPC, RLS ni
permisos). Producción sigue en la 153 con el frontend `3e9bfc2`.

## 1. Regla

Un congelador de tienda nunca presenta "Ajustar stock" dentro de Inventario central, sin importar el rol (Admin, Dueño u otro),
si la tienda está activa o inactiva, el interruptor global, la existencia o los permisos centrales. Los ajustes de una tienda se
hacen por el proceso de correcciones autorizadas (153, contratos del servidor; su pantalla es H3E, no incluida).

| Pertenencia del cuarto (`cuartos_frios.establecimiento_id`) | "Ajustar stock" |
|---|---|
| 1 (CEDIS confirmado) | se ofrece (sin cambio) |
| otro entero positivo (tienda) | no se ofrece; el handler lo bloquea |
| ausente, nulo o inválido (desconocido) | no se ofrece; el handler lo bloquea (fail-closed) |

La pertenencia sale SOLO del dato real (`pertenenciaCuarto`, la misma fuente de P4-H2C). Nunca del nombre, la clave, el prefijo
`CONG-`, el nombre de la tienda, el interruptor, el estado activo ni listas fijas de ids.

## 2. Componentes

- `src/data/stockContratosLogic.js` (lógica pura): `puedeOfrecerAjusteCentral(cuarto)`, `validarAjusteCentral(abierto, vigente)`,
  `esErrorInventarioDeTienda(error)` (reconoce el rechazo de la 152 por su `DETAIL` `{"codigo":"INVENTARIO_DE_TIENDA"}`, no por el
  texto) y los mensajes. Mensaje para una tienda, exacto: «Los ajustes de inventario de tiendas deben realizarse mediante el
  proceso de correcciones autorizadas.»
- `src/components/views/InventarioView.jsx`:
  - **Capa A (visibilidad):** el botón "Ajustar stock" de cada tarjeta solo se dibuja si `puedeOfrecerAjusteCentral(cf)`.
  - **Capa B (handler):** al abrir, al confirmar y dentro del ciclo por SKU (antes de CADA envío) se revalida contra el cuarto
    VIGENTE (referencia que se actualiza en cada render con `data.cuartosFrios`, incluido el realtime): mismo id y CEDIS en el
    dato abierto y en el vigente. Si cambió (otro cuarto, pasó a tienda, perdió el dato o ya no está) se bloquea, se cierra el
    diálogo y se avisa (con cuántos SKU ya se ajustaron, si fue a la mitad).
- `src/data/supaStore.js` → `ajustarExistenciaCuarto`: conserva `requireRol(['Admin'])`; antes del RPC relee del servidor
  `cuartos_frios.establecimiento_id` del cuarto y no envía nada si no es CEDIS confirmado (o si la lectura falla). Si aun así el
  servidor rechaza con `INVENTARIO_DE_TIENDA`, muestra el mismo mensaje.

El congelador de la tienda se sigue listando, consultando (existencia) y editando (nombre, temperatura) como antes. No hay
pantallas nuevas ni opciones de H3E.

## 3. Pruebas (`src/__tests__/p4h3dAjusteStockTienda.test.jsx`, 21)

| Pedido | Prueba |
|---|---|
| 1 CEDIS con permiso: visible | `[1]` lógica y render (1 botón, solo el del CEDIS) |
| 2 tienda: oculto | `[2][5][6]` lógica y render |
| 3–4 Admin / Dueño: oculto | `[3][4]` la regla no recibe ni consulta rol ni dueño |
| 5 tienda inactiva / activa · 6 interruptor | `[2][5][6]` variantes sin efecto |
| 7 pertenencia desconocida | `[7]` lógica (undefined, null, '', texto, 0, −1, 1.5) y render |
| 8 CEDIS se ejecuta | `[8]` |
| 9 tienda bloqueada antes del RPC | `[9]` lógica + orden lectura → corte → RPC en el store |
| 10 desconocido bloqueado | `[10]`, `[9][10][13]` store |
| 11–12 datos cambiantes con el diálogo abierto | `[11]` otro cuarto, `[12]` pasó a tienda / perdió el dato |
| 13 cuarto ausente | `[13]` |
| 14 sin cambio de permisos | `[14][19]` `requireRol(['Admin'])` antes de la lectura |
| 15–16 la tienda se lista, consulta y edita | `[15][16]` |
| 17 CEDIS y P4-H2C intactos | `[17]` |
| 18 sin heurísticas | nombre/prefijo engañosos; la vista no contiene `MATRIZ`, `CONG-`, `startsWith('CF-` ni el interruptor |
| 20 rechazo del servidor | reconocido por código (`INVENTARIO_DE_TIENDA`), no por texto |

Regresión: `p4h2cCongeladorTienda`, inventario y cuartos en verde; Vitest completo **2,015 / 2,015** (113 archivos); lint, typecheck,
build y `git diff --check` limpios. Sin base de datos ni producción.

## 4. Compatibilidad

- No cambia ningún contrato: el CEDIS se ajusta igual (`ajustar_existencia_cuarto`, mismo payload y operación).
- La autoridad sigue en el servidor: desde la 152 el ajuste central sobre una tienda se rechaza aunque un cliente viejo lo envíe.
  H3D solo deja de ofrecerlo y agrega una lectura previa de una fila (`id, establecimiento_id`, permitida por la RLS de lectura).
- Un cuarto del CEDIS sin `establecimiento_id` dejaría de ofrecer el ajuste (fail-closed). En producción los 3 cuartos del CEDIS
  tienen `establecimiento_id = 1` (columna NOT NULL desde 143).

## 5. Otras entradas centrales que escriben cuartos (observadas; fuera de alcance, sin cambio)

El servidor (152) ya las rechaza sobre un congelador de tienda; la interfaz todavía puede listarlo como opción:
- Producción → merma de cuarto y salida manual (`ProduccionStandaloneView.jsx`, `registrarMermaCuarto` / `salidaCuartoManual`).
- Inventario → Traspaso entre cuartos (`InventarioView.jsx`, modal de traspaso).
- Venta directa: elección de cuarto (`VentaDirectaOrigen.jsx`).
- Devolución: cuarto de reintegro (`DevolucionModal.jsx`).
Propuesta (no autorizada): aplicar el mismo criterio `pertenenciaCuarto === 'cedis'` a esas listas en un microbloque aparte.

## 6. Riesgos residuales

- Defensa de interfaz, no de seguridad: la garantía es la guarda de la 152.
- La revalidación del diálogo usa el dato en memoria (realtime); la del store consulta al servidor justo antes de enviar, pero entre
  esa lectura y el RPC el servidor sigue siendo quien decide.
- Un ajuste de varios SKU interrumpido a la mitad deja aplicados los anteriores (como antes: cada SKU es su propia operación).
- Sin validación visual con sesión real; sin deploy.

## 7. Estado

IMPLEMENTED LOCAL · VERIFIED LOCAL · COMMITTED (local) · **NOT PUSHED / NOT DEPLOYED**. Publicar requiere integrar la rama con
`origin/main` (no es ancestro) y autorización del dueño.
