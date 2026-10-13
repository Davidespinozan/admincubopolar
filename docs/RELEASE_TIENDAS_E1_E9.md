# CUBOPOLAR · Tiendas propias E1–E9 — paquete de release

Preparado el 2026-10-13. **Estado al cierre de P2 (2026-10-13, 20:12Z): las migraciones 143–150 están
aplicadas y verificadas en producción (sección N). Frontend y Netlify de Tiendas NO están publicados;
el interruptor está apagado y no hay ninguna tienda.** Las secciones C y D quedan como registro del
procedimiento que se siguió. Este documento no autoriza nada: cada paso marcado **[AUTORIZACIÓN]**
necesita la palabra del dueño para ESE paso; los marcados **[SOLO LECTURA]** no cambian nada.

Reglas de todo el procedimiento:
- Una autorización no implica la siguiente (migraciones ≠ publicar ≠ encender ≠ activar ≠ vender).
- Un "SUCCESS" del SQL Editor no autoriza el paso siguiente.
- Ante cualquier resultado que no coincida con este documento: **NO-GO**, detenerse y reportar. No
  se corrigen datos ni se adapta una migración sobre la marcha.
- Las pruebas locales no bastan para declarar GO: cada compuerta se decide con lo verificado en
  producción en ese momento.

---

## A. Migraciones (aplicar exactamente estos archivos)

| # | Archivo | SHA-256 | Qué hace |
|---|---|---|---|
| 143 | `supabase/143_establecimientos_estructura.sql` | `afb100ab1c515dd10a6cda376405facd35935b26f4b18abce0ef1fd0c46f7a0f` | Establecimientos, asignaciones e interruptor global (nace apagado) |
| 144 | `supabase/144_proteccion_inventario_cedis.sql` | `d050d9774cac88c2ab61a9c69cb569d234f1222ed46276480031ebf8de8a2b94` | Lo central usa solo inventario del CEDIS (redefine 4 contratos) |
| 145 | `supabase/145_seguridad_por_establecimiento.sql` | `fd1dd9bbedba9d4f0b141f383e3c312d3787e73ae3552295a2106d5981f61f10` | Perfil efectivo "Ventas Tienda" (redefine 5 funciones de identidad), lectura acotada |
| 146 | `supabase/146_pos_cajas_turnos.sql` | `8e03f75ee0bfa33693ec22c93d6c1c087353b9aa367d907192944c8bc30ac496` | Cajas, turnos, venta, corrección y reembolso |
| 147 | `supabase/147_activacion_tienda_fabrica.sql` | `d80d50d5ff0b3d92ec92e42f150bd0d032297d3cb4cbc6b1090c3fb8853a9fcf` | Configuración y activación de una tienda |
| 148 | `supabase/148_traspasos_tiendas.sql` | `ac60223c4507554af37f04eacea13dcbb0f373e98f6ae0e435407c4de56e3537` | Tiendas remotas y traspasos con tránsito |
| 149 | `supabase/149_reportes_establecimientos.sql` | `a7492b55f347d08c3e5b91aeb3a4582f08266bf6e6bc70a797b7fc6a844e2704` | Reportes por establecimiento (solo lectura) |
| 150 | `supabase/150_cierre_integral_tiendas.sql` | `4fdf8993459c3d0f1f50af693af92b4a2fb7056d184cb399d53efb5a95ad2af0` | Último cajero, conciliación de reembolsos, permiso de `service_role` |

Comprobar antes de pegar cada una: `shasum -a 256 supabase/NNN_*.sql`.

## B. Commits locales (rama `tiendas-e9-cierre-integral`; ninguno en el remoto)

| Bloque | Commit |
|---|---|
| E1 (143) | `2083c93` |
| E2 (144) | `b2cc8bf` |
| E3 (145) | `fd7fef3448a39017cf2d8437554484192331f51c` |
| E4 (146) | `dd8d5f2b265321bf5c8fbed5f56b3738469664a0` |
| E5 (interfaz POS y Netlify) | `15e3224e27a476959c2462529675b417f575c6fe` |
| E6 (147) | `3a387e2cb34a77f343039dd2fbdb591394df48f4` |
| E7 (148) | `4f2ceaa5972d8481caefd0c2917421566b45ae2d` |
| E8 (149) | `a8ad876e0472ae61f61379bf189978296f0d5f71` |
| E9 (150) — último commit de código | `ffe6a13e58a09abe6dbcf2bd0fb2a466813c3f3b` |

Encima de E9 va solo documentación (este archivo y `docs/STATUS.md`). Lo que se publique debe ser
ese mismo código: antes del push, `git diff ffe6a13 HEAD -- . ':(exclude)docs'` debe salir vacío, o
la diferencia debe revisarse y validarse de nuevo.

La rama parte de `origin/main` = `a1e3d34` (T5-D2, el commit desplegado según `docs/STATUS.md`),
según la referencia local del remoto. Antes de publicar hay que confirmar que el remoto no avanzó;
si avanzó, se integra y, si la integración toca archivos de Tiendas o los contratos de la sección
C, se repite el gate local completo. Eso es parte del paso F.

---

## C. Precondiciones de producción **[SOLO LECTURA]**

C1. Base: migraciones hasta la 142; ningún objeto de Tiendas todavía.

C2. Huellas de los contratos históricos. Las migraciones 144, 145, 146 y 150 se niegan a aplicarse
si no las encuentran; comprobarlas antes evita un aborto a medio procedimiento.

```sql
-- SOLO LECTURA. Todas deben decir ok = true.
SELECT f.firma, md5(pg_get_functiondef(f.firma::regprocedure)) AS md5, md5(pg_get_functiondef(f.firma::regprocedure)) = f.esperado AS ok
FROM (VALUES
  ('public.confirmar_carga_ruta(uuid,bigint,text,boolean,text)',            'b1be0d0eda13210f828d23572e8d0fb3'),  -- 144 la redefine
  ('public.crear_orden(jsonb,jsonb)',                                       'ef8e49a380d52f870aaccc1bf2ef323c'),  -- 144 la redefine
  ('public.ajustar_existencia(uuid,text,integer,text)',                     'def11d269c049c7301dfa568a96c529f'),  -- 144 la redefine
  ('public.traspaso_cuartos(uuid,text,text,text,integer)',                  '8a03866b79eb80cd45cc3862d43a9b03'),  -- 144 la redefine
  ('public.erp_actor()',                                                    '27277fcf645f05134275473c7892b769'),  -- 145 la redefine
  ('public.erp_roles_activos()',                                            '53c2999e3a7e19c781999d73ea052c68'),  -- 145 la redefine
  ('public.erp_lector_negocio()',                                           'd97f617862eda14b2d86100221e9885b'),  -- 145 la redefine
  ('public.erp_es_activo()',                                                '1e94bc1d08b13cd559e7e678c7e6347e'),  -- 145 la redefine
  ('public.erp_exigir_no_empleado(text)',                                   '51882a9b70cd7451ee315021c6db7bf0'),  -- 145 la redefine
  ('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)', '2107586c1f5b8b59d7a4ff039a1fd0d6'),  -- 146 la usa, no la cambia
  ('public.registrar_pago_orden(bigint,text,text,bigint)',                  'add148ab82529ea5f3b2c4d2fcdb10ca'),  -- 146 la usa
  ('public.registrar_devolucion(uuid,bigint,jsonb,text,text,text,text,text)', 'ba3f4a250794e3b49f54cb167f4a45af'), -- 146 la usa
  ('public.lineas_canonicas(bigint,bigint,jsonb)',                          '1a84a57e4334218972341dcc76e00c28'),  -- 146 la usa
  ('public.precio_canonico(bigint,bigint,text)',                            'c549682fbc47f9a3bb3be82e62a3b80f'),  -- 146 la usa
  ('public.barra_surtir_cuarto(uuid,text,jsonb)',                           '49d3a848ffea9266bf62dd808541f193'),  -- 146 la usa
  ('public.guardar_usuario(bigint,text,text,text,text[])',                  '2b32868497e95e5deaf91af26619ec97')   -- 150 la comprueba, no la cambia
) AS f(firma, esperado);
```

Cualquier `ok = false` o función inexistente = **NO-GO**: producción cambió desde que se validó y
la migración correspondiente debe revisarse en local contra la definición real.

C3. Fotografía previa, guardada fuera del repositorio: `supabase/tests/prod/catalogo_huella.sql`,
`estado_negocio.sql` y `conteos.sql` (incluye el máximo de `error_log`).

C4. Usuarios: lista de usuarios activos por rol (para la regresión de la sección G) y confirmación
de que ningún usuario Ventas tiene hoy una asignación (la tabla aún no existe: se confirma tras 143
que `usuario_establecimientos` tiene 0 filas).

## D. Aplicación de migraciones **[AUTORIZACIÓN: una sola, explícita, para 143–150]**

Nada de esta sección se ha ejecutado. Durante la migración: el interruptor global nace y se queda
**apagado**; no se crea ninguna tienda (solo la fila del CEDIS, id 1); no se asigna ningún usuario
a una tienda (`usuario_establecimientos` queda en 0 filas, así que nadie cambia de perfil); no se
modifica ningún dato comercial histórico (órdenes, pagos, CxC, kardex, existencias, clientes,
usuarios); no se publica frontend ni Netlify.

### D0. Fotografía previa **[SOLO LECTURA]** — el mismo día, justo antes de aplicar

El CLI de Supabase escribe en `supabase/.temp/` del directorio donde corre. Para no tocar el
repositorio, se trabaja sobre una copia fuera de él. Con `--workdir`, el CLI resuelve `-f` contra esa
copia: los archivos SQL van con ruta absoluta (la primera versión de este bloque usaba rutas
relativas y dejaba las fotografías vacías sin avisar; corregido el 2026-10-13):

```
REPO="$(pwd)"                     # raíz del repositorio (ruta ABSOLUTA: con --workdir las relativas no sirven)
SNAP=<carpeta fuera del repositorio>/tiendas-$(date +%Y%m%d-%H%M)
mkdir -p "$SNAP/wd/supabase" && cp -R "$REPO/supabase/.temp" "$SNAP/wd/supabase/.temp"
q() { supabase db query --linked --workdir "$SNAP/wd" -f "$1" --output json > "$2" && test -s "$2" || echo "FALLÓ: $2 quedó vacío"; }

q "$REPO/supabase/tests/prod/catalogo_huella.sql"  "$SNAP/00_catalogo.json"     # catálogo completo
q "$REPO/supabase/tests/prod/estado_negocio.sql"   "$SNAP/00_estado.json"       # datos de negocio
q "$REPO/supabase/tests/prod/conteos.sql"          "$SNAP/00_conteos.json"      # conteos y centinelas
shasum -a 256 "$REPO"/supabase/14[3-9]_*.sql "$REPO"/supabase/150_*.sql > "$SNAP/00_sha256.txt"   # debe ser la sección A
```

Y estas dos consultas (pegadas en el SQL Editor o con `q` desde un archivo en `$SNAP`):

1. La consulta de las 16 huellas de la sección C2 → todas `ok = true`.
2. Versión y conteos (no existe tabla de historial de migraciones: la "cabeza" se reconoce por sus objetos):

```sql
-- SOLO LECTURA. Esperado antes de 143: cabeza_142 = 5, tiendas = 0, 226 · 62 · 96 · 54.
SELECT now() AS cuando,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
     ('cerrar_ruta_admin','iniciar_ruta_admin','conciliacion_ruta','ruta_cobros_pendientes','ruta_cobros_pendientes_interno')) AS cabeza_142,
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname IN
     ('establecimientos','tiendas_activacion','usuario_establecimientos','establecimiento_clientes','cajas','turnos_caja','turnos_caja_eventos',
      'ventas_tienda','correcciones_venta_tienda','establecimiento_eventos','traspasos','traspaso_lineas','traspaso_eventos')) AS tiendas,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS funciones,
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r') AS tablas,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies,
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'S') AS secuencias,
  (SELECT max(id) FROM error_log) AS error_log_max,
  (SELECT count(*) FROM rutas WHERE estatus NOT IN ('Cerrada','Cancelada')) AS rutas_abiertas,
  (SELECT count(*) FROM ordenes WHERE estatus IN ('Creada','Asignada','En ruta')) AS pedidos_abiertos;
```

Detenerse (NO-GO) si: alguna huella no coincide; `tiendas` ≠ 0; los conteos no son los esperados
(algo cambió desde P0: repetir el preflight); hay una ruta abierta o cargándose en ese momento
(144 redefine la carga de ruta y la creación de órdenes: aplicar con la operación en pausa).

### D1. Secuencia 143 → 150

Reglas para cada paso:
- **Acción autorizable:** ejecutar el archivo COMPLETO, tal cual, una sola vez: pegado en el SQL Editor
  de Supabase o con `supabase db query --linked -f <ruta ABSOLUTA del archivo>` (así se hizo en P2). Antes de pegar: `shasum -a 256` del archivo = el de la tabla.
- Cada migración es transaccional en sus precondiciones: si no las encuentra aborta con un mensaje
  que empieza por su número y "No se aplicó nada".
- **Verificación posterior [SOLO LECTURA]:** la consulta de conteos de D0 debe dar los números de
  la tabla; además la comprobación propia de la fila. `00_estado.json` debe seguir idéntico (se
  repite al final; ante cualquier duda, también en medio).
- **Detenerse** ante: error al aplicar; conteos distintos de la fila; `error_log_max` mayor que en
  D0; interruptor encendido; cualquier fila en `usuario_establecimientos`. No se aplica la
  siguiente, no se "repara" nada, y se reporta. Las ocho son re-aplicables (idempotentes), pero
  volver a pegar una que falló solo se hace tras entender el error.

Conteos esperados después de cada una (funciones · tablas · policies · secuencias), partiendo de
226 · 62 · 96 · 54:

| # | SHA-256 (inicio…fin) | Precondición que comprueba el propio archivo | Conteos después | Comprobación propia [SOLO LECTURA] |
|---|---|---|---|---|
| 143 | `afb100ab…46f7a0f` | El CEDIS debe quedar como establecimiento 1; ningún cuarto fuera del CEDIS | 231 · 65 · 96 · 55 | `SELECT habilitada FROM tiendas_activacion` = false · `establecimientos` = 1 fila (id 1, `cedis`) · los 3 cuartos con `establecimiento_id = 1` · `ordenes.establecimiento_id` todo NULL |
| 144 | `d050d977…e8a2b94` | 143 aplicada; CEDIS = 1; huellas 1–4 de C2 | 233 · 65 · 96 · 55 | md5: `confirmar_carga_ruta` `50ce141b…`, `crear_orden` `ccdd240c…`, `ajustar_existencia` `0a5f9c2c…`, `traspaso_cuartos` `f73c7272…` · disparador `trg_cuartos_frios_actor` |
| 145 | `fd1dd9bb…81f61f10` | 143 y 144 aplicadas; huellas 5–9 de C2 | 242 · 66 · 101 · 55 | md5: `erp_actor` `e1a9770e…`, `erp_roles_activos` `5da5963d…`, `erp_lector_negocio` `858e98ff…`, `erp_es_activo` `9b87432b…`, `erp_exigir_no_empleado` `d87bc09b…` · 5 policies `tienda_read` · consulta de identidad de abajo |
| 146 | `8e03f75e…c30ac496` | 145 aplicada; huellas 10–15 de C2 | 257 · 71 · 108 · 59 | `cajas`, `turnos_caja`, `ventas_tienda`, `correcciones_venta_tienda` con 0 filas · `ordenes.turno_id` todo NULL · `completar_venta_directa` sigue `2107586c…` |
| 147 | `d80d50d5…853a9fcf` | 145 y 146 aplicadas | 269 · 72 · 109 · 60 | `establecimiento_eventos` 0 filas · existen `activar_tienda`, `estado_tienda`, `tienda_checklist` |
| 148 | `ac60223c…e56e3537` | 147 aplicada; `tienda_checklist`, `retirar_usuario_tienda` y `guardar_establecimiento` de 147 | 282 · 75 · 109 · 63 | md5: `tienda_checklist` `e82e731d…`, `retirar_usuario_tienda` `dd831c01…`, `guardar_establecimiento(bigint,text,text,text)` `1ea7cfab…` (la de 3 argumentos ya no existe) · `traspasos` 0 filas |
| 149 | `a7492b55…44e2704` | 146 a 148 aplicadas | 287 · 75 · 109 · 63 | existen los 4 `reporte_*` de tienda · `reporte_financiero` sigue `32f90860…` |
| 150 | `4fdf8993…a95ad2af0` | 143–149 aplicadas; huella 16 de C2 (`guardar_usuario`) | 291 · 75 · 109 · 63 | disparadores `trg_usuarios_guard_ultimo_cajero` y `trg_usuario_establecimientos_guard_ultimo_cajero` · `guardar_usuario` sigue `2b328684…` · sección E |

Los conteos salen de comparar el catálogo de producción (P0) con la base local que tiene las ocho
aplicadas: 65 funciones nuevas (148 sustituye una firma de 147: suma 13), 13 tablas, 13 policies y
9 secuencias. Si un número no coincide, se detiene y se revisa con `catalogo_huella.sql` contra
`00_catalogo.json`; no se sigue "porque la diferencia parece menor".

Identidad, tras 145 **[SOLO LECTURA]** — nadie cambia de perfil:

```sql
SELECT (SELECT count(*) FROM usuario_establecimientos) AS asignaciones,                                       -- 0
       (SELECT count(*) FROM usuarios u WHERE erp_usuario_de_tienda(u.id)) AS usuarios_de_tienda,             -- 0
       (SELECT jsonb_object_agg(rol, n) FROM (SELECT rol, count(*) n FROM usuarios WHERE estatus = 'Activo' GROUP BY 1) z) AS activos_por_rol;  -- igual que en D0
```

`erp_actor()` no se puede probar desde el SQL Editor (no hay sesión de usuario): el perfil real de
cada rol se confirma en la sección G, con personas reales, después de publicar. Por eso 145 se
verifica aquí por huella y por "cero usuarios de tienda", y la publicación tiene su propia compuerta.

### D2. Verificación final **[SOLO LECTURA]**

1. Las huellas posteriores (son **14**, distintas de las 16 previas de C2: 9 funciones redefinidas
   por 144 y 145 con su valor NUEVO, 3 de tienda que ajusta 148 y 2 que deben seguir intactas):

```sql
SELECT f.firma, md5(pg_get_functiondef(f.firma::regprocedure)) = f.esperado AS ok
FROM (VALUES
  ('public.confirmar_carga_ruta(uuid,bigint,text,boolean,text)', '50ce141b71b2692a015a1cd77e780fec'),
  ('public.crear_orden(jsonb,jsonb)',                            'ccdd240c58f69d89699c99c89199e911'),
  ('public.ajustar_existencia(uuid,text,integer,text)',          '0a5f9c2c95b89c0deb8a38bca5dd7f8a'),
  ('public.traspaso_cuartos(uuid,text,text,text,integer)',       'f73c7272614080b951bfc3d813f8dff4'),
  ('public.erp_actor()',                                         'e1a9770e1bc5cebd7f565c9cfdc2a880'),
  ('public.erp_roles_activos()',                                 '5da5963d56554336793351384f018d74'),
  ('public.erp_lector_negocio()',                                '858e98ff65b09e80477dde7298b164d2'),
  ('public.erp_es_activo()',                                     '9b87432b5056856944453a60c4e97ff2'),
  ('public.erp_exigir_no_empleado(text)',                        'd87bc09bf29e8c06dcedff936e13c12f'),
  ('public.tienda_checklist(bigint)',                            'e82e731dfb92f198af09515be6977c3f'),
  ('public.retirar_usuario_tienda(bigint,bigint,boolean)',       'dd831c01be1739380348d10ee260bd58'),
  ('public.guardar_establecimiento(bigint,text,text,text)',      '1ea7cfabf6fe2a9ccc0550db21ae60ca'),
  ('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)', '2107586c1f5b8b59d7a4ff039a1fd0d6'),
  ('public.guardar_usuario(bigint,text,text,text,text[])',       '2b32868497e95e5deaf91af26619ec97')
) AS f(firma, esperado);
```

   Estas 14 se validaron contra la base LOCAL (14 de 14). En producción se leen aquí por primera
   vez: producción corre PostgreSQL 17.6 y la base local 18; las 16 previas coincidieron entre
   ambas, así que no se espera diferencia de formato, pero si alguna diera `false` con la migración
   aplicada sin error, es **NO-GO para publicar** y se compara la definición completa antes de seguir.

2. Estado inicial de Tiendas, apagado y vacío:

```sql
SELECT (SELECT habilitada FROM tiendas_activacion) AS interruptor,              -- false
       (SELECT count(*) FROM establecimientos) AS establecimientos,             -- 1 (el CEDIS)
       (SELECT count(*) FROM usuario_establecimientos) AS asignaciones,         -- 0
       (SELECT count(*) FROM cajas) AS cajas, (SELECT count(*) FROM turnos_caja) AS turnos, (SELECT count(*) FROM traspasos) AS traspasos,   -- 0, 0, 0
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_usuarios_guard_ultimo_cajero', 'trg_usuario_establecimientos_guard_ultimo_cajero') AND NOT tgisinternal) AS guardas;  -- 2
```

3. `q "$REPO/supabase/tests/prod/estado_negocio.sql" "$SNAP/99_estado.json"` → idéntico a `00_estado.json`
   (esa consulta lee columnas concretas de órdenes, pagos, CxC, kardex y existencias: las columnas
   nuevas no la alteran). `99_catalogo.json` contra `00_catalogo.json`: la diferencia son solo los
   objetos de 143–150. `error_log_max` igual que en D0.
4. Sección E (rol de servicio).

Con D2 y E en verde, las migraciones quedan MIGRATION APPLIED / VALIDATED. Eso **no** autoriza
publicar: la compuerta 2 es aparte.

## E. `erp_usuario_de_tienda` y el rol de servicio **[SOLO LECTURA]**

Las Netlify Functions preguntan el perfil de tienda con esta función usando el rol de servicio.
Si no pueden ejecutarla responden 503 a TODO usuario con rol Ventas (fallan cerrado).

```sql
SELECT has_function_privilege('service_role',  'public.erp_usuario_de_tienda(bigint)', 'EXECUTE') AS servicio,       -- true
       has_function_privilege('authenticated', 'public.erp_usuario_de_tienda(bigint)', 'EXECUTE') AS autenticado,    -- false
       has_function_privilege('anon',          'public.erp_usuario_de_tienda(bigint)', 'EXECUTE') AS anonimo,        -- false
       (SELECT count(*) FROM usuarios u WHERE u.rol = 'Ventas' AND erp_usuario_de_tienda(u.id)) AS ventas_de_tienda; -- 0 (nadie asignado todavía)
```

`servicio = false`, o `ventas_de_tienda > 0` antes de configurar nada = **NO-GO** para publicar.

## F. Publicación de frontend y Netlify **[AUTORIZACIÓN aparte de D]**

1. **[SOLO LECTURA]** Secciones D y E en verde; interruptor apagado (sección H).
2. Confirmar que `origin/main` sigue en `a1e3d34`. Si avanzó: integrar y repetir en local lo que la
   integración toque (vitest en las 4 zonas, lint, typecheck, build; gate de base de datos si cambió SQL).
3. **[AUTORIZACIÓN]** Push a `main` (= deploy de Netlify: frontend y funciones salen juntos).
4. **[SOLO LECTURA]** Netlify `ready` con `commit_ref` = el SHA empujado; bundle vivo con
   `vender_en_tienda`, `reporte_reembolsos_tiendas`, `pos-tienda`, `tiendas-admin`; las funciones
   responden 401 sin sesión; `error_log` sin filas nuevas.

Con el interruptor apagado, el frontend nuevo no cambia la operación central: ningún contrato de
tienda acepta nada y nadie tiene perfil de tienda.

## G. Regresión de usuarios centrales **[SOLO LECTURA + uso normal de cada persona]**

Sin crear datos de prueba. Con una persona real de cada rol, en su trabajo de ese día:

| Rol | Debe seguir igual |
|---|---|
| Admin / Dueño | Entra al panel; ve órdenes, clientes, rutas, finanzas; aparece el módulo Tiendas (vacío) |
| Ventas (central) | Entra a Ventas; ve SUS órdenes; levanta una venta real; genera link de pago o factura si le toca (pasa por Netlify: prueba el perfil efectivo) |
| Chofer | Ve su ruta; entrega y cierra como siempre |
| Producción | Registra producción; mueve entre cuartos del CEDIS |
| Almacén Bolsas, Facturación, Empleado | Entran a lo suyo |

Y en la base **[SOLO LECTURA]**: `SELECT rol, count(*) FROM usuarios WHERE estatus = 'Activo' GROUP BY 1`
igual que antes; `error_log` sin filas nuevas tras ese uso. Un usuario central que pierda acceso,
un 503 de Netlify o un error nuevo = **NO-GO** para encender (y evaluar contención, sección K).

## H. Interruptor global **[SOLO LECTURA]**

```sql
SELECT habilitada, habilitada_at, habilitada_por FROM tiendas_activacion;   -- false, NULL, NULL
```

Debe estar apagado desde 143 hasta que el dueño decida encenderlo. No existe contrato ni pantalla
que lo encienda: solo SQL del dueño. Encenderlo es **[AUTORIZACIÓN aparte]** y por sí solo no
activa ninguna tienda.

```sql
-- OPERACIÓN DEL DUEÑO (no ejecutar sin su autorización expresa para este paso).
UPDATE tiendas_activacion SET habilitada = true, habilitada_at = now(), habilitada_por = '<nombre del dueño>';
```

## I. Primera tienda de fábrica **[AUTORIZACIÓN aparte: configurar y activar]**

Todo por la pantalla (Administración → Tiendas → Configuración); nada por SQL.

1. Alta de la tienda (clave y nombre). Nace inactiva.
2. Congelador propio de la tienda (nace en cero; el producto llega por traspaso, nunca por ajuste).
3. Al menos una caja.
4. Cajeros: **mínimo dos** usuarios con rol Ventas que NO tengan ventas centrales sin terminar ni
   accesos adicionales que vayan a necesitar. Desde ese momento dejan de ser Ventas central.
5. Permisos, cada uno explícito y solo si el dueño lo decide: vender desde el CEDIS (cajero),
   traspasar con el CEDIS (Producción / Admin), recibir traspasos (cajero).
6. Clientes que el punto de venta puede elegir (o solo público en general).
7. Revisar la lista de verificación de la pantalla: todo lo obligatorio en verde.
8. **[AUTORIZACIÓN]** Activar la tienda.

**[SOLO LECTURA]** después: `establecimientos.activo = true` solo para esa tienda; un evento de
activación; `erp_usuario_de_tienda` = true solo para sus cajeros; los cajeros entran y ven
únicamente Punto de venta, Mi turno y Recibir producto.

## J. Prueba operativa supervisada **[AUTORIZACIÓN aparte: primera venta real]**

Con el dueño presente, sesión real de cada persona (Supabase Auth real) y el equipo real de caja.
Es operación real: producto, dinero y clientes reales; no se registran datos de prueba.

1. Abastecer: traspaso CEDIS → tienda (o surtido directo de Producción si tiene permiso) y
   recepción por el cajero. Comparar el congelador físico con la pantalla.
2. Abrir turno con el fondo contado.
3. Una venta real por cada forma de pago que se vaya a usar (efectivo, tarjeta, transferencia).
4. Cierre de turno a ciegas; comparar contado, esperado y diferencia con el dinero físico.
5. Administración → Tiendas → Reportes: la venta en la tienda (no en el CEDIS), la caja y el
   inventario coinciden con lo físico.
6. Solo si ocurre de verdad: una devolución y su reembolso; revisar la conciliación de reembolsos.

Si algo no cuadra: detener la venta en la tienda (sección K) y reportar. No se ajusta a mano.

## K. Contención ante incidentes

Primero entender qué quedó abierto **[SOLO LECTURA]**:

```sql
SELECT 'turno abierto' AS que, t.id::text AS id, e.nombre AS tienda, t.cajero_nombre AS detalle, t.abierto_at AS desde
  FROM turnos_caja t JOIN establecimientos e ON e.id = t.establecimiento_id WHERE t.estado = 'abierto'
UNION ALL SELECT 'traspaso en tránsito', tr.folio, e.nombre, tr.responsable, tr.despachado_at
  FROM traspasos tr JOIN establecimientos e ON e.id = CASE WHEN tr.destino_establecimiento_id = 1 THEN tr.origen_establecimiento_id ELSE tr.destino_establecimiento_id END WHERE tr.estado = 'en_transito'
UNION ALL SELECT 'traspaso sin despachar', tr.folio, e.nombre, tr.responsable, tr.created_at
  FROM traspasos tr JOIN establecimientos e ON e.id = CASE WHEN tr.destino_establecimiento_id = 1 THEN tr.origen_establecimiento_id ELSE tr.destino_establecimiento_id END WHERE tr.estado = 'pendiente'
UNION ALL SELECT 'reembolso pendiente', c.id::text, e.nombre, c.reembolso_medio || ' $' || c.reembolso_monto, c.created_at
  FROM correcciones_venta_tienda c JOIN establecimientos e ON e.id = c.establecimiento_id WHERE c.reembolso_estado = 'registrado'
UNION ALL SELECT 'incidencia abierta', tr.folio, e.nombre, tr.notas_recepcion, tr.recibido_at
  FROM traspasos tr JOIN establecimientos e ON e.id = CASE WHEN tr.destino_establecimiento_id = 1 THEN tr.origen_establecimiento_id ELSE tr.destino_establecimiento_id END WHERE tr.incidencia AND tr.incidencia_cerrada_at IS NULL;
```

Niveles, del menor al mayor **[cada uno es una AUTORIZACIÓN del dueño]**:

1. **Una tienda.** Cerrar sus turnos (cada uno con su conteo; Administración puede cerrar el de
   otra persona escribiendo por qué) y desactivarla con su motivo. El servidor no deja desactivar
   con turnos abiertos. La tienda conserva inventario e historia; sus cajeros no venden.
2. **Todas las tiendas.** Apagar el interruptor (SQL del dueño: `habilitada = false`). Nadie vende,
   abre turno ni despacha. Lo central no cambia.
   Con el interruptor apagado (revisado en el código de 145–148 durante P0; no probado en pantalla):
   - **Traspasos en tránsito: quedan BLOQUEADOS.** Recibir, retornar, cancelar, despachar y cerrar
     una incidencia exigen el interruptor encendido. El producto sigue registrado "en tránsito"
     (no está en ningún cuarto, no se pierde), pero no se puede resolver hasta volver a encenderlo.
   - Cerrar un turno, corregir una venta y confirmar un reembolso NO dependen del interruptor.
   - Abrir turno, vender y reabrir un turno quedan bloqueados (es lo que se busca).
   - El reintento de un cobro sin confirmar se responde desde el registro de la operación antes de
     mirar el interruptor o el turno: sigue funcionando.

   Por eso, **antes de apagarlo y siempre que sea posible:** recibir o retornar todos los traspasos
   en tránsito y cerrar los turnos. **Si la emergencia exige detener las ventas de inmediato,**
   apagarlo puede ser necesario aunque haya traspasos en camino: quedarán pendientes hasta una
   recuperación controlada (encender de nuevo, con autorización del dueño, solo para recibirlos o
   retornarlos, y volver a apagar si la causa sigue). Mientras tanto no se ajusta inventario a mano.
3. **Frontend.** Volver Netlify al deploy anterior. Las migraciones se quedan (son compatibles con
   el frontend anterior). Si ya hay cajeros asignados a una tienda, siguen siendo "Ventas Tienda"
   para la base aunque el frontend anterior no lo sepa: retirarlos de la tienda por contrato antes
   de volver atrás, o no podrán trabajar como Ventas central.

Casos puntuales:
- **Cobro sin confirmar en un aparato** (se perdió la respuesta): en ese mismo aparato, "Revisar
  ese cobro". Reenvía la MISMA operación: si ya estaba registrada muestra su comprobante; si no, la
  registra una sola vez. No capturar la venta otra vez desde otro aparato sin revisar primero.
- **No retirar de la tienda ni dar de baja a un cajero que tenga un cobro sin confirmar** sin
  conciliarlo antes: el reintento exige que siga siendo cajero de esa tienda; si ya no lo es, el
  aparato recibe "no autorizado" y deja de saber si la venta existe. Primero "Revisar ese cobro"
  (o confirmar en Reportes → Ventas que la venta está o no está), y después el retiro o la baja.
- **Aparato perdido o reiniciado con un cobro sin confirmar:** la venta, si llegó, está en la base
  (Reportes → Ventas del día y de esa caja). Si no aparece, no se cobró en el sistema.
- **Reembolso registrado y no entregado:** queda como pendiente en Reportes → Cajas hasta que
  Administración lo confirme. Nunca se confirma dos veces.
- **Último cajero que hay que dar de baja ya:** desactivar la tienda (nivel 1) y después la baja.
- **Baja de un cajero con turno abierto:** se permite; el turno lo cierra Administración.

Las migraciones 143–150 **no se retiran** si ya existe una venta, un turno o un traspaso de tienda.
Sin ninguna historia, la reversión es la del encabezado de cada archivo, de 150 hacia 143; 144 y 145
redefinen contratos centrales y su reversión es volver a aplicar las definiciones anteriores: es
una fase nueva, con su propia validación y autorización.

## L. Aceptación contable y riesgos residuales

Pendiente de aceptación del contador / dueño:
1. Una devolución registra su egreso contable el día de la devolución, aunque el dinero se
   entregue después. El contrato histórico (104) no se cambió; la diferencia se ve en la
   conciliación de reembolsos.
2. Los reportes centrales (`reporte_financiero`, caja) incluyen las ventas de tienda junto con las
   centrales. La separación está solo en Tiendas → Reportes.
3. Dañados y faltantes de un traspaso son piezas registradas como incidencia: no generan merma
   contable ni valor. Si deben valuarse, es una decisión aparte.
4. Forma de pago "Tarjeta (terminal)" y su tratamiento fiscal (mismo pendiente que en lo central).

Riesgos residuales conocidos:
- No validado fuera de local: inicio de sesión real, Netlify con perfil de tienda, realtime,
  equipos de caja reales.
- Pantallas de configuración, corrección de venta y confirmación de reembolso: probadas por la API
  real y por render, no en navegador contra una base real.
- El despacho de traspasos es solo de Administración.
- Retiro y baja simultáneos de la misma persona pueden terminar en un aborto limpio (se reintenta).
- Con un solo cajero, cualquier baja exige desactivar la tienda: por eso el mínimo de dos.
- El ensayo de reversión de 069 no retira las policies `tienda_read` de 145 en `ordenes` y `pagos`.
- Con el interruptor apagado los traspasos en tránsito no se pueden recibir ni retornar (ver K).
- Cerrar turnos y confirmar reembolsos con el interruptor apagado: revisado en código, no probado en pantalla.
- Brechas de paridad entre la base local de pruebas y producción: sección M.

## M. Paridad entre la base local de pruebas y producción (preflight P0, 2026-10-13)

Todo lo de este documento se validó en una base local reconstruida con las migraciones del
repositorio. P0 comparó su catálogo con el de producción. Diferencias encontradas y por qué no
bloquean:

| Diferencia | Efecto sobre 143–150 |
|---|---|
| **Privilegios por omisión.** En producción, lo que crea `postgres` (SQL Editor) nace abierto solo a `postgres` y `service_role`; en local nace abierto también a `anon` y `authenticated`. | Ninguno: las 35 funciones de tienda que usa la aplicación y las 6 tablas que lee llevan `GRANT` explícito a `authenticated`, y lo que debe quedar cerrado lleva `REVOKE`. `service_role` recibe EXECUTE por omisión y además 150 lo otorga explícito para `erp_usuario_de_tienda`. Por esto mismo la sección E se verifica en producción y no se da por buena con la prueba local. |
| `cuartos_frios.stock_minimo` (jsonb NOT NULL, con valor por omisión) existe solo en producción. | Ninguno: el alta de congelador de tienda inserta con lista de columnas. |
| `rutas`: `carga_confirmada_por` es bigint en producción y text en local; `carga_confirmada_at` y `fecha_fin` difieren de tipo; cuatro columnas jsonb son NOT NULL solo en producción. Producción tiene además la llave `rutas_carga_confirmada_por_fkey`. | Bajo: 144 redefine `confirmar_carga_ruta`, que escribe dos de esas columnas, pero esas líneas son las de la definición vigente en producción y 144 no las cambia (solo agrega la restricción al CEDIS). La prueba local de esa función corrió sobre tipos distintos: la primera carga de ruta real tras 144 debe observarse. |
| Valores por omisión en `orden_lineas` y `pagos` (producción los tiene, local no); `productos.empaque_sku` text / varchar. | Ninguno: las inserciones de tienda dan todos esos valores. |
| En local existen, y en producción no: `pagos_monto_check`, llaves de `pagos` y `orden_lineas`, disparadores `updated_at` de 4 tablas, tabla `cuarto_frio_stock`. | Ninguno para Tiendas; es el backlog P3 ya registrado en STATUS. Significa que producción es MENOS estricta que local en esos puntos. |
| `increment_saldo` tiene otro cuerpo en local. | Ninguno: ninguna migración de Tiendas la usa ni la toca. |
| Producción tiene el disparador de evento `ensure_rls` (activa RLS sola en tablas nuevas) y `rls_auto_enable()`. | Ninguno: las migraciones activan RLS en cada tabla de todos modos. |
| PostgreSQL 17.6 en producción, 18 en local. | Las 16 huellas previas coinciden entre ambas; las 14 posteriores se leen en producción por primera vez en D2. |
| En producción hay UN solo usuario Ventas activo. | No afecta la migración. Antes de activar una tienda hay que dar de alta cajeros (mínimo dos por tienda). |

Lo que la base local NO reproduce y por eso se verifica en producción: privilegios por omisión,
Supabase Auth, Netlify con el rol de servicio y realtime.

## N. Registro de ejecución P2 — migraciones 143–150 (2026-10-13)

**DEPLOYED DB / VERIFIED PROD.** Proyecto Supabase `Cubopolar` (`ibjftrjmzkulcoqbuwof`, Central EU).
Las aplicó David desde su terminal con `supabase db query --linked -f`, una vez cada una y en orden;
cada una se verificó en solo lectura antes de la siguiente.

| # | Verificada (UTC) | Conteos (funciones · tablas · policies · secuencias) | Resultado |
|---|---|---|---|
| preflight | 19:54 | 226 · 62 · 96 · 54 — 16 de 16 huellas previas; 0 objetos de Tiendas; sin rutas ni pedidos abiertos | GO técnico |
| 143 | 19:56 | 231 · 65 · 96 · 55 | correcta |
| 144 | 19:58 | 233 · 65 · 96 · 55 | correcta (4 huellas nuevas) |
| 145 | 20:01 | 242 · 66 · 101 · 55 | correcta (5 huellas de identidad; 0 usuarios de tienda) |
| 146 | 20:02 | 257 · 71 · 108 · 59 | correcta |
| 147 | 20:03 | 269 · 72 · 109 · 60 | correcta |
| 148 | 20:06 | 282 · 75 · 109 · 63 | correcta (3 huellas nuevas) |
| 149 | 20:09 | 287 · 75 · 109 · 63 | correcta |
| 150 | 20:12 | 291 · 75 · 109 · 63 | correcta |

Verificación final (D2): 14 de 14 huellas posteriores; catálogo antes contra después = 65 funciones
nuevas, 9 redefinidas, 13 tablas, 13 policies, 17 disparadores, nada retirado ni permisos cambiados en
lo anterior; cada objeto nuevo o redefinido idéntico a la base local validada (definición y
permisos); `service_role` con EXECUTE sobre `erp_usuario_de_tienda`, `authenticated` y `anon` sin
él; interruptor apagado; solo el CEDIS; 0 asignaciones, cajas, turnos, ventas de tienda y traspasos;
estado de negocio idéntico a la fotografía previa; `error_log` máx 4. Fotografías y verificaciones:
`~/.cache/cubopolar-release/tiendas-20261013-1253/` (fuera del repositorio).

**Desviaciones conocidas:**
1. **Sin respaldo restaurable confirmado.** El preflight se detuvo en esa condición (el CLI no pudo
   listar los respaldos del proyecto) y las migraciones se aplicaron sin resolverla. La recuperación
   con la que se procedió es la reversión documentada en el encabezado de cada migración. Después,
   en solo lectura, se observó que el archivado continuo de WAL está activo y sin fallos; eso no
   prueba que el plan permita restaurar. Queda PENDIENTE confirmarlo en el panel de Supabase
   (Database → Backups) antes de operar tiendas con datos reales.
2. La fotografía previa se tomó con rutas absolutas porque el bloque original de D0 fallaba (corregido arriba).
3. El perfil de cada persona con su sesión real no se verificó (no es posible desde SQL): pertenece a la sección G.

---

## Compuertas GO / NO-GO

Cada compuerta se decide con evidencia de producción de ese momento. Un solo "no" = **NO-GO**.

### 1. Antes de aplicar migraciones
- [ ] Autorización expresa del dueño para aplicar 143–150.
- [ ] Producción en la 142, sin objetos de Tiendas.
- [ ] Las 16 huellas de C2 con `ok = true`, leídas el mismo día. **Cualquier huella distinta = NO-GO.**
- [ ] Conteos de D0 = 226 · 62 · 96 · 54 y 0 objetos de Tiendas (si cambiaron desde P0, repetir el preflight).
- [ ] Ninguna ruta abierta ni cargándose en el momento de aplicar 144.
- [ ] SHA-256 de los ocho archivos igual a la sección A.
- [ ] Fotografía previa guardada (catálogo, estado de negocio, conteos).
- [ ] Momento sin operación crítica en curso (144 y 145 redefinen contratos centrales).

### 2. Antes de publicar frontend y Netlify
- [ ] Autorización expresa del dueño para publicar (distinta de la anterior).
- [ ] Las ocho migraciones aplicadas una vez, sin error, con el catálogo cambiado solo en lo suyo y
      los datos de negocio idénticos.
- [ ] Conteos tras 150 = 291 · 75 · 109 · 63 y las 14 huellas posteriores de D2 con `ok = true`. **Falla de identidad = NO-GO.**
- [ ] `service_role` con EXECUTE sobre `erp_usuario_de_tienda`; `authenticated` y `anon` sin él.
      **Sin ese permiso = NO-GO.**
- [ ] 0 usuarios Ventas con perfil de tienda; interruptor apagado; solo el CEDIS.
- [ ] `origin/main` sin commits ajenos desde `a1e3d34`, o rama integrada y validada de nuevo en local.

### 3. Antes de encender el interruptor
- [ ] Autorización expresa del dueño para encenderlo.
- [ ] Deploy `ready` con el commit esperado y bundle vivo verificado.
- [ ] Regresión de usuarios centrales (G) sin incidencias; ningún 503 de Netlify para Ventas.
- [ ] `error_log` sin filas nuevas desde las migraciones.
- [ ] Decidido quién opera la primera tienda y cuándo.

### 4. Antes de activar la primera tienda
- [ ] Autorización expresa del dueño para esa tienda.
- [ ] Lista de verificación del servidor completa en verde.
- [ ] Al menos dos cajeros asignados, sin ventas centrales sin terminar.
- [ ] Permisos de inventario decididos uno por uno por el dueño (ninguno por omisión).
- [ ] Congelador de la tienda en cero, a la espera de su primer traspaso.
- [ ] Los cajeros entran con su sesión real y ven solo su punto de venta.

### 5. Antes de la primera venta real
- [ ] Autorización expresa del dueño.
- [ ] Puntos 1 y 2 de la sección L aceptados por el contador o el dueño.
- [ ] Producto recibido por traspaso y congelador físico = pantalla.
- [ ] Equipo real de caja probado con la sesión real del cajero (entra, abre turno).
- [ ] Dueño o responsable presente; procedimiento de contención (K) a la mano.
- [ ] Definido cómo se entrega el comprobante al cliente.
