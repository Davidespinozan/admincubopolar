# Auditoría Mobile/Responsive — Cubo Polar ERP

**Fecha**: 2026-05-06.
**Tanda**: 15 Fase 1 (solo investigación, sin código).
**Síntomas que motivaron la auditoría**:
- "De la nada se hace un poco de zoom cuando escribo".
- "El scroll falla a veces".
- "No es perfecto el responsive".

---

## Resumen ejecutivo

| Dimensión | Estado |
|---|---|
| Configuración base (viewport, CSS reset) | ✅ Correcta |
| **Zoom automático en inputs (iOS Safari)** | 🔴 Causa raíz identificada |
| **Scroll en modales** | 🔴 Causa raíz identificada |
| Tap targets en ChoferView (mobile-only) | 🟡 Algunos sub-44px |
| Banner stack en App.jsx | 🟡 Inconsistencia z-index/sticky |
| Tablas extensas en mobile | 🟡 Aceptable, pero discoverabilidad baja |
| Viewport units `vh` vs `dvh` | 🟢 Funciona, mejora opcional |
| PWA installed mode safe-area | 🟢 Cubierto en mayoría, falta Login |
| Mapa Leaflet gestures | 🟢 Defaults OK, sin reporte |

**Top 3 problemas críticos**:
1. **Inputs `text-sm` (14px) → zoom forzado iOS** — afecta TODOS los formularios del sistema.
2. **Modales no bloquean body scroll** — arrastrar fuera del modal scrollea el fondo.
3. **Tap targets pequeños en ChoferView** — fricción real para chofer con dedos en operación.

**Tiempo total estimado para mobile "perfecto"**: ~4-5 horas de fix repartidas en 3 PRs (P0 / P1 / P2).

---

## Problema 1 (🔴 P0) — Zoom automático al hacer focus en un input

### Causa raíz exacta

**Regla de iOS Safari**: si un input/textarea/select tiene `font-size < 16px`, al hacer focus iOS hace zoom forzado del viewport para que el texto sea legible. Después del zoom el viewport queda escalado y NO regresa hasta que el usuario hace pinch manual para alejar.

**Confirmado en este código**:
- Tailwind `text-sm` = `0.875rem` = **14px** ❌
- Tailwind `text-xs` = `0.75rem` = **12px** ❌
- Tailwind `text-base` = `1rem` = **16px** ✅ (mínimo seguro iOS)

### Localización

**Componentes reutilizables** (impacto máximo, todos los modales heredan):
| Archivo | Línea | Helper | font-size |
|---|---|---|---|
| `src/components/ui/Modal.jsx` | 48 | `FormInput` | `text-sm` (14px) ❌ |
| `src/components/ui/Modal.jsx` | 60 | `FormSelect` | `text-sm` (14px) ❌ |
| `src/components/ui/Modal.jsx` | 76 | `FormTextarea` | `text-sm` (14px) ❌ |

Esto solo ya cubre todos los modales del ERP: NuevaVentaModal, EditarVentaModal, CancelarCFDIModal, DevolucionModal, CierreCajaModal, etc.

**Inputs directos** (selección):
- `src/components/Login.jsx:80,86` — email + password (primer punto de contacto del usuario).
- `src/components/ChoferView.jsx:1120,1127,1213` — modal cobro (folioNota, cobroRef) + modal venta express (cliente).
- `src/components/CuboPolarERP.jsx:687-699,818-824` — formularios Lead y Comodato.
- Todas las búsquedas de las vistas: `OrdenesView`, `RutasView`, `ClientesView`, `ProductosView`, `FacturacionView`, `PreciosView`, `DevolucionesView`, `ConciliacionView`, `CostosView`.

**Total estimado**: ~110 elementos de formulario en `src/` (76 inputs + 33 selects + 5 textareas) — la inmensa mayoría con `text-sm` o `text-xs`.

### Fix propuesto

**Una sola regla CSS global** en `src/index.css`, sin tocar 110 líneas de JSX:

```css
/* ── Prevenir zoom automático en iOS Safari ──
   iOS hace zoom al focus de cualquier input < 16px. La regla aplica
   solo en mobile (max-width 767px) — en desktop conservamos text-sm
   para mantener la densidad visual actual.                        */
@media (max-width: 767px) {
  input,
  select,
  textarea {
    font-size: 16px !important;
  }
}
```

**Por qué `!important`**: las clases Tailwind `text-sm` se generan con specificity `0.0.1.0`. Sin `!important`, una regla CSS hermana del mismo specificity pierde según orden de carga. `!important` garantiza que aplique sobre Tailwind utilities.

**Por qué solo mobile**: en desktop el zoom no aplica (no es un fenómeno de iOS Safari desktop) y `text-sm` mantiene la densidad UI que ya tiene Cubo Polar.

**Estimación**: **15 minutos** (escribir regla + verificar local con DevTools mobile emulation + smoke E2E).

---

## Problema 2 (🔴 P0) — Scroll falla cuando un modal está abierto

### Causa raíz exacta

`src/components/ui/Modal.jsx` (componente reutilizable) tiene 2 problemas que combinados producen el síntoma "el scroll falla":

**A) NO bloquea body scroll cuando el modal abre**.
Cuando un modal se monta, el `<body>` sigue siendo scrollable. En mobile, si el dedo empieza el arrastre fuera del área del modal (ej. en el backdrop oscuro), el navegador scrollea **el fondo** en lugar del modal. Sensación: "intenté scrollear el modal y se movió la página de atrás".

**B) `overscroll-behavior` no está contenido**.
El modal interno tiene `overflow-y-auto` pero NO `overscroll-behavior: contain`. Cuando el usuario llega al final del scroll del modal y sigue arrastrando, el navegador propaga el scroll al body. En iOS Safari esto se manifiesta como un "rebote" del fondo + a veces el modal se cierra accidentalmente.

### Localización

| Archivo | Línea | Problema |
|---|---|---|
| `src/components/ui/Modal.jsx` | 5-42 | Componente `Modal` no aplica body lock + sin `overscroll-behavior` |
| `src/components/ui/Modal.jsx` | 102-140 | `ConfirmDialog` mismo problema |

**Modales custom** (que NO usan `Modal.jsx`) heredan el problema porque el body sigue scrollable:
- `ChoferView.jsx:805,873,1111,1196` — modales custom de firma, excepción, cobro, venta express.
- `ProduccionStandaloneView.jsx` — modales de traspaso, sacar, merma, transformación.
- `BotonFirmasPendientes.jsx` — modal de advertencia y firma.

### Fix propuesto

**1. En `Modal.jsx` y `ConfirmDialog`**: agregar useEffect que bloquea body scroll mientras `open=true`:

```jsx
useEffect(() => {
  if (!open) return;
  const original = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return () => { document.body.style.overflow = original; };
}, [open]);
```

**2. En el div del modal interno**: agregar `overscroll-contain`:

```jsx
className={`relative ... overflow-y-auto overscroll-contain ...`}
```

**3. Para los modales custom** (ChoferView, ProduccionStandaloneView, BotonFirmasPendientes): mismo patrón. Como son varios, conviene extraer un hook reutilizable `useBodyScrollLock(open)` en `src/components/ui/Modal.jsx` y usarlo desde los custom.

**Estimación**: **30 minutos** (Modal.jsx + ConfirmDialog + hook + 5 modales custom + smoke E2E).

---

## Problema 3 (🟡 P1) — Tap targets pequeños en ChoferView

### Por qué importa

ChoferView es **100% mobile**. El operario lo usa en campo: dedos posiblemente con guantes finos, hielo derritiéndose, sol directo en pantalla. Cualquier tap target sub-44px (Apple HIG) genera fail rate alto.

### Inventario

| Archivo:Línea | Elemento | Tamaño actual |
|---|---|---|
| `ChoferView.jsx:665, 749, 906` | Botón "Salir" header (3 sub-shells) | `py-1.5 px-3 text-xs` ≈ 28px ❌ |
| `ChoferView.jsx:945` | Toggle "Ver mapa / Ocultar mapa" | `py-1.5 px-3 text-xs` ≈ 28px ❌ |
| `ChoferView.jsx:1016, 1026` | Botones Llamar / WhatsApp en parada | `px-2 py-1 text-[10px]` ≈ 22px ❌ |
| `ChoferView.jsx:1129, 1164, 1289` | "Tomar otra" foto | `text-xs` sin min-h ≈ 24px ❌ |
| `ChoferView.jsx:1382` | "← Volver" en cierre | `py-1.5 text-xs` ≈ 28px ❌ |
| `ChoferView.jsx:1124` | Chips método de pago | `py-3.5` ≈ 40px ⚠️ (cerca pero <44) |

Botones primarios (`Confirmar entrega`, `Cerrar ruta`, `Crear venta`) sí están bien (`py-4` ≈ 48-52px).

### Fix propuesto

Aumentar a `min-h-[44px]` con padding adecuado y/o subir tamaño de fuente:

```jsx
// Antes
<button className="rounded-full px-3 py-1.5 text-xs">Salir</button>

// Después
<button className="rounded-full px-4 py-2.5 text-sm min-h-[44px]">Salir</button>
```

Para los chips de método de pago (línea 1124) cambiar `py-3.5` a `py-4 min-h-[48px]`.

Para los iconos Llamar/WhatsApp: subir a `px-3 py-2 text-xs min-h-[40px]` y agregar `gap-1.5` para separar texto del icono (más area de tap).

**Estimación**: **45 minutos** (ChoferView solo, ~7 cambios localizados, smoke E2E).

---

## Problema 4 (🟡 P1) — Banner stack en App.jsx

### Causa

`App.jsx` líneas 200, 213, 222 tienen 3 banners distintos:
- Admin view-as (`z-[9999]`)
- Offline (`z-[10000]`)
- Reconectado (`z-[10000]`)

Los 3 son `position: fixed top-0 left-0 right-0`. **No empujan contenido**, se SUPERPONEN encima.

`ModoPruebaBanner` (Tanda 14) en cambio usa `sticky top-0` → SÍ empuja contenido.

**Resultado**: cuando el modo prueba banner está visible Y aparece el banner offline, hay zonas donde el contenido del shell queda tapado en parte. Y si el usuario es Admin con `adminViewAs` activo, hay 2 banners superpuestos sobre 1 banner sticky → comportamiento confuso.

### Fix propuesto

Decidir comportamiento uniforme para los 4 banners:
- **Opción A**: todos `sticky` y empujan contenido. Más espacio pero predictible.
- **Opción B**: todos `fixed` con padding-top dinámico en el shell raíz cuando hay banners visibles.

Recomendación: **Opción A** — convertir los 3 de App.jsx de `fixed` a `sticky`, igual que `ModoPruebaBanner`.

**Estimación**: **20 minutos**.

---

## Problema 5 (🟡 P1) — Tablas en mobile, discoverabilidad de scroll horizontal

### Hallazgo

`OrdenesView`, `RutasView`, `ClientesView`, `FacturacionView` usan el componente `DataTable` (en `viewsCommon`). Tabla con muchas columnas en mobile → scroll horizontal o cards stack según `cardSubtitle`.

`DataTable` tiene fallback a cards en mobile via `cardSubtitle` prop, pero **no todas las vistas lo usan**. Cuando no se pasa `cardSubtitle`, en mobile la tabla scrollea horizontalmente sin indicador visual de que hay más columnas a la derecha.

`src/index.css:145-148` esconde el scrollbar horizontal en mobile:
```css
@media (max-width: 767px) {
  .overflow-x-auto::-webkit-scrollbar { display: none; }
}
```

Sin scrollbar visible, el usuario no descubre que puede arrastrar.

### Fix propuesto

**Opción A**: agregar gradiente de "más contenido" al borde derecho cuando hay overflow:

```css
.overflow-x-auto::after {
  content: '';
  position: sticky;
  right: 0;
  width: 24px;
  background: linear-gradient(to right, transparent, rgba(255,255,255,0.9));
  pointer-events: none;
}
```

**Opción B**: convertir todas las tablas a cards en mobile con `cardSubtitle` consistente.

Recomendación: **Opción A** primero (fix global), Opción B en PR dedicado solo si A no es suficiente.

**Estimación**: 20 minutos (Opción A) + revisar/auditar las 4 vistas.

---

## Problema 6 (🟢 P2) — Viewport units `vh` vs `dvh`

### Hallazgo

Múltiples modales usan `max-h-[92vh]`, `max-h-[88vh]`, `max-h-[85vh]`, `max-h-[90vh]`.

En iOS Safari, `100vh` se calcula con la barra de URL **incluida** (estado expandido del browser chrome). Cuando el usuario hace scroll y la barra se esconde, el viewport real crece pero `100vh` no. Resultado: modal queda con espacio "vacío" abajo o los botones quedan más cerca del borde de lo esperado.

`100dvh` (dynamic viewport height, CSS Values 4) se ajusta dinámicamente. iOS 15.4+ y Chrome 108+ lo soportan.

### Fix propuesto

Reemplazar `vh` por `dvh` en modales y shells. Tailwind 3.5+ tiene `[100dvh]` arbitrary value, no requiere config.

```jsx
// Antes
className="max-h-[92vh] sm:max-h-[88vh]"

// Después
className="max-h-[92dvh] sm:max-h-[88dvh]"
```

**Estimación**: 15 minutos (find/replace controlado).

---

## Problema 7 (🟢 P2) — Login.jsx y safe-area-inset

### Hallazgo

Login.jsx tiene `min-h-screen` con padding genérico (`px-4 py-6`). En iPhone con notch, el contenido del centro queda OK pero el badge "CUBOPOLAR ERP" en la parte superior puede quedar parcialmente tapado por la dynamic island/notch en orientación landscape.

Demás vistas usan `style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}` y similares. Login NO.

### Fix propuesto

```jsx
// Login.jsx outer div
<div
  className="min-h-screen overflow-y-auto bg-gradient-to-br ..."
  style={{
    paddingTop: 'max(env(safe-area-inset-top, 0px), 1.5rem)',
    paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 1.5rem)',
  }}
>
```

**Estimación**: 5 minutos.

---

## Problema 8 (🟢 P2) — Sidebar drawer mobile sin overscroll-behavior

### Hallazgo

`CuboPolarERP.jsx:485` — drawer lateral mobile:
```jsx
<aside className="lg:hidden fixed top-0 left-0 bottom-0 w-[85%] max-w-[320px] bg-white z-50 shadow-2xl overflow-y-auto animate-slideInLeft flex flex-col">
```

Tiene `overflow-y-auto` pero NO `overscroll-behavior: contain`. Mismo problema que modales: arrastrar al final scrollea el body.

### Fix propuesto

Agregar `overscroll-contain` al `aside`. **Estimación**: 2 minutos.

---

## Problema 9 (🟢 P2) — Mapa Leaflet gesture conflict

### Hallazgo (sin reporte específico de bug)

`MapaRuta.jsx` usa Leaflet por default. En iOS Safari, cuando el dedo está sobre el mapa y arrastra, **Leaflet captura** el gesture. Si el usuario quería scrollear la página y empieza el dedo sobre el mapa, no scrollea — solo pan en el mapa.

### Fix propuesto (preventivo, opcional)

Configurar `dragging: true, touchZoom: true, scrollWheelZoom: false`. Esto último previene scroll-wheel zoom en desktop y es lo defaul de Leaflet ya. Probable que no sea necesario, pero confirmar en mobile testing.

**Estimación**: 5 minutos de prueba + posible cambio si aplica.

---

## Problema 10 (🟢 P2) — Tailwind config sin extensiones mobile-first

### Hallazgo

`tailwind.config.js` solo extiende `fontFamily`. No hay:
- `screens` custom (uses defaults sm=640, md=768, lg=1024, xl=1280, 2xl=1536).
- `theme.extend.spacing` para safe-area.
- `theme.extend.height/minHeight` con `dvh`.

Algunos componentes mezclan `sm:` y `md:` para "mobile vs desktop" sin convención. Inconsistente.

### Fix propuesto

Agregar al config:

```js
theme: {
  extend: {
    fontFamily: { ... },
    spacing: {
      'safe-top': 'env(safe-area-inset-top)',
      'safe-bottom': 'env(safe-area-inset-bottom)',
    },
    height: {
      'screen-dvh': '100dvh',
    },
    minHeight: {
      'screen-dvh': '100dvh',
    },
  },
}
```

Permite escribir `pt-safe-top`, `min-h-screen-dvh`, etc.

**Estimación**: 10 minutos + opcionalmente refactor de algunos componentes para usar las nuevas clases (PR aparte).

---

## Plan de fix priorizado

| Prioridad | Problema | Fix | Estimación |
|---|---|---|---|
| **P0** | #1 Zoom inputs iOS | Regla CSS global mobile-only | **15 min** |
| **P0** | #2 Modales scroll fail | Body lock + overscroll-contain | **30 min** |
| **P1** | #3 Tap targets ChoferView | min-h-[44px] en 7 botones | **45 min** |
| **P1** | #4 Banner stack inconsistente | Convertir 3 banners a sticky | **20 min** |
| **P1** | #5 Tabla scroll discoverability | Gradiente CSS global | **20 min** |
| **P2** | #6 vh → dvh | Find/replace controlado | **15 min** |
| **P2** | #7 Login safe-area | Padding inline en outer div | **5 min** |
| **P2** | #8 Sidebar drawer overscroll | Una clase | **2 min** |
| **P2** | #9 Mapa Leaflet gesture | Probable no-op | **5 min** |
| **P2** | #10 Tailwind config extensiones | Util para futuros PRs | **10 min** |

**Total**: ~3 horas de trabajo de código + testing manual (DevTools mobile emulation + iPhone real si es posible).

---

## Plan de PRs sugerido (Fase 2)

**PR 1 — Tanda 16 P0 (45 min)**: Fixes que David nota inmediatamente.
- Problema #1 (zoom).
- Problema #2 (modales scroll).
- Problema #8 (sidebar overscroll, suma con #2).

Smoke E2E debe seguir verde.

**PR 2 — Tanda 17 P1 (1h 25min)**: Fixes operacionales que afectan a operario en campo.
- Problema #3 (ChoferView taps).
- Problema #4 (banner stack).
- Problema #5 (tablas scroll horizontal).

**PR 3 — Tanda 18 P2 (45 min)**: Refinamientos que no son urgentes pero quedan limpios.
- Problema #6 (dvh).
- Problema #7 (Login safe-area).
- Problema #9 (Leaflet, si aplica).
- Problema #10 (Tailwind config).

---

## Apéndice — Lo que SÍ está bien

Para no quedar con la impresión de que todo está mal:

- ✅ **Meta viewport correcto**: `width=device-width, initial-scale=1.0, viewport-fit=cover`. Sin `maximum-scale=1` ni `user-scalable=no` (permite zoom usuario, accesible).
- ✅ **PWA configurada**: `apple-mobile-web-app-capable=yes` + manifest + service worker.
- ✅ **CSS base sólido**: `-webkit-text-size-adjust: 100%`, `overflow-x: hidden`, `overscroll-behavior-x: none`, `-webkit-tap-highlight-color: transparent`.
- ✅ **Safe-area-inset implementado** en CuboPolarERP, ChoferView, ProduccionStandaloneView (notch + bottom bar respetados).
- ✅ **Sidebar drawer mobile**: animaciones suaves, backdrop click-to-close, max-width 320px.
- ✅ **Botones primarios** del flujo crítico (Confirmar entrega, Cerrar ruta, Crear venta): `py-4` ≈ 48-52px, dentro del HIG.
- ✅ **Modales con drag handle visual** (`mx-auto mt-3 h-1 w-10 rounded-full bg-slate-200 md:hidden`) — discoverable.
- ✅ **DataTable con responsive cards via `cardSubtitle`** — patrón correcto, solo falta consistencia de adopción.

El sistema NO está mal en mobile. Tiene 2 bugs concretos con causa identificada (zoom + scroll modales) y un puñado de polish menores.
