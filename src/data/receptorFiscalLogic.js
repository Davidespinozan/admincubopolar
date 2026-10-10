// receptorFiscalLogic.js — a quién sale una factura y con qué datos fiscales.
// Espejo de `decidirReceptor` del servidor (netlify/functions/_lib/invoiceLogic.js):
// la pantalla muestra lo MISMO que el servidor va a timbrar; quien decide es el servidor.
import { REGIMENES_FISCALES_SAT } from './sat/regimenesFiscales';

const GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const REGIMENES = new Map(REGIMENES_FISCALES_SAT.map(r => [r.codigo, r]));

// Usos de CFDI que se ofrecen al capturar un cliente (catálogo c_UsoCFDI 4.0).
// "P01 Por definir" ya no existe en CFDI 4.0: el SAT lo rechaza.
export const USOS_CFDI = [
  { value: 'G01', label: 'G01 — Adquisición de mercancías' },
  { value: 'G03', label: 'G03 — Gastos en general' },
  { value: 'S01', label: 'S01 — Sin efectos fiscales' },
];
const USOS_VALIDOS = new Set(['G01', 'G02', 'G03', 'I01', 'I02', 'I03', 'I04', 'I05', 'I06', 'I07', 'I08', 'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'S01', 'CP01', 'CN01']);

const limpio = (v) => String(v ?? '').trim();
const rfcDe = (v) => limpio(v).toUpperCase();

/** 'moral' (12 caracteres), 'fisica' (13), 'generico' (XAXX/XEXX) o null si no hay RFC con formato. */
export function tipoRfc(rfc) {
  const r = rfcDe(rfc);
  if (!r) return null;
  if (GENERICOS.has(r)) return 'generico';
  if (!RFC_RE.test(r)) return null;
  return r.length === 12 ? 'moral' : 'fisica';
}

/**
 * Régimen y uso de CFDI que se proponen al capturar un RFC. Antes todo cliente nacía con
 * 616 "Sin obligaciones fiscales" + G03, combinación que el SAT rechaza: la factura no salía
 * a su nombre. Persona moral → 601; física → 612; sin RFC → 616 con S01.
 */
export function fiscalesPorOmision(rfc) {
  const t = tipoRfc(rfc);
  if (t === 'moral') return { regimen: '601', usoCfdi: 'G03' };
  if (t === 'fisica') return { regimen: '612', usoCfdi: 'G03' };
  return { regimen: '616', usoCfdi: 'S01' };
}

/** ¿El régimen es de los que puede tener ese tipo de persona? (vacío = no) */
export function regimenCompatible(rfc, regimen) {
  const r = REGIMENES.get(limpio(regimen));
  const t = tipoRfc(rfc);
  if (!r) return false;
  if (t !== 'moral' && t !== 'fisica') return true;
  return r.tipo === 'ambos' || r.tipo === t;
}

/**
 * Lo que le falta a un cliente con RFC propio para que su factura salga a su nombre.
 * `cp` es el código postal FISCAL (el de su constancia), no el de entrega.
 * @returns {string[]} textos listos para mostrarse; [] si está completo o si no lleva RFC propio.
 */
export function faltantesFiscales(cliente) {
  const t = tipoRfc(cliente?.rfc);
  if (t === 'generico' || !limpio(cliente?.rfc)) return [];
  const faltan = [];
  if (!t) faltan.push('un RFC con formato válido');
  const regimen = limpio(cliente?.regimen);
  if (!REGIMENES.has(regimen)) faltan.push('el régimen fiscal');
  else if (t && !regimenCompatible(cliente?.rfc, regimen)) faltan.push(`un régimen de persona ${t === 'moral' ? 'moral' : 'física'} (tiene ${regimen})`);
  else if (regimen === '616') faltan.push('su régimen real (616 "Sin obligaciones fiscales" es solo para público en general)');
  if (!/^\d{5}$/.test(limpio(cliente?.cp))) faltan.push('el código postal fiscal (5 dígitos)');
  const uso = limpio(cliente?.usoCfdi ?? cliente?.uso_cfdi);
  if (uso && !USOS_VALIDOS.has(uso)) faltan.push(`un uso de CFDI válido (tiene "${uso}")`);
  return faltan;
}

/**
 * Receptor que llevará la factura de una venta, para la vista previa.
 * @returns {{publicoGeneral:boolean, nombre:string, rfc:string, regimen:string, usoCfdi:string, cp:string, faltan:string[]}}
 */
export function receptorDeFactura(cliente, { cpEmisor = '' } = {}) {
  const rfc = rfcDe(cliente?.rfc);
  if (!rfc || rfc === 'XAXX010101000') {
    return { publicoGeneral: true, nombre: 'PUBLICO EN GENERAL', rfc: 'XAXX010101000', regimen: '616', usoCfdi: 'S01', cp: limpio(cpEmisor), faltan: [] };
  }
  if (rfc === 'XEXX010101000') {
    return { publicoGeneral: false, nombre: 'PUBLICO EN GENERAL EXTRANJERO', rfc, regimen: '616', usoCfdi: 'S01', cp: limpio(cpEmisor), faltan: [] };
  }
  return {
    publicoGeneral: false, nombre: limpio(cliente?.nombre), rfc, regimen: limpio(cliente?.regimen),
    usoCfdi: limpio(cliente?.usoCfdi ?? cliente?.uso_cfdi) || 'G03', cp: limpio(cliente?.cp), faltan: faltantesFiscales(cliente),
  };
}

/** Nombre del régimen para mostrarlo ("601 — General de Ley Personas Morales"). */
export function etiquetaRegimen(codigo) {
  const r = REGIMENES.get(limpio(codigo));
  return r ? `${r.codigo} — ${r.nombre}` : limpio(codigo);
}

/** Códigos del servidor ante los que la pantalla ofrece facturar a público en general. */
export const CODIGOS_OFRECER_PUBLICO = new Set(['RFC_RECHAZADO', 'DATOS_FISCALES_INCOMPLETOS']);
