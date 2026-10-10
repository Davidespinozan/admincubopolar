// tanda1Arreglos.test.js — correcciones de la revisión profunda del 2026-10-10 (tanda 1):
// ruta del chofer, mezcla de entregas (fotos), crédito antes de entregar, cierre con venta
// exprés, Rutas (órdenes por ruta, carga autorizada al editar), resumen del cierre y nómina.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rutaActivaDelChofer, motivoSinCredito, mezclarEntregas } from '../data/choferRutaLogic';
import { resumenEconomicoRuta } from '../data/rutasLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const YO = { id: 7, nombre: 'Chofer Uno' };
const HOY = '2026-10-10';

describe('Chofer: cuál es su ruta', () => {
  const r = (id, estatus, fecha, chofer_id = 7) => ({ id, estatus, fecha, chofer_id });

  it('una ruta programada la noche anterior se ve al día siguiente; una futura, no', () => {
    expect(rutaActivaDelChofer([r(1, 'Programada', '2026-10-09')], YO, HOY)?.id).toBe(1);
    expect(rutaActivaDelChofer([r(1, 'Programada', '2026-10-10')], YO, HOY)?.id).toBe(1);
    expect(rutaActivaDelChofer([r(1, 'Programada', '2026-10-11')], YO, HOY)).toBeNull();
  });

  it('una ruta ya empezada sigue visible aunque cambie el día', () => {
    for (const est of ['En progreso', 'Cargada', 'Pendiente firma']) expect(rutaActivaDelChofer([r(1, est, '2026-10-08')], YO, HOY)?.id).toBe(1);
  });

  it('si le crean otra ruta a media ruta, sigue en la que ya empezó', () => {
    const rutas = [r(9, 'Programada', HOY), r(5, 'En progreso', HOY), r(6, 'Cargada', HOY)];
    expect(rutaActivaDelChofer(rutas, YO, HOY).id).toBe(5);
    expect(rutaActivaDelChofer([r(9, 'Programada', HOY), r(8, 'Programada', HOY)], YO, HOY).id).toBe(8);   // entre iguales, la más antigua
  });

  it('solo sus rutas; cerradas y canceladas no cuentan; Admin en vista previa ve la primera', () => {
    expect(rutaActivaDelChofer([r(1, 'En progreso', HOY, 99)], YO, HOY)).toBeNull();
    expect(rutaActivaDelChofer([r(1, 'Cerrada', HOY), r(2, 'Cancelada', HOY), r(3, 'Completada', HOY)], YO, HOY)).toBeNull();
    expect(rutaActivaDelChofer([r(1, 'En progreso', HOY, 99)], { id: 1 }, HOY, { esAdmin: true }).id).toBe(1);
    expect(rutaActivaDelChofer([{ id: 4, estatus: 'Programada', fecha: HOY, choferNombre: 'Chofer Uno', chofer_id: 'x' }], YO, HOY).id).toBe(4);
    expect(rutaActivaDelChofer(null, YO, HOY)).toBeNull();
  });

  it('al cambiar de ruta sin recargar, la app no arrastra entregas de la anterior', () => {
    const v = src('../components/ChoferView.jsx');
    expect(v).toMatch(/if \(ultimaRutaRef\.current != null && ultimaRutaRef\.current !== id\) \{\s*setEntregas\(\[\]\); setMermas\(\[\]\); setRutaDeEntregas\(null\);/);
    expect(v).toMatch(/entregas\.length === 0 \|\| rutaDeEntregas !== miRutaActiva\.id\) return;/);   // no guarda las de otra ruta
    expect(v.indexOf('ultimaRutaRef.current = id;')).toBeLessThan(v.indexOf("const clave = 'entregas_ruta_' + miRutaActiva.id;"));
  });
});

describe('Chofer: fiado solo a quien tiene crédito', () => {
  it('sin cliente, sin crédito autorizado o sobre el límite: no se entrega fiado', () => {
    expect(motivoSinCredito(null, 100)).toMatch(/cliente registrado/);
    expect(motivoSinCredito({ nombre: 'Abarrotes', credito_autorizado: false }, 100)).toMatch(/Abarrotes no tiene crédito autorizado/);
    expect(motivoSinCredito({ nombre: 'Abarrotes', credito_autorizado: true, limite_credito: 1000, saldo: 950 }, 100)).toMatch(/le quedan \$50/);
  });
  it('con crédito y dentro del límite (o sin límite): sí', () => {
    expect(motivoSinCredito({ credito_autorizado: true, limite_credito: 1000, saldo: 900 }, 100)).toBeNull();
    expect(motivoSinCredito({ credito_autorizado: true, limite_credito: 0, saldo: 5000 }, 100)).toBeNull();
    expect(motivoSinCredito({ creditoAutorizado: true, limiteCredito: 500, saldo: 0 }, 500)).toBeNull();
  });
  it('la pantalla lo revisa antes de marcar la entrega, y la venta rápida no ofrece link de pago', () => {
    const v = src('../components/ChoferView.jsx');
    expect(v.indexOf('const sinCredito = motivoSinCredito(cli, entregaModal.totalCalc);')).toBeLessThan(v.indexOf('await actions.updateOrdenEstatus(entregaModal.id, "Entregada"'));
    expect(v).toMatch(/PAGOS\.filter\(m => m !== "QR \/ Link de pago"\)\.map\(m => <ChoiceButton key=\{m\} active=\{vForm\.pago===m\}/);
  });
});

describe('Chofer: las entregas del teléfono se mezclan con las del servidor sin perder fotos', () => {
  const FOTO = 'data:image/jpeg;base64,AAA';
  it('el servidor manda en total y pago; el teléfono conserva foto, referencia, contacto y hora', () => {
    const locales = [
      { ordenId: 2, folio: 'OV-2', total: 100, pago: 'Transferencia', foto: FOTO, referencia: '123456', contacto: '6181234567', hora: '10:05', fotoSubida: false },
      { id: 'ex1', express: true, total: 60, pago: 'Efectivo' },
      { ordenId: 1, folio: 'OV-1', total: 50, pago: 'Efectivo', fotoEntrega: FOTO, fotoEntregaSubida: true },
    ];
    const servidor = [{ ordenId: 1, folio: 'OV-1', total: 55, pago: 'Efectivo', hora: '' }, { ordenId: 2, folio: 'OV-2', total: 100, pago: 'Transferencia', hora: '' }, { ordenId: 3, folio: 'OV-3', total: 70, pago: 'Tarjeta', hora: '' }];
    const m = mezclarEntregas(locales, servidor);
    expect(m.map(e => e.ordenId ?? e.id)).toEqual([2, 'ex1', 1, 3]);              // mismo orden de entrega; lo nuevo al final
    expect(m[0]).toMatchObject({ foto: FOTO, referencia: '123456', contacto: '6181234567', hora: '10:05', fotoSubida: false });
    expect(m[2]).toMatchObject({ total: 55, fotoEntrega: FOTO, fotoEntregaSubida: true });   // total del servidor, foto del teléfono
    expect(m[1]).toBe(locales[1]);                                                 // la venta exprés no se toca
    expect(mezclarEntregas([], servidor)).toHaveLength(3);
    expect(mezclarEntregas(locales, [])).toEqual(locales);
  });
  it('la pantalla usa esa mezcla y reintenta las fotos que fallan', () => {
    const v = src('../components/ChoferView.jsx');
    expect(v).toMatch(/const merged = mezclarEntregas\(prev, dbEntregas\);/);
    expect(v).toMatch(/subiendoEvidencias\.current\.delete\(p\.clave\); setReintentoFotos\(k => k \+ 1\); \}, 60_000\)/);
  });
});

describe('Chofer: cobra el total de la venta y puede cerrar con venta exprés', () => {
  it('el importe es el total registrado (precio de la venta, sucursal incluida)', () => {
    const v = src('../components/ChoferView.jsx');
    expect(v).toMatch(/totalCalc: n\(o\.total\) \|\| total, entregada,/);
    expect(v).toMatch(/const linea = \(o\.preciosSnapshot \|\| \[\]\)\.find\(l => s\(l\.sku\) === sku\);/);
  });
  it('el segundo envío del cierre financiero manda las mismas entregas que el primero', () => {
    const st = src('../data/supaStore.js');
    expect(st).toMatch(/const claveFin = `cierre_fin_entregas_\$\{rutaId\}`;/);
    expect(st).toMatch(/const g = storage\?\.getItem\(claveFin\); if \(g\) entregasPayload = JSON\.parse\(g\);/);
    expect(st.indexOf("if (finErr) return { error: mensajeErrorCierreFinanciero(finErr) };")).toBeLessThan(st.indexOf('storage?.setItem(claveFin'));   // solo se guarda si el servidor aceptó
    expect(st).toMatch(/storage\?\.removeItem\(`cierre_fin_entregas_\$\{rutaId\}`\)/);
    expect(src('../components/ChoferView.jsx')).toMatch(/if \(res\.financiero\) setEntregas\(prev => prev\.filter\(e => e\.ordenId\)\);/);
  });
});

describe('Rutas: órdenes por ruta y carga autorizada al editar', () => {
  it('las órdenes traen rutaId (antes toda ruta decía "0 órdenes") y la etiqueta de factura', () => {
    const st = src('../data/supaStore.js');
    expect(st).toMatch(/rutaId: o\.ruta_id \?\? null,/);
    expect(st).toMatch(/requiereFactura: !!o\.requiere_factura,/);
  });
  it('editar una ruta conserva la carga autorizada y el extra guardados', () => {
    const v = src('../components/views/RutasView.jsx');
    expect(v).toMatch(/const extraGuardado = ruta\.extraAutorizado \?\? ruta\.extra_autorizado;/);
    expect(v).toMatch(/const cargaAutGuardada = ruta\.cargaAutorizada \?\? ruta\.carga_autorizada;/);
  });
  it('resumen del cierre: una venta levantada a crédito pero cobrada en efectivo es COBRADA', () => {
    const r = resumenEconomicoRuta({ id: 5 }, [
      { id: 1, rutaId: 5, estatus: 'Entregada', total: 300, metodoPago: 'Efectivo', tipoCobro: 'Credito' },
      { id: 2, rutaId: 5, estatus: 'Entregada', total: 200, metodoPago: 'Crédito', tipoCobro: 'Contado' },
      { id: 3, rutaId: 5, estatus: 'Entregada', total: 100, metodoPago: '', tipoCobro: 'Credito' },
    ]);
    expect(r).toMatchObject({ cobrado: 300, credito: 300, total: 600 });
  });
});

describe('Nómina y factura', () => {
  it('Pagar recalcula también cuando el concepto automático se creó después de generar los recibos', () => {
    expect(src('../components/views/NominaView.jsx')).toMatch(/if \(conceptos\.some\(c => c\.activo !== false && esAutomatico\(c\)\) \|\| recibosConAutomaticos\(/);
  });
  it('"Ver PDF" abre la pestaña en el mismo toque y, si no se puede, descarga', () => {
    expect(src('../components/views/FacturacionView.jsx')).toMatch(/ventana = window\.open\('', '_blank'\);/);
    const st = src('../data/supaStore.js');
    expect(st).toMatch(/if \(abrir && ventana && !ventana\.closed\) \{\s*ventana\.location\.href = url;/);
    expect(st).toMatch(/if \(abrir\) t\(\)\?\.info\('La factura se descargó: ábrela desde tus descargas'\);/);
  });
  it('135: lo de otra semana en borrador no se le quita; los descuentos se recortan; bolsa antes que cuarto', () => {
    const sql = src('../../supabase/135_correcciones_tanda1.sql');
    expect(sql).toMatch(/p2\.id <> v_per\.id AND p2\.estatus <> 'Pagado' AND r2\.empleado_id = v_r\.empleado_id/);
    expect(sql).toMatch(/Recortado: lo ganado esta semana no alcanza para el descuento completo/);
    expect(sql.indexOf('-- 8a (135)')).toBeLessThan(sql.indexOf('-- 8. Cuartos de la asignación'));
    expect(sql).toMatch(/USING \(erp_rol_activo\(\) = 'Admin' OR \(erp_lector_negocio\(\) AND subido_por = erp_usuario_id\(\)\)\);/);
  });
});
