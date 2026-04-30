# Respuesta a Observaciones, Dudas y Aclaraciones — CuboPolar ERP

---

## 1. Observaciones — Catálogo de Productos (SKU)

**"No permite modificar el SKU una vez creado"**
> El campo SKU **sí es editable**. Al hacer clic sobre cualquier producto en el catálogo se abre el formulario de edición donde se puede modificar el SKU, nombre, precio, costo y demás campos. Si necesitan que les mostremos dónde, con gusto agendamos una sesión.

**"No existe la opción para eliminar productos"**
> **Ya se agregó.** Al abrir un producto para editar, ahora aparece un botón rojo "Eliminar producto" en la parte inferior del formulario. Pide confirmación antes de ejecutar para evitar eliminaciones accidentales.

---

## 2. Observaciones — Rutas de Distribución (Entregas)

**"No hay visualización en tiempo real de las rutas"**
> **Ya se implementó.** Ahora cuando un chofer está en ruta, el sistema envía su ubicación GPS cada 30 segundos automáticamente. Desde la vista de Administración en el módulo de Rutas, al hacer clic en "Ver mapa de pedidos", se muestran:
> - Pins naranjas = pedidos sin ruta asignada
> - Pins azules = pedidos asignados a ruta
> - **Marcadores verdes pulsantes = choferes activos en tiempo real** (con nombre del chofer y folio de ruta)

**"Adjuntar evidencia (folio de nota y/o fotografía)"**
> **Ya se implementó ambos:**
> - **Folio de nota:** Aparece un campo "Folio de nota (opcional)" tanto al crear la orden desde administración como al momento de la entrega por parte del chofer.
> - **Foto de evidencia:** En el modal de entrega del chofer ahora aparece la opción "Foto de nota o entrega" que permite tomar una foto con la cámara del celular como comprobante. Esta foto queda vinculada a la entrega.

**"No hay opción para cuadrar producto vendido contra merma o devoluciones"**
> **Ya se mejoró.** La pantalla de cierre de ruta del chofer ahora muestra una tabla de cuadre con 5 columnas:
>
> | Producto | Cargó | Entregó | Merma | Devuelve |
> |----------|-------|---------|-------|----------|
> | HC-25K   | 100   | 85      | 3     | 12       |
> | HC-5K    | 50    | 45      | 1     | 4        |
> | **Total**| **150**| **130** | **4** | **16**   |
>
> Además, el sistema **bloquea el cierre de ruta** si los números no cuadran (si un producto muestra que se entregó más de lo que se cargó).

---

## 3. Observaciones — Creación de Cliente Nuevo

**"No hay campo de nombre comercial"**
> **Ya se agregó.** Al crear o editar un cliente ahora aparece el campo "Nombre comercial" debajo de la razón social. Ejemplos: "Nevería Don Pedro", "Tienda La Esquina". Este nombre comercial:
> - Se muestra en la tabla de clientes debajo de la razón social
> - Se puede buscar por nombre comercial en el buscador

**"Solo se permite registrar razón social y RFC"**
> Resuelto con el punto anterior. El nombre comercial permite identificar clientes de mostrador sin necesidad de razón social formal. Para público en general se puede usar el RFC genérico (XAXX010101000) junto con un nombre comercial descriptivo.

**"Precios especiales solo permite configurar un solo producto"**
> Esto **ya funcionaba para múltiples productos**. Existe una vista completa llamada **"Precios Especiales"** en el menú de Comercial donde se pueden asignar precios diferentes a **todos los productos que se deseen** por cada cliente. Cada precio especial se agrega individualmente y se pueden tener tantos como se necesiten por cliente. Les mostraremos dónde encontrarla.

---

## 4. Observaciones — Ventas

**"Falta captura del número de folio de la nota"**
> **Ya se agregó.** El campo "Folio de nota" aparece en dos lugares:
> 1. Al crear una orden desde Ventas (campo opcional)
> 2. Al momento de la entrega por parte del chofer (campo opcional)
>
> El folio de nota se muestra en la tabla de ventas debajo del folio del sistema para fácil identificación.

---

## 5. Dudas y Aclaraciones

### "¿Cómo funcionan las órdenes de venta?"

Las órdenes tienen un ciclo de vida con 4 estados:

```
CREADA → ASIGNADA → ENTREGADA → FACTURADA
```

| Etapa | Quién la hace | Qué sucede |
|-------|---------------|------------|
| **Creada** | Admin o Vendedor | Se registra el pedido con cliente, productos, total y tipo de cobro (contado o crédito). El folio se genera automáticamente (OV-0001, OV-0002...) |
| **Asignada** | Admin | Se agrega la orden a una ruta de reparto. El inventario se descuenta del cuarto frío en ese momento |
| **Entregada** | Chofer o Admin | Se registra el cobro (efectivo, transferencia, tarjeta, crédito). Se genera automáticamente el ingreso contable |
| **Facturada** | Admin | Se timbra el CFDI en Facturama. El folio fiscal queda ligado a la orden |

---

### "¿La facturación está ligada a los ingresos? ¿Está automatizado?"

**Sí, todo está conectado y automatizado:**

1. Al **cobrar una orden** → se genera automáticamente un registro de **ingreso en contabilidad**
2. Al **timbrar factura** → se genera el CFDI en Facturama y la orden pasa a "Facturada"
3. Si la venta es a **crédito con factura** → se emite factura PPD y cuando el cliente paga, se genera automáticamente el **Complemento de Pago**

```
Venta → Cobro → Ingreso contable (automático)
              → Cuenta por cobrar si es crédito (automático)
              → Factura CFDI (se timbra con un botón)
              → Complemento de pago (automático al cobrar la CxC)
```

---

### "¿Las órdenes son de andén o de ruta?"

**Sirven para ambas.** La diferencia es cómo se procesan:

| Tipo de venta | Proceso |
|---------------|---------|
| **Andén / mostrador** | Crear orden → Cobrar directo (botón "Cobrar") → Listo |
| **Ruta** | Crear orden → Crear ruta (asignar chofer + camión + órdenes) → Chofer entrega y cobra → Cierre de ruta |
| **Venta a bordo** | El chofer crea la venta directamente desde su celular usando "Venta rápida" |

---

### "La vista de Ventas está limitada"

La vista de Ventas ya muestra el flujo completo de cada venta:

- **Badges de color** por estatus: Creada (gris), Asignada (azul), Entregada (verde), Facturada (morado)
- **Columna "Ruta"** que muestra a qué ruta está asignada cada orden
- **Botones de acción** según la etapa:
  - Creada → "Cobrar" + "Asignar ruta"
  - Asignada → "Cobrar entrega"
  - Entregada → "Facturar"
- Se puede **filtrar por estatus** y **buscar por folio o cliente**

---

### "¿Cómo funciona el sistema desde la vista de otros usuarios?"

El sistema tiene **5 roles**, cada uno con su propia vista:

| Rol | Qué ve | Para quién |
|-----|--------|------------|
| **Admin** | Todo: ventas, rutas, producción, inventario, contabilidad, facturación, clientes, empleados, nómina, auditoría | Dueños / gerente |
| **Chofer** | App móvil de 3 pasos: Confirmar carga → Entregar pedidos → Cerrar ruta | Chofer / repartidor |
| **Ventas** | Crear órdenes, ver sus clientes, registrar cobros | Vendedor |
| **Producción** | Crear lotes de producción, confirmar, transformar productos | Encargado de planta |
| **Almacén** | Entrada/salida de empaques, ajustes de inventario, cuartos fríos | Almacenista |

**Como Admin pueden ver cualquier vista** usando el botón **"Ver como..."** que aparece en la parte superior. Esto les permite ver exactamente lo que ve un Chofer, Vendedor, etc.

---

### Ejemplo completo: Flujo de una venta de ruta

```
1. Admin/Vendedor crea la orden:
   OV-0045 → Nevería Don Pedro → 25 bolsas HC-25K → $2,500 → Contado

2. Admin crea la ruta del día:
   R-012 → Chofer: Juan → Camión: Unidad 3
   Asigna OV-0045 + otras órdenes → Inventario se descuenta automáticamente

3. Chofer Juan abre su app:
   → Confirma la carga
   → Ve las entregas pendientes con dirección y mapa
   → Entrega a Nevería Don Pedro → Cobra $2,500 efectivo
   → Captura folio de nota y foto de evidencia
   → Si alguien le compra en el camino → Venta rápida
   → Si se rompe una bolsa → Registra merma con foto

4. Al terminar, el chofer cierra la ruta:
   → Ve el cuadre: Cargó 100 | Entregó 85 | Merma 3 | Devuelve 12
   → Ve cobros: Efectivo $15,000 | Transferencia $3,000 | Crédito $2,500
   → Envía reporte → Ruta cerrada

5. El sistema automáticamente:
   → Registra ingresos contables por cada cobro
   → Crea cuentas por cobrar por ventas a crédito
   → Registra egresos por costo de mermas
   → Devuelve inventario sobrante al cuarto frío
   → Envía notificación al admin
```

---

## Resumen de cambios realizados

| Funcionalidad | Estado |
|---------------|--------|
| Nombre comercial en clientes | Implementado |
| Folio de nota en ventas y entregas | Implementado |
| Foto de evidencia en entregas | Implementado |
| Eliminar productos del catálogo | Implementado |
| Cuadre detallado al cierre de ruta | Implementado |
| GPS en tiempo real de choferes | Implementado |
| Seguridad por roles (RLS) | Implementado |
| Registro de errores en producción | Implementado |
| Precios especiales multi-producto | Ya existía |
| Edición de SKU | Ya existía |
| Vista por roles (Ver como...) | Ya existía |

---

*Cualquier duda adicional estamos a sus órdenes. Se recomienda agendar una sesión de capacitación para mostrar las nuevas funcionalidades y las que ya existían pero no se habían explorado.*
