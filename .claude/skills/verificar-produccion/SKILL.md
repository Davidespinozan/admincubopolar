---
name: verificar-produccion
description: Verificación de solo lectura de la producción de CuboPolar (catálogo de la base, estado de negocio, conteos, centinelas y frontend desplegado). Úsalo antes y después de aplicar una migración, para confirmar que producción coincide con docs/STATUS.md, o cuando haya duda de si algo está realmente en producción.
---

# Verificar producción (solo lectura)

Solo SELECT y GET. Nunca INSERT/UPDATE/DELETE/DDL, nunca llamar un contrato que escriba, nunca
un login de prueba ni un flujo de la app contra producción. Si para saber algo habría que escribir,
la respuesta es "no verificable en solo lectura" y se reporta así.

## Herramientas

Consultas versionadas en `supabase/tests/prod/` (ver su README). El CLI usa su propia sesión
(`supabase login` + proyecto enlazado); no pidas, leas ni imprimas tokens.

    supabase db query --linked -f supabase/tests/prod/conteos.sql --output json
    supabase db query --linked -f supabase/tests/prod/catalogo_huella.sql --output json
    supabase db query --linked -f supabase/tests/prod/estado_negocio.sql --output json

- `conteos.sql` — chequeo rápido: conteos de objetos, exposición a `anon`, centinelas
  (`error_log` máximo, md5 de OV-0086, cuartos, empaque, día de negocio) y filas por tabla.
- `catalogo_huella.sql` — huella completa del catálogo (roles, grants, funciones, triggers,
  policies, privilegios por defecto) con una huella `fp`.
- `estado_negocio.sql` — md5 y conteos de los datos de negocio.
- `revisar-bundle.sh <cadena>…` (en este skill) — baja el frontend desplegado y cuenta en cuántos
  archivos aparece cada cadena.

Guarda las salidas fuera del repositorio (directorio temporal de trabajo), nunca en `supabase/.temp/`.

## Procedimiento

1. **Rápido:** `conteos.sql` y compara con `docs/STATUS.md` (conteos, centinelas, migración más alta).
2. **Antes de una activación:** guarda `catalogo_huella` y `estado_negocio` como "antes".
3. **Después de cada migración:** vuelve a correr ambas y compara ignorando la clave `now`:
   - Catálogo: la diferencia debe ser EXACTAMENTE los objetos que crea, cambia o revoca la
     migración. Cualquier otro cambio es una contradicción.
   - Estado: idéntico, salvo lo que la migración declara (por ejemplo filas de apertura).
4. **Frontend:** `revisar-bundle.sh` con una cadena exclusiva del frontend nuevo. Un deploy
   `ready` en Netlify no basta: confirma que el bundle servido la contiene.
5. **Invariantes del subsistema:** consultas puntuales según la tarjeta (por ejemplo suma por
   cuarto, promedio vs historial de costo). Si la consulta se va a reutilizar, agrégala a
   `supabase/tests/prod/` con un encabezado que diga cuándo y para qué se escribió.
6. **Dependencias:** una migración de contención solo se da por verificada si el bundle vivo ya
   usa el contrato; una fase solo está VALIDATED si pasaron los pasos 3 y 4.

## Reporte

Di qué se comprobó, con qué consulta y en qué fecha. Separa VERIFICADO de DECLARADO (lo que solo
dice STATUS o un commit). Si producción contradice a STATUS o a una tarjeta, repórtalo ANTES de
declarar nada cerrado y no corrijas datos: la corrección es otra fase con su propia autorización.

## Límites conocidos

- La configuración de Supabase Auth (registro deshabilitado) y las variables de Netlify no se
  ven con estas consultas.
- `conteos.sql` se escribió el 2026-10-05; las otras dos son las consultas históricas usadas
  desde 090/093, recuperadas tal cual. No cambies su forma: perderías la comparación con huellas anteriores.
