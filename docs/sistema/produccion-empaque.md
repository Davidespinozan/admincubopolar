# Producción, empaque y costo de empaque

## Invariant
El producto terminado entra a un cuarto frío solo por los contratos de producción; cada unidad
producida consume un empaque y la producción guarda (snapshot) el costo de ese empaque. El costo
del empaque es un promedio ponderado que solo cambia con recepciones de compra y con el reverso
de una producción (al costo unitario guardado), y se reconoce como costo al producir. Ninguna
unidad de empaque entra fuera de esas dos vías; su existencia nunca es negativa. El producto
terminado no se capitaliza ni tiene costo unitario.

## Source of truth
- Existencia de producto terminado: `cuartos_frios.stock` (JSON SKU → entero, por cuarto).
  `productos.stock` de un producto terminado es un espejo NO autoritativo (está desfasado).
- Existencia de empaque: `productos.stock` (total de la empresa: almacén + lo entregado a Producción).
- Costo promedio de empaque: `productos.costo_unitario` del SKU tipo Empaque (6 decimales);
  evidencia de cada cambio en `costos_empaque_historial` (Apertura, Compra, Reverso producción).
- Producción: `produccion` (`operacion_id`, `cuarto_id`, `empaque_sku`, `empaque_cantidad`,
  `costo_empaque`, `costo_total`, estatus Confirmada / Revertida).
- Costo reconocido: `costos_historial` tipo `Producción` y `Reverso producción` (ref `PROD-<id>`).

## Canonical contracts
- `registrar_produccion(op, turno, maquina, sku, cantidad, cuarto)` — Admin, Producción.
- `registrar_transformacion(…)` — Admin, Producción (insumo Materia Prima/Insumo; hoy no hay esos SKUs).
- `revertir_produccion(op, produccion_id, motivo)` — Admin.
- `registrar_recepcion_compra(op, sku, cantidad, costo_total, proveedor, credito)` — Admin, Almacén Bolsas.
- `registrar_salida_empaque(op, sku, cantidad)` — Admin, Almacén Bolsas (entrega a Producción).
- `ajustar_existencia(op, sku, nueva, motivo)` — Admin. `conciliacion_empaque()` — lectura.

## Closed decisions
- **Empaque "Modelo A" (092):** la entrega a Producción es un traslado logístico que no cambia la
  existencia; el único consumo es producir. Por qué: no existe un saldo de Producción y así no hay doble descuento.
- **El costo se reconoce al producir (092/093):** `costos_historial` sin Egreso; la compra es
  efectivo o CxP, no gasto. Por qué: compra + consumo se contaban dos veces.
- **Promedio ponderado con compras reales (106):** nuevo = (existencia × promedio + total de
  factura) ÷ (existencia + recibido); con existencia 0, factura ÷ recibido. El reintento no
  recalcula. Por qué: el costo tecleado a mano no tenía evidencia.
- **Snapshot (076/106):** `costo_empaque` y `costo_total` de una producción no cambian con compras posteriores.
- **Reverso compensatorio (093/094, 107):** la producción no se borra; sale del cuarto original,
  devuelve el empaque guardado, lo reingresa al promedio AL COSTO UNITARIO GUARDADO (con
  existencia 0, ese costo) y compensa el costo GUARDADO en resultados. Por qué: historia inmutable
  y base de costo coherente. Bloqueo: producción → empaque → cuarto (igual que producir).
- **El empaque entra solo por compra (108):** el ajuste manual solo baja (el promedio no cambia);
  un empaque nuevo nace en 0 y sin costo (sustituye la apertura al dar de alta de 106); existencia
  negativa imposible (CHECK, también para SQL de confianza); un empaque con existencia, uso o
  historia no se borra por API. Por qué: unidades sin costo conocido y borrar/recrear reiniciaban la base.
- **Sin costo de producto terminado (106):** no se capitaliza, no hay capas de costo, mano de
  obra y gastos indirectos no se asignan a SKU; `costo_unitario` de Producto Terminado es 0 y
  no se usa. Por qué: el único costo observado es el empaque; evitar falsa precisión.
- **Merma de producto terminado sin valuación ni egreso (106).** Por qué: su empaque ya se reconoció al producir.
- **Apertura declarada (106):** EMP-5 99,000 @ 1 y EMP-25 9,800 @ 2 son supuestos de apertura,
  no costos reconstruidos. Solo hacia adelante.

## Security / mutation boundary
- Por API no se puede: cambiar existencia de insumos por UPDATE (094), editar el costo ni cambiar
  el tipo de un Empaque (106), borrar producción o editar más que turno/máquina (093/094),
  insertar kardex (103), escribir el historial de costo.
- Por API todavía se puede (Admin): INSERT de `productos` (empaque nace 0 @ 0) y DELETE solo de
  empaques sin existencia, uso ni historia (108).
- `service_role` y SQL de confianza quedan fuera de las guardas (autoridad de mantenimiento).

## Dependencies
- `plataforma.md` (actor, idempotencia por operación, día de negocio).
- `finanzas.md` (cómo el reporte lee costo de ventas y compras).
- Cuartos fríos (tarjeta pendiente; evidencia 102/103): primitiva interna `stock_mov_cuarto`.

## Evidence
Migraciones 076, 077, 088 (compra), 092, 093/094, 106, 107/108. Suites `076`, `092`, `093`, `106`, `107` y sus
bloques de concurrencia en el runner local. Vitest: `produccionAtomica`, `reversoProduccion`,
`costoEmpaquePromedio`, `baseCostoEmpaque`.

## Open residuals
- Sin corrección ni reverso de una compra; la CxP de una compra se puede editar o borrar por REST.
- Sin reverso de transformación. Las producciones anteriores a 076 (sin `operacion_id`) no son reversibles.

## Load this card when
producción, transformación, empaque, bolsas, Almacén Bolsas, compra o recepción de empaque,
costo promedio, costo de ventas, revertir producción, `productos.costo_unitario`, `produccion`.
