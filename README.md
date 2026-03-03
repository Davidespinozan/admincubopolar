# CUBOPOLAR ERP

Sistema ERP para Fábrica de Productos de Hielo S.A. de C.V.

## Setup local

```bash
# 1. Instalar dependencias
npm install

# 2. Correr en modo desarrollo
npm run dev

# 3. Abrir en el navegador
# → http://localhost:5173
```

## Deploy en Netlify (vía GitHub)

1. Sube este repo a GitHub
2. En Netlify → "Add new site" → "Import an existing project"
3. Conecta tu repo de GitHub
4. Configuración de build:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
5. Click "Deploy site"

Cada `git push` desplegará automáticamente.

## Estructura del proyecto

```
cubopolar-erp/
├── index.html              ← Entry point
├── package.json            ← Dependencias
├── vite.config.js          ← Config de Vite
├── tailwind.config.js      ← Config de Tailwind
├── postcss.config.js       ← PostCSS
├── netlify.toml            ← Config de Netlify
├── public/
│   └── favicon.svg         ← Icono
└── src/
    ├── main.jsx            ← Monta React
    ├── App.jsx             ← Componente raíz
    ├── index.css           ← Estilos globales + Tailwind
    ├── data/
    │   └── mockData.js     ← Datos de ejemplo (reemplazar con API)
    └── components/
        ├── CuboPolarERP.jsx    ← Layout principal (sidebar + topbar)
        ├── ui/
        │   ├── Icons.jsx       ← Todos los iconos SVG
        │   └── Components.jsx  ← Componentes reutilizables
        └── views/
            ├── DashboardView.jsx   ← Dashboard
            └── ModuleViews.jsx     ← Todos los módulos
```

## Módulos incluidos

- **Login** con roles (Admin, Chofer, Ventas, Almacén, Facturación)
- **Vista Chofer (móvil)** — órdenes asignadas, entregas, ventas exprés, registro de merma
- Dashboard (resumen operativo)
- Clientes (datos fiscales)
- Productos (empaque + producto terminado)
- Precios (público general + overrides por cliente)
- Producción (órdenes diarias por turno/máquina)
- Inventario (cuartos fríos, kardex, movimientos)
- Órdenes de Venta (programadas + exprés)
- Rutas y Entregas (distribución, evidencias)
- Facturación CFDI (timbrado manual)
- Conciliación (cargado vs vendido vs devuelto vs merma)
- Auditoría (historial de acciones)
- Configuración (usuarios, roles, alertas, ubicaciones)

## Notas

El login utiliza autenticación real de Supabase. No hay usuarios de demostración activados en el código; las credenciales se gestionan en la base de datos.

Los choferes ven una vista móvil diferente con sus órdenes, ventas exprés y registro de merma.
