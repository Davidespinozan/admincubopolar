---
name: fase-auditoria
description: Auditoría estrictamente de solo lectura de un subsistema de CuboPolar antes de cambiarlo. Úsalo cuando el usuario pida auditar, revisar o diagnosticar un flujo (por ejemplo "STRICT READ-ONLY AUDIT"), o antes de proponer cualquier cambio en dinero, inventario, permisos o fechas.
---

# Fase de auditoría (solo lectura)

Una auditoría termina en un reporte y un HARD STOP. No modifica código, esquema, datos ni
producción, y no empieza la implementación aunque la recomendación parezca obvia.

## Secuencia

1. **Línea base.** `git rev-parse HEAD` y `git status --short`. Si no coincide con la línea base
   de `docs/STATUS.md`, dilo antes de seguir.
2. **Estado.** Lee `docs/STATUS.md`: fase actual, decisiones pendientes y la tabla "Cerrado — no reabrir".
3. **Tarjetas.** Carga solo las tarjetas de `docs/sistema/` que el tema toca (tabla de ruteo en
   `CLAUDE.md`). Sin tarjeta para el tema: la evidencia son las migraciones y suites que cita STATUS.
4. **Solo lectura.** Código y SQL del repo; base local; producción únicamente con consultas
   SELECT (`verificar-produccion`). Nada de QA que escriba en producción.
5. **Escritores y lectores.** Para cada tabla/columna del tema: quién la escribe (contratos,
   triggers, REST directo, Netlify Functions, `service_role`) y quién la lee (reportes, vistas, frontend).
   La versión vigente de una función es la de la migración más alta que la redefine.
6. **Caminos de falla.** Reintento, doble clic, concurrencia, respuesta perdida, cliente viejo,
   actor inactivo, zona horaria, valores nulos / cero / negativos, borrado y recreación, REST directo.
7. **Hechos vs supuestos.** Cada hallazgo lleva su evidencia (archivo:línea, consulta o prueba).
   Lo que no se pudo comprobar se rotula SUPUESTO.
8. **Decisiones cerradas.** Contrasta cada hallazgo con "Closed decisions" de las tarjetas: no
   propongas reabrir una decisión cerrada; si la evidencia la contradice, repórtalo como contradicción.
9. **Opciones.** Dos o tres, con alcance, riesgo y lo que cada una NO resuelve.
10. **Recomendación.** La más pequeña que sea defendible. Las decisiones de negocio se listan
    como preguntas para el usuario: no se resuelven por cuenta propia.
11. **Frontera de regresión.** Qué contratos, suites y subsistemas cerrados no deben cambiar.
12. **STATUS.** Actualiza `docs/STATUS.md` solo si el usuario lo autorizó en esta fase
    (estado `AUDITED / DECISION PENDING` y la lista de decisiones). Si no, propón el texto en el reporte.
13. **HARD STOP.** Entrega el reporte en el formato que pidió el usuario y detente.

## Reglas

- Las demostraciones que escriben (por ejemplo reproducir una falla) van solo en la base local y
  dentro de una transacción con ROLLBACK (`gate-local`).
- No imprimas secretos ni contenido de `.env`. `.env` apunta a producción: no levantes flujos que escriban.
- Redacción neutral en pruebas y consultas: describe el comportamiento, no "ataques".
- No toques `error_log` (el máximo registrado en STATUS debe quedar igual) ni filas legadas.
