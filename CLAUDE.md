# Proyecto CuboPolar ERP

Este repositorio contiene la aplicación ERP de Cubo Polar, una fábrica de productos de hielo. Está construida con React + Vite + Tailwind y usa Supabase como backend (Auth + Postgres).

### Estructura principal

- `src/` – React application
  - `components/` – UI components, vistas por rol, modales, etc.
    - `views/` – Vistas modulares (index.js, ModuleViews.jsx, viewsCommon.js)
    - `ui/` – Componentes reutilizables (Modal, Toast, Icons, Components)
  - `data/` – lógica de acceso a Supabase (`supaStore.js`)
  - `lib/supabase.js` – inicialización del cliente Supabase.
  - `utils/` – utilidades:
    - `safe.js` – funciones `s`, `n`, `money`, `fmtDate`, etc.
    - `geocoding.js` – geocodificación con Google Maps API
    - `exportReports.js` – exportación a Excel/PDF (lazy loaded)
- `public/` – recursos estáticos (favicon, manifest, service worker).
- `supabase/` – scripts SQL para schema y seed (001-009).
- configuraciones de Vite, Tailwind, Netlify, etc.

### Flujo de trabajo local

1. Clonar el repositorio y ejecutar `npm install`.
2. Ejecutar `npm run dev` para levantar el servidor en `http://localhost:5173`.
3. Crear ramas locales para cambios de prueba (`git checkout -b mi-rama`).
4. Commit y push solo cuando se quiera sincronizar con GitHub/Netlify.

### Configuración requerida

Para geocodificación de direcciones, configurar en `.env`:
```
VITE_GOOGLE_MAPS_API_KEY=tu_api_key
```

### Notas importantes

- **Autenticación real**: se utiliza Supabase Auth; no hay usuarios de demostración.
- **Branch `main`**: contiene el estado actual en producción.
- **Netlify** despliega automáticamente desde `main`.

### Arquitectura y optimizaciones

- **Code splitting**: Vistas por rol (Chofer, Bolsas, etc.) se cargan lazy
- **Vendor chunks**: React, Supabase y DOMPurify separados
- **Export reports**: ~700KB lazy loaded solo cuando se exporta
- **Console cleanup**: console.log/warn removidos en producción (vite.config.js)
- **Error Boundary**: Captura errores con opción de copiar detalles

### Advertencias y mejoras futuras

- `ModuleViews.jsx` tiene ~3000 líneas; se preparó `viewsCommon.js` e `index.js` para dividirlo
- El bundle principal es ~977KB; dividir ModuleViews reduciría esto significativamente
- Agregar TypeScript gradualmente mejoraría la mantenibilidad
- Considerar tests para flujos críticos (crear orden, cerrar ruta)

### Propósito de este archivo

El archivo `CLAUDE.md` sirve como referencia rápida para desarrolladores que trabajen con asistentes de IA. Contiene el contexto necesario para entender la arquitectura, los comandos habituales y notas de mantenimiento.
