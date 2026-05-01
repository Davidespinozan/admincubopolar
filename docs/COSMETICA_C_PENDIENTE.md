# Fase Cosmética C — Limpieza de imports y warnings ESLint

Pendiente para sesión separada. Activado tras instalación de ESLint en **Fase Blindaje** (commit en `feature/blindaje-eslint-no-undef`).

El propósito del blindaje (prevenir bugs tipo CapacityBar) ya quedó cumplido: `0` errores de `no-undef` ni `react/jsx-no-undef` en todo el código actual. Los warnings son deuda cosmética separada que merece su propia sesión y testing.

## Snapshot del primer run de ESLint

```
✖ 200 problems (1 error, 199 warnings)
```

## Errores reales (1)

- **`src/components/ui/AddressAutocomplete.jsx:27`** — anti-patrón `Promise(async (resolve, reject) => {...})` (`no-async-promise-executor`). El catch interno ignora rejections; refactor a `async function () { ... } + .then(resolve).catch(reject)`.

## Warnings cosméticos (~199)

### Distribución por categoría

| Origen | ~Cantidad | Causa típica |
|---|---|---|
| Vistas admin (~20 archivos) | ~150 | Cada vista importa todo `viewsCommon` (`Icons`, `StatusBadge`, `DataTable`, `PageHeader`, `Modal`, `FormInput`, `FormSelect`, `FormBtn`, `EmptyState`, `Paginator`, `useDebounce`, etc.) y usa solo la mitad |
| Vistas standalone | ~10 | Algunos pre-existentes (`useRef` en ProduccionStandaloneView; `confirmadoCarga`, `clientesAsignados`, `necesitaPorSku`, `iniciarRuta` en ChoferView) |
| `supaStore.js` | 5 | `e`/`syncErr` en `catch` blocks que no usan el error |
| `main.jsx` | 4 | `React`, `App`, `ErrorBoundary`, `ToastProvider` — **sospechosos**, probablemente falsos positivos por uso JSX que ESLint no detectó |
| `exportReports.js` | 1 | `e` en catch sin uso |

## Plan para Fase Cosmética C

1. **Investigar warnings de `main.jsx`** primero — probablemente requieren ajustar la config de ESLint (algún plugin/setting para que reconozca uso JSX correctamente). Si en realidad están sin usar, son los más raros (App, React, ErrorBoundary deberían usarse en el bootstrap).
2. **Limpiar imports no usados archivo por archivo** (NO masivamente con `--fix` automático). Revisar cada uno: a veces un símbolo aparenta no usarse pero se importa por side effect, lazy ref, o tipo.
3. **Renombrar catches sin uso** a `_e` (o eliminar el binding cuando aplica). El config actual ya ignora variables que empiezan con `_`.
4. **Arreglar `AddressAutocomplete.jsx:27`** — el único error real, requiere refactor del Promise wrapper para no mezclar `async` con executor.

## Estimación

1-2 hrs para los 4 puntos. No urgente: ningún warning afecta runtime, build o producción.

## Cómo correr ESLint

```bash
npm run lint        # reporta errors + warnings
npm run lint:fix    # auto-arregla los que se pueden (típicamente formato)
```

Config en `eslint.config.js` (root). Reglas activas:
- `no-undef`: error
- `react/jsx-no-undef`: error
- `no-unused-vars`: warn (con `argsIgnorePattern: '^_'`)
- `react/prop-types`: off
- `react/react-in-jsx-scope`: off (React 18 no lo necesita)
- `no-empty`: warn (allow empty catch)
