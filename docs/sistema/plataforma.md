# Plataforma: identidad, permisos, contratos, idempotencia y fecha

## Invariant
Toda autoridad sale del actor canónico: la fila de `usuarios` con `auth_id = auth.uid()` y
`estatus = 'Activo'`. La API (un JWT, aunque sea de Admin) solo cambia dinero, inventario e
historia a través de contratos del servidor; las tablas canónicas no aceptan escritura REST.
El día de negocio lo decide el servidor en America/Mazatlan.

## Source of truth
- Identidad: `usuarios` (`auth_id` único, `estatus`, `rol`) ↔ `auth.users`. Roles: Admin, Ventas,
  Chofer, Producción, Almacén Bolsas, Facturación.
- Helpers: `erp_rol_activo()`, `erp_usuario_id()`, `erp_es_activo()`, `erp_actor_etiqueta()`;
  `get_my_rol()` / `get_my_user_id()` delegan en ellos; `fin_actor_permitido(roles[])` autoriza
  cada contrato (también deja pasar a `service_role` y a SQL sin JWT).
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
- **Día de negocio America/Mazatlan decidido por el servidor (096, 098).** Un DATE guardado no se
  convierte; el navegador usa `diaNegocio()` solo para mostrar y filtrar. Por qué: la zona del
  navegador cambiaba la fecha contable.

## Security / mutation boundary
- `anon`: nada. `authenticated`: lectura según policies y solo el DML que el frontend usa
  (mapa en 090, reducido por 091, 094, 097, 099, 101, 103 y 105; la suite `090-07` lo verifica).
- Sin DML REST para nadie: `pagos`, `cuentas_por_cobrar`, `cierres_diarios`, `pagos_proveedores`,
  `nomina_*`, `devoluciones`, `inventario_mov`, `mermas`, `stock_operaciones`, `costos_empaque_historial`.
- Admin por REST conserva catálogo y metadatos (productos, clientes, precios, usuarios, cuartos
  sin existencia, rutas), asientos contables manuales y cuentas por pagar.
- El auto-registro de Supabase Auth se deshabilitó al activar 071 (configuración del proyecto,
  no verificable desde el repositorio: confirmar si se toca Auth).

## Dependencies
Ninguna. Es la base de las demás tarjetas.

## Evidence
Migraciones 069–071, 073–075, 077–083, 085, 090/091, 096. Suites `069`, `071`, `079`, `082`,
`083`, `090`. El runner local comprueba RLS, `search_path` y referencias no calificadas en cada
corrida. Vitest `b4Privilegios` compara los grants con las escrituras directas del frontend.

## Open residuals
- `increment_saldo` (solo limpieza) y `error_log` con INSERT abierto (riesgo de observabilidad).
- `service_role` y SQL de confianza pasan las guardas por diseño.
- `git push` está preaprobado en la configuración local de Claude; la regla de autorización está en `CLAUDE.md`.

## Load this card when
RLS, policy, grant, rol, usuario, autenticación, `SECURITY DEFINER`, `search_path`, idempotencia,
`operacion_id`, fecha o zona horaria, tabla o función nueva, contrato nuevo, guarda, `service_role`.
