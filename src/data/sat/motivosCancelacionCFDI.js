// motivosCancelacionCFDI.js — catálogo SAT de motivos de cancelación
// CFDI 4.0 (Anexo 20). Tanda 5: la UI muestra estos en un dropdown,
// el backend los manda directo a Facturama (param `motive`) y a SAT.
//
// Solo el motivo '01' requiere uuidSustituto (UUID del CFDI que reemplaza
// al cancelado). Los demás se cancelan sin sustitución.

export const MOTIVOS_CANCELACION_CFDI = [
  {
    codigo: '01',
    nombre: 'Comprobante emitido con errores con relación',
    descripcion: 'El CFDI tenía errores y se emite uno nuevo que lo sustituye.',
    requiereSustituto: true,
  },
  {
    codigo: '02',
    nombre: 'Comprobante emitido con errores sin relación',
    descripcion: 'El CFDI tenía errores y NO se emitirá uno que lo sustituya.',
    requiereSustituto: false,
  },
  {
    codigo: '03',
    nombre: 'No se llevó a cabo la operación',
    descripcion: 'La venta nunca se concretó (cliente canceló, devolución total, etc.).',
    requiereSustituto: false,
  },
  {
    codigo: '04',
    nombre: 'Operación nominativa relacionada en factura global',
    descripcion: 'Cliente solicitó CFDI nominativo de una venta ya incluida en factura global a público.',
    requiereSustituto: false,
  },
];

/**
 * Opciones para FormSelect ({value, label}).
 */
export const MOTIVOS_OPTIONS = MOTIVOS_CANCELACION_CFDI.map(m => ({
  value: m.codigo,
  label: `${m.codigo} — ${m.nombre}`,
}));

const CODIGOS_VALIDOS = new Set(MOTIVOS_CANCELACION_CFDI.map(m => m.codigo));

export function esMotivoCancelacionValido(codigo) {
  return CODIGOS_VALIDOS.has(String(codigo || '').trim());
}

export function motivoPorCodigo(codigo) {
  const c = String(codigo || '').trim();
  return MOTIVOS_CANCELACION_CFDI.find(m => m.codigo === c) || null;
}

export function requiereUuidSustituto(codigo) {
  const m = motivoPorCodigo(codigo);
  return !!m?.requiereSustituto;
}
