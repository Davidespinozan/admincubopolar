// regimenesFiscales.js — catálogo SAT c_RegimenFiscal (CFDI 4.0).
// Tanda 4 🔴-10: reemplaza el FormSelect/FormInput de texto libre por
// un dropdown con los 19 regímenes SAT vigentes. UI guarda el código
// (3 dígitos), el backend lo pasa directo al CFDI.
//
// Fuente oficial: catálogo c_RegimenFiscal del SAT (Anexo 20 v4.0).

export const REGIMENES_FISCALES_SAT = [
  { codigo: '601', nombre: 'General de Ley Personas Morales', tipo: 'moral' },
  { codigo: '603', nombre: 'Personas Morales con Fines no Lucrativos', tipo: 'moral' },
  { codigo: '605', nombre: 'Sueldos y Salarios e Ingresos Asimilados a Salarios', tipo: 'fisica' },
  { codigo: '606', nombre: 'Arrendamiento', tipo: 'fisica' },
  { codigo: '607', nombre: 'Régimen de Enajenación o Adquisición de Bienes', tipo: 'fisica' },
  { codigo: '608', nombre: 'Demás ingresos', tipo: 'fisica' },
  { codigo: '610', nombre: 'Residentes en el Extranjero sin Establecimiento Permanente', tipo: 'ambos' },
  { codigo: '611', nombre: 'Ingresos por Dividendos (socios y accionistas)', tipo: 'fisica' },
  { codigo: '612', nombre: 'Personas Físicas con Actividades Empresariales y Profesionales', tipo: 'fisica' },
  { codigo: '614', nombre: 'Ingresos por intereses', tipo: 'fisica' },
  { codigo: '615', nombre: 'Régimen de los ingresos por obtención de premios', tipo: 'fisica' },
  { codigo: '616', nombre: 'Sin obligaciones fiscales', tipo: 'ambos' },
  { codigo: '620', nombre: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos', tipo: 'moral' },
  { codigo: '621', nombre: 'Incorporación Fiscal', tipo: 'fisica' },
  { codigo: '622', nombre: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras', tipo: 'ambos' },
  { codigo: '623', nombre: 'Opcional para Grupos de Sociedades', tipo: 'moral' },
  { codigo: '624', nombre: 'Coordinados', tipo: 'moral' },
  { codigo: '625', nombre: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', tipo: 'fisica' },
  { codigo: '626', nombre: 'Régimen Simplificado de Confianza', tipo: 'ambos' },
];

/**
 * Devuelve las opciones formateadas para FormSelect ({value, label}).
 * El value es el código de 3 dígitos; el label combina código + nombre.
 */
export const REGIMENES_OPTIONS = REGIMENES_FISCALES_SAT.map(r => ({
  value: r.codigo,
  label: `${r.codigo} — ${r.nombre}`,
}));

/**
 * Set de códigos válidos para validación rápida.
 */
const CODIGOS_VALIDOS = new Set(REGIMENES_FISCALES_SAT.map(r => r.codigo));

/**
 * Verifica si un valor es un código de régimen SAT válido.
 * @param {string} codigo
 * @returns {boolean}
 */
export function esCodigoRegimenValido(codigo) {
  return CODIGOS_VALIDOS.has(String(codigo || '').trim());
}

/**
 * Busca un régimen por código.
 * @param {string} codigo
 * @returns {{codigo, nombre, tipo}|null}
 */
export function regimenPorCodigo(codigo) {
  const c = String(codigo || '').trim();
  return REGIMENES_FISCALES_SAT.find(r => r.codigo === c) || null;
}
