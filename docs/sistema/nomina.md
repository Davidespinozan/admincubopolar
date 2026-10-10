# Nómina: periodos, recibos y conceptos (bonos, comisiones, descuentos)

## Invariant
Un periodo se paga una sola vez por el neto de sus recibos, y cada recibo cuadra con su desglose:
las casillas del recibo son la SUMA de sus renglones por clase. Lo pagado es histórico e
inmutable (periodo, recibos y renglones). El navegador nunca manda salario ni totales.

## Source of truth
- `nomina_periodos` (semana sábado → viernes, pago el viernes; identidad = `fecha_inicio`) y
  `nomina_recibos` (uno por empleado, con la foto del salario diario). Migraciones 100/101.
- `nomina_conceptos` — catálogo: nombre, tipo (`percepcion` / `descuento`), clase, cálculo (monto
  fijo semanal o % del salario diario), a quién aplica (`todos` / `departamento` / `personas`),
  vigencia opcional y activo. Migración 128.
- `nomina_concepto_empleados` — por persona: `excluido`, `monto` propio y `limite_total` (tope).
- `nomina_recibo_lineas` — el desglose del recibo. Cada renglón guarda la FOTO de nombre, tipo,
  clase y monto, y lo que se propuso (`propuesto`). `concepto_id` nulo = renglón manual.
- Clase → casilla del recibo: `comisiones`, `prima_dominical`, `bono_puntualidad`,
  `bono_productividad`, `otras_percepciones`; todo descuento (`isr`, `imss`, `prestamo`,
  `otras_deducciones`) suma en `deducciones`.
- Egreso y costo del pago: `movimientos_contables` + `costos_historial` (ver `finanzas.md`).

## Canonical contracts (todos Admin)
- `crear_periodo_nomina(fecha)` · `pagar_nomina(periodo)` — sin cambio desde 100.
- `generar_recibos_nomina(periodo)` — crea los recibos que falten y, SOLO a los recién creados,
  les propone los conceptos del catálogo. Nunca reescribe un recibo existente.
- `aplicar_conceptos_nomina(periodo)` — agrega a un borrador los conceptos que le falten (catálogo
  creado o cambiado después). No cambia montos capturados ni revive un renglón dejado en 0.
- `guardar_recibo_nomina(recibo, dias, con_septimo, lineas)` — el desglose completo que debe
  quedar. Un concepto que ya estaba y no viene queda en 0 ("no aplicó"); los manuales se reemplazan.
- `guardar_concepto_nomina(id, datos)` — alta y edición del catálogo; `personas` reemplaza la lista.
  Deja `bitacora_cambios` (acción CONTRATO, la lee el Dueño) y `auditoria`.
- `nomina_acumulados()` — avance de los topes: pagado, en borrador y restante.
- `editar_recibo_nomina(...)` (100) — contrato anterior, misma firma y respuesta: recibe el TOTAL
  de cada casilla y guarda la diferencia contra el catálogo como renglón manual.
- Lectura: solo Admin activo (`erp_rol_activo() = 'Admin'`). Sin DML por API en ninguna de las 5 tablas.

## Closed decisions
- **Semana sábado → viernes, pago el viernes, Borrador → Pagado inmutable (100/101).** No se reabre.
- **El recibo guarda la foto.** Cambiar o desactivar un concepto no cambia recibos ya generados.
  Por qué: la nómina de una semana no puede moverse porque alguien editó el catálogo después.
- **Las casillas de 100 se conservan como sumas.** Los CHECK de 100, `pagar_nomina`, los totales
  del periodo y las guardas no cambiaron con 128 (md5 idénticos). Por qué: no reabrir lo cerrado.
- **Los conceptos los administra Admin; el Dueño lo ve en su bitácora** (decisión delegada,
  2026-10-09). Un bono se propone completo, no proporcional a los días: Admin lo quita o ajusta.
- **Préstamo = descuento con tope acumulado opcional.** El acumulado se DERIVA de los renglones
  (pagados y en borrador); no hay saldo mutable. Al llegar al tope deja de proponerse y el
  contrato rechaza descontar de más. Dos semanas generadas a la vez no rebasan el tope.
- **El sistema no calcula ISR ni IMSS.** Se capturan como descuentos con monto por persona.
- **Un descuento propuesto nunca deja el neto en negativo:** se recorta a lo disponible y se
  conserva lo propuesto. Al guardar a mano, un neto negativo se rechaza.
- **Tipo y clase de un concepto no cambian después del alta:** se desactiva y se crea otro.
- **Un concepto sin fechas aplica siempre** (también a la semana que se paga el mismo día del alta).

## Known limits
- Sin reverso de un periodo pagado (backlog aceptado). Sin recibo imprimible por empleado.
- Comisiones calculadas con ventas o entregas y puntualidad con el reloj checador: no existen;
  se capturan por semana.
- La pantalla carga el desglose de las 12 semanas más recientes.
- "Faltan conceptos" en la pantalla es una pista (no cuenta conceptos con vigencia ni con tope);
  `aplicar_conceptos_nomina` es quien decide.

## Verification
`supabase/tests/128_conceptos_nomina_test.sql`, `100_nomina_canonica_test.sql` (también tras 128),
concurrencia `conc128` / `conc100` del runner; `src/__tests__/nom1ConceptosNomina.test.jsx`,
`src/__tests__/nomina.test.js`. Invariante en producción (solo lectura): por recibo, casillas =
sumas de `nomina_recibo_lineas`; por periodo, `total_neto` = suma de `neto_a_pagar`.

## Load this card when
nómina, recibos, periodo de nómina, bonos, comisiones, prima dominical, descuentos, préstamos a
empleados, ISR/IMSS en el recibo, conceptos de nómina, `nomina_*`.
