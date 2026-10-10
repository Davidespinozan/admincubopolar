// arreglosCampo.test.js — arreglos reportados en campo (2026-10-09):
// ticket de la entrega y mapa dentro de la app (Chofer), link público de la
// nota, resumen económico del cierre de ruta, hoja de firma y mapa de Rutas.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mensajeTicket, enlaceWhatsApp, tieneCoordenadas, urlMapaParada, urlNavegacionParada } from '../data/ticketLogic';
import { resumenEconomicoRuta, ordenEntregada } from '../data/rutasLogic';
import { createHandler as createReciboHandler } from '../../netlify/functions/recibo/index.js';
import { firmarRecibo } from '../../netlify/functions/_lib/reciboToken.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Chofer: ticket de la entrega', () => {
  it('el mensaje saluda, dice folio, importe y forma de pago, y trae el link', () => {
    const m = mensajeTicket({ empresa: 'Cubo Polar SA', cliente: ' Abarrotes  Lupita ', folio: 'OV-0101', total: 1240.5, pago: 'Efectivo', url: 'https://x/nota/9?t=abc' });
    expect(m).toBe('Hola Abarrotes Lupita, gracias por tu compra en Cubo Polar SA. Tu ticket (folio OV-0101 · $1,240.50 · Efectivo):\nhttps://x/nota/9?t=abc');
    expect(mensajeTicket({ url: 'https://x' })).toBe('Hola, gracias por tu compra en Cubo Polar. Tu ticket:\nhttps://x');
  });

  it('WhatsApp: al teléfono del cliente (10 dígitos) o para elegir contacto', () => {
    expect(enlaceWhatsApp('(618) 123-4567', 'hola ñ')).toBe('https://wa.me/526181234567?text=hola%20%C3%B1');
    expect(enlaceWhatsApp('+52 618 123 4567', 'x')).toBe('https://wa.me/526181234567?text=x');
    expect(enlaceWhatsApp('', 'x')).toBe('https://wa.me/?text=x');
    expect(enlaceWhatsApp('12345', 'x')).toBe('https://wa.me/?text=x');
  });

  it('la pantalla abre el ticket al terminar la entrega y dice por qué falló si falla', () => {
    const v = src('../components/ChoferView.jsx');
    expect(v).toMatch(/abrirTicket\(entrega, contactoCliente\)/);
    expect(v).toMatch(/data-testid="ticket-entrega"/);
    expect(v).toMatch(/Enviar ticket por WhatsApp/);
    expect(v).toMatch(/err\?\.status === 403/);
    expect(v).not.toMatch(/No se pudo generar la nota'/);   // el aviso genérico que escondía la causa
  });
});

describe('Chofer: mapa de la parada dentro de la app', () => {
  it('por coordenadas si las hay; si no, por la dirección; nada si no hay datos', () => {
    expect(urlMapaParada({ latitud: 24.02, longitud: -104.65, direccion: 'x' })).toBe('https://maps.google.com/maps?q=24.02%2C-104.65&z=16&output=embed');
    expect(urlMapaParada({ direccion: ' Av. 20 de Noviembre  100 ' })).toBe('https://maps.google.com/maps?q=Av.%2020%20de%20Noviembre%20100&z=16&output=embed');
    expect(urlMapaParada({ latitud: 0, longitud: 0 })).toBeNull();
    expect(urlMapaParada({})).toBeNull();
    expect([{ latitud: '24', longitud: '-104' }, { latitud: null, longitud: -104 }, { latitud: 95, longitud: 1 }].map(tieneCoordenadas)).toEqual([true, false, false]);
    expect(urlNavegacionParada({ latitud: 24.02, longitud: -104.65 })).toBe('https://www.google.com/maps/dir/?api=1&destination=24.02%2C-104.65');
  });

  it('la tarjeta de la entrega ya no saca al chofer de la app', () => {
    const v = src('../components/ChoferView.jsx');
    expect(v).toMatch(/data-testid="ver-mapa-parada"/);
    expect(v).toMatch(/<iframe title="Mapa de la entrega"/);
    expect(v).not.toMatch(/window\.location\.href = `https:\/\/www\.google\.com\/maps\/search/);
  });
});

describe('Nota pública: el link /nota/:id?t= funciona', () => {
  const SECRETO = 'secreto-de-prueba';
  const supa = () => ({ from: (t) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === 'ordenes' ? { id: 77, folio: 'OV-77', total: 100, estatus: 'Entregada', fecha: '2026-10-09' } : null, error: null }), order: async () => ({ data: [] }) }) }) }) });
  const handler = createReciboHandler({ getSupabase: supa, getSecret: () => SECRETO });

  it('toma el id de la ruta cuando el rewrite no manda ?o=', async () => {
    const t = firmarRecibo(77, SECRETO);
    const r = await handler({ httpMethod: 'GET', path: '/nota/77', queryStringParameters: { t } });
    expect(r.statusCode).toBe(200);
    const directo = await handler({ httpMethod: 'GET', path: '/.netlify/functions/recibo', queryStringParameters: { o: '77', t } });
    expect(directo.statusCode).toBe(200);
  });

  it('sin id o con firma de otra orden: sigue rechazado', async () => {
    expect((await handler({ httpMethod: 'GET', path: '/nota/', queryStringParameters: { t: 'x' } })).statusCode).toBe(400);
    expect((await handler({ httpMethod: 'GET', path: '/nota/78', queryStringParameters: { t: firmarRecibo(77, SECRETO) } })).statusCode).toBe(403);
  });
});

describe('Rutas: resumen económico del cierre', () => {
  const RUTA = { id: 5, total_cobrado: 0, total_credito: 0 };
  const ORDENES = [
    { id: 1, rutaId: 5, estatus: 'Entregada', total: 500, metodoPago: 'Efectivo' },
    { id: 2, rutaId: 5, estatus: 'Facturada', total: 300.5, metodoPago: 'Transferencia' },
    { id: 3, rutaId: 5, estatus: 'Entregada', total: 1000, metodoPago: 'Crédito' },
    { id: 4, rutaId: 5, estatus: 'Entregada', total: 200, metodoPago: '', tipoCobro: 'Credito' },
    { id: 5, rutaId: 5, estatus: 'Cancelada', total: 999, metodoPago: 'Efectivo' },
    { id: 6, rutaId: 5, estatus: 'Asignada', total: 999, metodoPago: 'Efectivo' },
    { id: 7, rutaId: 6, estatus: 'Entregada', total: 999, metodoPago: 'Efectivo' },
    { id: 8, ruta_id: 5, estatus: 'entregada', total: '50', metodo_pago: 'Efectivo' },
  ];

  it('sale de las órdenes entregadas de la ruta, no de las columnas que ya nadie escribe', () => {
    const r = resumenEconomicoRuta(RUTA, ORDENES);
    expect(r).toEqual({ cobrado: 850.5, credito: 1200, total: 2050.5, entregas: 5, porMetodo: { Efectivo: 550, Transferencia: 300.5, 'Crédito': 1200 } });
    expect([{ estatus: 'Facturada' }, { estatus: ' entregada ' }, { estatus: 'Cancelada' }, null].map(ordenEntregada)).toEqual([true, true, false, false]);
  });

  it('ruta antigua sin órdenes cargadas: respaldo en lo guardado; sin nada, ceros', () => {
    expect(resumenEconomicoRuta({ id: 9, totalCobrado: 700, total_credito: 100 }, ORDENES)).toMatchObject({ cobrado: 700, credito: 100, total: 800, entregas: 0 });
    expect(resumenEconomicoRuta({ id: 9 }, [])).toMatchObject({ cobrado: 0, credito: 0, total: 0 });
    expect(resumenEconomicoRuta(null, ORDENES)).toMatchObject({ total: 0, entregas: 0 });
  });

  it('el reporte, su PDF y la exportación usan el mismo cálculo', () => {
    expect(src('../components/ReporteRutaModal.jsx')).toMatch(/resumenEconomicoRuta\(ruta, ordenes\)/);
    const exp = src('../utils/exportReports.js');
    expect(exp).toMatch(/resumenEconomicoRuta\(ruta, ordenes\)/);
    expect(exp).toMatch(/resumenEconomicoRuta\(r, ordenes\)\.cobrado/);
    expect(exp).not.toMatch(/n\(ruta\.total_cobrado \|\| ruta\.totalCobrado\)/);
  });
});

describe('Firma de carga y mapa de Rutas', () => {
  it('la hoja de firma va en un portal con alto máximo: la barra inferior no tapa Confirmar', () => {
    const v = src('../components/BotonFirmasPendientes.jsx');
    expect(v).toMatch(/createPortal\(/);
    expect(v).toMatch(/max-h-\[94dvh\] w-full max-w-md overflow-y-auto/);
    expect(v).toMatch(/canvasRef\.current !== el/);   // un lienzo nuevo se prepara otra vez
  });

  it('el mapa de pedidos siempre trae su botón para ocultarlo y no se encima a menús ni ventanas', () => {
    const v = src('../components/views/RutasView.jsx');
    expect(v).toMatch(/data-testid="ocultar-mapa-pedidos" onClick=\{\(\) => setMapaVisible\(false\)\}/);
    expect(src('../components/ui/MapaPedidos.jsx')).toMatch(/relative isolate z-0/);
    expect(src('../components/ui/MapaRuta.jsx')).toMatch(/relative isolate z-0/);
  });
});
