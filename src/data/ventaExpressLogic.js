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
//   - Si no existe el cliente, el chofer lo da de alta con datos fiscales
//     completos por el contrato `crear_cliente_chofer` (127): sin crédito,
//     idempotente por RFC. No hay matching ni merge automático (eso es P1).

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
    return { error: 'Para facturar selecciona un cliente registrado de la lista. Si no existe, regístralo con "Registrar cliente nuevo".' };
  }
  if (!validarRFC(cliente.rfc, { permitirGenericos: false })) {
    return { error: 'El cliente no tiene RFC nominativo. Ventas/Admin debe capturar sus datos fiscales antes de facturar.' };
  }
  return null;
}

/**
 * Valida los datos fiscales que el chofer captura para registrar un cliente nuevo
 * (espejo de las reglas de `crear_cliente_chofer`, 127; el servidor decide).
 * @param {Object} d - { nombre, rfc, regimen, usoCfdi, cp, correo }
 * @returns {{ error: string } | null}
 */
export function validarClienteNuevoChofer(d = {}) {
  if (!String(d.nombre || '').trim()) return { error: 'Captura el nombre o razón social.' };
  if (!validarRFC(d.rfc, { permitirGenericos: false })) return { error: 'El RFC no es válido (debe ser nominativo, no genérico).' };
  if (!/^\d{3}$/.test(String(d.regimen || '').trim())) return { error: 'Elige el régimen fiscal.' };
  if (!String(d.usoCfdi || '').trim()) return { error: 'Elige el uso de CFDI.' };
  if (!/^\d{5}$/.test(String(d.cp || '').trim())) return { error: 'El código postal debe tener 5 dígitos.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.correo || '').trim())) return { error: 'Captura un correo válido para enviar la factura.' };
  return null;
}
