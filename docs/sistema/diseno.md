# Diseño de la interfaz (mobile-first) — sistema "CUBOPOLAR 2026"

## Invariant
La app se usa primero en iPhone. Toda pantalla se diseña para 390 px de ancho con el pulgar, y
escala a escritorio sin cambiar de lenguaje. Un solo sistema: mismos colores, radios, sombras,
tipografía y componentes en los 7 roles. Nada se dibuja "a mano" en una vista si existe la
primitiva en `src/components/ui/`.

## Tokens (`src/index.css` → `:root`, `tailwind.config.js`)
- Lienzo `#F4F6F9` (sin manchas de color). Superficie (tarjetas, hojas, cabecera) `#FFFFFF`.
- Tinta `#0B1220` · texto secundario `#5B6472` · texto suave `#8A94A3` · línea `#E6EAF0`.
- Marca oscura (cabeceras de rol, menú, barra inferior): degradado `#0B1F3A → #0F172A`.
- Acento `#0E7490` (teal hielo) solo para estado activo, enlaces y foco. Botón primario = tinta.
- Semánticos: éxito `#059669` · aviso `#D97706` · peligro `#DC2626` · info `#2563EB`,
  siempre sobre fondo tintado al 8–10 % (`bg-emerald-50`, …) y texto 800.
- Radios: campo/botón **14 px** · tarjeta **20 px** · hoja/modal **28 px** · píldora 999.
- Sombras: `shadow-card` (1 px + difusa muy suave) y `shadow-sheet` (hojas). Sin sombras duras.
- Tipografía: **Inter** (variable) para todo; números con `tabular-nums` (`.tnum`).
  Display 28/32 −0.02em · título 20/24 −0.015em · cuerpo 15/22 · secundario 13/18 ·
  etiqueta 11/14 mayúsculas con tracking **0.08em** (no 0.24em).
- Movimiento: 160–240 ms, `cubic-bezier(.32,.72,0,1)`; vistas entran con `animate-view-in`;
  hojas suben con `animate-sheet-in`; botones `active:scale-[0.98]`. Respeta `prefers-reduced-motion`.
- Objetivos táctiles ≥ 44 px (iconos solos: 40 px con área de 44).

## Componentes canónicos (`src/components/ui/`)
| Pieza | Componente | Regla |
|---|---|---|
| Título de pantalla | barra superior del shell | La vista NO repite su título en móvil; `PageHeader` solo trae acciones (en sm+ muestra título). |
| Acción principal | `PageHeader action` o `FormBtn primary` | Tinta, 44 px, icono `Plus`. Nunca `bg-blue-600`/`bg-green-600` a mano. |
| Cifras | `KpiTile` en `grid grid-cols-2` (3 solo si caben) | Etiqueta 11 px, cifra 24 px tabular, pista 12 px. |
| Pestañas | `SegmentedTabs` (≤4) o `Chips` (desplazables) | Nunca pestañas subrayadas ni píldoras de colores distintos. |
| Lista | `ListRow` dentro de `Card` o `DataTable` (tarjetas en móvil) | Título 15 px, subtítulo 13 px, valor a la derecha, chevron si navega. |
| Estado | `StatusBadge` | Píldora tintada 11 px. |
| Formulario | `FormInput` / `FormSelect` / `FormTextarea` / `FormBtn` | Campo 48 px, etiqueta 13 px. |
| Hoja / modal | `Modal` con `footer` | Encabezado y pie pegajosos; el pie lleva los botones. |
| Confirmación | `useConfirm` | Nunca `window.confirm`. |
| Vacío | `EmptyState` | Icono, frase corta, pista, CTA. |
| Aviso efímero | `useToast` | Píldora inferior; sin emojis. |
| Elegir opción | `ChoiceButton` en `grid grid-cols-2` | Para producto, método de pago, causa, cuarto. |
| Sección | `SectionLabel` | Una por bloque; no títulos `h2` sueltos. |

## Decisiones cerradas
- Sin emojis en la interfaz: iconos SVG de `Icons`.
- Sin banner global de modo prueba; el aviso vive dentro de Facturación.
- Cabecera: menú, título, búsqueda (back office), firmas solo con pendientes, una campana "Avisos".
- Menú lateral y barra inferior comparten la marca oscura; "Mi espacio" agrupa lo personal.
- Bienvenida en la pantalla de inicio de cada rol con la hora del negocio.
- Las vistas por rol (Chofer, Ventas, Producción, Almacén) usan `RoleHeader` o el shell; nunca ambos.
- Toda hoja lleva sus acciones en `footer` (pegajoso, con safe-area); nada de botones sueltos al final del cuerpo.
- `animate-view-in` termina sin `transform` (`animation-fill-mode: backwards`): un contenedor con transform
  vuelve a sí mismo el marco de cualquier `position: fixed` y las hojas se abren mal posicionadas.
- Pickers (producto, método de pago, causa, turno) en `grid grid-cols-2`; filtros de fecha/selección en dos columnas.

## Verificación
`npx vitest run src/__tests__/movilFirst.test.jsx src/__tests__/disenoSistema.test.jsx` y las capturas
del arnés local (WebKit iPhone 14 y SE) antes de publicar. Evidencia: hojas de contacto antes/después.

## Load this card when
estilos, Tailwind, colores, tipografía, íconos, botones, tarjetas, modales, hojas, cabecera, barra
inferior, menú móvil, bienvenida, estados vacíos, toasts, "se ve mal en el celular", premium.
