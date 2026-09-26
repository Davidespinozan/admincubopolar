// ventaExpressLogic.js — P0: la venta exprés del chofer no captura datos
// fiscales que luego se descartan.
//
// Decisión (documentada en el PR P0):
//   - Venta exprés SIN factura: puede ser anónima ("Público en general")
//     o contra un cliente de lista. Se conserva el snapshot
//     ordenes.cliente_nombre como hasta ahora.
//   - Venta exprés CON factura: exige un cliente REGISTRADO con RFC
//     nominativo. La identidad fiscal (RFC, régimen, uso CFDI, CP,
//     correo) vive en `clientes` y la lee billing-create-invoice. La
//     orden persiste `requiere_factura = true` para que aparezca en
//     Facturación pendiente.
//   - Si no existe el cliente, el chofer NO puede completar la venta
//     con factura: Ventas/Admin debe darlo de alta por el flujo
//     explícito (ClientesView / NuevaVentaModal). No hay matching ni
//     merge automático (eso es P1).

import { validarRFC } from '../utils/safe';

/**
 * @param {Object} p
 * @param {boolean} p.factura  - toggle "¿Necesita factura?"
 * @param {Object|null} p.cliente - fila de clientes seleccionada de la lista (o null)
 * @returns {{ error: string } | null}
 */
export function validarVentaExpressFactura({ factura, cliente }) {
  if (!factura) return null;
  if (!cliente || cliente.id === undefined || cliente.id === null || cliente.id === '') {
    return { error: 'Para facturar selecciona un cliente registrado de la lista. Si no existe, Ventas debe darlo de alta.' };
  }
  if (!validarRFC(cliente.rfc, { permitirGenericos: false })) {
    return { error: 'El cliente no tiene RFC nominativo. Ventas/Admin debe capturar sus datos fiscales antes de facturar.' };
  }
  return null;
}
