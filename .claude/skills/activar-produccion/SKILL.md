---
name: activar-produccion
description: Secuencia para llevar a producción una fase de CuboPolar ya implementada y con gate local en verde (migración aditiva, commit, push/deploy, bundle, contención, verificación). Úsalo solo cuando el usuario autorice explícitamente activar, aplicar una migración en producción, hacer push o deploy.
---

# Activar una fase en producción

Requiere autorización explícita del usuario EN ESTA FASE para cada cosa que se vaya a hacer:
aplicar migraciones, commit, push. Un push a `main` ES un deploy (Netlify publica solo). El permiso
técnico preaprobado de `git push` no es autorización. Si falta alguna autorización: detente y pregunta.

Ningún paso implica el siguiente: commit ≠ push ≠ deploy ≠ migración aplicada ≠ validado.

## Secuencia

1. **Autorización.** Cita la frase del usuario que autoriza y qué alcance cubre.
2. **Línea base.** `git rev-parse HEAD` == línea base de `docs/STATUS.md`; árbol sin cambios ajenos a la fase.
3. **Gate local en verde** (`gate-local`), incluida la aplicación de cada migración dos veces.
4. **Fotografía previa (solo lectura).** Guarda fuera del repo la salida de
   `supabase/tests/prod/catalogo_huella.sql` y `estado_negocio.sql`, más las precondiciones propias
   de la migración (duplicados, nulos, filas que violarían una restricción nueva).
5. **Migración aditiva.** `supabase db query --linked -f supabase/NNN_nombre.sql`. Una sola vez.
   Debe ser compatible con el frontend que hoy está desplegado.
6. **Verificación tras la aditiva (solo lectura).** El catálogo cambió exactamente en los objetos
   de la migración; el estado de negocio no cambió, salvo lo declarado (por ejemplo filas de apertura).
7. **Commit.** Solo archivos de la fase, nunca `supabase/.temp/`. Mensaje en español
   (`feat(NNN): …`) con la línea de atribución vigente.
8. **Push a `main`** (= deploy). Solo con autorización explícita de esta fase.
9. **Esperar el deploy.** El `siteId` está en `.netlify/state.json` (archivo ignorado; no lo copies al repo):
   `netlify api listSiteDeploys --data '{"site_id":"<siteId>","per_page":1}'` hasta `state: ready`
   con `commit_ref` == el SHA empujado.
10. **Bundle vivo.** `verificar-produccion/revisar-bundle.sh` con cadenas que solo existen en el
    frontend nuevo (nombre del contrato nuevo) y, si aplica, cadenas que ya no deben existir.
11. **Contención.** Solo cuando el bundle vivo ya usa el contrato: aplica la migración de
    contención (revoca la escritura REST anterior). Antes de ella los clientes viejos siguen funcionando;
    después dejan de escribir por la vía antigua (decisión aceptada en 095).
12. **Verificación final (solo lectura)** con `verificar-produccion`: catálogo == esperado, estado
    idéntico salvo lo declarado, `error_log` sin filas nuevas, centinelas intactos.
13. **Registro.** Actualiza `docs/STATUS.md` (línea base, migraciones, conteos, fase cerrada) y
    la tarjeta del subsistema. Ese cambio de documentación va en su propio commit autorizado.
14. **HARD STOP** con el reporte de la fase. El usuario declara "CLOSED IN PRODUCTION".

## Si algo falla

- Falla la aditiva: no hay commit ni push. Reporta el error textual y detente.
- El deploy falla o el bundle no trae el contrato: NO apliques la contención. Reporta.
- Una verificación no cuadra: repórtalo como contradicción antes de declarar nada; no "repares"
  datos en producción. Un rollback es una fase nueva que también requiere autorización.

## Prohibido

QA que escriba en producción; reparar historia; imprimir secretos; `git add -A`; `--force`;
declarar una fase cerrada sin las verificaciones de los pasos 6, 10 y 12.
