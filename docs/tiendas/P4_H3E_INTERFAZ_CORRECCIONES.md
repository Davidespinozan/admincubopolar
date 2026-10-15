# P4-H3E — Interfaz de correcciones autorizadas de inventario de tiendas

Fecha: 2026-10-15. Estado: **IMPLEMENTED LOCAL · VERIFIED LOCAL** · DEPLOYED PROD: **no** · VALIDATED REAL SESSION: **no**.
Solo frontend: sin SQL, migraciones, RPC, RLS ni permisos. Consume la migración 153 (CLOSED PROD, SHA-256 `5f6dfc9f…1699`), sin cambiarla.

## 1. Ubicación

**Inventario → pestaña "Correcciones de tiendas"** (al lado de "Congeladores"). Solo la ve el rol Admin (Administración y
Dueño). Es una pestaña dentro de Inventario, no un módulo nuevo: no cambia el menú. El módulo Tiendas no se usó porque la
corrección debe funcionar con la tienda inactiva y el interruptor apagado (D-H3-07), y su lugar natural es el inventario. La
pantalla se carga solo al abrir la pestaña (`lazy`).

## 2. Componentes

| Archivo | Qué hace |
|---|---|
| `src/data/correccionesTiendaLogic.js` | Lógica pura: perfil por persona, botones por fila, congeladores de una tienda, diferencia, validación, parámetros exactos de cada contrato, claves de operación, enviador idempotente, traducción de los códigos de 153, filtros y resumen |
| `src/components/CorreccionesTienda.jsx` | Pantalla: explicación, resumen por estado, filtros, tabla y diálogos (solicitar → confirmar, autorizar/rechazar, ejecutar → resultado, cancelar) |
| `src/data/supaStore.js` | 5 acciones, una por contrato (`corrRpc`), y una lectura fresca del congelador (`select id, nombre, stock, establecimiento_id`) |
| `src/components/views/InventarioView.jsx` | Pestañas "Congeladores" / "Correcciones de tiendas" (solo Admin) |
| `src/components/CuboPolarERP.jsx` | Inventario recibe el usuario con `usuarios.id` resuelto (`usuarioRol`), para "su propia solicitud" y "quien autorizó" |

## 3. Contratos consumidos (parámetros comprobados contra la firma SQL en la prueba)

| Contrato | Parámetros | Uso |
|---|---|---|
| `correcciones_tienda_consulta` | `p_establecimiento_id`, `p_limite` (200) | historial con `estado_efectivo` |
| `solicitar_correccion_tienda` | `p_operacion_id`, `p_cuarto_id`, `p_sku`, `p_existencia_vista`, `p_existencia_propuesta`, `p_motivo` | solicitar |
| `autorizar_correccion_tienda` | `p_operacion_id`, `p_correccion_id`, `p_decision` (`autorizar`/`rechazar`), `p_nota` | decidir |
| `ejecutar_correccion_tienda` | `p_operacion_id`, `p_correccion_id` (nada más) | ejecutar |
| `cancelar_correccion_tienda` | `p_operacion_id`, `p_correccion_id`, `p_motivo` | cancelar / cerrar vencida |

Nombres de tienda: `estado_tienda(null)` (Admin, ya existente). La tabla privada no se toca desde ningún archivo del frontend.

## 4. Permisos de la pantalla (experiencia; la autoridad es 153)

| Acción | Administración (Admin sin `es_dueno`) | Dueño (Admin + `es_dueno`) | Ventas, Ventas Tienda, Chofer, Producción, Facturación, sin rol |
|---|---|---|---|
| Ver la pestaña / historial | sí | sí | no (sin pestaña) |
| Solicitar | sí | no | no |
| Autorizar / rechazar | no | sí, solo solicitadas ajenas | no |
| Ejecutar | sí, autorizadas vigentes que no autorizó | no | no |
| Cancelar | solo lo que solicitó, abierto | cualquiera abierta | no |

El Dueño se identifica con `esDueno` (`es_dueno`/`esDueno`), el mismo mecanismo de Auditoría y Usuarios; no solo con el rol Admin.
Sin `usuarios.id` conocido no se ofrecen las acciones que dependen de la persona.

## 5. Estados

Solicitada · Autorizada · Ejecutada · Rechazada · Cancelada · Vencida, con texto (no solo color). Se muestra `estado_efectivo`
del servidor: una autorizada cuyo plazo pasó aparece "Vencida" y su botón es "Cerrar como vencida" (153 la cierra como vencida).

## 6. Flujos

- **Solicitar:** tienda (solo tiendas con congelador propio, de `estado_tienda`) → congelador de esa tienda (por
  `establecimiento_id`; nunca el CEDIS ni lo desconocido) → producto → existencia registrada leída del servidor al elegir →
  contada → diferencia (contada − registrada; positiva, negativa o sin diferencia) → motivo (≥ 10) → **Revisar** (vuelve a
  leer el congelador; si la existencia cambió, avisa y pide recontar) → resumen con "no modifica todavía el inventario" →
  enviar.
- **Autorizar/rechazar (Dueño):** detalle completo; explica 24 h (fija el servidor), que no mueve inventario y que quien autoriza
  no ejecuta; nota opcional (`p_nota`). Al autorizar muestra el `vence_at` que devolvió el servidor.
- **Ejecutar (Administración):** antes de abrir relee el historial del servidor; solo abre si sigue autorizada y vigente.
  Advierte que **sí modifica el inventario**. Resultado con lo que respondió el servidor: existencia anterior y resultante,
  diferencia y movimiento de kardex. Tras el éxito el store recarga los datos (existencias y kardex) y la pantalla el historial.
- **Cancelar:** motivo (≥ 5); nunca sobre ejecutada, rechazada o cancelada.

## 7. Idempotencia

`crearEnviadorCorrecciones`: por cada intento lógico (clave = datos del intento) usa siempre la misma `p_operacion_id` hasta que
el servidor confirma; un segundo envío de la misma clave mientras el primero sigue en camino se ignora (doble clic); tras un error
(de red o rechazo) la operación se conserva y el reintento la reutiliza: 153 responde `replay` sin duplicar. El botón cambia a
"Reintentar (misma operación)" cuando el resultado es incierto. Un intento nuevo, tras un éxito, es otra operación.

## 8. Errores

Los 21 códigos que pueden devolver los contratos de 153 (y `CORRECCION_INMUTABLE` de sus disparadores) tienen mensaje propio
(sin SQL ni trazas), entre ellos `SOLO_ADMINISTRACION`,
`SOLO_DUENO`, `AUTOAUTORIZACION`, `AUTORIZADOR_NO_EJECUTA`, `CONTEO_OBSOLETO` («La existencia cambió desde que se solicitó la
corrección. Es necesario realizar un nuevo conteo y generar otra solicitud.»), `AUTORIZACION_VENCIDA`, `SKU_NO_VALIDO`,
`CUARTO_NO_ES_DE_TIENDA`, `CUARTO_NO_PERTENECE`, `CORRECCION_ABIERTA`, `OPERACION_REUSADA`, `YA_EJECUTADA`, `ESTADO_INVALIDO`.
Red, tiempo agotado o respuesta sin rechazo reconocible → **incierto** (nunca éxito). El detalle técnico queda en la consola
(`console.warn`), como el resto de contratos.

## 9. Pruebas

`src/__tests__/p4h3eCorreccionesTienda.test.jsx` (32): roles 1–8, solicitud 9–17, autorización 18–22, ejecución 23–30,
historial y cancelación 31–35, regresión 36–40; además, parámetros = firma SQL de cada contrato y todos los códigos de 153
traducidos. Vitest completo **2,047 / 2,047** en UTC, Mazatlán, CDMX y Madrid; lint, typecheck, build y `git diff --check` limpios.
Sin SQL modificado: no se re-corrieron suites SQL.

Hallazgo corregido durante las pruebas: "Cerrar como vencida" se calculaba sin exigir permiso de cancelar.

## 10. Riesgos residuales

- La operación de un intento vive en memoria: si se recarga la página tras un resultado incierto, el reintento usa otra
  operación; el servidor sigue sin duplicar (`YA_EJECUTADA`, `CORRECCION_ABIERTA`, `ESTADO_INVALIDO`) y la lista muestra la verdad.
- El historial trae las últimas 200 correcciones (filtros locales sobre ellas).
- Sin pruebas de interacción en navegador (el proyecto no tiene DOM de pruebas); el comportamiento se probó con lógica pura,
  render estático y el enviador.
- Sin validación con sesiones reales (Administración y Dueño) ni corrección real de punta a punta.
- Las otras cuatro superficies centrales que listan el congelador de la tienda siguen sin cambio (fuera de alcance).

## 11. Estado de despliegue

Commit local en `tiendas-e9-cierre-integral`. **No publicado.** Publicar requiere aislarlo sobre `origin/main` (`547e5f9`), como
P4-H3D2, y autorización del dueño.
