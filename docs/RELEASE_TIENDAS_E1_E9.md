# CUBOPOLAR · Tiendas propias E1–E9 — paquete de release

Preparado el 2026-10-13. **Nada de esto está en producción.** Producción está en la migración 142
y sin frontend de Tiendas. Este documento no autoriza nada: cada paso marcado **[AUTORIZACIÓN]**
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

Orden estricto 143 → 144 → 145 → 146 → 147 → 148 → 149 → 150, una vez cada una, por quien el dueño
designe (hasta hoy las pega el dueño en el SQL Editor). Son compatibles con el frontend
desplegado, que no usa nada de Tiendas.

Después de CADA una **[SOLO LECTURA]**: la migración terminó sin error; `catalogo_huella.sql`
cambió solo en sus objetos; `estado_negocio.sql` idéntico; `error_log` sin filas nuevas. Si una
falla, no se aplica la siguiente.

Al terminar las ocho **[SOLO LECTURA]**:

```sql
-- SOLO LECTURA. Huellas de lo redefinido = base local validada.
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

-- Estado inicial de Tiendas: apagado y vacío.
SELECT (SELECT habilitada FROM tiendas_activacion) AS interruptor,              -- false
       (SELECT count(*) FROM establecimientos) AS establecimientos,             -- 1 (el CEDIS)
       (SELECT count(*) FROM usuario_establecimientos) AS asignaciones,         -- 0
       (SELECT count(*) FROM cajas) AS cajas, (SELECT count(*) FROM turnos_caja) AS turnos, (SELECT count(*) FROM traspasos) AS traspasos,   -- 0, 0, 0
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_usuarios_guard_ultimo_cajero', 'trg_usuario_establecimientos_guard_ultimo_cajero') AND NOT tgisinternal) AS guardas;  -- 2
```

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
   Antes de apagarlo, si la urgencia lo permite: cerrar turnos y recibir o retornar los traspasos
   en tránsito. Cerrar un turno y confirmar un reembolso siguen disponibles con el interruptor
   apagado (revisado en el código de 146). **No está verificado** que recibir o retornar un
   traspaso funcione con el interruptor apagado: si queda alguno en tránsito, puede hacer falta
   encenderlo de nuevo un momento para resolverlo. El producto en tránsito no está en ningún
   cuarto mientras tanto.
3. **Frontend.** Volver Netlify al deploy anterior. Las migraciones se quedan (son compatibles con
   el frontend anterior). Si ya hay cajeros asignados a una tienda, siguen siendo "Ventas Tienda"
   para la base aunque el frontend anterior no lo sepa: retirarlos de la tienda por contrato antes
   de volver atrás, o no podrán trabajar como Ventas central.

Casos puntuales:
- **Cobro sin confirmar en un aparato** (se perdió la respuesta): en ese mismo aparato, "Revisar
  ese cobro". Reenvía la MISMA operación: si ya estaba registrada muestra su comprobante; si no, la
  registra una sola vez. No capturar la venta otra vez desde otro aparato sin revisar primero.
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
- Recepción o retorno de traspasos con el interruptor apagado: sin verificar (ver K).

---

## Compuertas GO / NO-GO

Cada compuerta se decide con evidencia de producción de ese momento. Un solo "no" = **NO-GO**.

### 1. Antes de aplicar migraciones
- [ ] Autorización expresa del dueño para aplicar 143–150.
- [ ] Producción en la 142, sin objetos de Tiendas.
- [ ] Las 16 huellas de C2 con `ok = true`. **Cualquier huella distinta = NO-GO.**
- [ ] SHA-256 de los ocho archivos igual a la sección A.
- [ ] Fotografía previa guardada (catálogo, estado de negocio, conteos).
- [ ] Momento sin operación crítica en curso (144 y 145 redefinen contratos centrales).

### 2. Antes de publicar frontend y Netlify
- [ ] Autorización expresa del dueño para publicar (distinta de la anterior).
- [ ] Las ocho migraciones aplicadas una vez, sin error, con el catálogo cambiado solo en lo suyo y
      los datos de negocio idénticos.
- [ ] Huellas posteriores de D con `ok = true`. **Falla de identidad = NO-GO.**
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
