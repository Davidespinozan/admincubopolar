---
name: gate-local
description: Gate local de CuboPolar antes de dar por buena una fase — base Postgres local con todas las migraciones y suites SQL, Vitest en cuatro zonas horarias, lint, typecheck y build. Úsalo al implementar o modificar una migración, un contrato SQL o lógica de frontend ligada a contratos, y siempre antes de activar-produccion.
---

# Gate local

Todo corre en la máquina local. Ninguna prueba que escriba toca producción. `.env` apunta a
PRODUCCIÓN: el gate no usa `npm run dev` ni flujos de la app.

## 1. Base local (runner)

El runner `supabase/tests/local/run_local_db.mjs` levanta un Postgres embebido (puerto 5499, base
`cubopolar_test`, usuario `tester`), reconstruye el esquema con las migraciones del repo en el
orden de producción y corre cada fase: paridad → migración ×2 → chequeo RLS → suite → re-corrida
de suites anteriores → concurrencia con dos conexiones.

Sus dependencias NO están en `package.json`. Instálalas en un directorio de trabajo FUERA del repo
(el que quieras; no lo dejes fijo en ningún archivo versionado):

    WORK=<directorio de trabajo fuera del repo>
    mkdir -p "$WORK" && (cd "$WORK" && npm init -y >/dev/null && npm i embedded-postgres pg)
    WORK="$WORK" NODE_PATH="$WORK/node_modules" node supabase/tests/local/run_local_db.mjs > "$WORK/gate.log" 2>&1; echo "exit=$?"

- Versiones con las que corrió el 2026-10-05: `embedded-postgres` 18.4.0-beta.17, `pg` 8.23.1,
  macOS arm64. No están fijadas: si una versión nueva falla, instala esas.
- En otra plataforma, define `PG_BIN` con el directorio `bin` de un Postgres 16+.
- Tarda varios minutos. El runner borra y recrea la base en cada corrida y apaga Postgres al terminar.
- Si el directorio de trabajo está en una carpeta temporal del sistema, puede desaparecer entre
  sesiones: se reinstala con los mismos tres comandos.

### Cómo leer el log

- Verde = `exit=0` y última línea `RESULTADO: OK`.
- Ruido ESPERADO al inicio (no es falla): `archivos con errores (esperado…)` en las migraciones
  base, `RLS_CHECK[069 sin 070 …]: FAIL` y `ERROR … A. Producción no puede poner CxC en 0`
  (reproducen a propósito el hueco anterior a 070).
- Todo lo demás debe estar limpio: busca `FAIL`, `ERROR en sentencia`, `NEEDS REVIEW`, `NO_RESUELVE`
  y `RESULTADO: FALLÓ` después de esas primeras líneas.

### Probar una migración suelta

Con Postgres local encendido (`"$PG_BIN/pg_ctl" -D "$WORK/pgdata" -o "-p 5499" start`, donde
`PG_BIN` es por defecto `$WORK/node_modules/@embedded-postgres/<plataforma>/native/bin`):

    NODE_PATH="$WORK/node_modules" node .claude/skills/gate-local/aplica-dos-veces.cjs supabase/NNN_x.sql

Aplica dos veces dentro de una transacción con ROLLBACK. La base queda como la dejó la última corrida del runner.

## 2. Integrar una fase nueva al runner (4 puntos)

1. Excluir la migración de la base: agrega `!f.startsWith('NNN_')` al filtro de `files`.
2. Bloque de fase (copia el de la fase anterior): paridad → aplicar ×2 → `rlsCheck` → suite
   `supabase/tests/NNN_*_test.sql` → `reruns090('NNN', omitir)` → lista `SUITES_NNN` → función de concurrencia.
3. Agrega cada función `SECURITY DEFINER` nueva a la lista `F069` (chequeo de `search_path`).
4. Suites anteriores que la fase cambia a propósito: hazlas conscientes de la fase (la misma
   suite corre antes y después de la contención); no borres aserciones para "ponerla en verde".

Paridad local ≠ producción ya resuelta en el runner (no la deshagas): elimina
`trg_nomina_periodos_updated` y `cuentas_por_cobrar_monto_original_check`, que producción no tiene.
Si una prueba falla por algo que solo existe en local, comprueba primero cómo está en producción
(`verificar-produccion`, solo lectura) y documenta el ajuste en el runner.

## 3. Frontend

    for tz in UTC America/Mazatlan America/Mexico_City Europe/Madrid; do TZ=$tz npx vitest run || break; done
    npm run lint          # 0 errores
    npm run typecheck
    npm run build
    git diff --check

Si el número de tests BAJA respecto a la corrida anterior, se pisó un archivo de pruebas:
revísalo antes de seguir.

## 4. Reporte del gate

Por cada parte: comando, resultado y conteos (suites SQL, tests Vitest por zona). Un gate
incompleto se reporta como incompleto, con lo que faltó. Gate en verde = `LOCAL-VALIDATED`,
nada más: no implica commit, deploy ni producción.
