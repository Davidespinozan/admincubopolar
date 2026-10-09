# Plataforma: identidad, permisos, contratos, idempotencia y fecha

## Invariant
Toda autoridad sale del actor canónico: la fila de `usuarios` con `auth_id = auth.uid()` y
`estatus = 'Activo'`. La API (un JWT, aunque sea de Admin) solo cambia dinero, inventario e
historia a través de contratos del servidor; las tablas canónicas no aceptan escritura REST.
El día de negocio lo decide el servidor en America/Mazatlan.

## Source of truth
- Identidad: `usuarios` (`auth_id` único, `estatus`, `rol`) ↔ `auth.users`. Roles: Admin, Ventas,
  Chofer, Producción, Almacén Bolsas, Facturación, Empleado (116), Sin asignar.
- GER-1 (120/121): **Dueño** = Admin + `usuarios.es_dueno` (uno solo; no es un rol); **accesos
  adicionales** `usuarios.accesos_extra` ⊆ {Ventas, Almacén Bolsas}; **contraseña temporal**
  `usuarios.debe_cambiar_password` (sin autoridad hasta cambiarla; huella en `usuarios_password_temporal`).
- Helpers: `erp_rol_activo()` (rol PRINCIPAL), `erp_usuario_id()`, `erp_es_activo()`, `erp_actor_etiqueta()`;
  `get_my_rol()` / `get_my_user_id()` delegan en ellos; `erp_roles_activos()` / `erp_tiene_rol(rol)` (principal +
  accesos) y `erp_es_dueno()` (120); `fin_actor_permitido(roles[])` autoriza cada contrato con TODOS los roles
  del actor (también deja pasar a `service_role` y a SQL sin JWT).
- Idempotencia: `stock_operaciones` (UUID de operación + clave + resultado) con `stock_op_replay`;
  algunas tablas guardan su propio `operacion_id` (producción, cierres, pagos a proveedor, devoluciones).
- Fecha: `fin_zona_negocio()` = America/Mazatlan, `fin_dia_negocio(instante)`, `fin_hoy()`; las
  columnas DATE de negocio tienen `fin_hoy()` por defecto.
- Estado declarado de producción: `docs/STATUS.md`. Repositorio, deploy y base de datos son tres cosas distintas.

## Canonical contracts
No es una lista de funciones: es el patrón que toda mutación de negocio sigue.
- **Contrato:** función `SECURITY DEFINER` con `SET search_path = public, pg_temp`; primer paso
  `fin_actor_permitido(...)`; `REVOKE ALL … FROM PUBLIC, anon` y `GRANT EXECUTE … TO authenticated,
  service_role`; recibe un UUID de operación; bloquea la fila de negocio (`FOR UPDATE`); mismo
  UUID + mismos datos → devuelve el resultado guardado; mismo UUID + otros datos → error 23505;
  actor, montos y fechas los deriva el servidor; deja kardex/auditoría.
- **Guarda de historia:** disparador `SECURITY INVOKER` que usa `b4_escritura_api()`
  (`current_user` es `authenticated` o `anon`). Los contratos (corren como su dueño) y
  `service_role` no son frenados por la guarda.
- **Activación en dos partes:** migración aditiva → frontend que usa el contrato → migración de
  contención que revoca la escritura REST anterior.

## Closed decisions
- **Identidad por `auth_id` + activo, nunca por email (071, 079, 082, 083).** Por qué: el
  auto-registro y los perfiles inactivos pasaban las policies.
- **RLS activa en el libro financiero y sin acceso para `anon` (070, 090).** Por qué: con RLS
  apagada regían los grants de tabla.
- **El JWT de Admin tiene autoridad de negocio pero no reescribe historia canónica (090).** Por
  qué: un navegador comprometido o viejo no debe poder alterar dinero ni inventario pasados.
- **Privilegios por defecto vacíos (090):** una tabla, secuencia o función nueva no otorga nada a
  `anon`, `authenticated` ni `PUBLIC`; cada objeto nuevo necesita su GRANT explícito.
- **`service_role` y SQL de confianza son autoridad de mantenimiento;** los flujos con
  service-role viven en Netlify Functions, no en Edge Functions de Supabase.
- **Idempotencia por UUID de operación en toda mutación de negocio (084 en adelante).** Por qué:
  reintentos, doble clic y respuestas perdidas duplicaban efectos.
- **Usuarios solo por contrato (120/121).** Alta: Netlify `admin-create-user`; cambios: `guardar_usuario`;
  baja = Inactivo (no se borran). Admin gestiona operativos; el rol Admin, otro Admin, el Dueño y los accesos
  adicionales son del Dueño; nadie cambia su propio rol ni estatus. Por qué: Admin podía darse otro rol o
  desactivar al dueño por REST (GER-0 H1).
- **Una regla "rol X solo sobre lo suyo" vale también para quien actúa por acceso adicional (120).** Las
  ramas por rol dentro de funciones usan el rol principal: antes de permitir un acceso adicional nuevo hay que
  revisar cada rama y policy que nombre ese rol (por eso solo Ventas y Almacén Bolsas). Facturación (111–113)
  lee el rol principal y rechaza el acceso adicional.
- **Bitácora de cambios sensibles (120):** `bitacora_cambios` registra toda escritura REST directa en 14 tablas
  (antes/después, actor fijado por el servidor), solo se inserta desde un disparador (`pg_trigger_depth() > 0`),
  no tiene UPDATE/DELETE por API y solo la lee el Dueño. Los contratos dejan `auditoria`.
- **Día de negocio America/Mazatlan decidido por el servidor (096, 098).** Un DATE guardado no se
  convierte; el navegador usa `diaNegocio()` solo para mostrar y filtrar. Por qué: la zona del
  navegador cambiaba la fecha contable.

## Security / mutation boundary
- `anon`: nada. `authenticated`: lectura según policies y solo el DML que el frontend usa
  (mapa en 090, reducido por 091, 094, 097, 099, 101, 103 y 105; la suite `090-07` lo verifica).
- Sin DML REST para nadie: `pagos`, `cuentas_por_cobrar`, `cierres_diarios`, `pagos_proveedores`,
  `nomina_*`, `devoluciones`, `inventario_mov`, `mermas`, `stock_operaciones`, `costos_empaque_historial`.
- Admin por REST conserva catálogo y metadatos (productos, clientes, precios, cuartos sin existencia,
  rutas), asientos contables manuales y cuentas por pagar (todo ello queda en la bitácora; su paso a
  contratos con aprobación del Dueño es GER-2/GER-3). `usuarios`: sin DML REST desde 121.
- El auto-registro de Supabase Auth se deshabilitó al activar 071 (configuración del proyecto,
  no verificable desde el repositorio: confirmar si se toca Auth).

## Dependencies
Ninguna. Es la base de las demás tarjetas.

## Evidence
Migraciones 069–071, 073–075, 077–083, 085, 090/091, 096, 116–121. Suites `069`, `071`, `079`, `082`,
`083`, `090`, `117`, `119`, `120`, `121`; Vitest `ger1DuenoAccesos`. El runner local comprueba RLS, `search_path` y referencias no calificadas en cada
corrida. Vitest `b4Privilegios` compara los grants con las escrituras directas del frontend.

## Open residuals
- `increment_saldo` (solo limpieza) y `error_log` con INSERT abierto (riesgo de observabilidad).
- `service_role` y SQL de confianza pasan las guardas por diseño (y tienen la autoridad del Dueño en `guardar_usuario`).
- GER-1: el cambio obligatorio de contraseña es OPCIONAL y nace apagado (decisión del dueño, 2026-10-09): sin
  marcarlo, la contraseña inicial que elige Administración sirve hasta que alguien la cambie (quien la conozca
  entra a la cuenta, también a una de Admin). Con la casilla marcada aplica la contraseña temporal de 120. El
  acceso adicional no factura. Chofer (modo enfoque) no muestra accesos adicionales en pantalla.
- `git push` está preaprobado en la configuración local de Claude; la regla de autorización está en `CLAUDE.md`.

## Load this card when
RLS, policy, grant, rol, usuario, autenticación, `SECURITY DEFINER`, `search_path`, idempotencia,
`operacion_id`, fecha o zona horaria, tabla o función nueva, contrato nuevo, guarda, `service_role`.
