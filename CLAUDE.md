# Proyecto CuboPolar ERP

Este repositorio contiene la aplicación ERP de Cubo Polar, una fábrica de productos de hielo. Está construida con React + Vite + Tailwind y usa Supabase como backend (Auth + Postgres).

### Estructura principal

- `src/` – React application
  - `components/` – UI components, vistas por rol, modales, etc.
  - `data/` – lógica de acceso a Supabase (`store.js`, `supaStore.js` etc.)
  - `lib/supabase.js` – inicialización del cliente Supabase.
  - `utils/` – utilidades (`safe.js` con funciones `s`, `n`, `money`, etc.).
- `public/` – recursos estáticos (favicon, manifest, service worker).
- `supabase/` – scripts SQL para schema y seed.
- configuraciones de Vite, Tailwind, Netlify, etc.

### Flujo de trabajo local

1. Clonar el repositorio y ejecutar `npm install`.
2. Ejecutar `npm run dev` para levantar el servidor en `http://localhost:5173`.
3. Crear ramas locales para cambios de prueba (`git checkout -b mi-rama`).
4. Commit y push solo cuando se quiera sincronizar con GitHub/Netlify.

### Notas importantes

- **Autenticación real**: se utiliza Supabase Auth; no hay usuarios de demostración.
- **Branch `main`**: contiene el estado actual en producción. El historial fue reseteado recientemente.
- **Rama de desarrollo**: `mis-cambios` (o cualquier otra creada) se usa para trabajar sin afectar el remoto.
- **Netlify** despliega automáticamente desde `main`.

### Advertencias y mejoras

- El bundle de Vite es grande ( ~530 KB minificado ). Se sugiere code-splitting si el tamaño preocupa.
- Algunas partes del código inicializan estado dentro del render; se corrigieron ejemplos en `ChoferView`.
- No existen credenciales o datos sensibles en el repositorio.

### Propósito de este archivo

El archivo `CLAUDE.md` se creó para documentar el proyecto y servir como referencia rápida para desarrolladores que trabajen con Claude o cualquier otro asistente. Contiene el contexto necesario para entender la arquitectura, los comandos habituales y notas de mantenimiento.
