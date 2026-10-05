# Consultas de verificación de producción (solo lectura)

Cada archivo es **un solo `SELECT`**: no inserta, actualiza, borra ni llama funciones
que escriban. No contienen credenciales. El procedimiento completo está en el skill
`verificar-produccion`.

| Archivo | Para qué |
|---|---|
| `conteos.sql` | Revisión rápida: conteos del catálogo, exposición de la API y centinelas. Detecta si `docs/STATUS.md` está desactualizado. |
| `catalogo_huella.sql` | Huella completa del catálogo. Se compara antes/después de una activación: la diferencia debe ser exactamente lo que la fase cambió. |
| `estado_negocio.sql` | Huella de datos de negocio, dinero e inventario. Debe ser idéntica antes/después si la fase no cambia datos. |

Ejecución (CLI de Supabase ya vinculado y con sesión propia; nunca imprimir secretos):

```
supabase db query --linked -f supabase/tests/prod/conteos.sql --output json
```

Guarda las salidas grandes en un archivo fuera del repositorio y compáralas con un
script; en `catalogo_huella.sql` ignora la clave `now`.
