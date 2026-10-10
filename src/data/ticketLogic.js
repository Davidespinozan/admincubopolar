// ticketLogic.js — lógica pura del Chofer para (1) el ticket de la entrega que
// se manda al cliente y (2) el mapa de la parada DENTRO de la app.
// El ticket es la nota pública firmada (netlify/functions/recibo): aquí solo se
// arma el mensaje y el enlace de WhatsApp.

const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const pesos = (x) => `$${(Number(x) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Mensaje que acompaña al link del ticket. */
export function mensajeTicket({ empresa, cliente, folio, total, pago, url } = {}) {
  const quien = texto(empresa) || 'Cubo Polar';
  const saludo = texto(cliente) ? `Hola ${texto(cliente)}, ` : 'Hola, ';
  const detalle = [texto(folio) && `folio ${texto(folio)}`, Number(total) > 0 && pesos(total), texto(pago)].filter(Boolean).join(' · ');
  return `${saludo}gracias por tu compra en ${quien}.${detalle ? ` Tu ticket (${detalle}):` : ' Tu ticket:'}\n${texto(url)}`;
}

/** Enlace de WhatsApp: al teléfono del cliente (10 dígitos, México) o para elegir contacto. */
export function enlaceWhatsApp(telefono, mensaje) {
  const tel = String(telefono ?? '').replace(/\D/g, '').slice(-10);
  const q = `?text=${encodeURIComponent(String(mensaje ?? ''))}`;
  return tel.length === 10 ? `https://wa.me/52${tel}${q}` : `https://wa.me/${q}`;
}

const coordenada = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
/** ¿La parada tiene coordenadas utilizables? */
export function tieneCoordenadas(parada) {
  const lat = coordenada(parada?.latitud);
  const lng = coordenada(parada?.longitud);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/**
 * URL del mapa embebido de una parada (se muestra dentro de la app, sin salir):
 * por coordenadas si las hay; si no, por la dirección escrita. null si no hay nada.
 */
export function urlMapaParada(parada) {
  const destino = tieneCoordenadas(parada) ? `${Number(parada.latitud)},${Number(parada.longitud)}` : texto(parada?.direccion);
  if (!destino) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(destino)}&z=16&output=embed`;
}

/** Enlace para abrir la navegación paso a paso en la app de mapas (eso sí sale de la app). */
export function urlNavegacionParada(parada) {
  const destino = tieneCoordenadas(parada) ? `${Number(parada.latitud)},${Number(parada.longitud)}` : texto(parada?.direccion);
  return destino ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}` : null;
}

// ── Datos bancarios para cobrar por transferencia (mig 132) ──
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** CLABE válida: 18 dígitos y dígito verificador correcto (pesos 3-7-1). */
export function validarClabe(clabe) {
  const d = soloDigitos(clabe);
  if (d.length !== 18) return false;
  const pesos371 = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i += 1) suma += (Number(d[i]) * pesos371[i % 3]) % 10;
  return (10 - (suma % 10)) % 10 === Number(d[17]);
}

/** "012 180 01234567890 1": la CLABE en grupos, más fácil de dictar y revisar. */
export function formatoClabe(clabe) {
  const d = soloDigitos(clabe);
  return d.length === 18 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 17)} ${d.slice(17)}` : d;
}

/** Datos bancarios de la configuración (camel o snake), ya limpios. `completos` = hay CLABE. */
export function datosBancarios(config) {
  const c = config || {};
  const clabe = soloDigitos(c.clabe);
  return {
    banco: texto(c.banco), clabe, beneficiario: texto(c.beneficiario || c.razonSocial || c.razon_social),
    cuenta: texto(c.cuentaBancaria ?? c.cuenta_bancaria), completos: clabe.length === 18,
  };
}

/** Mensaje con los datos para transferir. null si la empresa no tiene CLABE capturada. */
export function mensajeTransferencia(config, { total, folio } = {}) {
  const b = datosBancarios(config);
  if (!b.completos) return null;
  const lineas = [
    'Datos para tu transferencia:',
    b.beneficiario && `Beneficiario: ${b.beneficiario}`,
    b.banco && `Banco: ${b.banco}`,
    `CLABE: ${b.clabe}`,
    b.cuenta && `Cuenta: ${b.cuenta}`,
    Number(total) > 0 && `Importe: ${pesos(total)}`,
    texto(folio) && `Concepto: ${texto(folio)}`,
    'Al terminar, envíanos por aquí tu comprobante. Gracias.',
  ];
  return lineas.filter(Boolean).join('\n');
}

/**
 * Valida el formulario de datos bancarios (Ajustes) y devuelve el parche para guardar.
 * Todo vacío = borrar los datos. Con algún dato, la CLABE es obligatoria y debe ser válida.
 */
export function buildDatosBancarios(form = {}) {
  const banco = texto(form.banco);
  const clabe = soloDigitos(form.clabe);
  const beneficiario = texto(form.beneficiario);
  const cuenta = soloDigitos(form.cuentaBancaria);
  if (!banco && !clabe && !beneficiario && !cuenta) return { datos: { banco: null, clabe: null, beneficiario: null, cuentaBancaria: null } };
  if (clabe.length !== 18) return { error: 'La CLABE tiene 18 números' };
  if (!validarClabe(clabe)) return { error: 'La CLABE no es válida: revisa los números' };
  if (!banco) return { error: 'Escribe el banco' };
  if (banco.length > 60 || beneficiario.length > 120 || cuenta.length > 30) return { error: 'Un dato es demasiado largo' };
  return { datos: { banco, clabe, beneficiario: beneficiario || null, cuentaBancaria: cuenta || null } };
}
