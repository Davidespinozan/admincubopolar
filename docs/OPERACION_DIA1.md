# CUBOPOLAR — Procedimiento del Día 1

Guía corta para capacitar al equipo. Describe solo lo que el sistema hace hoy
(producción `95d69a3`, base de datos hasta la migración 115, catálogo del Día 0).

## Antes de abrir (una sola vez) — Conteo físico de apertura

Lo hace **Admin**, justo antes de la primera producción real. Hoy el producto
terminado está en 0 y las existencias de bolsas en el sistema **no están verificadas**.

1. **Bolsas EMP-5 (5 kg) y EMP-25 (25 kg):** contar las bolsas físicas.
   - Si hay **menos** que en el sistema: ajustar a la baja con el conteo (Inventario / Bolsas).
   - Si hay **más**: solo entran con una **recepción de compra real** (Almacén de Bolsas).
   - No producir ni preparar nada antes de este paso.
2. **Producto terminado y barras** (solo si existen al abrir): conteo por cuarto en
   Inventario → "Conteo de cuarto" (fija la cantidad exacta; no mueve dinero).
3. Confirmar en Dashboard que los cuartos muestran lo contado.

## Reglas de la barra (para todos)

- 1 barra física de ~50 kg = **1 barra** en el sistema.
- Vender una barra completa: sale 1 barra, **no** usa bolsa ($120).
- **Preparar** 1 barra = **2 bolsas** de Picada o Triturada y usa **2 bolsas de 25 kg**.
- Vender bolsas ya preparadas **no** vuelve a gastar barra ni bolsa ($60 cada una).
- "Media barra" picada o triturada = **1 bolsa preparada**. No existen medias barras en el sistema.
- La media barra **sin picar** no se maneja en el sistema (caso raro aceptado).
- Picada y triturada **solo** salen de "Preparar barra". Nunca se registran en una máquina.

## Admin

- **Usuarios:** Configuración → crear usuario con su rol (Admin, Ventas, Producción, Chofer,
  Facturación, Almacén Bolsas). Las cuentas de prueba (E2E, QA) están inactivas: no usarlas.
- **Clientes:** Clientes → nuevo cliente (datos fiscales, contacto, dirección/ubicación, zona).
  El crédito y el límite solo los cambia Admin.
- **Precios especiales:** Precios → por cliente y producto. Precio comercial vigente:
  HPC-5K $28 (desde 20 bolsas/semana) y HPC-25K $87 (desde 10 bolsas/semana). El sistema
  **no** revisa el volumen: Admin decide quién califica y lo revisa periódicamente.
- **Camiones:** Rutas → Autorizar ruta → "+ Nuevo camión" (nombre, placas, modelo).
  El camión "david / nununu / 1234" es de prueba: **no usarlo**.
- **Rutas:** Autorizar ruta (chofer, ayudante, camión, carga por producto, pedidos).
  Revisar en Bandeja las rutas abiertas de días anteriores y los cierres de caja.
- **Cierre de caja:** Cortes → contar efectivo y transferencias de cada ruta cerrada.
- **Reversos:** producción equivocada → Producción → Revertir; preparación equivocada →
  Producción → Preparaciones → Revertir. Solo funciona si lo producido/preparado sigue
  completo en el cuarto.
- **Inventario:** conteos por cuarto (Inventario); mermas en Mermas.

## Producción

- **Producir hielo embolsado:** Producción → elige **máquina** (Máq 30 / 20 / 15),
  turno, producto, cantidad y cuarto. Gasta 1 bolsa por unidad automáticamente.
- **Barras:** elige **Máquina Barra** y "Barra de Hielo ~50 kg". No usa bolsa.
- **Preparar barra** (pestaña "Preparar"): elige Picada o Triturada, cuarto y cuántas
  **barras enteras**. Revisa la vista previa ("3 barras → 6 bolsas…", "Se consumirán 6
  empaques…") y confirma. Si dice que falta empaque o barras, avisa a Admin.
  - **Picada:** se puede preparar por adelantado y guardar en el cuarto.
  - **Triturada:** prepárala cerca de la venta (se pega si se guarda mucho).
- **Firmar la carga** de cada ruta cuando el chofer la solicite (botón de firmas).
- **Mermas:** Mermas → producto, cantidad, cuarto, causa y foto.
- **Nunca** uses Transformaciones (ya no forma parte de la operación).

## Ventas

- **Nueva venta:** cliente → productos → detalles. El precio lo pone el sistema
  (público o especial del cliente); no se puede cambiar a mano.
- **Venta en mostrador:** "Completar" la venta eligiendo de qué cuarto sale cada producto
  (contado o crédito).
- **Pedido para ruta:** "Enviar a ruta"; Admin lo asigna a una ruta.
- **Preparación de la barra:** en "Referencias para el chofer" escribe si la quiere
  completa, picada o triturada (por ejemplo "1 barra completa + 2 bolsas picada").
  Para vender picada o triturada debe haber bolsas **ya preparadas** en el cuarto.
- **Link de pago:** el primer cobro real por link se revisa con Admin (ver abajo).

## Chofer

1. Revisa tu ruta y **solicita la carga** con lo que realmente subes; Producción firma.
2. Entrega en cada parada y registra el **cobro** (efectivo, transferencia, tarjeta, link o crédito).
   Funciona sin señal: lo pendiente se sincroniza al reconectar.
3. Si un cliente no recibe: "No entregada" (el producto regresa a la ruta).
4. **Mermas en ruta:** con foto.
5. **Cierre:** con señal y sin pendientes; cuenta lo que regresa en el camión. Si el conteo
   no cuadra, el sistema no deja cerrar: revisa con Admin.

## Primer cobro real con link (GL-2)

En la primera venta con link de pago, Admin verifica: el link es de Stripe en vivo
(`cs_live_…`), llega la notificación de pago, se registra **un solo** pago y la orden cuadra.

## Facturas (GL-3 pendiente)

CUBOPOLAR **todavía no emite facturas reales**: Facturama está en modo prueba
(aparece el aviso "Modo prueba"). **No timbrar** en el sistema. Si un cliente pide factura,
usar el proceso actual externo hasta que se active Facturama en vivo.
