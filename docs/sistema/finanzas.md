# Finanzas: resultados, efectivo, CxC, CxP y cierres

## Invariant
Resultados (lo devengado) y flujo de efectivo (lo cobrado y pagado) son dos lecturas distintas
del mismo libro y ningún evento se cuenta dos veces. El ingreso nace en la entrega, el efectivo
en el pago. Todo cobro, saldo y cierre se escribe por contrato, una sola vez por operación.

## Source of truth
- Lectura única: `reporte_financiero(desde, hasta)` (Admin, Facturación) → `resultados`, `flujo`,
  `saldos`, `limitaciones`. El navegador no recalcula estos números.
- Ingreso: `ordenes.delivered_at` (día de negocio); órdenes antiguas sin esa fecha usan `ordenes.fecha` (`ventas_legado`).
- Entradas de efectivo: `pagos` (evento canónico de cobro: mostrador, ruta, CxC, pasarela).
- Salidas de efectivo: `movimientos_contables` tipo Egreso, excluyendo asientos sin salida de dinero
  (`fin_egreso_no_efectivo`: categorías Mermas / Costo de Ventas, referencias `MERMA-` y `PROD-`).
- Por cobrar: `cuentas_por_cobrar` + `clientes.saldo` (se mueven juntos, solo por contrato).
- Por pagar: `cuentas_por_pagar` + `pagos_proveedores`.
- Costos del periodo: `costos_historial` (tipos Producción, Reverso producción, Fijo, Variable, Nómina).
- Cierres: `cierres_diarios` (una caja por ruta); `nomina_periodos` + `nomina_recibos`.

## Canonical contracts
- Venta y cobro: `crear_orden`, `update_orden_atomic` (Admin, Ventas); `crear_cxc_orden`,
  `registrar_pago_orden`, `registrar_ingreso_orden` (Admin, Ventas, Chofer); `abonar_cxc`
  (Admin, Ventas, Facturación); `anular_cxc_orden` (Admin).
- Ruta y caja: `cerrar_ruta_financiero` (Admin, Chofer); `cerrar_caja_ruta` (Admin).
- Proveedores: `registrar_recepcion_compra` (Admin, Almacén Bolsas); `pagar_cuenta_por_pagar` (Admin).
- Nómina (Admin): `crear_periodo_nomina`, `generar_recibos_nomina`, `editar_recibo_nomina`, `pagar_nomina`.
- Devolución: `registrar_devolucion` (Admin). Reporte: `reporte_financiero`.

## Closed decisions
- **Resultados ≠ efectivo (093, 096).** El costo de producción y las mermas no son salida de
  dinero; la compra y el pago a proveedor no son gasto. Por qué: antes se sumaban y contaban doble.
- **Ingreso al entregar, efectivo al pagar (093).** Por qué: una venta a crédito no es dinero recibido.
- **Compra de empaque = adquisición; su costo entra a resultados al producir (092/093/106).**
  Otras CxP (que no vienen de `recepcion_compra/`) son gasto al emitirse (`gastos_credito`).
- **Nómina, fijos y variables son costos del periodo;** la nómina se reconoce al pagarse, una vez
  por semana sábado→viernes, con recibos congelados (100/101). Sin IMSS automático.
- **Un cierre = una operación (086, 096, 098, 100):** ruta con UUID + huella; una caja por ruta;
  pago de CxP con UUID y la cuenta bloqueada; nómina pagada una sola vez. Por qué: reintentos duplicaban dinero.
- **Devolución (104/105):** una por orden; precio de la línea original; reembolso en efectivo con
  tope en lo cobrado; nota de crédito solo en venta a crédito; reposición bloqueada; orden
  Facturada deja `requiere_nota_credito`. Por qué: no existe saldo a favor del cliente ni CFDI de egreso.
- **Merma sin gasto adicional (106).** Por qué: el empaque ya se reconoció al producir.
- **Día de negocio America/Mazatlan del servidor en todo asiento de "hoy" (096, 098).**
- **Sin reparación histórica:** las filas legadas se reportan aparte (`ventas_legado`,
  `entradas_legado`); OV-0086 no se toca.

## Security / mutation boundary
- Sin DML REST: `pagos`, `cuentas_por_cobrar`, `cierres_diarios`, `pagos_proveedores`, `nomina_*`, `devoluciones`.
- `ordenes`: campos financieros y `tiene_devolucion` protegidos por `ordenes_guard_financiero`.
- `movimientos_contables`: Admin captura asientos manuales por REST; el servidor fija la fecha de
  negocio (098) y las guardas protegen los asientos ligados a contratos (nómina, reembolsos, costos).
- `cuentas_por_pagar`: Admin todavía inserta, edita y borra por REST (ver residuales).
- El navegador nunca envía montos autoritativos: el servidor deriva precio, total, saldo y actor.

## Dependencies
- `plataforma.md` (actor, idempotencia, día de negocio, guardas).
- `produccion-empaque.md` (origen de `costo_ventas` y de las compras de empaque).
- Órdenes/rutas, nómina y devoluciones: tarjetas pendientes; evidencia 086–088, 100/101, 104/105.

## Evidence
Migraciones 069, 070, 086, 088, 089, 093/094, 096/097, 098/099, 100/101, 104/105, 106. Suites
`069`, `086`, `088`, `093`, `096`, `098`, `100`, `104`. Vitest: `cierreFinanciero`, `cierreCaja`,
`fechasNegocio`, `fechaNegocioEscritores`, `nomina`, `devoluciones`, `b4Privilegios`.

## Open residuals
- La CxP de una compra se puede editar o borrar por REST; no hay corrección ni reverso de compra.
- `pagar_cuenta_por_pagar` no rechaza un pago mayor al saldo (el saldo queda en 0; conserva la aritmética anterior).
- Costos fijos y variables se capturan con dos inserciones no transaccionales desde el navegador.
- La pérdida de empaque (ajustes a la baja) nunca llega a resultados.
- Sin saldo a favor del cliente, sin CFDI de egreso y sin flujo de reposición.
- El reporte no es saldo de caja ni de banco (no hay saldo inicial). `increment_saldo` pendiente de limpieza.

## Load this card when
dinero, pago, cobro, CxC, CxP, proveedor, saldo de cliente, egreso, ingreso, utilidad, reporte
financiero, cierre de ruta o de caja, nómina, devolución o reembolso, `movimientos_contables`.
