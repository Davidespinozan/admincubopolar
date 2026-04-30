# CuboPolar ERP — Resumen Técnico del Repositorio

Sistema ERP para CuboPolar (fábrica de hielo en Durango, México). Maneja producción, inventario, distribución por rutas, ventas, cobranza, facturación CFDI, contabilidad y nómina.

---

## Stack Técnico

**Frontend:**
- React 18 + Vite 6 + Tailwind 3
- React Router (no — usa renderizado condicional por rol)
- Lazy loading por rol
- Leaflet + OpenStreetMap (mapas, sin API key)

**Backend:**
- Supabase (PostgreSQL + Auth + Realtime + Storage)
- Netlify Functions (serverless, esbuild bundler)
- Service Worker para PWA

**Integraciones externas:**
- Facturama (CFDI 4.0 — facturas y complementos de pago)
- Stripe (links de pago)
- MercadoPago (pagos)
- Google Maps API (geocodificación)

**Deploy:** Netlify auto-deploy desde `main` → cubopolar-erp en Netlify (NO es cubopolar.com, ese es el sitio público de marketing)

---

## Estructura del Repositorio

```
admincubopolar/
├── src/
│   ├── App.jsx                    # Router por rol + filtrado de datos por scope
│   ├── main.jsx                   # Entry point
│   ├── components/
│   │   ├── CuboPolarERP.jsx       # Vista principal Admin (sidebar + módulos)
│   │   ├── ChoferView.jsx         # App móvil del chofer (3 pasos)
│   │   ├── VentasStandaloneView.jsx
│   │   ├── ProduccionStandaloneView.jsx
│   │   ├── BolsasView.jsx         # Almacén de empaques
│   │   ├── Login.jsx              # Supabase Auth
│   │   ├── ErrorBoundary.jsx      # Captura errores → error_log
│   │   ├── ui/
│   │   │   ├── MapaRuta.jsx       # Mapa para chofer (con su GPS)
│   │   │   ├── MapaPedidos.jsx    # Mapa admin (pedidos + choferes en vivo)
│   │   │   ├── Modal.jsx, Toast.jsx, Skeleton.jsx, Icons.jsx, Components.jsx
│   │   └── views/                 # Vistas modulares del Admin
│   │       ├── viewsCommon.jsx    # Componentes y helpers compartidos
│   │       ├── DashboardView.jsx
│   │       ├── ClientesView.jsx
│   │       ├── ProductosView.jsx
│   │       ├── PreciosView.jsx
│   │       ├── ProduccionView.jsx
│   │       ├── InventarioView.jsx
│   │       ├── OrdenesView.jsx
│   │       ├── RutasView.jsx
│   │       ├── AlmacenBolsasView.jsx
│   │       ├── ContabilidadView.jsx
│   │       ├── FacturacionView.jsx
│   │       ├── NominaView.jsx
│   │       ├── EmpleadosView.jsx
│   │       └── ConfiguracionView.jsx
│   ├── data/
│   │   ├── supaStore.js           # ⭐ HUB CENTRAL (~2,800 líneas) — todas las queries y mutations
│   │   ├── ordenLogic.js          # Cálculo de líneas de orden, folios
│   │   ├── produccionLogic.js
│   │   ├── rutasLogic.js
│   │   ├── cobrosLogic.js
│   │   ├── finanzasLogic.js
│   │   └── mockData.js            # No usado en prod
│   ├── lib/
│   │   ├── supabase.js            # Cliente Supabase (con validación de env vars)
│   │   └── backend.js             # Helper para llamar Netlify Functions
│   ├── utils/
│   │   ├── safe.js                # Helpers s(), n(), centavos(), money(), fmtDate()
│   │   ├── geocoding.js           # Google Maps API
│   │   ├── exportReports.js       # Excel/PDF (lazy loaded, ~700KB)
│   │   └── navegacion.js          # Abrir Google Maps con dirección
│   └── __tests__/                 # Vitest (crearOrden, rutas, cobros, finanzas, produccion, facturacion)
│
├── supabase/
│   ├── 001_schema_completo.sql    # ⭐ Esquema base ACTUAL en producción
│   ├── 001_schema.sql             # Esquema alterno con ENUMs (NO usado en prod)
│   ├── 003_empleados_nomina_contabilidad.sql
│   ├── 004_control_financiero.sql
│   ├── 005_rutas_mejoradas.sql
│   ├── 006_costos_gastos.sql
│   ├── 007_rpc_atomic_operations.sql  # update_stocks_atomic, cerrar_ruta_atomic
│   ├── 010_billing_integrations.sql   # Stripe, MercadoPago, Facturama
│   ├── 011_facturama_sync.sql
│   ├── 014_storage_mermas.sql         # Bucket de fotos
│   ├── 021_cuartos_frios_stock_jsonb.sql  # Stock como JSONB
│   ├── 024_transformacion_hielo.sql       # Barra → triturado
│   ├── 025_stock_minimo_cuartos.sql
│   ├── 027_notificaciones.sql
│   ├── 028_credito_clientes.sql       # credito_autorizado, tipo_cobro
│   ├── 029_nombre_comercial_folio_nota.sql
│   ├── 030_indexes_performance.sql
│   ├── 031_rls_por_rol.sql            # ⭐ RLS por rol (helper functions email-based)
│   ├── 032_gps_tracking.sql           # chofer_ubicaciones
│   ├── 033_error_log.sql              # error_log
│   └── 034_fix_rls_rpc_permissions.sql # SECURITY DEFINER en RPCs críticas
│
├── netlify/functions/                  # Backend serverless
│   ├── _lib/                          # Helpers compartidos
│   ├── billing-config                 # Config de Stripe/MP
│   ├── billing-create-checkout        # Crear sesión de pago
│   ├── billing-create-invoice         # Timbrar CFDI en Facturama
│   ├── billing-create-complemento     # Complemento de pago PPD
│   ├── billing-pay                    # Página /pagar/:id
│   ├── billing-result                 # Resultado del pago
│   ├── billing-sync-payment           # Sincronizar pago con Stripe
│   ├── billing-webhook-stripe
│   └── billing-webhook-mercadopago
│
├── public/
│   ├── favicon.svg, icon-192.png, icon-512.png
│   ├── manifest.json                  # PWA standalone
│   └── sw.js                          # Service Worker (cache shell)
│
├── docs/                              # Documentación interna (no en repo)
├── index.html                         # Viewport-fit=cover, apple PWA meta
├── netlify.toml                       # Redirects + cache headers + functions
├── vite.config.js                     # manualChunks (vendor-react, vendor-supabase)
├── tailwind.config.js
├── package.json
└── CLAUDE.md                          # Instrucciones para Claude Code
```

---

## Modelo de Datos (tablas principales)

```
usuarios          (id, nombre, email, rol, pass, estatus)
clientes          (id, nombre, nombre_comercial, rfc, regimen, uso_cfdi, contacto,
                   calle, colonia, ciudad, latitud, longitud, saldo,
                   credito_autorizado, limite_credito, estatus)
productos         (id, sku, nombre, tipo, stock, ubicacion, precio,
                   costo_unitario, proveedor, empaque_sku, stock_minimo)
precios_esp       (id, cliente_id, sku, precio)        — multi-producto por cliente
ordenes           (id, folio, cliente_id, cliente_nombre, productos, fecha,
                   total, estatus, ruta_id, metodo_pago, vendedor_id,
                   tipo_cobro, folio_nota, facturama_id, facturama_uuid)
orden_lineas      (id, orden_id, sku, cantidad, precio_unit, subtotal)
rutas             (id, folio, nombre, chofer_id, ayudante_id, camion_id,
                   estatus, fecha, fecha_fin, carga JSONB,
                   carga_autorizada JSONB, extra_autorizado JSONB,
                   clientes_asignados JSONB)
cuartos_frios     (id TEXT, nombre, temp, capacidad, stock JSONB)  — stock = {sku: cantidad}
produccion        (id, folio, fecha, turno, sku, cantidad, estatus, tipo,
                   input_sku, input_kg, output_kg, merma_kg, rendimiento)
inventario_mov    (id, fecha, tipo, producto, cantidad, origen, destino, usuario)
mermas            (id, sku, cantidad, causa, origen, foto_url, usuario_id)
pagos             (id, cliente_id, monto, metodo_pago, referencia,
                   saldo_antes, saldo_despues, usuario_id)
cuentas_por_cobrar (id, cliente_id, orden_id, monto_original, monto_pagado,
                    saldo_pendiente, fecha_vencimiento, estatus)
movimientos_contables (id, fecha, tipo, categoria, concepto, monto, orden_id)
auditoria         (id, fecha, usuario, accion, modulo, detalle)
notificaciones    (id, tipo, titulo, mensaje, icono, referencia, leida)
chofer_ubicaciones (id, ruta_id, chofer_id, latitud, longitud, precision_m, created_at)
error_log         (id, tipo, mensaje, stack, componente, url, usuario_id, metadata)
empleados, nomina_periodos, nomina_recibos, costos_fijos, costos_historial,
cuentas_por_pagar, pagos_proveedores, camiones, invoice_attempts
```

---

## RPCs Críticos (todos con SECURITY DEFINER)

| Función | Uso |
|---|---|
| `move_stock(sku, cantidad, tipo, origen, usuario_id)` | Cambio atómico de stock + inventario_mov |
| `update_stocks_atomic(p_changes[])` | Cambio multi-cuarto atómico (JSONB) |
| `confirmar_produccion(prod_id, usuario_id)` | Lote a confirmado + suma stock |
| `asignar_orden(orden_id, ruta_id, usuario_id)` | Orden → Asignada + descuenta stock |
| `cancelar_orden_asignada(orden_id, usuario_id)` | Revertir asignación |
| `registrar_pago(cliente_id, monto, referencia, usuario_id)` | Registra pago + actualiza saldo |
| `increment_saldo(cli, delta)` | Suma/resta saldo de cliente |
| `cerrar_ruta_atomic(...)` | Cierre atómico (poco usado) |
| `get_my_rol()` / `get_my_user_id()` | Helpers RLS — busca por email del JWT |

---

## Roles y Vistas

| Rol | Componente | Acceso |
|---|---|---|
| **Admin** | `CuboPolarERP.jsx` | Todo (sidebar con 14 módulos) + botón "Ver como..." |
| **Chofer** | `ChoferView.jsx` | App de 3 pasos: Cargar → Ruta → Cierre. GPS cada 30s |
| **Ventas** | `VentasStandaloneView.jsx` | Crear órdenes, sus clientes, sus cobros |
| **Producción** | `ProduccionStandaloneView.jsx` | Lotes, transformaciones, cuartos fríos |
| **Almacén Bolsas** | `BolsasView.jsx` | Entrada/salida de empaques |
| **Facturación** | (usa CuboPolarERP filtrado) | Solo módulos fiscales |

**Ver como (Admin preview):** Cuando `user.rol === 'Admin'` y `adminViewAs` está activo, App.jsx pasa todos los datos sin filtrar y los componentes de rol detectan `isAdminPreview = user.rol === 'Admin'` para no filtrar por usuario actual.

---

## Flujo de una Orden (estado-máquina)

```
CREADA → ASIGNADA → ENTREGADA → FACTURADA
   │         │           │            │
   │         │           │            └→ Facturama timbra CFDI 4.0
   │         │           │               (PUE contado / PPD crédito)
   │         │           ├→ Genera ingreso contable automático
   │         │           ├→ Si crédito: crea CxC + factura PPD
   │         │           └→ Pago automático genera Complemento si PPD
   │         └→ update_stocks_atomic() descuenta cuartos_frios
   └→ Folio OV-XXXX (sequence)
```

---

## Seguridad

**RLS por rol** (migración 031):
- Admin: acceso total (`admin_all` en cada tabla)
- Otros roles: políticas específicas por operación
- Helper `get_my_rol()` busca `usuarios.rol` por email del JWT (no `auth_id` porque el esquema en prod no lo tiene)
- Tablas append-only: `auditoria`, `notificaciones`, `inventario_mov`, `error_log`
- Tablas solo-Admin: `empleados`, `nomina_*`, `costos_*`, `cuentas_por_pagar`, `pagos_proveedores`

**RPCs con SECURITY DEFINER** (migración 034) — bypassan RLS para operaciones que requieren permisos elevados (mover stock, registrar pagos, etc.)

---

## Convenciones del Código

**Naming:**
- Tablas en DB: `snake_case`
- Estado en JS: `camelCase`
- supaStore convierte automáticamente con `toCamel()`

**Money:**
- Siempre usar `centavos()` de `utils/safe.js` para operaciones monetarias (evita floats)
- `n(x)` para conversión segura a número
- `s(x)` para conversión segura a string

**Folios:**
- Órdenes: `OV-0001` (`folio_ov_seq`)
- Rutas: `R-001` (`folio_ruta_seq`)
- Producción: `OP-001` (`folio_op_seq`)
- Transformación: `TR-001` (mismo seq que OP)

**Errores:**
- `safeRows(query)` para reads (retorna `[]` en error)
- `safeRows(query, { critical: true })` para writes (throw)
- Eventos `'supabase-error'` capturados por `ErrorBoundary` → `error_log`

**Code splitting:**
- Vistas por rol son lazy (`React.lazy`)
- `exportReports.js` lazy (~700KB jsPDF + xlsx)
- `MapaRuta` y `MapaPedidos` lazy (Leaflet ~150KB)

---

## Estado Actual del Proyecto (Abril 2026)

**Migraciones aplicadas en producción:** 029, 030, 031, 032, 033, 034

**Funcionalidades completadas recientemente:**
- Crédito autorizado por cliente + tipo de cobro contado/crédito en órdenes
- Nombre comercial en clientes
- Folio de nota en órdenes y entregas
- Foto de evidencia en todas las entregas
- Eliminar productos del catálogo
- Cuadre detallado al cierre de ruta (5 columnas con totales)
- GPS de choferes en tiempo real (cada 30s)
- RLS por rol con SECURITY DEFINER en RPCs
- Error tracking automático
- Aviso visible cuando Admin usa "Ver como..."

**Pendientes técnicos no críticos:**
- Tests E2E (solo hay tests unitarios)
- Sentry o similar (hoy se usa tabla `error_log` interna)

---

## Variables de Entorno Requeridas

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_MAPS_API_KEY=...

# Solo backend (Netlify Functions)
SUPABASE_SERVICE_ROLE_KEY=...
FACTURAMA_USER=...
FACTURAMA_PASSWORD=...
FACTURAMA_API=https://api.facturama.mx (o sandbox)
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
MERCADOPAGO_ACCESS_TOKEN=...
```

---

## Comandos

```bash
npm install
npm run dev          # Vite dev server (localhost:5173)
npm run dev:full     # netlify dev (con functions)
npm run build        # Bundle producción
npm run test         # Vitest
```
