import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { backendPost } from '../lib/backend';
import { n, s, centavos } from '../utils/safe';
import { useToast } from '../components/ui/Toast';
import { parseProductos, validateItems, buildLineas, validateCancelacion, buildAnotacionCancelacion, validateEdicionOrden, parseLineasEdicion, buildUpdateFieldsOrden, validateTransicionOrden, isFacturable, validateCancelacionCFDI, esPagoEnLinea } from './ordenLogic';
import { traducirErrorCamionRutaActiva } from './mejorasMenoresLogic';
import { mensajeErrorMerma } from './mermasLogic';
import { buildUpdateFieldsProduccion } from './produccionLogic';
import { buildRegistrarProduccionArgs, buildRegistrarTransformacionArgs, interpretarResultadoProduccion, interpretarResultadoTransformacion, mensajeErrorProduccion } from './produccionAtomicaLogic';
import { buildActividadDatos, buildCompletarArgs, buildEditarOcurrenciaArgs, sumarDiasISO } from './calendarioLogic';
import { buildRegistroArgs, buildCentroArgs, buildTurnoArgs, buildCorreccionArgs, esErrorDeRed, mensajeErrorLlamada, rolSinDatosNegocio } from './asistenciaLogic';
import { buildGuardarAvisosArgs } from './avisosAsistenciaLogic';
import { nuevoOperacionId, buildConfirmarCargaArgs, buildNoEntregaArgs, buildSalidaManualArgs, buildTraspasoArgs, buildAjusteCuartoArgs, buildMermaCuartoArgs, interpretarResultadoStock, mensajeErrorStock } from './stockContratosLogic';
import {
  normalizarEntregasCierre, claveCierreFinanciero, buildCerrarFinancieroArgs, interpretarCierreFinanciero,
  mensajeErrorCierreFinanciero, leerOperacionCierre, guardarOperacionCierre, borrarOperacionCierre,
  resolverOperacion as resolverOperacionCierre,
} from './cierreFinancieroLogic';
import { buildRegistrarDevolucionArgs, mensajeErrorDevolucion } from './devolucionesLogic';
import { buildCompletarVentaDirectaArgs, mensajeErrorVentaDirecta } from './ventaDirectaLogic';
import { camposAltaProducto, mensajeErrorEmpaque } from './empaqueLogic';
import {
  validateConfirmarCarga,
  validateFirmarCarga,
  excedeAutorizacion,
  validateEdicionRuta,
  validateCancelacionRuta,
} from './rutasLogic';
import {
  interpretarBalance, normalizarConteo, claveMermasRuta, buildMermasRutaArgs, claveCierreInventario,
  buildFinalizarInventarioArgs, detalleErrorInventario, mensajeErrorInventarioRuta,
  claveStorageMermasRuta, claveStorageCierreInventario, leerOperacion, guardarOperacion, borrarOperacion,
} from './inventarioRutaLogic';
import { geocodeDireccion, buildDireccion } from '../utils/geocoding';
import { formatDireccion } from './direccionLogic';
import { preciosParaLineas } from './sucursalLogic';
import { traducirError } from '../utils/errorMessages';
import { TABLAS_CORE_RT, TABLAS_SLICE_RT } from './realtimeLogic';
import { complementoPendienteOrden } from './complementoLogic';
import { ordenesEsperanRuta } from './bandejaLogic';
import { alertaEsperanRuta } from './avisosLogic';
import { buildPreparacionArgs, buildPartirArgs, buildPreparacionMediaArgs, mensajeErrorPreparacion } from './preparacionBarraLogic';
import { normalizarReporteFinanciero } from './finanzasLogic';
import { fechaElegida, camposFechaCosto, buildPagarCxPArgs } from './fechaNegocioLogic';
import { buildEditarReciboArgs, buildGuardarReciboArgs, buildGuardarConceptoArgs } from './nominaLogic';
import { diaNegocio } from '../utils/fechas';
import { buildGuardarUsuarioArgs, mensajeErrorUsuario } from './usuariosLogic';

// ═══════════════════════════════════════════════════════════════
// useSupaStore — fuente única de verdad para toda la app
// API: { data, actions, loading, error }
//
// Estructura real de Supabase:
//   cuartos_frios  → id: TEXT, stock: JSONB  (no hay cuarto_frio_stock)
//   inventario_mov → columna "producto" (no "sku"), "usuario" (no "usuario_id")
//   auditoria      → columna "usuario" texto (no "usuario_id")
// ═══════════════════════════════════════════════════════════════

// Fetch helper — returns [] on error for queries, throws for critical mutations
// Usage: safeRows(query) for reads | safeRows(query, { critical: true }) for writes
const safeRows = async (query, options = {}) => {
  const { critical = false, operation = 'query' } = options;
  try {
    const { data, error } = await query;
    if (error) {
      console.error('[supaStore] ❌', operation, '|', error.message, '| code:', error.code);
      // Dispatch custom event for error tracking (can be caught by ErrorBoundary or Sentry)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('supabase-error', { 
          detail: { operation, error: error.message, code: error.code } 
        }));
      }
      if (critical) {
        throw new Error(`Error en ${operation}: ${error.message}`);
      }
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('[supaStore] ❌ Exception:', operation, '|', e.message);
    if (critical) throw e;
    return [];
  }
};

// snake_case → camelCase
const toCamel = (obj) => {
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (obj === null || typeof obj !== 'object') return obj;
  const o = {};
  for (const [k, v] of Object.entries(obj)) {
    o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return o;
};

const EMPTY = {
  clientes: [], productos: [], preciosEsp: [], ordenes: [],
  rutas: [], produccion: [], inventarioMov: [], cuartosFrios: [],
  alertas: [], facturacionPendiente: [], conciliacion: [],
  auditoria: [], usuarios: [], umbrales: [], pagos: [],
  comodatos: [], leads: [], empleados: [], nominaPeriodos: [], actividadesAbiertas: [],
  nominaRecibos: [], nominaConceptos: [], nominaConceptoEmpleados: [], nominaReciboLineas: [], nominaAcumulados: [], movContables: [], mermas: [], cuentasPorCobrar: [],
  cuentasPorPagar: [], pagosProveedores: [],
  costosFijos: [], costosHistorial: [],
  camiones: [],
  invoiceAttempts: [],
  cfdiOperaciones: [],
  pagosCxc: [],
  notificaciones: [],
  choferUbicaciones: [],
  devoluciones: [],
  cierresDiarios: [],
  contabilidad: { ingresos: [], egresos: [] },
  configEmpresa: null,
};

export function useSupaStore(userId, userName, userRol) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const uidRef = useRef(userId);
  uidRef.current = userId;
  const userNameRef = useRef(userName || '');
  userNameRef.current = userName || '';
  const userRolRef = useRef(userRol || '');
  userRolRef.current = userRol || '';

  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // ── Slices independientes (Tanda 23) ────────────────────────
  // Tablas sin joins con el núcleo: cada una se trae y mapea sola, y
  // el realtime refetchea SOLO la afectada (1-2 queries) en vez del
  // fetchAll completo. Las que cambian juntas comparten slice (cxp
  // arrastra pagos_proveedores, nómina sus recibos, costos su
  // historial). La partición vive en realtimeLogic.js.
  const fetchSlice = useCallback(async (tabla) => {
    switch (tabla) {
      case 'produccion': {
        const pro = await safeRows(supabase.from('produccion').select('*').order('id', { ascending: false }));
        setData(prev => ({ ...prev, produccion: pro.map(p => ({ ...p, cantidad: Number(p.cantidad) })) }));
        return;
      }
      case 'inventario_mov': {
        const mov = await safeRows(supabase.from('inventario_mov').select('*').order('id', { ascending: false }).limit(200));
        setData(prev => ({
          ...prev,
          inventarioMov: mov.map(m => ({
            ...m,
            producto: m.producto || m.sku || '',   // columna real: "producto"
            sku:      m.producto || m.sku || '',   // alias para compatibilidad
            cantidad: Number(m.cantidad),
            usuario:  m.usuario || 'Sistema',      // columna real: "usuario" texto
          })),
        }));
        return;
      }
      case 'pagos': {
        const pag = await safeRows(supabase.from('pagos').select('*').order('id', { ascending: false }).limit(200));
        setData(prev => ({ ...prev, pagos: pag.map(p => ({ ...toCamel(p), monto: Number(p.monto) })) }));
        return;
      }
      case 'auditoria': {
        const aud = await safeRows(supabase.from('auditoria').select('*').order('id', { ascending: false }).limit(500));
        setData(prev => ({ ...prev, auditoria: aud.map(a => ({ ...a, usuario: a.usuario || 'Sistema' })) }));
        return;
      }
      case 'comodatos': {
        const com = await safeRows(supabase.from('comodatos').select('*').order('id', { ascending: false }));
        setData(prev => ({ ...prev, comodatos: com.map(toCamel) }));
        return;
      }
      case 'leads': {
        const lea = await safeRows(supabase.from('leads').select('*').order('id', { ascending: false }));
        setData(prev => ({ ...prev, leads: lea.map(toCamel) }));
        return;
      }
      case 'movimientos_contables': {
        const movC = await safeRows(supabase.from('movimientos_contables').select('*').order('id', { ascending: false }).limit(500));
        const movContables = movC.map(m => ({ ...toCamel(m), monto: Number(m.monto) }));
        setData(prev => ({
          ...prev,
          movContables,
          contabilidad: {
            ingresos: movContables.filter(m => m.tipo === 'Ingreso'),
            egresos:  movContables.filter(m => m.tipo === 'Egreso'),
          },
        }));
        return;
      }
      case 'mermas': {
        const mer = await safeRows(supabase.from('mermas').select('*').order('id', { ascending: false }).limit(200));
        const mermas = await Promise.all(mer.map(async (m) => {
          const row = { ...toCamel(m), cantidad: Number(m.cantidad) };
          const fotoPath = s(m.foto_url);
          row.fotoPath = fotoPath;
          row.fotoUrl = fotoPath;
          if (fotoPath && !/^https?:\/\//.test(fotoPath) && !/^data:/.test(fotoPath) && !/^blob:/.test(fotoPath)) {
            const { data: signedData, error: signedErr } = await supabase.storage
              .from('mermas')
              .createSignedUrl(fotoPath, 60 * 60 * 12);
            if (!signedErr && signedData?.signedUrl) {
              row.fotoUrl = signedData.signedUrl;
            }
          }
          return row;
        }));
        setData(prev => ({ ...prev, mermas }));
        return;
      }
      case 'nomina_periodos': {
        const [nomP, nomR] = await Promise.all([
          safeRows(supabase.from('nomina_periodos').select('*').order('id', { ascending: false })),
          safeRows(supabase.from('nomina_recibos').select('*').order('id', { ascending: false })),
        ]);
        // 128 (NOM-1): catálogo de conceptos, a quién aplican y el desglose de los
        // recibos de las 12 semanas más recientes (lo que la pantalla muestra).
        const recientes = new Set(nomP.slice(0, 12).map(p => p.id));
        const idsRecibos = nomR.filter(r => recientes.has(r.periodo_id)).map(r => r.id);
        const [nomC, nomCE, nomL] = await Promise.all([
          safeRows(supabase.from('nomina_conceptos').select('*').order('id', { ascending: true })),
          safeRows(supabase.from('nomina_concepto_empleados').select('*')),
          idsRecibos.length
            ? safeRows(supabase.from('nomina_recibo_lineas').select('*').in('recibo_id', idsRecibos).order('id', { ascending: true }).limit(5000))
            : Promise.resolve([]),
        ]);
        // Avance de los topes (préstamos): solo si alguien tiene uno.
        let acumulados = [];
        if (nomCE.some(a => a.limite_total != null)) {
          const { data: acu, error: eAcu } = await supabase.rpc('nomina_acumulados');
          if (eAcu) console.warn('[nomina] nomina_acumulados:', eAcu.message);
          else if (Array.isArray(acu)) acumulados = acu;
        }
        setData(prev => ({
          ...prev, nominaPeriodos: nomP.map(toCamel), nominaRecibos: nomR.map(toCamel),
          nominaConceptos: nomC.map(toCamel), nominaConceptoEmpleados: nomCE.map(toCamel), nominaReciboLineas: nomL.map(toCamel),
          nominaAcumulados: acumulados.map(toCamel),
        }));
        return;
      }
      case 'cuentas_por_pagar': {
        const [cxp, pagProv] = await Promise.all([
          safeRows(supabase.from('cuentas_por_pagar').select('*').order('id', { ascending: false }).limit(500)),
          safeRows(supabase.from('pagos_proveedores').select('*').order('id', { ascending: false }).limit(200)),
        ]);
        setData(prev => ({
          ...prev,
          cuentasPorPagar: cxp.map(c => ({
            ...toCamel(c),
            montoOriginal: Number(c.monto_original),
            montoPagado: Number(c.monto_pagado),
            saldoPendiente: Number(c.saldo_pendiente),
          })),
          pagosProveedores: pagProv.map(p => ({ ...toCamel(p), monto: Number(p.monto) })),
        }));
        return;
      }
      case 'costos_fijos': {
        const [costF, costH] = await Promise.all([
          safeRows(supabase.from('costos_fijos').select('*').order('id')),
          safeRows(supabase.from('costos_historial').select('*').order('id', { ascending: false }).limit(200)),
        ]);
        setData(prev => ({
          ...prev,
          costosFijos: costF.map(c => ({ ...toCamel(c), monto: Number(c.monto) })),
          costosHistorial: costH.map(c => ({ ...toCamel(c), monto: Number(c.monto) })),
        }));
        return;
      }
      case 'devoluciones': {
        const devs = await safeRows(supabase.from('devoluciones').select('*').order('id', { ascending: false }).limit(200));
        setData(prev => ({ ...prev, devoluciones: devs.map(d => ({ ...toCamel(d), total: Number(d.total) })) }));
        return;
      }
      case 'cierres_diarios': {
        const cierres = await safeRows(supabase.from('cierres_diarios').select('*').order('id', { ascending: false }).limit(200));
        setData(prev => ({
          ...prev,
          cierresDiarios: cierres.map(c => ({
            ...toCamel(c),
            esperadoEfectivo: Number(c.esperado_efectivo),
            esperadoTransferencia: Number(c.esperado_transferencia),
            esperadoCredito: Number(c.esperado_credito),
            esperadoTotal: Number(c.esperado_total),
            contadoEfectivo: Number(c.contado_efectivo),
            contadoTransferencia: Number(c.contado_transferencia),
            contadoTotal: Number(c.contado_total),
            diferencia: Number(c.diferencia),
          })),
        }));
        return;
      }
      case 'notificaciones': {
        const notif = await safeRows(supabase.from('notificaciones').select('*').order('id', { ascending: false }).limit(100));
        setData(prev => ({ ...prev, notificaciones: notif.map(toCamel) }));
        return;
      }
      case 'chofer_ubicaciones': {
        const chUbi = await safeRows(supabase.from('chofer_ubicaciones').select('*').order('created_at', { ascending: false }).limit(50));
        setData(prev => ({ ...prev, choferUbicaciones: chUbi.map(toCamel) }));
        return;
      }
      default:
        return;
    }
  }, []);

  // ── Núcleo interdependiente (Tanda 23) ──────────────────────
  // Estas tablas se cruzan en el mapeo: el saldo del cliente sale de
  // CxC, la ruta cuenta sus órdenes y resuelve chofer/ayudante/camión,
  // las alertas mezclan productos + umbrales + cuartos + órdenes + CxC
  // + invoice_attempts. Cambia una → se recargan juntas.
  const fetchCore = useCallback(async () => {
    try {
      const [cli, prod, pe, ord, ol, rut, cf, usr, umb, cxc, emp, cam, invAttempts, cfdiOps, pagosCxcRows, suc] = await Promise.all([
        safeRows(supabase.from('clientes').select('*').order('id')),
        safeRows(supabase.from('productos').select('*').order('id')),
        safeRows(supabase.from('precios_esp').select('*').order('id')),
        safeRows(supabase.from('ordenes').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('orden_lineas').select('*').order('orden_id')),
        safeRows(supabase.from('rutas').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('cuartos_frios').select('*')),
        safeRows(supabase.from('usuarios').select('*').order('id')),
        safeRows(supabase.from('umbrales').select('*')),
        safeRows(supabase.from('cuentas_por_cobrar').select('*').order('id', { ascending: false }).limit(500)),
        safeRows(supabase.from('empleados').select('*').order('id')),
        safeRows(supabase.from('camiones').select('*').order('id')),
        safeRows(supabase.from('invoice_attempts').select('orden_id, provider_reference, status, created_at, request_payload').order('id', { ascending: false }).limit(300)),
        // OL-04: operaciones CFDI (RLS: Admin / Facturación); estado del complemento por pago.
        safeRows(supabase.from('cfdi_operaciones').select('id, orden_id, tipo, generacion, estado, pago_id, relacionado_uuid, parcialidad, cfdi_uuid, proveedor_id, cfdi_metodo_pago, lease_hasta, updated_at').order('created_at', { ascending: false }).limit(500)),
        // OL-04: pagos ligados a CxC (cualquier camino: cobro, webhook, cierre de ruta) para el estado de complementos.
        safeRows(supabase.from('pagos').select('id, orden_id, cxc_id, monto, fecha, metodo_pago, saldo_antes, saldo_despues').not('cxc_id', 'is', null).order('id', { ascending: false }).limit(500)),
        // 123: sucursales por cliente (solo lectura; se escriben por contrato).
        safeRows(supabase.from('sucursales').select('*').order('id')),
      ]);

      // Configuracion de empresa (singleton id=1)
      const { data: configEmpresaRow } = await supabase
        .from('configuracion_empresa')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      const clientes  = cli;
      const productos = prod;
      const ordenLineas = ol;
      const rutas     = rut;
      const usuarios  = usr;
      const umbrales  = umb;

      // ── Map ordenes ──
      const ordenes = (ord || []).map(o => {
        const c = clientes.find(x => x.id === o.cliente_id);
        const r = rutas.find(x => x.id === o.ruta_id);
        const lines = ordenLineas.filter(l => l.orden_id === o.id);
        const sc = o.sucursal_id ? (suc || []).find(x => x.id === o.sucursal_id) : null;
        return {
          ...o,
          clienteId: o.cliente_id,
          cliente: c?.nombre || '',
          // 123: sucursal de la orden (nombre solo si no es la principal).
          sucursalId: o.sucursal_id || null,
          sucursal: sc && !sc.es_principal ? sc.nombre : '',
          productos: lines.map(l => `${l.cantidad}×${l.sku}`).join(', '),
          ruta: r?.nombre || '—',
          usoCfdi: c?.uso_cfdi || 'G03',
          preciosSnapshot: lines.map(l => ({
            sku: l.sku, qty: l.cantidad,
            unitPrice: Number(l.precio_unit), lineTotal: Number(l.subtotal),
          })),
        };
      });

      // ── Map clientes ──
      // Tanda 2 🟡-4: el saldo del cliente se computa desde la suma de
      // CxC pendientes (no desde el cache `clientes.saldo` de BD, que
      // puede divergir — ver caso DAVID ESPINOZA $2000 fantasma limpiado
      // en mig 055). Sobrescribimos `saldo` aquí para que TODOS los
      // consumidores (ClientesView, NuevaVentaModal, exportReports, etc.)
      // reciban el valor correcto sin cambiar su código.
      // La columna `clientes.saldo` en BD queda como cache deprecated;
      // su eliminación está documentada en docs/PENDIENTES_TECNICOS.md.
      const saldoPorCliente = new Map();
      for (const cxcRow of (cxc || [])) {
        if (cxcRow?.estatus === 'Pagada') continue;
        const cid = cxcRow?.cliente_id;
        if (cid == null) continue;
        const saldoPend = Number(cxcRow?.saldo_pendiente || 0);
        if (!Number.isFinite(saldoPend) || saldoPend <= 0) continue;
        saldoPorCliente.set(cid, (saldoPorCliente.get(cid) || 0) + saldoPend);
      }
      const clientesMapped = clientes.map(c => ({
        ...c,
        usoCfdi: c.uso_cfdi,
        saldo: saldoPorCliente.get(c.id) || 0,
      }));

      // ── Map precios especiales ──
      // ── Map sucursales (123): nombre del cliente y dirección formateada ──
      const sucursales = (suc || []).map(x => {
        const c = clientes.find(y => y.id === x.cliente_id);
        return { ...x, clienteId: x.cliente_id, clienteNom: c?.nombre || '', esPrincipal: !!x.es_principal, direccion: formatDireccion(x) };
      });
      const preciosEsp = (pe || []).map(p => {
        const c = clientes.find(x => x.id === p.cliente_id);
        const sc = p.sucursal_id ? sucursales.find(x => x.id === p.sucursal_id) : null;
        return { ...p, clienteId: p.cliente_id, clienteNom: c?.nombre || '', sucursalId: p.sucursal_id || null, sucursalNom: sc?.nombre || '', precio: Number(p.precio) };
      });

      // ── Map rutas ──
      const rutasMapped = rutas.map(r => {
        const linked = (ord || []).filter(o => o.ruta_id === r.id);
        const u = usuarios.find(x => String(x.id) === String(r.chofer_id));
        const choferRaw = u?.nombre || r.chofer_nombre || r.chofer || '—';
        const choferLabel = (choferRaw && typeof choferRaw === 'object') ? (choferRaw.nombre || '—') : String(choferRaw);
        const cargaRaw = r.carga;
        const cargaTxt = (cargaRaw && typeof cargaRaw === 'object')
          ? Object.entries(cargaRaw).map(([sku, qty]) => `${qty}×${sku}`).join(', ')
          : (cargaRaw ?? '');
        const ayudante = r.ayudante_id ? (emp || []).find(e => e.id === r.ayudante_id) : null;
        const camion = r.camion_id ? (cam || []).find(c => c.id === r.camion_id) : null;
        return {
          ...r,
          chofer: choferLabel,
          cargaTxt,
          choferId: r.chofer_id,
          ayudanteId: r.ayudante_id,
          ayudanteNombre: ayudante?.nombre || '',
          camionId: r.camion_id,
          camionNombre: camion?.nombre || '',
          camionPlacas: camion?.placas || '',
          ordenes: linked.length,
          entregadas: linked.filter(o => o.estatus === 'Entregada' || o.estatus === 'Facturada').length,
        };
      });

      // ── Build facturacionPendiente ──
      // Tanda 5: usa isFacturable (FSM) — incluye órdenes con CFDI cancelado
      // pendientes de re-timbrar y excluye las que tienen requiere_factura=false.
      const facturacionPendiente = ordenes
        .filter(o => isFacturable(o))
        .map(o => {
          const c = clientes.find(x => x.id === o.cliente_id);
          return {
            id: o.id, folio: o.folio, cliente: c?.nombre || '',
            rfc: c?.rfc || '', fecha: o.fecha, total: Number(o.total),
            cfdiCanceladoAt: o.cfdi_cancelado_at || null,
          };
        });

      // ── Map cuartos_frios (id: TEXT, stock: JSONB)
      // Normalize: coerce temp/capacidad to numbers and keep only "Producto Terminado" in stock
      // Orden manual (`orden`, mig 126); sin él, por número del id (CF-1, CF-2…).
      const numCuarto = (q) => { const m = String(q?.id || '').match(/(\d+)/); return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER; };
      const cuartosOrdenados = [...(cf || [])].sort((a, b) =>
        ((a.orden ?? Number.MAX_SAFE_INTEGER) - (b.orden ?? Number.MAX_SAFE_INTEGER))
        || (numCuarto(a) - numCuarto(b)) || String(a.id).localeCompare(String(b.id)));
      const cuartosFrios = cuartosOrdenados.map(q => {
        const stockObj = (q.stock && typeof q.stock === 'object') ? q.stock : {};
        // Build a filtered stock object containing only Producto Terminado SKUs
        const stockFiltered = {};
        for (const [sku, qty] of Object.entries(stockObj)) {
          const p = productos.find(x => x.sku === sku);
          if (p && s(p.tipo) === "Producto Terminado") {
            stockFiltered[sku] = Number(qty);
          }
        }
        return {
          ...q,
            temp: q.temp !== null && q.temp !== undefined ? Number(q.temp) : -10,
          capacidad: Number(q.capacidad),
          stock: stockFiltered,
          productos: Object.entries(stockFiltered)
            .map(([sku, qty]) => `${sku}: ${qty}`)
            .join(' · '),
        };
      });

      // ── Build effective stock map (sum cuartos_frios stock for finished products) ──
      const cfStockMap = {};
      for (const q of cuartosFrios) {
        for (const [sku, qty] of Object.entries(q.stock || {})) {
          cfStockMap[sku] = (cfStockMap[sku] || 0) + qty;
        }
      }

      // ── Build live alerts ──
      const alertas = umbrales.map(u => {
        const p = productos.find(x => x.sku === u.sku);
        if (!p) return null;
        // Use cuartos_frios aggregate if available, otherwise fall back to productos.stock
        const stock = cfStockMap[u.sku] !== undefined ? cfStockMap[u.sku] : Number(p.stock);
        if (stock <= u.critica)
          return { id: u.id, tipo: 'critica',    msg: `${p.nombre} bajo mínimo — ${stock} unidades`,  created_at: new Date().toISOString() };
        if (stock <= u.accionable)
          return { id: u.id, tipo: 'accionable', msg: `${p.nombre} nivel bajo — ${stock} unidades`,   created_at: new Date().toISOString() };
        return null;
      }).filter(Boolean);

      // ── Alertas de producción por stock mínimo ──
      const estatusPend = new Set(["creada", "asignada", "pendiente", "en proceso", "en_proceso", "enprogreso"]);
      const pendPorSku = {};
      for (const o of ordenes) {
        if (!estatusPend.has(s(o.estatus).toLowerCase())) continue;
        for (const ln of (o.preciosSnapshot || [])) {
          const sku = s(ln.sku);
          if (sku) pendPorSku[sku] = (pendPorSku[sku] || 0) + Number(ln.qty || ln.cantidad || 0);
        }
      }
      const prodTerminados = productos.filter(p => s(p.tipo) === 'Producto Terminado');
      for (const p of prodTerminados) {
        const minimo = Number(p.stock_minimo) || 0;
        if (minimo <= 0) continue;
        const sku = s(p.sku);
        const stock = cfStockMap[sku] !== undefined ? cfStockMap[sku] : Number(p.stock);
        const pend = pendPorSku[sku] || 0;
        const faltante = pend + minimo - stock;
        if (faltante > 0) {
          alertas.push({
            id: `prod-min-${sku}`,
            tipo: 'accionable',
            msg: `Producir ${faltante.toLocaleString()} ${p.nombre} — stock ${stock}, mín ${minimo}, pedidos ${pend}`,
            created_at: new Date().toISOString(),
          });
        }
      }

      // ── Alertas de complemento pendiente (OL-04: por pago; PPD con pagos emitibles o por conciliar) ──
      const opsCfdi = (cfdiOps || []).map(toCamel);
      const pagosCxc = (pagosCxcRows || []).map(toCamel);
      for (const o of ordenes) {
        if (o.facturama_id && complementoPendienteOrden(toCamel(o), pagosCxc, opsCfdi)) {
          alertas.push({
            id: `comp-${o.id}`,
            tipo: 'accionable',
            msg: `Complemento pendiente — ${s(o.folio)} (PPD)`,
            created_at: new Date().toISOString(),
          });
        }
      }

      // ── Ventas que Ventas mandó a reparto y esperan ruta (Admin las asigna) ──
      const alertaRuta = alertaEsperanRuta(ordenesEsperanRuta(ord || []));
      if (alertaRuta) alertas.push({ ...alertaRuta, created_at: new Date().toISOString() });

      // ── Alertas de CxC próximas a vencer ──
      const hoyStr = diaNegocio();
      for (const c of (cxc || [])) {
        if (c.estatus === 'Pagada') continue;
        const venc = s(c.fecha_vencimiento);
        if (venc && venc <= hoyStr) {
          alertas.push({
            id: `cxc-${c.id}`,
            tipo: 'critica',
            msg: `CxC vencida — ${s(c.concepto)} — $${Number(c.saldo_pendiente).toLocaleString()}`,
            created_at: new Date().toISOString(),
          });
        }
      }

      // ── Map umbrales ──
      const umbralesMapped = umbrales.map(u => {
        const p = productos.find(x => x.sku === u.sku);
        return { ...u, producto: p ? `${p.sku} (${p.nombre})` : u.sku };
      });

      // Patch merge: el núcleo solo pisa SUS llaves; los slices
      // independientes conservan lo suyo (Tanda 23).
      setData(prev => ({
        ...prev,
        clientes: clientesMapped,
        sucursales,
        productos: productos.map(p => ({ ...p, stock: Number(p.stock), precio: Number(p.precio) })),
        preciosEsp,
        ordenes,
        rutas: rutasMapped,
        cuartosFrios,
        alertas,
        facturacionPendiente,
        conciliacion: [],
        usuarios,
        umbrales: umbralesMapped,
        empleados: (emp || []).map(toCamel),
        camiones: (cam || []).map(toCamel),
        cuentasPorCobrar: (cxc || []).map(c => ({
          ...toCamel(c),
          montoOriginal: Number(c.monto_original),
          montoPagado: Number(c.monto_pagado),
          saldoPendiente: Number(c.saldo_pendiente),
        })),
        invoiceAttempts: (invAttempts || []).map(toCamel),
        cfdiOperaciones: (cfdiOps || []).map(toCamel),
        pagosCxc: (pagosCxcRows || []).map(p => ({ ...toCamel(p), monto: Number(p.monto) })),
        configEmpresa: configEmpresaRow ? toCamel(configEmpresaRow) : null,
      }));

      setError(null);
    } catch (err) {
      console.error('[fetchCore] ❌ catch error:', err?.message || err);
      setError(err.message);
    }
  }, []);

  // ── Fetch all data ──────────────────────────────────────────
  // Carga inicial y refresh completo tras acciones (rf()): núcleo +
  // todos los slices en paralelo. El realtime usa las piezas sueltas.
  // PD-02 (mig 118): ocurrencias abiertas visibles para la sesión (estado del servidor),
  // para el resumen del Dashboard y el detector de Bandeja. Falla en silencio.
  const fetchActividades = useCallback(async () => {
    try {
      const hoy = diaNegocio();
      const { data, error } = await supabase.rpc('calendario', { p_desde: sumarDiasISO(hoy, -1095), p_hasta: sumarDiasISO(hoy, 4), p_solo_mias: false, p_solo_abiertas: true });
      if (error) return;
      setData(prev => ({ ...prev, actividadesAbiertas: data?.ocurrencias || [] }));
    } catch { /* sin calendario: el resumen queda vacío */ }
  }, []);

  const fetchAll = useCallback(async () => {
    // WF-0: el rol Empleado no carga datos de negocio (su pantalla lee mi_asistencia()).
    if (rolSinDatosNegocio(userRolRef.current)) { setLoading(false); return; }
    try {
      await Promise.all([fetchCore(), ...TABLAS_SLICE_RT.map(t => fetchSlice(t)), fetchActividades()]);
    } catch (err) {
      console.error('[fetchAll] ❌ catch error:', err?.message || err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchCore, fetchSlice, fetchActividades]);

  // Re-fetch on mount y cuando cambia el userId (ej. después del login)
  // Wait for Supabase auth session to be ready when there is a userId to avoid
  // races where an initial fetch runs unauthenticated and returns empty results.
  useEffect(() => {
    let sub = null;
    let cancelled = false;

    const run = async () => {
      if (userId) {
        try {
          // v2: getSession() returns { data: { session } }
          const sessionRes = await supabase.auth.getSession();
          const session = sessionRes?.data?.session;
          if (!session) {
            // subscribe once to auth changes and fetch when session becomes available
            const { data } = supabase.auth.onAuthStateChange((event, s) => {
              if (s?.access_token && !cancelled) {
                fetchAll();
                try { data.subscription.unsubscribe(); } catch { /* noop */ }
              }
            });
            sub = data && data.subscription;
            return;
          }
        } catch {
          // ignore and continue to fetch
        }
      }
      if (!cancelled) fetchAll();
    };

    run();

    return () => { cancelled = true; if (sub && sub.unsubscribe) try { sub.unsubscribe(); } catch { /* noop */ } };
  }, [fetchAll, userId]);

  // ── Realtime subscriptions (Tanda 23: granular) ─────────────
  // Antes, CUALQUIER cambio en 20 tablas disparaba fetchAll completo
  // (~30 queries) con un debounce global de 500ms. Ahora cada evento
  // refetchea solo su grupo: las tablas del núcleo (joins cruzados)
  // recargan el núcleo, y las independientes SOLO su slice (1-2
  // queries). Debounce por grupo para colapsar bursts (un cierre de
  // ruta dispara 5+ eventos en milésimas). Nuevas suscripciones:
  // notificaciones (la campana ve las alertas de los crons al
  // instante) y chofer_ubicaciones (GPS en vivo en el mapa del admin).
  useEffect(() => {
    if (rolSinDatosNegocio(userRol)) return undefined;
    const timers = new Map();
    const disparar = (clave, fn, delay) => {
      if (timers.has(clave)) clearTimeout(timers.get(clave));
      timers.set(clave, setTimeout(() => {
        timers.delete(clave);
        Promise.resolve(fn()).catch(e => console.error('[realtime]', clave, e?.message));
      }, delay));
    };
    const channels = [
      ...TABLAS_CORE_RT.map(table =>
        supabase.channel(`rt_${table}`)
          .on('postgres_changes', { event: '*', schema: 'public', table }, () => disparar('core', fetchCore, 500))
          .subscribe()
      ),
      ...TABLAS_SLICE_RT.map(table =>
        supabase.channel(`rt_${table}`)
          .on('postgres_changes', { event: '*', schema: 'public', table }, () => disparar(table, () => fetchSlice(table), 300))
          .subscribe()
      ),
    ];
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [fetchCore, fetchSlice, userRol]);

  // ── Actions ─────────────────────────────────────────────────
  const actionsRef = useRef(null);
  if (!actionsRef.current) {
    const uid   = () => uidRef.current;
    const uname = () => userNameRef.current || 'Usuario';
    const urol  = () => userRolRef.current || '';
    const rf    = () => fetchAll();
    const t     = () => toastRef.current;
    const enLinea = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    const log   = (accion, modulo, detalle) =>
      supabase.from('auditoria').insert({ usuario: uname(), accion, modulo, detalle }).then(() => {});

    // Defensa en profundidad: además de RLS, valida rol en cliente para
    // acciones destructivas. Devuelve el shape estándar { error } si rechaza.
    const requireAdmin = () => urol() === 'Admin'
      ? null
      : { error: 'Solo Admin puede ejecutar esta acción' };

    // Variante que acepta lista de roles permitidos (auditoría inventario
    // 🟡-1, Tanda 1). Empleada en actions de inventario donde Admin no es
    // único actor legítimo (Producción, Bolsas, Chofer pueden ejecutar
    // ciertas operaciones según su responsabilidad).
    const requireRol = (rolesPermitidos) => {
      const rol = urol();
      if (Array.isArray(rolesPermitidos) && rolesPermitidos.includes(rol)) return null;
      const lista = Array.isArray(rolesPermitidos) ? rolesPermitidos.join(', ') : '';
      return {
        error: lista
          ? `Tu rol (${rol || 'sin rol'}) no puede ejecutar esta acción. Requerido: ${lista}`
          : 'Rol no autorizado',
      };
    };

    // Helper: insert notification (fire-and-forget, never blocks caller)
    const notify = (tipo, titulo, mensaje, icono, referencia) =>
      supabase.from('notificaciones').insert({ tipo, titulo, mensaje, icono, referencia }).then(() => {});

    // Helper: dispara alerta si algún SKU cae por debajo de su stock_minimo
    const checkStockBajo = async (skus) => {
      if (!skus || !skus.length) return;
      const uniqueSkus = [...new Set(skus.filter(Boolean))];
      if (!uniqueSkus.length) return;
      const [{ data: prods }, { data: cfs }] = await Promise.all([
        supabase.from('productos').select('sku, nombre, stock_minimo').in('sku', uniqueSkus),
        supabase.from('cuartos_frios').select('stock'),
      ]);
      if (!prods || !cfs) return;
      const stockTotal = {};
      for (const cf of cfs) {
        for (const [sku, qty] of Object.entries(cf.stock || {})) {
          stockTotal[sku] = (stockTotal[sku] || 0) + Number(qty);
        }
      }
      for (const p of prods) {
        const minimo = Number(p.stock_minimo || 0);
        if (minimo <= 0) continue;
        const actual = stockTotal[p.sku] || 0;
        if (actual < minimo) {
          notify('stock_bajo', 'Stock bajo', `${p.nombre || p.sku}: ${actual} disponibles (mínimo: ${minimo})`, '⚠️', p.sku);
        }
      }
    };

    actionsRef.current = {

      // ── CLIENTES ──
      addCliente: async (c) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          // Si el form ya trae coords (desde autocomplete), úsalas. Si no, geocodificar.
          let latitud = c.latitud != null && c.latitud !== '' ? Number(c.latitud) : null;
          let longitud = c.longitud != null && c.longitud !== '' ? Number(c.longitud) : null;
          if ((latitud == null || longitud == null) && (c.calle || c.colonia)) {
            const geo = await geocodeDireccion(buildDireccion(c)).catch(() => null);
            if (geo) { latitud = geo.lat; longitud = geo.lng; }
          }

          const { data: newCli, error } = await supabase.from('clientes').insert({
            nombre: c.nombre, rfc: c.rfc, regimen: c.regimen,
            uso_cfdi: c.usoCfdi || 'G03', cp: c.cp, correo: c.correo,
            tipo: c.tipo, contacto: c.contacto,
            nombre_comercial: c.nombreComercial || null,
            calle: c.calle || null, colonia: c.colonia || null,
            ciudad: c.ciudad || null, estado: c.estado || null, zona: c.zona || null,
            // Migración 056: numero_exterior obligatorio en form, NULL en BD
            // para no romper clientes legacy creados antes de esta migración.
            numero_exterior: c.numeroExterior || c.numero_exterior || null,
            numero_interior: c.numeroInterior || c.numero_interior || null,
            latitud, longitud,
            credito_autorizado: c.creditoAutorizado ?? false,
            limite_credito: Number(c.limiteCredito) || 0,
          }).select('id').single();
          if (error) {
            console.error('[addCliente]', error.message, error.code);
            // Migración 055: idx_clientes_rfc_nominativo bloquea RFC duplicado
            // de clientes Activos con RFC nominativo (no XAXX/XEXX).
            const esRfcDuplicado = error.code === '23505'
              && /idx_clientes_rfc_nominativo/.test(error.message || '');
            const msg = esRfcDuplicado
              ? 'Ya existe un cliente activo con este RFC'
              : 'Error al crear cliente: ' + error.message;
            t()?.error(msg);
            return { error: msg, code: error.code };
          }
          rf();
          log('Crear', 'Clientes', `${c.nombre}`);
          return newCli;
        } catch (e) {
          console.error('[addCliente] excepción:', e);
          t()?.error('Error inesperado al crear cliente');
          return { message: e?.message || 'Error inesperado' };
        }
      },

      updateCliente: async (id, c) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        const update = {};
        if (c.nombre   !== undefined) update.nombre   = c.nombre;
        if (c.rfc      !== undefined) update.rfc      = c.rfc;
        if (c.regimen  !== undefined) update.regimen  = c.regimen;
        if (c.usoCfdi  !== undefined) update.uso_cfdi = c.usoCfdi;
        if (c.cp       !== undefined) update.cp       = c.cp;
        if (c.correo   !== undefined) update.correo   = c.correo;
        if (c.tipo     !== undefined) update.tipo     = c.tipo;
        if (c.contacto !== undefined) update.contacto = c.contacto;
        if (c.estatus  !== undefined) update.estatus  = c.estatus;
        if (c.nombreComercial !== undefined) update.nombre_comercial = c.nombreComercial || null;
        if (c.calle    !== undefined) update.calle    = c.calle || null;
        if (c.colonia  !== undefined) update.colonia  = c.colonia || null;
        if (c.ciudad   !== undefined) update.ciudad   = c.ciudad || null;
        if (c.estado   !== undefined) update.estado   = c.estado || null;
        // Migración 056: numero_exterior/numero_interior. Acepta snake/camel.
        if (c.numero_exterior !== undefined) update.numero_exterior = c.numero_exterior || null;
        else if (c.numeroExterior !== undefined) update.numero_exterior = c.numeroExterior || null;
        if (c.numero_interior !== undefined) update.numero_interior = c.numero_interior || null;
        else if (c.numeroInterior !== undefined) update.numero_interior = c.numeroInterior || null;
        if (c.zona               !== undefined) update.zona               = c.zona || null;
        if (c.creditoAutorizado  !== undefined) update.credito_autorizado = c.creditoAutorizado;
        if (c.limiteCredito      !== undefined) update.limite_credito     = Number(c.limiteCredito) || 0;
        // Si el form trae coords explícitas (desde autocomplete), usarlas. Si no, re-geocodificar.
        if (c.latitud != null && c.latitud !== '' && c.longitud != null && c.longitud !== '') {
          update.latitud = Number(c.latitud);
          update.longitud = Number(c.longitud);
        } else if (c.calle !== undefined || c.colonia !== undefined || c.ciudad !== undefined) {
          const geo = await geocodeDireccion(buildDireccion(c)).catch(() => null);
          if (geo) { update.latitud = geo.lat; update.longitud = geo.lng; }
        }
        const { error } = await supabase.from('clientes').update(update).eq('id', id);
        if (error) {
          const esRfcDuplicado = error.code === '23505'
            && /idx_clientes_rfc_nominativo/.test(error.message || '');
          const msg = esRfcDuplicado
            ? 'Ya existe un cliente activo con este RFC'
            : 'Error al actualizar cliente';
          t()?.error(msg);
          return { error: msg, code: error.code };
        }
        log('Editar', 'Clientes', `ID ${id}`);
        rf();
      },

      deactivateCliente: async (id) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        const { error } = await supabase.from('clientes').update({ estatus: 'Inactivo' }).eq('id', id);
        if (error) { t()?.error('Error al desactivar cliente'); return error; }
        log('Desactivar', 'Clientes', `ID ${id}`);
        rf();
      },

      deleteCliente: async (id) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          const { error } = await supabase.from('clientes').delete().eq('id', id);
          if (error) {
            const msg = error.code === '23503'
              ? 'No se puede eliminar — el cliente tiene órdenes, pagos o comodatos asociados. Usa Desactivar.'
              : (error.message || 'Error al eliminar cliente');
            t()?.error(msg);
            return { error: msg };
          }
          log('Eliminar', 'Clientes', `ID ${id}`);
          rf();
          return undefined;
        } catch (e) {
          const msg = e?.message || 'Error inesperado al eliminar cliente';
          t()?.error(msg);
          return { error: msg };
        }
      },

      // ── PRODUCTOS ──
      addProducto: async (p) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        // 108: el Empaque nace sin existencia ni costo (entra por recepción de
        // compra, que fija el promedio); el producto terminado no tiene costo.
        const alta = camposAltaProducto({ tipo: p.tipo, stock: p.stock });
        const { error } = await supabase.from('productos').insert({
          sku: p.sku, nombre: p.nombre, tipo: p.tipo,
          stock: alta.stock, ubicacion: p.ubicacion,
          precio: Number(p.precio) || 0,
          costo_unitario: alta.costo_unitario,
          proveedor: p.proveedor || null,
          empaque_sku: p.empaque_sku || p.empaqueSku || null,
          // Tanda 4 🔴-7: claves SAT del producto (mig 060).
          clave_prod_serv: p.clave_prod_serv || p.claveProdServ || null,
          clave_unidad: p.clave_unidad || p.claveUnidad || 'H87',
        });
        if (error) { t()?.error(mensajeErrorEmpaque(error, 'Error al crear producto')); return error; }
        log('Crear', 'Productos', `${p.sku} — ${p.nombre}`);
        rf();
      },

      updateProducto: async (id, p) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        // Detectar si el SKU cambió comparando contra el actual en DB
        const { data: current, error: getErr } = await supabase
          .from('productos').select('sku').eq('id', id).single();
        if (getErr) { t()?.error('Error al leer producto'); return getErr; }

        const oldSku = String(current?.sku || '').trim();
        const newSku = (p.sku !== undefined && p.sku !== null) ? String(p.sku).trim() : oldSku;
        const skuCambio = newSku && oldSku && newSku !== oldSku;

        // Si cambió el SKU, hacer rename atómico (incluye actualizar productos.sku)
        if (skuCambio) {
          const { error: renameErr } = await supabase.rpc('rename_sku', {
            p_id: id, p_old_sku: oldSku, p_new_sku: newSku,
          });
          if (renameErr) {
            t()?.error('Error al renombrar SKU: ' + renameErr.message);
            return renameErr;
          }
          log('Renombrar SKU', 'Productos', `${oldSku} → ${newSku}`);
        }

        // Actualizar el resto de los campos (sin SKU porque ya lo manejó rename_sku)
        const update = {
          nombre: p.nombre, tipo: p.tipo, ubicacion: p.ubicacion,
          precio: Number(p.precio) || 0,
          // 106: el costo no se edita por catálogo (promedio ponderado de compras).
          proveedor: p.proveedor || null,
          empaque_sku: p.empaque_sku || p.empaqueSku || null,
        };
        // Tanda 4 🔴-7: claves SAT (mig 060). Snake o camel; null permitido
        // para limpiar (fallback en backend).
        if (p.clave_prod_serv !== undefined) update.clave_prod_serv = p.clave_prod_serv || null;
        else if (p.claveProdServ !== undefined) update.clave_prod_serv = p.claveProdServ || null;
        if (p.clave_unidad !== undefined) update.clave_unidad = p.clave_unidad || 'H87';
        else if (p.claveUnidad !== undefined) update.clave_unidad = p.claveUnidad || 'H87';
        // 093: editar el catálogo NUNCA toca el stock (un formulario abierto
        // con un valor viejo no puede restaurarlo). El stock cambia solo por
        // movimientos trazables: compra, producción, reverso o ajuste.
        const { error } = await supabase.from('productos').update(update).eq('id', id);
        if (error) { t()?.error('Error al actualizar producto: ' + error.message); return error; }
        log('Editar', 'Productos', `ID ${id} — ${p.nombre}`);
        rf();
      },

      deleteProducto: async (id) => {
        const { error } = await supabase.from('productos').delete().eq('id', id);
        if (error) { t()?.error(mensajeErrorEmpaque(error, 'Error al eliminar producto')); return error; }
        log('Eliminar', 'Productos', `ID ${id}`);
        rf();
      },

      updateStockMinimo: async (id, stockMinimo) => {
        const { error } = await supabase.from('productos').update({ stock_minimo: stockMinimo }).eq('id', id);
        if (error) { t()?.error('Error al actualizar stock mínimo'); return error; }
        rf();
      },

      deleteDemoProducts: async () => {
        const demoSkus = ['DEMO-HC-10K', 'DEMO-HT-10K'];
        const { error } = await supabase.from('productos').delete().in('sku', demoSkus);
        if (error) { t()?.error('Error al eliminar productos demo'); return error; }
        log('Limpiar', 'Productos', `Eliminados SKUs demo: ${demoSkus.join(', ')}`);
        t()?.success('Productos demo eliminados');
        rf();
      },
      // ── PRECIOS ESPECIALES ──
      addPrecioEsp: async (p) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        const { error } = await supabase.from('precios_esp').insert({
          cliente_id: p.clienteId, sucursal_id: p.sucursalId || null, sku: p.sku, precio: Number(p.precio),
        });
        if (error) {
          const msg = error.code === '23505' ? 'Ese cliente (o sucursal) ya tiene precio especial para ese producto' : 'Error al guardar precio especial';
          t()?.error(msg); return { ...error, error: msg };
        }
        log('Crear', 'Precios Especiales', `${p.sku} — $${p.precio}${p.sucursalId ? ' (sucursal)' : ''}`);
        rf();
      },

      // ── SUCURSALES (123): solo por contrato ──
      // 127: el Chofer registra un cliente con datos fiscales completos para facturar su venta rápida.
      crearClienteChofer: async (d) => {
        const guard = requireRol(['Chofer']);
        if (guard) { t()?.error(guard.error); return guard; }
        const { data, error } = await supabase.rpc('crear_cliente_chofer', { p_datos: {
          nombre: d.nombre, rfc: d.rfc, regimen: d.regimen, uso_cfdi: d.usoCfdi, cp: d.cp, correo: d.correo, contacto: d.contacto || null,
        } });
        if (error) {
          const msg = String(error.message || 'No se pudo registrar el cliente').replace(/^crear_cliente_chofer: /, '');
          t()?.error(msg); return { error: msg, code: error.code };
        }
        rf();
        return data || {};
      },
      guardarSucursal: async (id, clienteId, datos) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        const { data, error } = await supabase.rpc('guardar_sucursal', { p_id: id || null, p_cliente_id: Number(clienteId), p_datos: datos || {} });
        if (error) {
          const msg = String(error.message || 'No se pudo guardar la sucursal').replace(/^guardar_sucursal: /, '');
          t()?.error(msg); return { error: msg, code: error.code };
        }
        rf();
        return data || {};
      },
      fusionarClienteEnSucursal: async (origenId, destinoId, nombreSucursal) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        const { data, error } = await supabase.rpc('fusionar_cliente_en_sucursal', {
          p_origen: Number(origenId), p_destino: Number(destinoId), p_nombre_sucursal: nombreSucursal || null,
        });
        if (error) {
          const msg = String(error.message || 'No se pudo fusionar').replace(/^fusionar_cliente_en_sucursal: /, '');
          t()?.error(msg); return { error: msg, code: error.code };
        }
        rf();
        return data || {};
      },

      deletePrecioEsp: async (id) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        const { error } = await supabase.from('precios_esp').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar precio especial'); return error; }
        log('Eliminar', 'Precios Especiales', `ID ${id}`);
        rf();
      },

      // Edita solo el precio (cliente y sku son inmutables — para cambiarlos
      // el usuario debe borrar y crear nuevo, evitando bugs de identidad).
      updatePrecioEsp: async (id, payload = {}) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          if (!id) return { error: 'Precio requerido' };
          const { precio } = payload;
          if (precio === undefined || precio === null || precio === '') {
            return { error: 'Precio requerido' };
          }
          const num = n(precio);
          if (!Number.isFinite(num) || num <= 0) {
            return { error: 'Precio debe ser mayor a 0' };
          }
          const { error } = await supabase
            .from('precios_esp')
            .update({ precio: num })
            .eq('id', id);
          if (error) {
            t()?.error('Error al actualizar precio especial');
            return { error: error.message || 'Error al actualizar precio' };
          }
          log('Editar', 'Precios Especiales', `ID ${id} — $${num}`);
          rf();
          return undefined;
        } catch (e) {
          const msg = e?.message || 'Error inesperado al actualizar precio';
          t()?.error(msg);
          return { error: msg };
        }
      },

      // ── ÓRDENES ──
      // 088: la orden se crea con el contrato crear_orden — orden Creada +
      // líneas en UNA transacción; precios (especial del cliente o catálogo),
      // total, folio, stock disponible, crédito y actor los deriva el
      // servidor. El cliente solo manda cliente, productos×cantidad y datos de
      // entrega. Sin INSERT directo en ordenes/orden_lineas.
      addOrden: async (o) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          const items = parseProductos(o.productos);
          const itemsErr = validateItems(items);
          if (itemsErr) return { message: itemsErr };
          const lat = o.latitudEntrega;
          const lng = o.longitudEntrega;
          const { data, error } = await supabase.rpc('crear_orden', {
            p_orden: {
              cliente_id: o.clienteId || null,
              sucursal_id: o.sucursalId || null, // 123: sin ella, el servidor usa la principal
              cliente_nombre: s(o.cliente) || null,
              tipo_cobro: o.tipoCobro || 'Contado',
              metodo_pago: o.metodoPago || 'Efectivo',
              requiere_factura: o.requiereFactura === true,
              folio_nota: o.folioNota || null,
              fecha: o.fecha || null,
              direccion_entrega: typeof o.direccionEntrega === 'string' ? o.direccionEntrega.trim() : null,
              referencia_entrega: typeof o.referenciaEntrega === 'string' ? o.referenciaEntrega.trim() : null,
              latitud_entrega: (lat === '' || lat === null || lat === undefined || !Number.isFinite(Number(lat))) ? null : Number(lat),
              longitud_entrega: (lng === '' || lng === null || lng === undefined || !Number.isFinite(Number(lng))) ? null : Number(lng),
            },
            p_items: items.map(it => ({ sku: it.sku, cantidad: it.qty })),
          });
          if (error) {
            const msg = String(error.message || 'Error al crear orden').replace(/^venta: /, '');
            console.warn('[addOrden] rpc crear_orden:', error.message);
            t()?.error(msg);
            return { message: msg };
          }
          const newOrd = data || {};
          await log('Crear', 'Órdenes', `${newOrd.folio} — $${newOrd.total}`);
          notify('venta', 'Nueva orden creada', `${newOrd.folio} — ${newOrd.cliente_nombre} — $${Number(newOrd.total || 0).toLocaleString()}`, '🧾', newOrd.folio);
          rf();
          return { orden: { ...newOrd, cliente: newOrd.cliente_nombre } };
        } catch (e) {
          console.error('[addOrden] excepción:', e);
          t()?.error('Error inesperado al crear orden');
          return { message: e?.message || 'Error inesperado' };
        }
      },

      updateOrdenEstatus: async (id, nuevoEst, metodoPago = null, extra = {}) => {
        try {
          const { data: ordenPrev, error: errPrev } = await supabase
            .from('ordenes')
            .select('estatus, metodo_pago')
            .eq('id', id)
            .single();
          if (errPrev) {
            console.warn('[updateOrdenEstatus] select estatus prev:', errPrev.message);
            t()?.error('No se pudo leer la orden');
            return errPrev;
          }

          // FSM: rechaza transiciones ilegales (ej. Cancelada → Entregada,
          // Facturada → Creada). Defensa en profundidad: la UI ya filtra
          // botones por estatus, esto bloquea llamadas vía API directa.
          const transErr = validateTransicionOrden(ordenPrev?.estatus, nuevoEst);
          if (transErr) {
            t()?.error(transErr.error);
            return transErr;
          }

          let error;
          if (nuevoEst === 'Asignada') {
            ({ error } = await supabase.rpc('asignar_orden', { p_orden_id: id, p_ruta_id: null, p_usuario_id: uid() }));
          } else if (nuevoEst === 'Cancelada') {
            const { data: ord, error: errOrd } = await supabase.from('ordenes').select('estatus').eq('id', id).single();
            if (errOrd) {
              console.warn('[updateOrdenEstatus] select para cancelar:', errOrd.message);
              t()?.error('No se pudo leer la orden para cancelar');
              return errOrd;
            }
            if (ord?.estatus === 'Asignada') {
              ({ error } = await supabase.rpc('cancelar_orden_asignada', { p_orden_id: id, p_usuario_id: uid() }));
            } else {
              ({ error } = await supabase.from('ordenes').update({ estatus: nuevoEst }).eq('id', id));
            }
          } else {
            const updateObj = { estatus: nuevoEst };
            if (metodoPago) updateObj.metodo_pago = metodoPago;
            if (extra.folioNota) updateObj.folio_nota = extra.folioNota;
            ({ error } = await supabase.from('ordenes').update(updateObj).eq('id', id));
          }
          if (error) { t()?.error('Error al actualizar orden'); return error; }

          // Auto-registrar ingreso o CxC al cobrar (Entregada)
          if (nuevoEst === 'Entregada') {
            const { data: ord, error: errOrd } = await supabase
              .from('ordenes')
              .select('id, folio, total, cliente_id, metodo_pago, facturama_id')
              .eq('id', id)
              .single();
            if (errOrd) {
              console.warn('[updateOrdenEstatus] select datos completos:', errOrd.message);
              // Rollback: restaurar estatus previo
              await supabase.from('ordenes').update({
                estatus: ordenPrev?.estatus || 'Creada',
                metodo_pago: ordenPrev?.metodo_pago || metodoPago,
              }).eq('id', id);
              t()?.error('No se pudieron leer los datos de la orden — estatus revertido');
              return errOrd;
            }

            if (ord && n(ord.total) > 0) {
              let cli = null;
              if (ord.cliente_id) {
                const { data: cliData, error: errCli } = await supabase
                  .from('clientes').select('nombre').eq('id', ord.cliente_id).single();
                if (errCli) {
                  console.warn('[updateOrdenEstatus] select cliente nombre (no crítico):', errCli.message);
                }
                cli = cliData;
              }
              const mPago = metodoPago || s(ord.metodo_pago) || 'Efectivo';
              const esCredito = mPago.toLowerCase().includes('crédito') || mPago.toLowerCase().includes('fiado');
              let downstreamError = null;

              if (esCredito && ord.cliente_id) {
                // P1 Fase A: contrato atómico (CxC + saldo del cliente en una
                // transacción, idempotente por orden).
                const { data: cxcRes, error: cxcError } = await supabase.rpc('crear_cxc_orden', {
                  p_orden_id: id,
                  p_dias_vencimiento: 30,
                });
                if (cxcError) {
                  downstreamError = cxcError;
                } else if (cxcRes?.creada) {
                  notify('credito', 'Venta a crédito', `${s(ord.folio)} — ${cli?.nombre || 'Cliente'} — $${n(ord.total).toLocaleString()} a 30 días`, '💳', s(ord.folio));
                }
              } else if (!esPagoEnLinea(mPago)) {
                // 093: la venta de contado cobrada al entregar se registra como
                // PAGO (evento canónico del flujo de efectivo) con el contrato
                // registrar_pago_orden (idempotente; también deja el ingreso
                // contable). El ingreso del estado de resultados sale de la
                // entrega (delivered_at), no de este registro.
                const { error: pagoError } = await supabase.rpc('registrar_pago_orden', {
                  p_orden_id: id,
                  p_metodo: mPago,
                  p_usuario_id: uid(),
                });
                if (pagoError) downstreamError = pagoError;
              }
              // QR / link de pago: el dinero llega por el webhook (pagos); no se
              // registra un cobro que todavía no ocurrió.

              if (downstreamError) {
                await supabase.from('ordenes').update({
                  estatus: ordenPrev?.estatus || 'Creada',
                  metodo_pago: ordenPrev?.metodo_pago || ord.metodo_pago,
                }).eq('id', id);
                t()?.error('No se pudo sincronizar el cobro: ' + (downstreamError?.message || String(downstreamError)));
                return downstreamError;
              }
            }

            // Sync payment status with Facturama if invoice exists
            if (ord && ord.facturama_id) {
              try {
                await backendPost('billing-sync-payment', { ordenId: ord.id });
              } catch {
                notify('advertencia', 'Sincronización Facturama', `No se pudo sincronizar el pago de ${s(ord.folio)} con Facturama`, '⚠️', s(ord.folio));
              }
            }
          }

          if (nuevoEst === 'Facturada') {
            const { data: ordFact, error: errOrdFact } = await supabase.from('ordenes').select('folio, cliente_nombre').eq('id', id).maybeSingle();
            if (errOrdFact) {
              console.warn('[updateOrdenEstatus] select para notify Facturada (no crítico):', errOrdFact.message);
            } else {
              notify('factura', 'Orden facturada', `${s(ordFact?.folio)} — ${s(ordFact?.cliente_nombre)}`, '🧾', s(ordFact?.folio));
            }
          }

          await log('Cambiar estatus', 'Órdenes', `Orden #${id} → ${nuevoEst}`);

          rf();
          return undefined;
        } catch (e) {
          console.error('[updateOrdenEstatus] excepción:', e);
          t()?.error('Error inesperado al actualizar orden');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── VENTA DIRECTA DE PLANTA (OL-02C / mig 109) ──
      // UN contrato atómico: salida física de los cuartos asignados +
      // Entregada + pago (contado) o CxC (crédito, 30 días) o entrega de un
      // pedido ya pagado por link. Este camino NO usa updateOrdenEstatus ni
      // llama aparte a registrar_pago_orden / crear_cxc_orden / salida de
      // cuarto: el servidor hace todo en una transacción. La asignación
      // {sku, cuarto_id, cantidad} es explícita; el servidor nunca elige.
      // operacionId: lo fija la vista por intento (reintento = mismo UUID).
      completarVentaDirecta: async (payload = {}) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        const built = buildCompletarVentaDirectaArgs({ ...payload, operacionId: payload.operacionId || nuevoOperacionId() });
        if (built.error) { t()?.error(built.error); return { error: built.error }; }
        try {
          const { data, error } = await supabase.rpc('completar_venta_directa', built.args);
          if (error) {
            const msg = mensajeErrorVentaDirecta(error);
            console.warn('[completarVentaDirecta] rpc completar_venta_directa:', error.message);
            t()?.error(msg);
            return { error: msg };
          }
          rf();
          return { data, replay: data?.replay === true };
        } catch (e) {
          console.error('[completarVentaDirecta] excepción:', e);
          t()?.error('Error de conexión al completar la venta. Reintenta: el mismo intento no se duplica.');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      deleteOrden: async (id) => {
        try {
          const { error } = await supabase.from('ordenes').delete().eq('id', id);
          if (error) {
            const msg = error.code === '23503'
              ? 'No se puede eliminar — la orden tiene pagos, CxC o ruta asignada. Usa Cancelar.'
              : (error.message || 'Error al eliminar orden');
            t()?.error(msg);
            return { error: msg };
          }
          log('Eliminar', 'Órdenes', `ID ${id}`);
          rf();
          return undefined;
        } catch (e) {
          const msg = e?.message || 'Error inesperado al eliminar orden';
          t()?.error(msg);
          return { error: msg };
        }
      },

      // Cancela una orden con motivo. Usa updateOrdenEstatus internamente
      // para reusar el reverso de stock vía RPC cuando estatus == 'Asignada'.
      // Bloquea cancelación si hay pagos directos o CxC con monto_pagado > 0.
      cancelarOrden: async ({ ordenId, motivo } = {}) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          if (!ordenId) return { error: 'Orden requerida' };
          const motivoTxt = String(motivo || '').trim();
          if (!motivoTxt) return { error: 'Motivo requerido' };

          // Leer orden + estatus actual
          const { data: orden, error: errOrd } = await supabase
            .from('ordenes')
            .select('id, folio, estatus, ruta_id')
            .eq('id', ordenId)
            .single();
          if (errOrd || !orden) {
            const msg = errOrd?.message || 'Orden no encontrada';
            t()?.error(msg);
            return { error: msg };
          }

          const estatusActual = s(orden.estatus);

          // Lectura paralela de CxC + pagos para validación atómica
          const [{ data: cxcRows, error: errCxc }, { data: pagosRows, error: errPag }] = await Promise.all([
            supabase.from('cuentas_por_cobrar').select('id, monto_pagado, monto_original').eq('orden_id', ordenId),
            supabase.from('pagos').select('id').eq('orden_id', ordenId),
          ]);
          if (errCxc) console.warn('[cancelarOrden] select cxc:', errCxc.message);
          if (errPag) console.warn('[cancelarOrden] select pagos:', errPag.message);

          const cxc = (cxcRows || [])[0] || null;
          const hayPagosDirectos = (pagosRows || []).length > 0;

          // Validación pura — extraída a ordenLogic.validateCancelacion
          const validationErr = validateCancelacion({
            estatusActual,
            cxc,
            hayPagosDirectos,
            motivo: motivoTxt,
          });
          if (validationErr) return validationErr;

          // 090: la CxC sin cobros se anula con el contrato anular_cxc_orden
          // (borra la cuenta y revierte el saldo del cliente en una
          // transacción). Ningún JWT escribe cuentas_por_cobrar por REST.
          if (cxc) {
            const { error: errAnular } = await supabase.rpc('anular_cxc_orden', { p_orden_id: Number(ordenId) });
            if (errAnular) {
              console.warn('[cancelarOrden] rpc anular_cxc_orden:', errAnular.message);
              t()?.error('No se pudo anular la CxC asociada');
              return { error: errAnular.message };
            }
          }

          // Cambio de estatus a Cancelada — reusa updateOrdenEstatus que
          // dispara el RPC de reverso de stock cuando viene de 'Asignada'.
          const errEst = await actionsRef.current?.updateOrdenEstatus?.(ordenId, 'Cancelada');
          if (errEst && (errEst.error || errEst.message)) {
            const msg = errEst.error || errEst.message;
            t()?.error(msg);
            return { error: msg };
          }

          // Anotar contexto de cancelación (columnas de migración 043)
          const anotacion = buildAnotacionCancelacion(motivoTxt, uname() || 'Admin');
          const { error: errAnot } = await supabase
            .from('ordenes')
            .update(anotacion)
            .eq('id', ordenId);
          if (errAnot) {
            console.warn('[cancelarOrden] update anotaciones:', errAnot.message);
            t()?.error('Cancelación aplicada, pero las anotaciones no se guardaron');
          }

          // Audit
          await log('Cancelar', 'Órdenes',
            `${s(orden.folio) || ordenId} — ${motivoTxt}${estatusActual === 'Asignada' ? ' (stock revertido)' : ''}`
          );

          rf();
          return undefined;
        } catch (e) {
          console.error('[cancelarOrden] excepción:', e);
          t()?.error('Error inesperado al cancelar orden');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // Marca una orden como No entregada (cliente cerrado/ausente/rechazo).
      // Solo aplica desde 'Asignada' o 'En ruta' (validado por FSM).
      //
      // Stock se devuelve al cuarto frío INMEDIATAMENTE (decisión S1).
      // Discrepancia física durante el viaje de regreso del camión es
      // aceptable: nadie consulta cuarto durante ruta activa.
      // Trazabilidad de qué regresa físicamente:
      //   SELECT * FROM ordenes WHERE estatus='No entregada' AND ruta_id=X.
      marcarNoEntregada: async (ordenId, motivo, reagendar = false, opciones = {}) => {
        // 084/087: registrar_no_entrega hace en UNA transacción la transición
        // a 'No entregada' (motivo, reagendar). Desde 087 NO toca cuartos
        // fríos: el producto sigue en el camión y vuelve al cuarto solo con
        // finalizar_inventario_ruta. Idempotente por operacion_id (la cola
        // offline lo conserva entre reintentos).
        // opciones: { operacionId }
        try {
          const built = buildNoEntregaArgs({
            operacionId: opciones.operacionId || nuevoOperacionId(),
            ordenId,
            motivo,
            reagendar: reagendar === true,
          });
          if (built.error) { t()?.error(built.error); return { error: built.error }; }

          const { data, error } = await supabase.rpc('registrar_no_entrega', built.args);
          if (error) {
            const msg = mensajeErrorStock(error);
            console.warn('[marcarNoEntregada] rpc registrar_no_entrega:', error.message);
            t()?.error(msg);
            return { error: msg };
          }
          const res = interpretarResultadoStock(data);
          if (!res.replay) {
            // 087: sin movimiento de cuarto; el producto sigue en el camión
            // hasta finalizar_inventario_ruta.
            const lineas = Array.isArray(res.en_camion) ? res.en_camion : [];
            const cantTxt = lineas.length > 0 ? lineas.map(d => `${d.cantidad}×${d.sku}`).join(', ') : 'sin líneas';
            await log('No entregada', 'Órdenes',
              `${res.folio || `ID ${ordenId}`} — ${s(motivo)}${reagendar ? ' (reagendar)' : ''} — sigue en el camión: ${cantTxt}`
            );
          }
          rf();
          return undefined;
        } catch (e) {
          console.error('[marcarNoEntregada] excepción:', e);
          t()?.error('Error inesperado al marcar como No entregada');
          return { error: e?.message || 'Error inesperado' };
        }
      },
      updateOrden: async (ordenId, payload = {}) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          if (!ordenId) return { error: 'Orden requerida' };

          const { data: ord, error: errOrd } = await supabase
            .from('ordenes')
            .select('estatus, ruta_id, cliente_id, sucursal_id')
            .eq('id', ordenId)
            .single();
          if (errOrd || !ord) {
            const msg = errOrd?.message || 'Orden no encontrada';
            t()?.error(msg);
            return { error: msg };
          }

          // Si la orden está asignada a una ruta, leer si esa ruta ya
          // confirmó carga física. Una orden cuya ruta ya cargó no puede
          // editarse — generaría desacuerdo entre la nota y el camión.
          let ruta = null;
          if (ord.ruta_id) {
            const { data: rutaRow, error: errRuta } = await supabase
              .from('rutas')
              .select('id, carga_confirmada_at')
              .eq('id', ord.ruta_id)
              .maybeSingle();
            if (errRuta) {
              console.warn('[updateOrden] select ruta:', errRuta.message);
              t()?.error('No se pudo verificar la ruta');
              return { error: errRuta.message };
            }
            ruta = rutaRow;
          }

          // Validación pura — extraída a ordenLogic.validateEdicionOrden
          const edicionErr = validateEdicionOrden(s(ord.estatus), ruta);
          if (edicionErr) {
            t()?.error(edicionErr.error);
            return edicionErr;
          }

          const { lines, ...resto } = payload;

          // Si vienen líneas nuevas, recalcular total y validar SKUs/precios
          let totalNuevo = null;
          let lineasNuevas = null;
          if (Array.isArray(lines)) {
            const items = parseLineasEdicion(lines);
            const itemsErr = validateItems(items);
            if (itemsErr) return { error: itemsErr };

            const [{ data: prods }, { data: pesRaw }] = await Promise.all([
              supabase.from('productos').select('sku, precio, stock'),
              supabase.from('precios_esp').select('sku, precio, sucursal_id').eq('cliente_id', resto.clienteId || resto.cliente_id || ord.cliente_id || null),
            ]);
            // 123: precio de la sucursal de la orden sobre el del cliente (el servidor reprecia igual).
            const pes = preciosParaLineas(pesRaw || [], resto.sucursalId ?? resto.sucursal_id ?? ord.sucursal_id ?? null);
            const built = buildLineas(items, prods || [], pes);
            if (built.error) return { error: built.error };
            totalNuevo = built.total;
            lineasNuevas = built.lineas;
          }

          // Construir UPDATE — extraído a ordenLogic.buildUpdateFieldsOrden
          const updateFields = buildUpdateFieldsOrden(resto, lineasNuevas, totalNuevo);

          // Si no hay nada que actualizar, no llamar al RPC.
          if (Object.keys(updateFields).length === 0 && !Array.isArray(lines)) {
            return undefined;
          }

          // RPC atómica (mig 058): UPDATE ordenes + DELETE/INSERT lineas
          // en una transacción. Reemplaza el patrón previo de 3 ops sin
          // transacción que dejaba la orden sin líneas si el INSERT
          // fallaba a la mitad.
          const lineasParaRpc = lineasNuevas
            ? lineasNuevas.map(l => ({
                sku: l.sku,
                cantidad: Number(l.cantidad),
                precio_unit: Number(l.precio_unit),
                subtotal: Number(l.subtotal),
              }))
            : null;

          const { error: rpcErr } = await supabase.rpc('update_orden_atomic', {
            p_orden_id: Number(ordenId),
            p_update_fields: Object.keys(updateFields).length > 0 ? updateFields : {},
            p_lineas: lineasParaRpc,
          });
          if (rpcErr) {
            console.warn('[updateOrden] rpc update_orden_atomic:', rpcErr.message);
            t()?.error(rpcErr.message || 'No se pudo actualizar la orden');
            return { error: rpcErr.message };
          }

          await log('Editar', 'Órdenes', `ID ${ordenId}`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[updateOrden] excepción:', e);
          t()?.error('Error inesperado al editar orden');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── PRODUCCIÓN ──
      updateProduccion: async (id, fields) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        // 093: la producción es un evento inmutable; solo se corrigen turno y
        // máquina. Para deshacer una producción se usa revertirProduccion.
        // Construcción del payload pura — extraída a produccionLogic.
        const upd = buildUpdateFieldsProduccion(fields);
        if (!upd) return { error: 'Nada que actualizar' };
        const { error } = await supabase.from('produccion').update(upd).eq('id', id);
        if (error) { t()?.error('Error al actualizar producción'); return error; }
        log('Editar', 'Producción', `ID ${id} — ${Object.keys(upd).join(', ')}`);
        rf();
      },

      // 093: la producción es inmutable. Deshacerla es un reverso
      // compensatorio en el servidor (revertir_produccion): Admin, UUID,
      // atómico e idempotente; usa SOLO los datos guardados de esa producción
      // (cuarto original, empaque y cantidad históricos, costo). Las
      // transformaciones y las producciones legadas sin esos datos no se
      // pueden revertir todavía. No existe borrado físico.
      revertirProduccion: async (id, motivo, opciones = {}) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          if (!id) return { error: 'Producción requerida' };
          const motivoTxt = s(motivo).trim();
          if (!motivoTxt) return { error: 'Motivo requerido' };
          const { data, error } = await supabase.rpc('revertir_produccion', {
            p_operacion_id: opciones.operacionId || nuevoOperacionId(),
            p_produccion_id: Number(id),
            p_motivo: motivoTxt,
          });
          if (error) {
            const msg = error.message || 'No se pudo revertir la producción';
            t()?.error(msg);
            return { error: msg };
          }
          rf();
          return { data };
        } catch (e) {
          console.error('[revertirProduccion] excepción:', e);
          t()?.error('Error inesperado al revertir producción');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // OP-01D (mig 115): "Preparar desde barra". UNA operación atómica en el
      // servidor: N barras del cuarto → 2N bolsas de picada/triturada en el
      // mismo cuarto y −2N del empaque configurado en la salida. Vender después
      // esas bolsas no vuelve a consumir barra ni empaque. p.operacionId
      // identifica el intento lógico (reintento = mismo UUID → replay).
      prepararDesdeBarra: async (p = {}) => {
        const guard = requireRol(['Admin', 'Producción']);
        if (guard) { t()?.error(guard.error); return guard; }
        const built = buildPreparacionArgs(p);
        if (built.error) return { error: built.error };
        try {
          const { data, error } = await supabase.rpc('registrar_preparacion_barra', built.args);
          if (error) {
            console.warn('[prepararDesdeBarra] rpc:', error.message);
            return { error: mensajeErrorPreparacion(error) };
          }
          rf();
          return { data };
        } catch (e) {
          console.error('[prepararDesdeBarra] excepción:', e);
          return { error: mensajeErrorPreparacion(e) };
        }
      },

      // 129: "Desglosar barra". Producción decide qué queda de cada mitad (media barra, picada o
      // triturada). Se compone de contratos atómicos e idempotentes: partir_barra y, por cada
      // bolsa pedida, registrar_preparacion_media. Cada paso deja el inventario consistente; si uno
      // falla, reintentar con los mismos operacionIds continúa sin duplicar (replay).
      // p = { cuartoId, barras, plan: { picada, triturada }, operaciones: { partir, picada, triturada } }
      desglosarBarra: async (p = {}) => {
        const guard = requireRol(['Admin', 'Producción']);
        if (guard) { t()?.error(guard.error); return guard; }
        const ops = p.operaciones || {};
        const pasos = [{ nombre: 'partir', rpc: 'partir_barra', built: buildPartirArgs({ operacionId: ops.partir, cuartoId: p.cuartoId, barras: p.barras }) }];
        if (p.plan?.picada) pasos.push({ nombre: 'picada', rpc: 'registrar_preparacion_media', built: buildPreparacionMediaArgs({ operacionId: ops.picada, cuartoId: p.cuartoId, salidaSku: 'HIP-25K', medias: p.plan.picada }) });
        if (p.plan?.triturada) pasos.push({ nombre: 'triturada', rpc: 'registrar_preparacion_media', built: buildPreparacionMediaArgs({ operacionId: ops.triturada, cuartoId: p.cuartoId, salidaSku: 'HIT-25K', medias: p.plan.triturada }) });
        for (const paso of pasos) if (paso.built.error) return { error: paso.built.error };
        const hechos = [];
        try {
          for (const paso of pasos) {
            const { data, error } = await supabase.rpc(paso.rpc, paso.built.args);
            if (error) {
              console.warn('[desglosarBarra] rpc:', paso.rpc, error.message);
              if (hechos.length) rf();
              const base = mensajeErrorPreparacion(error);
              return { error: hechos.length ? `${base} La barra ya quedó partida; reintenta para completar el desglose.` : base, parcial: hechos.length > 0 };
            }
            hechos.push({ paso: paso.nombre, data });
          }
          rf();
          return { data: { pasos: hechos } };
        } catch (e) {
          console.error('[desglosarBarra] excepción:', e);
          if (hechos.length) rf();
          return { error: mensajeErrorPreparacion(e), parcial: hechos.length > 0 };
        }
      },

      // ── WF-0 + PD-01 (mig 116): asistencia. Persona, hora, turno y geocerca
      // los decide el servidor; el cliente solo manda una lectura de ubicación.
      miAsistencia: async () => {
        try {
          const { data, error } = await supabase.rpc('mi_asistencia');
          if (error) return { error: mensajeErrorLlamada(error, enLinea()) };
          return { data };
        } catch (e) {
          return { error: mensajeErrorLlamada(e, enLinea()) };
        }
      },

      // tipo 'entrada' | 'salida'. `red: true` = no hubo respuesta: el mismo
      // toque se reintenta con la MISMA operación (idempotente en el servidor).
      registrarAsistencia: async (tipo, coords, operacionId) => {
        const built = buildRegistroArgs({ operacionId, coords });
        if (built.error) return { error: built.error };
        const fn = tipo === 'salida' ? 'registrar_salida' : 'registrar_entrada';
        try {
          const { data, error } = await supabase.rpc(fn, built.args);
          if (error) return { error: mensajeErrorLlamada(error, enLinea()), red: esErrorDeRed(error, enLinea()), operacionId: built.args.p_operacion_id };
          return { data, operacionId: built.args.p_operacion_id };
        } catch (e) {
          return { error: mensajeErrorLlamada(e, enLinea()), red: esErrorDeRed(e, enLinea()), operacionId: built.args.p_operacion_id };
        }
      },

      asistenciaDia: async (fecha) => {
        const guard = requireAdmin();
        if (guard) return guard;
        const { data, error } = await supabase.rpc('asistencia_dia', { p_fecha: fecha || null });
        if (error) return { error: mensajeErrorLlamada(error, enLinea()) };
        return { data };
      },

      configAsistencia: async () => {
        const guard = requireAdmin();
        if (guard) return guard;
        const { data, error } = await supabase.rpc('config_asistencia');
        if (error) return { error: mensajeErrorLlamada(error, enLinea()) };
        return { data };
      },

      // PD-01.1 (mig 131): avisos de asistencia al celular (configuración de Admin).
      avisosAsistencia: async () => {
        const guard = requireAdmin();
        if (guard) return guard;
        const { data, error } = await supabase.rpc('avisos_asistencia');
        if (error) return { error: mensajeErrorLlamada(error, enLinea()) };
        return { data };
      },

      guardarAvisosAsistencia: async (form) => {
        const guard = requireAdmin();
        if (guard) return guard;
        const built = buildGuardarAvisosArgs(form);
        if (built.error) return { error: built.error };
        const { data, error } = await supabase.rpc('guardar_avisos_asistencia', { p_datos: built.datos });
        if (error) return { error: mensajeErrorLlamada(error, enLinea()) };
        t()?.success(data?.sin_cambios ? 'Sin cambios' : 'Avisos de asistencia guardados');
        return { data };
      },

      guardarCentroTrabajo: async (form) => {
        const guard = requireAdmin();
        if (guard) return guard;
        const built = buildCentroArgs(form);
        if (built.error) return { error: built.error };
        const { data, error } = await supabase.rpc('guardar_centro_trabajo', built.args);
        if (error) return { error: mensajeErrorLlamada(error, enLinea()) };
        t()?.success('Centro de trabajo guardado');
        return { data };
      },

      guardarTurno: async (form) => {
        const guard = requireAdmin();
        if (guard) return guard;
        const built = buildTurnoArgs(form);
        if (built.error) return { error: built.error };
        const { data, error } = await supabase.rpc('guardar_turno', built.args);
        if (error) {
          const msg = /ya tiene un turno activo/i.test(error.message || '')
            ? 'Ese empleado ya tiene un turno activo en alguno de esos días.'
            : mensajeErrorLlamada(error, enLinea());
          return { error: msg };
        }
        t()?.success('Turno guardado');
        return { data };
      },

      corregirAsistencia: async (params) => {
        const guard = requireAdmin();
        if (guard) return guard;
        const built = buildCorreccionArgs(params);
        if (built.error) return { error: built.error };
        const { data, error } = await supabase.rpc('corregir_asistencia', built.args);
        if (error) return { error: (error.message || '').replace(/^corregir_asistencia:\s*/, '') || 'No se pudo corregir' };
        t()?.success('Corrección registrada');
        return { data };
      },

      // ── PD-02 (mig 118): calendario operativo. Estado, fechas y permisos los
      // decide el servidor; crear/editar/desactivar solo Admin.
      calendario: async (desde, hasta, { soloMias = false, soloAbiertas = false } = {}) => {
        try {
          const { data, error } = await supabase.rpc('calendario', { p_desde: desde, p_hasta: hasta, p_solo_mias: soloMias, p_solo_abiertas: soloAbiertas });
          if (error) return { error: mensajeErrorLlamada(error, enLinea()) };
          return { data };
        } catch (e) {
          return { error: mensajeErrorLlamada(e, enLinea()) };
        }
      },

      completarOcurrencia: async (params) => {
        const built = buildCompletarArgs(params);
        if (built.error) return { error: built.error };
        try {
          const { data, error } = await supabase.rpc('completar_ocurrencia', built.args);
          if (error) {
            const msg = /solo la completa Admin/i.test(error.message || '') ? 'Esta actividad solo la completa Admin.'
              : (error.message || '').replace(/^completar_ocurrencia:\s*/, '') || 'No se pudo completar';
            return { error: msg, red: esErrorDeRed(error, enLinea()), operacionId: built.args.p_operacion_id };
          }
          fetchActividades();
          return { data, operacionId: built.args.p_operacion_id };
        } catch (e) {
          return { error: mensajeErrorLlamada(e, enLinea()), red: esErrorDeRed(e, enLinea()), operacionId: built.args.p_operacion_id };
        }
      },

      guardarActividad: async (id, form, operacionId) => {
        const guard = requireAdmin();
        if (guard) return guard;
        const built = buildActividadDatos(form);
        if (built.error) return { error: built.error };
        const { data, error } = await supabase.rpc('guardar_actividad', { p_operacion_id: operacionId || nuevoOperacionId(), p_id: id ? Number(id) : null, p_datos: built.datos });
        if (error) return { error: (error.message || '').replace(/^guardar_actividad:\s*/, '') || 'No se pudo guardar' };
        t()?.success(id ? 'Se creó una versión nueva para los periodos siguientes' : 'Actividad creada');
        fetchActividades();
        return { data };
      },

      editarOcurrencia: async (params) => {
        const guard = requireAdmin();
        if (guard) return guard;
        const built = buildEditarOcurrenciaArgs(params);
        if (built.error) return { error: built.error };
        const { data, error } = await supabase.rpc('editar_ocurrencia', built.args);
        if (error) return { error: (error.message || '').replace(/^editar_ocurrencia:\s*/, '') || 'No se pudo editar' };
        t()?.success('Ocurrencia actualizada');
        fetchActividades();
        return { data };
      },

      desactivarActividad: async (id, motivo) => {
        const guard = requireAdmin();
        if (guard) return guard;
        const { data, error } = await supabase.rpc('desactivar_actividad', { p_actividad_id: Number(id), p_motivo: String(motivo || '').trim() });
        if (error) return { error: (error.message || '').replace(/^desactivar_actividad:\s*/, '') || 'No se pudo desactivar' };
        t()?.success('Actividad desactivada');
        fetchActividades();
        return { data };
      },

      // WF-0: liga (o desliga con null) la ficha de empleado con su usuario (1 a 1).
      vincularEmpleadoUsuario: async (empleadoId, usuarioId) => {
        const guard = requireAdmin();
        if (guard) return guard;
        const { data, error } = await supabase.rpc('vincular_empleado_usuario', {
          p_empleado_id: Number(empleadoId), p_usuario_id: usuarioId ? Number(usuarioId) : null,
        });
        if (error) {
          const msg = /ya está ligado/i.test(error.message || '') ? 'Ese usuario ya está ligado a otro empleado.' : mensajeErrorLlamada(error, enLinea());
          t()?.error(msg);
          return { error: msg };
        }
        t()?.success(usuarioId ? 'Acceso ligado al empleado' : 'Acceso desligado');
        rf();
        return { data };
      },

      // OP-01D (mig 115): revertir una preparación equivocada (solo Admin):
      // regresa las barras y el empaque y quita las bolsas preparadas, si
      // siguen en el cuarto. Una sola vez por preparación.
      revertirPreparacion: async (id, motivo, opciones = {}) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          if (!id) return { error: 'Preparación requerida' };
          const motivoTxt = s(motivo).trim();
          if (!motivoTxt) return { error: 'Motivo requerido' };
          const { data, error } = await supabase.rpc('revertir_preparacion_barra', {
            p_operacion_id: opciones.operacionId || nuevoOperacionId(),
            p_preparacion_id: Number(id),
            p_motivo: motivoTxt,
          });
          if (error) {
            const msg = /Stock insuficiente/i.test(error.message || '')
              ? 'Ya no están todas las bolsas de esa preparación en el cuarto: no se puede revertir.'
              : (error.message || 'No se pudo revertir la preparación');
            t()?.error(msg);
            return { error: msg };
          }
          rf();
          return { data };
        } catch (e) {
          console.error('[revertirPreparacion] excepción:', e);
          t()?.error('Error inesperado al revertir la preparación');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // Producir y congelar (mig 076): UNA sola operación atómica en el
      // servidor. registrar_produccion crea la fila de producción, consume el
      // empaque (sin negativos), mete el producto al cuarto, genera el kardex
      // y registra costo + costos_historial + egreso, todo o nada. El cliente
      // no escribe productos/inventario_mov/produccion/costos/contabilidad ni
      // compensa: un error significa que el servidor revirtió todo.
      // p.operacionId identifica el intento lógico (reintento = mismo UUID).
      producirYCongelar: async (p = {}) => {
        const guard = requireRol(['Admin', 'Producción']);
        if (guard) { t()?.error(guard.error); return guard; }
        const built = buildRegistrarProduccionArgs(p);
        if (built.error) return { error: built.error };
        try {
          const { data, error } = await supabase.rpc('registrar_produccion', built.args);
          if (error) {
            console.warn('[producirYCongelar] rpc registrar_produccion:', error.message);
            return { error: mensajeErrorProduccion(error) };
          }
          const r = interpretarResultadoProduccion(data);
          if (!r.replay) {
            log('Producir', 'Producción', `${r.folio} — ${r.sku} x${r.cantidad}`);
            notify('produccion', 'Producción registrada', `${r.folio} — ${Number(r.cantidad).toLocaleString()} ${r.sku}`, '🏭', r.folio);
          }
          rf();
          return r;
        } catch (e) {
          console.error('[producirYCongelar] excepción:', e);
          return { error: mensajeErrorProduccion(e) };
        }
      },

      // ── TRANSFORMACIÓN: insumo (barra/materia prima) → producto terminado ──
      // Mig 076: UNA sola operación atómica en el servidor.
      // registrar_transformacion descuenta el insumo de productos.stock, mete
      // el output al cuarto destino, genera el kardex y registra la merma de
      // proceso (072), todo o nada, sin contabilidad. Sin folio, inserts,
      // deletes ni rollbacks en el cliente.
      addTransformacion: async (payload = {}) => {
        const guard = requireRol(['Admin', 'Producción']);
        if (guard) { t()?.error(guard.error); return guard; }
        const built = buildRegistrarTransformacionArgs(payload);
        if (built.error) { t()?.error(built.error); return { error: built.error }; }
        try {
          const { data, error } = await supabase.rpc('registrar_transformacion', built.args);
          if (error) {
            const msg = mensajeErrorProduccion(error);
            console.warn('[addTransformacion] rpc registrar_transformacion:', error.message);
            t()?.error(msg);
            return { error: msg };
          }
          const r = interpretarResultadoTransformacion(data);
          if (!r.replay) {
            await log('Transformar', 'Producción',
              `${r.folio} — ${r.inputCantidad}× ${r.inputSku} → ${r.outputCantidad}× ${r.outputSku} (merma ${r.merma})`);
          }
          rf();
          return r;
        } catch (e) {
          console.error('[addTransformacion] excepción:', e);
          const msg = mensajeErrorProduccion(e);
          t()?.error(msg);
          return { error: msg };
        }
      },

      // ── CUARTOS FRÍOS — CRUD ──
      // cuartos_frios.id es TEXT (ver migración 023). No tiene auto-increment
      // ni default, así que el id se genera client-side con patrón "CF-N"
      // tomando el siguiente número libre desde los existentes.
      addCuartoFrio: async (cf) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          const { data: existentes, error: errSel } = await supabase
            .from('cuartos_frios')
            .select('id');
          if (errSel) {
            t()?.error('Error al leer cuartos fríos existentes');
            return errSel;
          }
          let max = 0;
          for (const e of (existentes || [])) {
            const m = String(e?.id || '').match(/^CF-(\d+)$/i);
            if (m) max = Math.max(max, parseInt(m[1], 10));
          }
          const newId = `CF-${max + 1}`;

          const { error } = await supabase.from('cuartos_frios').insert({
            id: newId,
            nombre: cf.nombre,
            temp: cf.temp,
            capacidad_tarimas: Number(cf.capacidad_tarimas) || 0,
            stock: {},
          });
          if (error) {
            console.warn('[addCuartoFrio] insert:', error.message);
            t()?.error(error.message || 'Error al crear cuarto frío');
            return error;
          }
          log('Crear', 'Cuartos Fríos', `${newId} — ${cf.nombre}`);
          rf();
        } catch (e) {
          console.error('[addCuartoFrio] excepción:', e);
          t()?.error('Error inesperado al crear cuarto frío');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      updateCuartoFrio: async (id, cf) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        const update = {};
        if (cf.nombre    !== undefined) update.nombre    = cf.nombre;
        if (cf.temp      !== undefined) update.temp      = cf.temp;
        if (cf.capacidad_tarimas !== undefined) update.capacidad_tarimas = Number(cf.capacidad_tarimas) || 0;
        const { error } = await supabase.from('cuartos_frios').update(update).eq('id', id);
        if (error) { t()?.error('Error al actualizar cuarto frío'); return error; }
        log('Editar', 'Cuartos Fríos', `ID ${id}`);
        rf();
      },

      // Orden manual de las tarjetas: recibe los ids en el orden deseado y numera 1..N.
      ordenarCuartosFrios: async (ids) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        for (let i = 0; i < ids.length; i++) {
          const { error } = await supabase.from('cuartos_frios').update({ orden: i + 1 }).eq('id', ids[i]);
          if (error) { t()?.error('No se pudo guardar el orden de los cuartos'); rf(); return error; }
        }
        log('Editar', 'Cuartos Fríos', `Orden: ${ids.join(', ')}`);
        rf();
      },

      // Bloquea DELETE si el cuarto tiene stock asociado para evitar pérdida
      // silenciosa de inventario. El admin debe vaciar/trasladar el stock primero.
      deleteCuartoFrio: async (id) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          if (!id) return { error: 'Cuarto frío requerido' };

          const { data: cf, error: errSel } = await supabase
            .from('cuartos_frios')
            .select('id, nombre, stock')
            .eq('id', id)
            .single();
          if (errSel || !cf) {
            const msg = errSel?.message || 'Cuarto frío no encontrado';
            t()?.error(msg);
            return { error: msg };
          }

          const stock = (cf.stock && typeof cf.stock === 'object') ? cf.stock : {};
          const totalStock = Object.values(stock).reduce((acc, v) => acc + (Number(v) || 0), 0);
          if (totalStock > 0) {
            const skusConStock = Object.entries(stock)
              .filter(([, v]) => Number(v) > 0)
              .map(([sku, v]) => `${v}× ${sku}`)
              .join(', ');
            const msg = `Tiene stock asociado (${skusConStock}). Vacíalo o trasládalo a otro cuarto primero.`;
            t()?.error(msg);
            return { error: msg };
          }

          const { error } = await supabase.from('cuartos_frios').delete().eq('id', id);
          if (error) {
            const msg = error.code === '23503'
              ? 'No se puede eliminar — el cuarto tiene movimientos o relaciones asociadas.'
              : (error.message || 'Error al eliminar cuarto frío');
            t()?.error(msg);
            return { error: msg };
          }
          log('Eliminar', 'Cuartos Fríos', `ID ${id} (${s(cf.nombre)})`);
          rf();
          return undefined;
        } catch (e) {
          const msg = e?.message || 'Error inesperado al eliminar cuarto frío';
          t()?.error(msg);
          return { error: msg };
        }
      },

      // ── CUARTOS FRÍOS — STOCK (JSONB) ──
      sacarDeCuartoFrio: async (cfId, sku, cantidad, motivo, opciones = {}) => {
        // R2 fase 2A (084): salida manual vía salida_cuarto_manual. El servidor
        // valida cuarto, SKU, cantidad, stock y motivo (rechaza motivos de
        // carga a ruta: eso lo firma confirmar_carga_ruta). Sin RPC genérico.
        // opciones: { operacionId }
        const guard = requireRol(['Admin', 'Producción']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          const built = buildSalidaManualArgs({
            operacionId: opciones.operacionId || nuevoOperacionId(),
            cuartoId: cfId,
            sku,
            cantidad,
            motivo,
          });
          if (built.error) { t()?.error(built.error); return { error: built.error, message: built.error }; }

          const { data, error } = await supabase.rpc('salida_cuarto_manual', built.args);
          if (error) {
            const msg = mensajeErrorStock(error);
            console.warn('[sacarDeCuartoFrio] rpc salida_cuarto_manual:', error.message);
            t()?.error(msg);
            return { error: msg, message: msg };
          }
          const res = interpretarResultadoStock(data);
          if (!res.replay) log('Salida CF', 'Cuartos Fríos', `${built.args.p_cantidad}×${built.args.p_sku} de ${built.args.p_cuarto_id} — ${built.args.p_motivo}`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[sacarDeCuartoFrio] excepción:', e);
          t()?.error('Error inesperado al sacar del cuarto frío');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      traspasoEntreUbicaciones: async ({ origen, destino, sku, cantidad, operacionId } = {}, opciones = {}) => {
        // R2 fase 2A (084): traspaso_cuartos mueve origen − / destino + con dos
        // filas de kardex bajo UNA operación, en una transacción del servidor.
        // El cliente ya no muta cuartos por separado ni usa el RPC genérico.
        const guard = requireRol(['Admin', 'Producción']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          const built = buildTraspasoArgs({
            operacionId: operacionId || opciones.operacionId || nuevoOperacionId(),
            origen,
            destino,
            sku,
            cantidad,
          });
          if (built.error) { t()?.error(built.error); return { error: built.error, message: built.error }; }

          const { data, error } = await supabase.rpc('traspaso_cuartos', built.args);
          if (error) {
            const msg = mensajeErrorStock(error);
            console.warn('[traspasoEntreUbicaciones] rpc traspaso_cuartos:', error.message);
            t()?.error(msg);
            return { error: msg, message: msg };
          }
          const res = interpretarResultadoStock(data);
          if (!res.replay) log('Traspaso', 'Cuartos Fríos', `${built.args.p_cantidad}×${built.args.p_sku} de ${built.args.p_origen} → ${built.args.p_destino}`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[traspasoEntreUbicaciones] excepción:', e);
          t()?.error('Error inesperado en traspaso');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // 102: ajuste por conteo físico de UN SKU en UN cuarto
      // (ajustar_existencia_cuarto). Se manda la existencia contada; el
      // servidor bloquea el cuarto, calcula el delta, deja kardex
      // (ajuste_cuarto/<op>) y auditoría. Sin efecto financiero. Idempotente
      // por operación (el UUID lo conserva la vista entre reintentos).
      ajustarExistenciaCuarto: async ({ operacionId, cuartoId, sku, existencia, motivo } = {}) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        const built = buildAjusteCuartoArgs({ operacionId: operacionId || nuevoOperacionId(), cuartoId, sku, existencia, motivo });
        if (built.error) { t()?.error(built.error); return { error: built.error, message: built.error }; }
        const { data, error } = await supabase.rpc('ajustar_existencia_cuarto', built.args);
        if (error) {
          console.warn('[ajustarExistenciaCuarto] rpc:', error.message);
          const msg = mensajeErrorStock(error);
          t()?.error(msg);
          return { error: msg, message: msg };
        }
        rf();
        return { data };
      },

      // 093: ajuste manual por contrato del servidor (ajustar_existencia):
      // Admin, motivo obligatorio, el servidor lee la existencia actual con
      // bloqueo, calcula el delta, no permite negativos, deja kardex con el
      // actor canónico y es idempotente por operación. Para producto
      // terminado ajusta los cuartos fríos; para insumos, el total.
      // 108: el empaque solo se ajusta a la baja (entra por recepción de compra).
      ajustarExistenciaManual: async ({ sku, nuevaExistencia, motivo, operacionId } = {}) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        const target = Number(nuevaExistencia);
        const motivoTxt = s(motivo).trim();
        if (!sku || !Number.isInteger(target) || target < 0 || !motivoTxt) {
          const err = { message: 'Datos de ajuste inválidos (existencia entera ≥ 0 y motivo)' };
          t()?.error(err.message);
          return err;
        }
        const { error } = await supabase.rpc('ajustar_existencia', {
          p_operacion_id: operacionId || nuevoOperacionId(),
          p_sku: String(sku),
          p_nueva_existencia: target,
          p_motivo: motivoTxt,
        });
        if (error) { t()?.error(mensajeErrorEmpaque(error, error.message || 'No se pudo ajustar la existencia')); return error; }
        rf();
      },

      // ── RUTAS ──
      addRuta: async (r) => {
        const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_r_seq' });
        const folio = `R-${String(seq || 13).padStart(3, '0')}`;
        const hoy = new Date().toISOString();
        const cargaObj = r.carga || {};

        const { data: newRuta, error } = await supabase.from('rutas').insert({
          folio,
          nombre: r.nombre,
          chofer_id: r.choferId || null,
          ayudante_id: r.ayudanteId || null,
          camion_id: r.camionId || null,
          estatus: 'Programada',
          carga: cargaObj,                     // JSONB: {"HC-25K": 50, ...}
          carga_autorizada: r.cargaAutorizada || cargaObj,
          extra_autorizado: r.extraAutorizado || {},
          clientes_asignados: r.clientesAsignados || [],  // [{clienteId, orden}]
          autorizado_at: hoy,
        }).select('id').single();
        if (error) {
          // Tanda 6 🟢-6: traducir violación del UNIQUE de camión activo.
          const camionMsg = traducirErrorCamionRutaActiva(error);
          if (camionMsg) {
            t()?.error(camionMsg);
            return { error: camionMsg };
          }
          t()?.error('Error al crear ruta');
          return error;
        }

        // Fase 18: ya NO se descuenta inventario al autorizar.
        // El descuento ocurre cuando el chofer confirma carga (confirmarCargaRuta).

        // Log con detalle de carga autorizada
        const cargaTxt = Object.entries(cargaObj).map(([sku, qty]) => `${qty}×${sku}`).join(', ') || '—';
        log('Autorizar', 'Rutas', `${folio} — ${r.nombre} — Autorizado: ${cargaTxt}`);
        rf();
        return { id: newRuta?.id, folio };
      },

      solicitarFirmaCarga: async (rutaId, cargaReal) => {
        // El chofer marca su carga real y solicita firma. La ruta queda en
        // 'Pendiente firma'. NO descuenta inventario aún. Eso lo hace firmarCarga.
        const inputErr = validateConfirmarCarga(rutaId, cargaReal);
        if (inputErr) {
          t()?.error('Datos de carga inválidos');
          return new Error('Datos inválidos');
        }

        const { data: ruta, error: rutaErr } = await supabase
          .from('rutas')
          .select('id, folio, estatus, carga_autorizada, extra_autorizado, carga_confirmada_at')
          .eq('id', rutaId)
          .single();
        if (rutaErr || !ruta) {
          t()?.error('Ruta no encontrada');
          return rutaErr || new Error('Ruta no encontrada');
        }
        if (ruta.carga_confirmada_at) {
          t()?.error('Esta ruta ya tiene carga confirmada');
          return new Error('Carga ya confirmada');
        }

        // Validar que cargaReal no excede autorizado + extra
        const exceso = excedeAutorizacion(cargaReal, ruta.carga_autorizada, ruta.extra_autorizado);
        if (exceso) {
          t()?.error(`No puedes cargar ${exceso.qty} de ${exceso.sku}. Máximo: ${exceso.max}`);
          return new Error(`Excede autorización: ${exceso.sku}`);
        }

        // Guardar carga real + cambiar estatus + timestamp de solicitud
        const { error: updErr } = await supabase.from('rutas').update({
          carga_real: cargaReal,
          estatus: 'Pendiente firma',
          carga_solicitada_at: new Date().toISOString(),
        }).eq('id', rutaId);
        if (updErr) {
          t()?.error('No se pudo solicitar firma');
          return updErr;
        }

        const cargaTxt = Object.entries(cargaReal).map(([sku, qty]) => `${qty}×${sku}`).join(', ');
        await log('Solicitar firma', 'Rutas', `${ruta.folio} — ${cargaTxt}`);
        rf();
        return null;
      },

      firmarCarga: async (rutaId, firmaBase64, opciones = {}) => {
        // R2 fase 2A (084): un solo contrato del servidor hace TODO — valida
        // ruta/estado/autorización, asigna cuartos (FIFO por id), descuenta,
        // escribe kardex estructurado, firma y pasa a Cargada en UNA
        // transacción. El firmante es el actor autenticado (Chofer dueño en su
        // celular, o Producción/Admin en su propio dispositivo). Sin cálculo de
        // cuartos en el cliente, sin UPDATE directo de rutas, sin RPC genérico
        // y sin compensación: un error significa que no se aplicó nada.
        // opciones: { excepcion, motivoExcepcion, operacionId }
        const inputErr = validateFirmarCarga(rutaId, firmaBase64, opciones);
        if (inputErr) {
          if (inputErr.error === 'Sin ruta') t()?.error('Ruta inválida');
          else if (inputErr.error === 'Sin firma') t()?.error('Firma requerida');
          else if (inputErr.error === 'Sin justificación') t()?.error('Justificación requerida para carga sin firma');
          return new Error(inputErr.error);
        }
        const built = buildConfirmarCargaArgs({
          operacionId: opciones.operacionId || nuevoOperacionId(),
          rutaId,
          firma: firmaBase64,
          excepcion: opciones.excepcion === true,
          motivo: opciones.motivoExcepcion,
        });
        if (built.error) { t()?.error(built.error); return new Error(built.error); }

        const { data, error } = await supabase.rpc('confirmar_carga_ruta', built.args);
        if (error) {
          const msg = mensajeErrorStock(error);
          t()?.error(msg);
          return { error: msg, message: msg, code: error.code };
        }
        const res = interpretarResultadoStock(data);
        const cargaSkus = Object.keys(res.carga || {});
        if (cargaSkus.length > 0) await checkStockBajo(cargaSkus);
        if (!res.replay) {
          const tipo = res.excepcion ? 'Carga sin firma' : 'Firma carga';
          const detalle = res.excepcion
            ? `${res.folio || rutaId} — Excepción: ${s(opciones.motivoExcepcion)}`
            : `${res.folio || rutaId} — Firmado`;
          await log(tipo, 'Rutas', detalle);
        }
        rf();
        return null;
      },

      updateRutaEstatus: async (id, est) => {
        const { error } = await supabase.from('rutas').update({ estatus: est }).eq('id', id);
        if (error) { t()?.error('Error al actualizar ruta'); return error; }
        log('Cambiar estatus', 'Rutas', `Ruta #${id} → ${est}`);
        rf();
      },

      updateRuta: async (id, r) => {
        // Bloquear edición si la ruta ya está en estado terminal (mig 057
        // + auditoría rutas Bloque 1 — 🟡-4). Editar carga/chofer/camión
        // de una ruta cerrada corrompe reportes históricos.
        const { data: current, error: errSel } = await supabase
          .from('rutas').select('estatus').eq('id', id).maybeSingle();
        if (errSel) {
          t()?.error('No se pudo leer la ruta');
          return { error: errSel.message };
        }
        const edicionErr = validateEdicionRuta(current?.estatus);
        if (edicionErr) {
          t()?.error(edicionErr.error);
          return edicionErr;
        }

        const update = {};
        if (r.nombre    !== undefined) update.nombre    = r.nombre;
        if (r.choferId  !== undefined) update.chofer_id = r.choferId;
        if (r.chofer_id !== undefined) update.chofer_id = r.chofer_id;
        if (r.ayudanteId !== undefined) update.ayudante_id = r.ayudanteId || null;
        if (r.camionId   !== undefined) update.camion_id   = r.camionId || null;
        if (r.estatus   !== undefined) update.estatus   = r.estatus;
        if (r.carga     !== undefined) update.carga     = r.carga;
        if (r.cargaAutorizada !== undefined) update.carga_autorizada = r.cargaAutorizada;
        if (r.extraAutorizado !== undefined) update.extra_autorizado = r.extraAutorizado;
        if (r.clientesAsignados !== undefined) update.clientes_asignados = r.clientesAsignados;
        const { error } = await supabase.from('rutas').update(update).eq('id', id);
        if (error) {
          // Tanda 6 🟢-6: traducir violación del UNIQUE de camión activo.
          const camionMsg = traducirErrorCamionRutaActiva(error);
          if (camionMsg) {
            t()?.error(camionMsg);
            return { error: camionMsg };
          }
          t()?.error('Error al actualizar ruta');
          return error;
        }
        log('Editar', 'Rutas', `Ruta #${id}`);
        rf();
      },

      deleteRuta: async (id) => {
        // 🟡-5 Tanda 3: solo Admin, solo Programada, solo sin órdenes.
        // Para rutas con carga confirmada (Cargada/En progreso/Pendiente
        // firma) admin debe usar cancelarRutaConDevolucion para que el
        // stock vuelva al cuarto y las órdenes se liberen.
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }

        try {
          if (!id) return { error: 'Ruta requerida' };

          const { data: ruta, error: errRuta } = await supabase
            .from('rutas')
            .select('id, folio, estatus')
            .eq('id', id)
            .maybeSingle();
          if (errRuta) {
            console.warn('[deleteRuta] select:', errRuta.message);
            t()?.error('No se pudo leer la ruta');
            return { error: errRuta.message };
          }
          if (!ruta) return { error: 'Ruta no encontrada' };

          if (ruta.estatus !== 'Programada') {
            const msg = `Solo se pueden eliminar rutas en estatus Programada (actual: ${ruta.estatus}). Para rutas con carga, usa Cancelar.`;
            t()?.error(msg);
            return { error: msg };
          }

          const { count, error: errCount } = await supabase
            .from('ordenes')
            .select('id', { count: 'exact', head: true })
            .eq('ruta_id', id);
          if (errCount) {
            console.warn('[deleteRuta] count ordenes:', errCount.message);
            t()?.error('No se pudieron contar las órdenes asignadas');
            return { error: errCount.message };
          }
          if ((count || 0) > 0) {
            const msg = `La ruta tiene ${count} ${count === 1 ? 'orden asignada' : 'órdenes asignadas'}. Quítalas primero o cancela la ruta.`;
            t()?.error(msg);
            return { error: msg };
          }

          const { error } = await supabase.from('rutas').delete().eq('id', id);
          if (error) { t()?.error('Error al eliminar ruta'); return { error: error.message }; }
          await log('Eliminar', 'Rutas', `${ruta.folio} (ID ${id})`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[deleteRuta] excepción:', e);
          t()?.error('Error inesperado al eliminar ruta');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      asignarOrdenesARuta: async (rutaId, ordenIds, totalBolsas) => {
        // RPC atómica (mig 057): valida ruta + cada orden, hace UPDATE de
        // ruta_id+estatus en una sola transacción, recalcula carga JSONB.
        // Reemplaza el patrón de 3 UPDATEs secuenciales sin transacción
        // que dejaba órdenes con ruta_id pero estatus='Creada' si la red
        // fallaba a la mitad (bug histórico OV-0078).
        try {
          if (!rutaId) return { error: 'Ruta requerida' };
          if (!Array.isArray(ordenIds) || ordenIds.length === 0) {
            return { error: 'Sin órdenes para asignar' };
          }

          const idsNum = ordenIds.map(o => Number(o)).filter(Number.isFinite);
          const { data: result, error: rpcErr } = await supabase.rpc('asignar_ordenes_a_ruta', {
            p_ruta_id: Number(rutaId),
            p_orden_ids: idsNum,
          });
          if (rpcErr) {
            console.warn('[asignarOrdenesARuta] rpc:', rpcErr.message);
            t()?.error(rpcErr.message || 'No se pudieron asignar las órdenes');
            return { error: rpcErr.message };
          }

          const carga = (result && result.carga && typeof result.carga === 'object') ? result.carga : {};
          const cargaTxt = Object.entries(carga).map(([sku, qty]) => `${qty}×${sku}`).join(', ') || `${totalBolsas || 0} bolsas`;
          await log('Asignar órdenes', 'Rutas', `Ruta #${rutaId} — ${ordenIds.length} órdenes — ${cargaTxt}`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[asignarOrdenesARuta] excepción:', e);
          t()?.error('Error inesperado al asignar órdenes');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // 087: cierre de ruta por Admin = el MISMO contrato canónico que el
      // chofer. El conteo físico es observación; el servidor valida contra el
      // balance del camión, devuelve a los cuartos de origen y cierra. Ya no
      // existe devolución arbitraria (cerrar_ruta_atomic retirada).
      cerrarRuta: async (rutaId, conteo, opciones = {}) => {
        const forzar = opciones?.forzar === true;
        const motivoForzado = String(opciones?.motivo || '').trim();
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }

        // Órdenes sin resolver: bloquean el cierre salvo cierre forzado con
        // motivo (chofer sin celular, accidente). Forzado → 'No entregada'
        // sin movimiento de stock: el producto se resuelve en el conteo.
        const { data: pendientes, error: errPend } = await supabase
          .from('ordenes')
          .select('id, folio, estatus')
          .eq('ruta_id', rutaId)
          .in('estatus', ['Asignada', 'En ruta']);
        if (errPend) {
          console.warn('[cerrarRuta] select pendientes:', errPend.message);
          t()?.error('No se pudieron leer las órdenes de la ruta');
          return { error: errPend.message };
        }
        if (pendientes && pendientes.length > 0 && !forzar) {
          const folios = pendientes.slice(0, 3).map(o => o.folio).join(', ');
          const extra = pendientes.length > 3 ? `, +${pendientes.length - 3} más` : '';
          const msg = `Hay ${pendientes.length} ${pendientes.length === 1 ? 'orden pendiente' : 'órdenes pendientes'} de entregar (${folios}${extra}). Pídele al chofer que envíe su reporte primero.`;
          t()?.error(msg);
          return { error: msg, pendientes: pendientes.length };
        }
        if (forzar && pendientes && pendientes.length > 0 && !motivoForzado) {
          return { error: 'Forzar cierre requiere motivo (chofer sin celular, accidente, etc.)' };
        }
        let pendientesProcesadas = 0;
        if (forzar && pendientes && pendientes.length > 0) {
          const ids = pendientes.map(o => o.id);
          const { error: updErr } = await supabase
            .from('ordenes')
            .update({
              estatus: 'No entregada',
              motivo_no_entrega: `Cierre forzado por admin: ${motivoForzado}`,
              fecha_no_entrega: new Date().toISOString(),
            })
            .in('id', ids);
          if (updErr) {
            console.warn('[cerrarRuta forzado] update ordenes No entregada:', updErr.message);
            t()?.error('No se pudieron marcar las órdenes pendientes');
            return { error: updErr.message };
          }
          pendientesProcesadas = ids.length;
        }

        // Cierre financiero (086): si el chofer ya lo registró, el servidor lo
        // reconoce (replay o "ya registrado con otros datos"); si no, Admin lo
        // registra sin entregas.
        const storage = typeof localStorage !== 'undefined' ? localStorage : null;
        const opFin = resolverOperacionCierre(leerOperacionCierre(storage, rutaId), claveCierreFinanciero(rutaId, []));
        guardarOperacionCierre(storage, rutaId, opFin);
        const builtFin = buildCerrarFinancieroArgs({ operacionId: opFin.id, rutaId, entregas: [], usuarioId: uid(), usuarioNombre: uname() || 'Admin' });
        if (builtFin.error) { t()?.error(builtFin.error); return { error: builtFin.error }; }
        const { error: finErr } = await supabase.rpc('cerrar_ruta_financiero', builtFin.args);
        if (finErr && !/ya tiene cierre financiero registrado/i.test(finErr.message || '')) {
          const msg = mensajeErrorCierreFinanciero(finErr);
          t()?.error(msg);
          return { error: msg };
        }

        const r = await actionsRef.current.finalizarInventarioRuta(rutaId, conteo, {
          admin: true,
          detalle: forzar ? `FORZADO (${motivoForzado}) — ${pendientesProcesadas} órdenes a No entregada` : '',
        });
        if (r?.error) { t()?.error(r.error); return r; }
        return undefined;
      },

      // Cancelar una ruta. 087: una ruta con carga confirmada ya no se
      // cancela con devolución genérica (devolvía toda la carga_real aunque
      // hubiera entregas): su inventario se resuelve cerrándola con el conteo
      // canónico (finalizar_inventario_ruta devuelve a los cuartos de origen).
      // Rutas nunca cargadas: se cancelan sin movimiento de stock y sus
      // órdenes Asignadas se liberan a Creada.
      cancelarRutaConDevolucion: async (rutaId, motivo) => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          if (!rutaId) return { error: 'Ruta requerida' };
          const motivoTxt = String(motivo || '').trim();
          if (!motivoTxt) return { error: 'Motivo requerido' };

          const { data: ruta, error: errRuta } = await supabase
            .from('rutas')
            .select('id, folio, estatus, carga_confirmada_at')
            .eq('id', rutaId)
            .maybeSingle();
          if (errRuta) {
            console.warn('[cancelarRutaConDevolucion] select ruta:', errRuta.message);
            t()?.error('No se pudo leer la ruta');
            return { error: errRuta.message };
          }
          if (!ruta) return { error: 'Ruta no encontrada' };

          const validResult = validateCancelacionRuta(ruta);
          if (validResult.error) {
            t()?.error(validResult.error);
            return { error: validResult.error };
          }
          if (ruta.carga_confirmada_at) {
            const msg = 'La ruta ya tiene carga confirmada: ciérrala con el conteo de devolución (el producto vuelve al cuarto de origen).';
            t()?.error(msg);
            return { error: msg };
          }

          const { error: errUpd } = await supabase
            .from('rutas')
            .update({
              estatus: 'Cancelada',
              cancelada_at: new Date().toISOString(),
              motivo_cancelacion: motivoTxt,
            })
            .eq('id', rutaId);
          if (errUpd) {
            console.warn('[cancelarRutaConDevolucion] update ruta:', errUpd.message);
            t()?.error('No se pudo marcar la ruta como cancelada');
            return { error: errUpd.message };
          }

          const { error: errOrd, count: liberadas } = await supabase
            .from('ordenes')
            .update({ estatus: 'Creada', ruta_id: null }, { count: 'exact' })
            .eq('ruta_id', rutaId)
            .eq('estatus', 'Asignada');
          if (errOrd) {
            console.warn('[cancelarRutaConDevolucion] liberar órdenes (no crítico):', errOrd.message);
            notify('advertencia', 'Órdenes pendientes de liberar',
              `Ruta ${ruta.folio} cancelada, pero algunas órdenes Asignadas no se liberaron. Revísalas.`,
              '⚠️', String(rutaId));
          }

          await log('Cancelar', 'Rutas',
            `${ruta.folio} — Motivo: ${motivoTxt} — ${liberadas || 0} órdenes liberadas`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[cancelarRutaConDevolucion] excepción:', e);
          t()?.error('Error inesperado al cancelar ruta');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── CAMIONES ──
      addCamion: async (c) => {
        const { error } = await supabase.from('camiones').insert({
          nombre: c.nombre, placas: c.placas || '', modelo: c.modelo || '', estatus: 'Activo',
        });
        if (error) { t()?.error('Error al crear camión'); return error; }
        log('Crear', 'Camiones', c.nombre);
        rf();
      },
      updateCamion: async (id, c) => {
        const { error } = await supabase.from('camiones').update(c).eq('id', id);
        if (error) { t()?.error('Error al actualizar camión'); return error; }
        log('Editar', 'Camiones', `#${id}`);
        rf();
      },

      // ── FACTURACIÓN ──
      crearCheckoutPago: async (ordenId, provider = 'stripe') => {
        try {
          const { data: orden, error: ordenError } = await supabase
            .from('ordenes')
            .select('id, folio, total, cliente_id, cliente_nombre, productos')
            .eq('id', ordenId)
            .single();
          if (ordenError || !orden) {
            t()?.error('Orden no encontrada');
            return { error: ordenError?.message || 'Orden no encontrada' };
          }

          // P0: el backend lee monto, líneas, moneda y email desde la BD.
          // El frontend solo referencia la orden.
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const payload = await backendPost('billing-create-checkout', {
            provider,
            ordenId: orden.id,
            successUrl: origin ? `${origin}/pago-resultado?status=success&folio=${encodeURIComponent(orden.folio)}` : undefined,
            cancelUrl: origin ? `${origin}/pago-resultado?status=cancel&folio=${encodeURIComponent(orden.folio)}` : undefined,
          });
          log('Checkout', 'Pagos', `${orden.folio} — ${provider}`);
          // Add short URL for sharing
          const shortUrl = origin ? `${origin}/pagar/${orden.id}` : null;
          return { ...payload, shortUrl, folio: orden.folio, clienteNombre: orden.cliente_nombre };
        } catch (error) {
          t()?.error('Error al generar checkout: ' + (error.message || error));
          return { error: error.message || 'Error desconocido' };
        }
      },

      timbrar: async (folio) => {
        try {
          await backendPost('billing-create-invoice', { folio });
        } catch (error) {
          console.error('[timbrar]', error.message);
          t()?.error('Error al timbrar orden: ' + error.message);
          return error;
        }
        // Backend already updates estatus to 'Facturada' and saves facturama_id
        log('Timbrar', 'Facturación', `${folio}`);
        notify('factura', 'Factura timbrada', `CFDI generado para ${folio}`, '📄', folio);
        rf();
      },

      // Tanda 5: cancela un CFDI ya timbrado ante el SAT vía Facturama.
      // Backend valida auth + idempotency + revierte estatus a Entregada.
      cancelarCFDI: async ({ ordenId, motivo, motivoDetalle, uuidSustituto }) => {
        const orden = (data.ordenes || []).find(o => o.id === ordenId);
        const valid = validateCancelacionCFDI({ orden, motivo, uuidSustituto });
        if (valid?.error) {
          t()?.error(valid.error);
          return { error: valid.error };
        }
        try {
          const resp = await backendPost('billing-cancel-invoice', {
            ordenId,
            motivo,
            motivoDetalle: motivoDetalle || null,
            uuidSustituto: uuidSustituto || null,
          });
          // OL-03B: una cancelación SOLICITADA (pendiente del SAT) no es una
          // cancelación: el CFDI sigue vigente y la orden sigue Facturada.
          if (resp?.pending) {
            t()?.info('Cancelación solicitada al SAT; el CFDI sigue vigente hasta que se confirme');
            log('Solicitar cancelación CFDI', 'Facturación', `Orden ${ordenId} — motivo ${motivo} (pendiente)`);
            rf();
            return undefined;
          }
          if (resp?.alreadyCancelled) {
            t()?.info('El CFDI ya estaba cancelado');
          } else {
            t()?.success(`CFDI cancelado (motivo ${motivo})`);
          }
          log('Cancelar CFDI', 'Facturación', `Orden ${ordenId} — motivo ${motivo}`);
          notify('factura_cancelada', 'CFDI cancelado', `Cancelación SAT motivo ${motivo} para ${s(orden?.folio)}`, '🗑️', String(ordenId));
          rf();
          return undefined;
        } catch (err) {
          const msg = err?.message || 'Error al cancelar CFDI';
          t()?.error(msg);
          return err;
        }
      },

      // OL-04: el complemento se emite POR PAGO; el servidor toma montos, saldos,
      // fecha, forma de pago y parcialidad del renglón de pagos (sin cifras del cliente).
      emitirComplemento: async (pagoId) => {
        try {
          const resp = await backendPost('billing-create-complemento', { pagoId });
          if (resp?.alreadyIssued) {
            t()?.info('Ese pago ya tiene su complemento emitido');
          } else {
            t()?.success(`Complemento de pago emitido (parcialidad ${resp?.parcialidad ?? ''})`);
            notify('complemento', 'Complemento generado', `Complemento de pago del pago #${pagoId}`, '📎', String(pagoId));
            log('Complemento', 'Facturación', `Pago ${pagoId}`);
          }
          rf();
          return undefined;
        } catch (err) {
          t()?.error(err?.message || 'Error al generar el complemento');
          rf();
          return err;
        }
      },

      // ── NOTIFICACIONES ──
      marcarNotifLeida: async (id) => {
        await supabase.from('notificaciones').update({ leida: true }).eq('id', id);
        rf();
      },
      marcarTodasLeidas: async () => {
        await supabase.from('notificaciones').update({ leida: true }).eq('leida', false);
        rf();
      },

      // ── PAGOS ──

      // Cobrar contra una cuenta por cobrar específica
      cobrarCxC: async (cxcId, monto, metodoPago, referencia) => {
        const montoNum = centavos(n(monto));

        const { data: cxc, error: e1 } = await supabase
          .from('cuentas_por_cobrar')
          .select('id, orden_id, cliente_id, concepto, saldo_pendiente, estatus')
          .eq('id', cxcId)
          .single();
        if (e1 || !cxc) { t()?.error('Cuenta por cobrar no encontrada'); return e1; }
        if (cxc.estatus === 'Pagada') { t()?.error('Esta cuenta ya fue liquidada'); return; }

        // P1 Fase A: abono por contrato atómico (valida monto <= saldo,
        // inserta pago + ingreso Cobranza y ajusta el saldo del cliente en
        // una sola transacción; sin compensaciones por DELETE).
        const { data: abono, error: abonoErr } = await supabase.rpc('abonar_cxc', {
          p_cxc_id: cxcId,
          p_monto: montoNum,
          p_metodo: metodoPago || 'Efectivo',
          p_referencia: referencia || null,
          p_usuario_id: uid(),
        });
        if (abonoErr) {
          t()?.error(abonoErr.message || 'Error al registrar el abono');
          return abonoErr;
        }
        const nuevoEstatus = s(abono?.estatus) || 'Parcial';

        // Generar Complemento de Pago (CFDI tipo P) automáticamente si la orden tiene factura PPD timbrada
        if (cxc.orden_id) {
          const { data: ordenFacturada } = await supabase
            .from('ordenes')
            .select('facturama_uuid, metodo_pago, folio')
            .eq('id', cxc.orden_id)
            .maybeSingle();
          const esPPD = s(ordenFacturada?.metodo_pago).toLowerCase().includes('crédito');
          // OL-04: solo el identificador del pago; el servidor decide si aplica
          // (factura vigente PPD) y arma el complemento con los datos del pago.
          if (ordenFacturada?.facturama_uuid && esPPD && abono?.pago_id) {
            try {
              const comp = await backendPost('billing-create-complemento', { pagoId: abono.pago_id });
              if (!comp?.alreadyIssued) {
                notify('complemento', 'Complemento generado', `Complemento de pago automático para ${s(ordenFacturada.folio)}`, '📎', String(cxc.orden_id));
                t()?.success('Complemento de pago generado automáticamente');
              }
            } catch (compErr) {
              // El cobro ya se registró — notificamos el fallo para reintento manual
              notify('complemento_error', 'Error en complemento', `No se pudo generar complemento para ${s(ordenFacturada.folio)}: ${compErr.message || 'Error desconocido'}`, '⚠️', String(cxc.orden_id));
              t()?.error('Cobro registrado, pero falló el complemento. Puede reintentarse desde Facturación.');
            }
          }
        }

        log('Cobrar', 'Cuentas por Cobrar', `CxC #${cxcId} — $${monto} — ${nuevoEstatus}`);
        notify('cobro', 'Cobro registrado', `$${n(monto).toLocaleString()} cobrado — ${nuevoEstatus}`, '💰', String(cxcId));
        rf();
      },

      // ── MOVIMIENTOS CONTABLES ──
      addMovContable: async (m) => {
        const { error } = await supabase.from('movimientos_contables').insert({
          fecha: m.fecha, tipo: m.tipo, categoria: m.categoria,
          concepto: m.concepto, monto: centavos(m.monto),
        });
        if (error) { t()?.error('Error al guardar movimiento contable'); return error; }
        log('Registrar', 'Contabilidad', `${m.tipo}: ${m.concepto} — $${m.monto}`);
        rf();
      },

      updateMovContable: async (id, m) => {
        const { error } = await supabase.from('movimientos_contables').update({
          fecha: m.fecha, tipo: m.tipo, categoria: m.categoria,
          concepto: m.concepto, monto: centavos(m.monto),
        }).eq('id', id);
        if (error) { t()?.error('Error al actualizar movimiento'); return error; }
        log('Editar', 'Contabilidad', `ID ${id} — ${m.concepto}`);
        rf();
      },

      deleteMovContable: async (id) => {
        const { error } = await supabase.from('movimientos_contables').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar movimiento'); return error; }
        log('Eliminar', 'Contabilidad', `ID ${id}`);
        rf();
      },

      // ── COSTOS FIJOS ──
      addCostoFijo: async (c) => {
        const { error } = await supabase.from('costos_fijos').insert({
          nombre: c.nombre,
          categoria: c.categoria || 'Operación',
          monto: centavos(c.monto),
          frecuencia: c.frecuencia || 'Mensual',
          dia_cargo: c.diaCargo || 1,
          proveedor: c.proveedor || '',
          cuenta_pago: c.cuentaPago || '',
          notas: c.notas || '',
          activo: true,
        });
        if (error) { t()?.error('Error al crear costo fijo'); return error; }
        log('Crear', 'Costos', `${c.nombre} — $${c.monto} ${c.frecuencia}`);
        rf();
      },

      updateCostoFijo: async (id, c) => {
        const update = {};
        if (c.nombre !== undefined) update.nombre = c.nombre;
        if (c.categoria !== undefined) update.categoria = c.categoria;
        if (c.monto !== undefined) update.monto = centavos(c.monto);
        if (c.frecuencia !== undefined) update.frecuencia = c.frecuencia;
        if (c.diaCargo !== undefined) update.dia_cargo = c.diaCargo;
        if (c.proveedor !== undefined) update.proveedor = c.proveedor;
        if (c.cuentaPago !== undefined) update.cuenta_pago = c.cuentaPago;
        if (c.notas !== undefined) update.notas = c.notas;
        if (c.activo !== undefined) update.activo = c.activo;
        const { error } = await supabase.from('costos_fijos').update(update).eq('id', id);
        if (error) { t()?.error('Error al actualizar costo'); return error; }
        log('Editar', 'Costos', `ID ${id}`);
        rf();
      },

      deleteCostoFijo: async (id) => {
        const { error } = await supabase.from('costos_fijos').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar costo'); return error; }
        log('Eliminar', 'Costos', `ID ${id}`);
        rf();
      },

      // Aplicar costo fijo (genera egreso en movimientos_contables)
      // 098: la fecha la elige el usuario (se valida como DATE); sin fecha,
      // el día de negocio lo pone el servidor (fin_hoy()) y el costo usa la
      // misma fecha que devolvió el egreso.
      aplicarCostoFijo: async (costoFijoId, fecha, referencia) => {
        const fe = fechaElegida(fecha);
        if (fe.error) { t()?.error(fe.error); return { message: fe.error }; }

        // Buscar el costo
        const { data: costo } = await supabase.from('costos_fijos').select('*').eq('id', costoFijoId).single();
        if (!costo) { t()?.error('Costo no encontrado'); return { message: 'Costo no encontrado' }; }

        // Crear egreso en movimientos_contables
        const { data: movimiento, error: e1 } = await supabase.from('movimientos_contables').insert({
          ...(fe.fecha ? { fecha: fe.fecha } : {}),
          tipo: 'Egreso',
          categoria: costo.categoria,
          concepto: `${costo.nombre} (${costo.frecuencia})`,
          monto: centavos(costo.monto),
          referencia: referencia || '',
        }).select('id, fecha').single();
        if (e1) { t()?.error('Error al registrar egreso'); return e1; }

        // Registrar en historial
        await supabase.from('costos_historial').insert({
          costo_fijo_id: costoFijoId,
          tipo: 'Fijo',
          categoria: costo.categoria,
          concepto: costo.nombre,
          monto: centavos(costo.monto),
          ...camposFechaCosto(fe.fecha || movimiento?.fecha || null),
          referencia: referencia || '',
          movimiento_id: movimiento?.id,
        });

        t()?.success(`Gasto aplicado: ${costo.nombre}`);
        log('Aplicar', 'Costos', `${costo.nombre} — $${costo.monto}`);
        rf();
      },

      // Registrar costo variable (ej: compra de empaques, gastos puntuales)
      registrarCostoVariable: async (categoria, concepto, monto, referencia, fecha) => {
        const fe = fechaElegida(fecha);
        if (fe.error) { t()?.error(fe.error); return { message: fe.error }; }

        // Crear egreso
        const { data: movimiento, error: e1 } = await supabase.from('movimientos_contables').insert({
          ...(fe.fecha ? { fecha: fe.fecha } : {}),
          tipo: 'Egreso',
          categoria,
          concepto,
          monto: centavos(monto),
          referencia: referencia || '',
        }).select('id, fecha').single();
        if (e1) { t()?.error('Error al registrar gasto'); return e1; }

        // Registrar en historial
        await supabase.from('costos_historial').insert({
          tipo: 'Variable',
          categoria,
          concepto,
          monto: centavos(monto),
          ...camposFechaCosto(fe.fecha || movimiento?.fecha || null),
          referencia: referencia || '',
          movimiento_id: movimiento?.id,
        });

        log('Registrar', 'Costos', `Variable: ${concepto} — $${monto}`);
        rf();
      },

      // ── CUENTAS POR PAGAR (Proveedores) ──
      addCuentaPorPagar: async (cxp) => {
        const fe = fechaElegida(cxp.fechaEmision);
        if (fe.error) { t()?.error(fe.error); return { message: fe.error }; }
        const montoOriginal = centavos(n(cxp.montoOriginal || cxp.monto));
        const { error } = await supabase.from('cuentas_por_pagar').insert({
          proveedor: cxp.proveedor,
          concepto: cxp.concepto,
          monto_original: montoOriginal,
          monto_pagado: 0,
          saldo_pendiente: montoOriginal,
          ...(fe.fecha ? { fecha_emision: fe.fecha } : {}), // 098: sin fecha → fin_hoy() del servidor
          fecha_vencimiento: cxp.fechaVencimiento || null,
          categoria: cxp.categoria || 'Proveedores',
          referencia: cxp.referencia || '',
          notas: cxp.notas || '',
          estatus: 'Pendiente',
        });
        if (error) { 
          console.error('[addCuentaPorPagar]', error.message, error.code, error.details);
          t()?.error('Error al crear cuenta por pagar: ' + error.message); 
          return error; 
        }
        log('Crear', 'Cuentas por Pagar', `${cxp.proveedor} — $${montoOriginal}`);
        rf();
      },

      updateCuentaPorPagar: async (id, cxp) => {
        const update = {};
        if (cxp.proveedor !== undefined) update.proveedor = cxp.proveedor;
        if (cxp.concepto !== undefined) update.concepto = cxp.concepto;
        if (cxp.categoria !== undefined) update.categoria = cxp.categoria;
        if (cxp.referencia !== undefined) update.referencia = cxp.referencia;
        if (cxp.notas !== undefined) update.notas = cxp.notas;
        if (cxp.fechaVencimiento !== undefined) update.fecha_vencimiento = cxp.fechaVencimiento;
        const { error } = await supabase.from('cuentas_por_pagar').update(update).eq('id', id);
        if (error) { t()?.error('Error al actualizar cuenta'); return error; }
        log('Editar', 'Cuentas por Pagar', `ID ${id}`);
        rf();
      },

      deleteCuentaPorPagar: async (id) => {
        const { error } = await supabase.from('cuentas_por_pagar').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar cuenta'); return error; }
        log('Eliminar', 'Cuentas por Pagar', `ID ${id}`);
        rf();
      },

      // Abonar a cuenta por pagar (pago a proveedor)
      // 098: contrato pagar_cuenta_por_pagar — abono, egreso y pago a
      // proveedor ligados en UNA transacción; la fecha es el día de negocio
      // del servidor (fin_hoy()). Idempotente por operación. opciones: { operacionId }.
      pagarCuentaPorPagar: async (cxpId, monto, metodoPago, referencia, opciones = {}) => {
        const built = buildPagarCxPArgs({ operacionId: opciones.operacionId || nuevoOperacionId(), cxpId, monto, metodoPago, referencia });
        if (built.error) { t()?.error(built.error); return { message: built.error }; }
        const { data, error } = await supabase.rpc('pagar_cuenta_por_pagar', built.args);
        if (error) {
          console.warn('[pagarCuentaPorPagar] rpc:', error.message);
          const msg = traducirError(error, 'Error al registrar pago a proveedor');
          t()?.error(msg);
          return { error: msg, message: msg };
        }
        if (!data?.replay) {
          t()?.success(`Pago registrado: $${built.args.p_monto}`);
          log('Pagar', 'Cuentas por Pagar', `CxP #${cxpId} — $${built.args.p_monto} — ${s(data?.estatus)}`);
        }
        rf();
      },

      // ── MERMAS ── (contrato 072: evento server-authoritative e inmutable)
      // registrar_merma descuenta stock (FIFO por cuarto, con lock), crea el
      // kardex, el egreso contable y la merma en UNA transacción; actor y
      // atribución salen del JWT. Producción desde standalone; Admin desde
      // el shell. El chofer registra solo al cerrar ruta
      // (lote registrar_mermas_ruta en prepararCierreRuta; 087: descuenta del
      // camión, no de cuartos fríos).
      // 102: merma física en el cuarto elegido (registrar_merma_cuarto): solo
      // ese cuarto (sin FIFO), un efecto exacto, kardex con cuarto, auditoría
      // y valuación vigente. Idempotente por operación. Admin y Producción.
      registrarMermaCuarto: async ({ operacionId, cuartoId, sku, cantidad, causa, foto } = {}) => {
        const guard = requireRol(['Admin', 'Producción']);
        if (guard) { t()?.error(guard.error); return guard; }
        const built = buildMermaCuartoArgs({ operacionId: operacionId || nuevoOperacionId(), cuartoId, sku, cantidad, causa, foto });
        if (built.error) { t()?.error(built.error); return { error: built.error }; }
        try {
          const { error } = await supabase.rpc('registrar_merma_cuarto', built.args);
          if (error) {
            const msg = mensajeErrorMerma(error);
            console.warn('[registrarMermaCuarto] rpc registrar_merma_cuarto:', error.message);
            t()?.error(msg);
            return { error: msg };
          }
          notify('merma', 'Merma registrada', `${built.args.p_cantidad}× ${built.args.p_sku} en ${built.args.p_cuarto_id} — ${causa || 'Sin causa'}`, '⚠️', built.args.p_sku);
          await checkStockBajo([built.args.p_sku]);
          rf();
          return undefined;
        } catch (e) {
          console.error('[registrarMermaCuarto] excepción:', e);
          t()?.error('Error inesperado al registrar merma');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // Revierte una merma (solo Admin). El servidor carga la merma, regresa
      // exactamente los efectos persistidos a sus cuartos originales, borra
      // el egreso ligado por id, marca la merma Revertida (no la borra),
      // conserva la foto como evidencia y audita. Un segundo reverso se
      // rechaza sin cambios. Ya no existe borrado de mermas desde el cliente.
      revertirMerma: async (id, motivo = '') => {
        const guard = requireRol(['Admin']);
        if (guard) { t()?.error(guard.error); return guard; }
        if (!id) return { error: 'Merma requerida' };
        try {
          const { error } = await supabase.rpc('revertir_merma', {
            p_merma_id: Number(id),
            p_motivo: s(motivo) || null,
          });
          if (error) {
            const msg = mensajeErrorMerma(error);
            console.warn('[revertirMerma] rpc revertir_merma:', error.message);
            t()?.error(msg);
            return { error: msg };
          }
          rf();
          return undefined;
        } catch (e) {
          console.error('[revertirMerma] excepción:', e);
          t()?.error('Error inesperado al revertir merma');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── DEVOLUCIONES POST-ENTREGA ──
      // 104: contrato registrar_devolucion (Admin). UNA devolución por orden,
      // partidas validadas contra la orden, precio de la orden, disposición
      // (reintegrar al cuarto elegido o merma), CxC primero y reembolso con
      // tope de lo cobrado, un egreso, kardex y nota fiscal pendiente — todo en
      // una transacción e idempotente por operación. Sin compensaciones del
      // navegador.
      registrarDevolucion: async (payload = {}) => {
        const guard = requireAdmin();
        if (guard) { t()?.error(guard.error); return guard; }
        const built = buildRegistrarDevolucionArgs({ ...payload, operacionId: payload.operacionId || nuevoOperacionId() });
        if (built.error) { t()?.error(built.error); return { error: built.error }; }
        try {
          const { data, error } = await supabase.rpc('registrar_devolucion', built.args);
          if (error) {
            const msg = mensajeErrorDevolucion(error);
            console.warn('[registrarDevolucion] rpc registrar_devolucion:', error.message);
            t()?.error(msg);
            return { error: msg };
          }
          if (data?.requiere_nota_credito) {
            notify('credito', 'Nota de crédito fiscal pendiente',
              `${s(data?.folio)} — la orden está facturada: falta emitir el CFDI de egreso.`, '📄', s(data?.folio));
          }
          rf();
          return { devolucionId: data?.devolucion_id, data };
        } catch (e) {
          console.error('[registrarDevolucion] excepción:', e);
          t()?.error('Error inesperado al registrar devolución');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── CIERRE DE CAJA POR RUTA ──
      // 096: la caja se cierra con el contrato del servidor cerrar_caja_ruta:
      // una caja por ruta (UNIQUE(ruta_id)), fecha = rutas.fecha_fin (día de
      // negocio, sin conversión de zona), esperado, snapshot de pagos y actor
      // calculados en el servidor, idempotente por operación. El navegador
      // solo envía el conteo físico, el motivo y las notas.
      cerrarCajaRuta: async (payload = {}) => {
        const guard = requireAdmin();
        if (guard) { t()?.error(guard.error); return guard; }
        const { rutaId, contadoEfectivo, contadoTransferencia, motivoDiferencia, notas, operacionId } = payload;
        try {
          if (!rutaId) return { error: 'Ruta requerida' };
          const { data, error } = await supabase.rpc('cerrar_caja_ruta', {
            p_operacion_id: operacionId || nuevoOperacionId(),
            p_ruta_id: Number(rutaId),
            p_contado_efectivo: centavos(Number(contadoEfectivo || 0)),
            p_contado_transferencia: centavos(Number(contadoTransferencia || 0)),
            p_motivo_diferencia: s(motivoDiferencia).trim() || null,
            p_notas: s(notas).trim() || null,
          });
          if (error) {
            const msg = error.message || 'No se pudo registrar el cierre';
            t()?.error(msg);
            return { error: msg };
          }
          rf();
          return { cierreId: data?.cierre_id, diferencia: Number(data?.diferencia || 0), fecha: data?.fecha, replay: data?.replay === true };
        } catch (e) {
          console.error('[cerrarCajaRuta] excepción:', e);
          t()?.error('Error inesperado al cerrar caja');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // 096: rutas pendientes de caja según la identidad durable (la ruta tiene
      // o no su caja), calculadas en el servidor; sin fechas del navegador.
      obtenerRutasPendientesCaja: async () => {
        const guard = requireAdmin();
        if (guard) return guard;
        try {
          const { data, error } = await supabase.rpc('rutas_pendientes_caja');
          if (error) return { error: error.message };
          return { data: Array.isArray(data) ? data : [] };
        } catch (e) {
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── COMODATOS ──
      addComodato: async (c) => {
        const { error } = await supabase.from('comodatos').insert({
          cliente_id: c.clienteId || c.cliente_id || null,
          negocio: c.negocio, direccion: c.direccion, contacto: c.contacto,
          congelador_modelo: c.congeladorModelo, capacidad: Number(c.capacidad) || 0,
          stock_maximo: Number(c.stockMaximo) || 0, stock_actual: Number(c.stockActual) || 0,
          frecuencia: c.frecuencia, estatus: 'Activo',
        });
        if (error) { t()?.error('Error al guardar comodato'); return error; }
        log('Crear', 'Comodatos', `${c.negocio}`);
        rf();
      },

      updateComodato: async (id, c) => {
        const update = {};
        if (c.clienteId !== undefined) update.cliente_id = c.clienteId;
        if (c.cliente_id !== undefined) update.cliente_id = c.cliente_id;
        if (c.negocio     !== undefined) update.negocio      = c.negocio;
        if (c.direccion   !== undefined) update.direccion    = c.direccion;
        if (c.contacto    !== undefined) update.contacto     = c.contacto;
        if (c.congeladorModelo !== undefined) update.congelador_modelo = c.congeladorModelo;
        if (c.congelador_modelo !== undefined) update.congelador_modelo = c.congelador_modelo;
        if (c.capacidad   !== undefined) update.capacidad    = Number(c.capacidad);
        if (c.stockMaximo !== undefined) update.stock_maximo = Number(c.stockMaximo);
        if (c.stock_maximo !== undefined) update.stock_maximo = Number(c.stock_maximo);
        if (c.estatus     !== undefined) update.estatus      = c.estatus;
        if (c.stockActual !== undefined) update.stock_actual = Number(c.stockActual);
        if (c.stock_actual !== undefined) update.stock_actual = Number(c.stock_actual);
        if (c.frecuencia  !== undefined) update.frecuencia   = c.frecuencia;
        const { error } = await supabase.from('comodatos').update(update).eq('id', id);
        if (error) { t()?.error('Error al actualizar comodato'); return error; }
        log('Editar', 'Comodatos', `ID ${id}`);
        rf();
      },

      deleteComodato: async (id) => {
        const { error } = await supabase.from('comodatos').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar comodato'); return error; }
        log('Eliminar', 'Comodatos', `ID ${id}`);
        rf();
      },

      // ── LEADS ──
      addLead: async (l) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        const { error } = await supabase.from('leads').insert({
          nombre: l.nombre, telefono: l.telefono, correo: l.correo,
          mensaje: l.mensaje, origen: l.origen, estatus: 'Nuevo',
          // 098: fecha = fin_hoy() del servidor (default de la columna)
        });
        if (error) { t()?.error('Error al guardar lead'); return error; }
        log('Crear', 'Leads', `${l.nombre}`);
        rf();
      },

      updateLead: async (id, changes) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        const { error } = await supabase.from('leads').update(changes).eq('id', id);
        if (error) { t()?.error('Error al actualizar lead'); return error; }
        log('Editar', 'Leads', `ID ${id}`);
        rf();
      },

      deleteLead: async (id) => {
        const guard = requireRol(['Admin', 'Ventas']);
        if (guard) { t()?.error(guard.error); return guard; }
        const { error } = await supabase.from('leads').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar lead'); return error; }
        log('Eliminar', 'Leads', `ID ${id}`);
        rf();
      },

      // ── EMPLEADOS ──
      // Alineado con schema real (001_schema_completo.sql:188):
      // nombre, rfc, curp, nss, puesto, depto, salario_diario, fecha_ingreso,
      // jornada, estatus. NO existe 'telefono', 'salario_base', 'banco', 'cuenta'
      // en la tabla — los intentos previos de INSERT con esos campos rompían.
      addEmpleado: async (e) => {
        try {
          if (!e?.nombre || !String(e.nombre).trim()) return { error: 'Nombre requerido' };
          if (!e?.puesto || !String(e.puesto).trim()) return { error: 'Puesto requerido' };
          if (!e?.depto || !String(e.depto).trim()) return { error: 'Departamento requerido' };
          const salDiario = Number(e.salarioDiario ?? e.salario_diario);
          if (!Number.isFinite(salDiario) || salDiario <= 0) {
            return { error: 'Salario diario debe ser mayor a 0' };
          }
          const fechaIng = String(e.fechaIngreso || e.fecha_ingreso || '').trim();
          if (!fechaIng) return { error: 'Fecha de ingreso requerida' };

          const { error } = await supabase.from('empleados').insert({
            nombre: String(e.nombre).trim(),
            rfc: e.rfc ? String(e.rfc).trim().toUpperCase() : null,
            curp: e.curp ? String(e.curp).trim().toUpperCase() : null,
            nss: e.nss ? String(e.nss).trim() : null,
            telefono: e.telefono ? String(e.telefono).trim() : null,
            puesto: String(e.puesto).trim(),
            depto: String(e.depto).trim(),
            salario_diario: salDiario,
            fecha_ingreso: fechaIng,
            jornada: e.jornada || 'Diurna',
            estatus: 'Activo',
          });
          if (error) {
            t()?.error('Error al guardar empleado: ' + error.message);
            return { error: error.message || 'Error al guardar empleado' };
          }
          log('Crear', 'Empleados', `${e.nombre} — ${e.puesto}`);
          rf();
          return undefined;
        } catch (ex) {
          const msg = ex?.message || 'Error inesperado al crear empleado';
          t()?.error(msg);
          return { error: msg };
        }
      },

      updateEmpleado: async (id, e) => {
        try {
          if (!id) return { error: 'Empleado requerido' };
          const update = {};
          if (e.nombre       !== undefined) update.nombre       = String(e.nombre).trim();
          if (e.rfc          !== undefined) update.rfc          = e.rfc ? String(e.rfc).trim().toUpperCase() : null;
          if (e.curp         !== undefined) update.curp         = e.curp ? String(e.curp).trim().toUpperCase() : null;
          if (e.nss          !== undefined) update.nss          = e.nss ? String(e.nss).trim() : null;
          if (e.telefono     !== undefined) update.telefono     = e.telefono ? String(e.telefono).trim() : null;
          if (e.puesto       !== undefined) update.puesto       = String(e.puesto).trim();
          if (e.depto        !== undefined) update.depto        = String(e.depto).trim();
          if (e.salarioDiario !== undefined) {
            const sd = Number(e.salarioDiario);
            if (!Number.isFinite(sd) || sd <= 0) return { error: 'Salario diario debe ser mayor a 0' };
            update.salario_diario = sd;
          }
          if (e.salario_diario !== undefined) update.salario_diario = Number(e.salario_diario);
          if (e.fechaIngreso  !== undefined) update.fecha_ingreso = e.fechaIngreso;
          if (e.fecha_ingreso !== undefined) update.fecha_ingreso = e.fecha_ingreso;
          if (e.jornada      !== undefined) update.jornada      = e.jornada;
          if (e.estatus      !== undefined) update.estatus      = e.estatus;

          const { error } = await supabase.from('empleados').update(update).eq('id', id);
          if (error) {
            t()?.error('Error al actualizar empleado');
            return { error: error.message || 'Error al actualizar empleado' };
          }
          log('Editar', 'Empleados', `ID ${id}`);
          rf();
          return undefined;
        } catch (ex) {
          const msg = ex?.message || 'Error inesperado al actualizar empleado';
          t()?.error(msg);
          return { error: msg };
        }
      },

      deleteEmpleado: async (id) => {
        const guard = requireAdmin();
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          const { error } = await supabase.from('empleados').delete().eq('id', id);
          if (error) {
            const msg = error.code === '23503'
              ? 'No se puede eliminar — el empleado tiene rutas, órdenes o nómina asociada. Usa Desactivar.'
              : (error.message || 'Error al eliminar empleado');
            t()?.error(msg);
            return { error: msg };
          }
          log('Eliminar', 'Empleados', `ID ${id}`);
          rf();
          return undefined;
        } catch (e) {
          const msg = e?.message || 'Error inesperado al eliminar empleado';
          t()?.error(msg);
          return { error: msg };
        }
      },

      // ── NÓMINA ──
      // ── NÓMINA ── (100: modelo canónico; sin escritura REST directa)
      // crear_periodo_nomina: el servidor deriva la semana sábado→viernes del
      // día de negocio (Mazatlán) o de la fecha elegida; es idempotente por
      // fecha_inicio. Luego genera los recibos faltantes con el snapshot del
      // salario. fecha: 'YYYY-MM-DD' opcional (null = semana actual).
      crearPeriodoNomina: async (fecha = null) => {
        const fe = fechaElegida(fecha);
        if (fe.error) { t()?.error(fe.error); return { error: fe.error, message: fe.error }; }
        const { data, error } = await supabase.rpc('crear_periodo_nomina', { p_fecha: fe.fecha });
        if (error) {
          console.warn('[crearPeriodoNomina] rpc:', error.message);
          const msg = traducirError(error, 'Error al crear el periodo de nómina');
          t()?.error(msg);
          return { error: msg, message: msg };
        }
        if (data?.estatus === 'Borrador') {
          const { error: eRec } = await supabase.rpc('generar_recibos_nomina', { p_periodo_id: Number(data.periodo_id) });
          if (eRec) {
            console.warn('[crearPeriodoNomina] generar_recibos:', eRec.message);
            const msg = 'Periodo creado, pero los recibos no se generaron. Usa "Generar recibos".';
            t()?.error(msg);
            rf();
            return { error: msg, message: msg, partial: true };
          }
        }
        if (data?.replay) t()?.info(`El periodo ${s(data?.periodo)} ya existía`);
        else t()?.success(`Nómina creada: ${s(data?.periodo)}`);
        rf();
      },

      // generar_recibos_nomina: un recibo por empleado elegible; repetir solo
      // crea los faltantes y nunca reescribe un recibo existente.
      generarRecibosNomina: async (periodoId) => {
        const { data, error } = await supabase.rpc('generar_recibos_nomina', { p_periodo_id: Number(periodoId) });
        if (error) {
          console.warn('[generarRecibosNomina] rpc:', error.message);
          const msg = traducirError(error, 'Error al generar recibos');
          t()?.error(msg);
          return { error: msg, message: msg };
        }
        const creados = Number(data?.creados || 0);
        if (creados > 0) t()?.success(`${creados} recibo${creados === 1 ? '' : 's'} generado${creados === 1 ? '' : 's'}`);
        else t()?.info('Todos los empleados elegibles ya tienen recibo');
        rf();
      },

      // editar_recibo_nomina: valores reales de un recibo en Borrador; el
      // servidor recalcula con el salario del snapshot (sin totales del cliente).
      editarReciboNomina: async (reciboId, campos) => {
        const built = buildEditarReciboArgs(reciboId, campos);
        if (built.error) { t()?.error(built.error); return { error: built.error, message: built.error }; }
        const { error } = await supabase.rpc('editar_recibo_nomina', built.args);
        if (error) {
          console.warn('[editarReciboNomina] rpc:', error.message);
          const msg = traducirError(error, 'Error al guardar el recibo');
          t()?.error(msg);
          return { error: msg, message: msg };
        }
        t()?.success('Recibo actualizado');
        rf();
      },

      // 128 (NOM-1) — guardar_recibo_nomina: días, séptimo y el desglose
      // completo del recibo (renglones de catálogo y manuales) en una
      // operación; el servidor guarda la foto y recalcula.
      guardarReciboNomina: async (reciboId, campos, lineas, salarioDiario = null) => {
        const built = buildGuardarReciboArgs(reciboId, campos, lineas, salarioDiario);
        if (built.error) { t()?.error(built.error); return { error: built.error, message: built.error }; }
        const { error } = await supabase.rpc('guardar_recibo_nomina', built.args);
        if (error) {
          console.warn('[guardarReciboNomina] rpc:', error.message);
          const msg = traducirError(error, 'Error al guardar el recibo');
          t()?.error(msg);
          return { error: msg, message: msg };
        }
        t()?.success('Recibo guardado');
        rf();
      },

      // aplicar_conceptos_nomina: agrega al borrador los conceptos del catálogo
      // que le falten (creados o cambiados después de generar los recibos).
      // 130: además de agregar lo que falta, recalcula comisiones y bonos
      // automáticos del borrador (respeta lo cambiado a mano).
      aplicarConceptosNomina: async (periodoId, { silencioso = false } = {}) => {
        const { data, error } = await supabase.rpc('aplicar_conceptos_nomina', { p_periodo_id: Number(periodoId) });
        if (error) {
          console.warn('[aplicarConceptosNomina] rpc:', error.message);
          const msg = traducirError(error, 'Error al aplicar los conceptos');
          t()?.error(msg);
          return { error: msg, message: msg };
        }
        const k = Number(data?.lineas || 0);
        if (k > 0) t()?.success(`${k} renglón${k === 1 ? '' : 'es'} actualizado${k === 1 ? '' : 's'} en ${Number(data?.recibos || 0)} recibo${Number(data?.recibos || 0) === 1 ? '' : 's'}`);
        else if (!silencioso) t()?.info('Los recibos ya están al día');
        rf();
        return { data };
      },

      // guardar_concepto_nomina: alta y edición del catálogo (Admin). Queda en
      // la bitácora del Dueño. El servidor valida todo otra vez.
      guardarConceptoNomina: async (conceptoId, form, empleados) => {
        const built = buildGuardarConceptoArgs(conceptoId, form, empleados);
        if (built.error) { t()?.error(built.error); return { error: built.error, message: built.error }; }
        const { data, error } = await supabase.rpc('guardar_concepto_nomina', built.args);
        if (error) {
          console.warn('[guardarConceptoNomina] rpc:', error.message);
          const msg = error.code === '23505' ? 'Ya existe un concepto activo con ese nombre' : traducirError(error, 'Error al guardar el concepto');
          t()?.error(msg);
          return { error: msg, message: msg };
        }
        if (data?.sin_cambios) t()?.info('Sin cambios');
        else t()?.success(data?.creado ? 'Concepto creado' : 'Concepto actualizado');
        rf();
        return { data };
      },

      // Pagar nómina — 098/100: contrato pagar_nomina. Egreso, costo de nómina
      // y periodo Pagado (inmutable) en UNA transacción, con el neto de los
      // recibos y la fecha (fin_hoy()) del servidor. Un periodo se paga una vez.
      pagarNomina: async (periodoId) => {
        const { data, error } = await supabase.rpc('pagar_nomina', { p_periodo_id: Number(periodoId) });
        if (error) {
          console.warn('[pagarNomina] rpc:', error.message);
          const msg = traducirError(error, 'Error al pagar la nómina');
          t()?.error(msg);
          return { error: msg, message: msg };
        }
        const total = Number(data?.total_neto || 0);
        if (data?.replay) t()?.info('Este periodo ya estaba pagado');
        else {
          t()?.success(`Nómina pagada: $${total.toLocaleString()}`);
          log('Pagar', 'Nómina', `Período ${periodoId} — $${total}`);
        }
        rf();
      },

      // Recarga completa del store (núcleo + slices). Usado tras altas
      // hechas por Netlify Functions (admin-create-user) sobre tablas
      // sin realtime (usuarios).
      recargarDatos: () => rf(),

      // ── USUARIOS (GER-1, mig 120/121) ──
      // Sin escritura REST: el alta va por Netlify (admin-create-user), los
      // cambios por guardar_usuario y la baja es estatus Inactivo. El servidor
      // decide quién puede qué (Dueño / Admin); aquí solo se traduce el error.
      guardarUsuario: async (u, { incluirAccesos = false } = {}) => {
        const { data, error } = await supabase.rpc('guardar_usuario', buildGuardarUsuarioArgs(u, { incluirAccesos }));
        if (error) { const msg = mensajeErrorUsuario(error); t()?.error(msg); return { error: msg }; }
        rf();
        return { data };
      },

      restablecerPassword: async (usuarioId, password, { forzarCambio = false } = {}) => {
        try {
          const data = await backendPost('admin-reset-password', { usuarioId: Number(usuarioId), password, forzarCambio: !!forzarCambio });
          rf();
          return { data };
        } catch (e) {
          const msg = mensajeErrorUsuario(e);
          t()?.error(msg);
          return { error: msg };
        }
      },

      // La contraseña propia: verifica la actual, la cambia en Auth y libera la
      // cuenta si era temporal (confirmar_cambio_password compara la huella).
      cambiarMiPassword: async ({ actual, nueva }) => {
        const { data: sesion } = await supabase.auth.getUser();
        const email = sesion?.user?.email;
        if (!email) return { error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
        const { error: errActual } = await supabase.auth.signInWithPassword({ email, password: actual });
        if (errActual) return { error: mensajeErrorUsuario(errActual) };
        const { error: errNueva } = await supabase.auth.updateUser({ password: nueva });
        if (errNueva) return { error: mensajeErrorUsuario(errNueva) };
        const { error: errConf } = await supabase.rpc('confirmar_cambio_password');
        if (errConf) return { error: mensajeErrorUsuario(errConf) };
        return { data: { ok: true } };
      },

      // Bitácora de cambios sensibles (solo el Dueño la lee; RLS).
      cargarBitacora: async (limite = 200) => {
        const { data, error } = await supabase.from('bitacora_cambios').select('*').order('id', { ascending: false }).limit(limite);
        if (error) return { error: mensajeErrorUsuario(error) };
        return { data: data || [] };
      },

      // ── ALMACÉN BOLSAS ──
      // 088: Almacén Bolsas (y Admin) registran empaque/materia prima con
      // contratos acotados e idempotentes: la recepción de compra liga stock
      // + egreso (contado) o cuenta por pagar (crédito) en UNA transacción; la
      // salida a Producción solo mueve stock. Sin RPC genérico de stock ni
      // INSERT directo de egresos. opciones: { operacionId }.
      movimientoBolsa: async (sku, cantidad, tipo, motivo, costo, proveedor, esCredito, opciones = {}) => {
        const guard = requireRol(['Admin', 'Almacén Bolsas']);
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          const qty = Number(cantidad);
          if (!sku) return { error: 'SKU requerido' };
          if (!Number.isInteger(qty) || qty <= 0) return { error: 'Cantidad inválida' };
          if (tipo !== 'Entrada' && tipo !== 'Salida') return { error: 'Tipo inválido' };
          const operacionId = opciones.operacionId || nuevoOperacionId();
          let res;
          if (tipo === 'Entrada') {
            const total = centavos(Number(costo));
            if (!(total > 0)) return { error: 'Captura el total de la compra' };
            if (esCredito && !s(proveedor)) return { error: 'La compra a crédito requiere proveedor' };
            res = await supabase.rpc('registrar_recepcion_compra', {
              p_operacion_id: operacionId, p_sku: String(sku), p_cantidad: qty, p_costo_total: total,
              p_proveedor: s(proveedor) || null, p_credito: esCredito === true,
            });
          } else {
            res = await supabase.rpc('registrar_salida_empaque', { p_operacion_id: operacionId, p_sku: String(sku), p_cantidad: qty });
          }
          if (res.error) {
            console.warn('[movimientoBolsa] rpc:', res.error.message);
            t()?.error(res.error.message || 'No se pudo registrar el movimiento');
            return { error: res.error.message };
          }
          if (!res.data?.replay) {
            // 092: la "salida" es una entrega a Producción (traslado); no descuenta el total.
            log(tipo === 'Entrada' ? (esCredito ? 'Compra crédito' : 'Compra') : 'Entrega a Producción', 'Almacén Bolsas',
              `${sku} x${qty} — ${tipo === 'Entrada' ? `$${centavos(Number(costo))}${proveedor ? ' — ' + proveedor : ''}` : (motivo || 'Producción')}`);
            // 106: la compra recalcula el costo promedio del empaque en el servidor.
            if (tipo === 'Entrada' && res.data?.costo_promedio != null) {
              t()?.info(`Costo promedio de ${sku}: $${Number(res.data.costo_promedio).toFixed(2)} (antes $${Number(res.data.costo_promedio_anterior ?? 0).toFixed(2)})`);
            }
          }
          rf();
          return undefined;
        } catch (e) {
          console.error('[movimientoBolsa] excepción:', e);
          t()?.error('Error inesperado al registrar movimiento');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // 092: control "Salió a Producción vs Usó Producción" calculado en el
      // servidor desde fuentes independientes (eventos de entrega canónicos vs
      // consumo del contrato de producción). Solo lectura; Admin y Almacén Bolsas.
      // 093: reporte financiero del servidor para un periodo: Estado de
      // resultados (devengado) y Flujo de efectivo por separado, más saldos
      // de CxC/CxP. Calculado sobre TODOS los registros del periodo (sin los
      // topes de filas del cliente). Admin y Facturación.
      obtenerReporteFinanciero: async (desde, hasta) => {
        const guard = requireRol(['Admin', 'Facturación']);
        if (guard) return guard;
        try {
          const { data, error } = await supabase.rpc('reporte_financiero', { p_desde: desde, p_hasta: hasta });
          if (error) {
            console.warn('[obtenerReporteFinanciero] rpc:', error.message);
            return { error: error.message };
          }
          return { data: normalizarReporteFinanciero(data) };
        } catch (e) {
          return { error: e?.message || 'Error inesperado' };
        }
      },

      obtenerConciliacionEmpaque: async () => {
        const guard = requireRol(['Admin', 'Almacén Bolsas']);
        if (guard) return guard;
        try {
          const { data: filas, error } = await supabase.rpc('conciliacion_empaque');
          if (error) {
            console.warn('[obtenerConciliacionEmpaque] rpc:', error.message);
            return { error: error.message };
          }
          return { data: Array.isArray(filas) ? filas : [] };
        } catch (e) {
          return { error: e?.message || 'Error inesperado' };
        }
      },
      // ── CERRAR RUTA COMPLETA (chofer) ──
      // ── INVENTARIO DE RUTA (087) ──
      // Balance canónico del camión (servidor, solo lectura): cargado,
      // entregado, merma, devuelto y restante por SKU. Admin o chofer dueño.
      obtenerBalanceRuta: async (rutaId) => {
        try {
          const { data, error } = await supabase.rpc('calcular_balance_ruta', { p_ruta_id: Number(rutaId) });
          if (error) return { error: mensajeErrorInventarioRuta(error) };
          return { data: interpretarBalance(data) };
        } catch (e) {
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // Lote de mermas de ruta (087): atómico, idempotente por operacion_id
      // (persistido por ruta), tope = balance del camión, sin cuartos fríos.
      // Permite un segundo lote (faltante del conteo).
      registrarMermasRuta: async (rutaId, mermasLote) => {
        const storage = typeof localStorage !== 'undefined' ? localStorage : null;
        const key = claveStorageMermasRuta(rutaId);
        const op = resolverOperacionCierre(leerOperacion(storage, key), claveMermasRuta(rutaId, mermasLote));
        guardarOperacion(storage, key, op);
        const built = buildMermasRutaArgs({ operacionId: op.id, rutaId, mermas: mermasLote });
        if (built.error) return { error: built.error };
        try {
          const { data, error } = await supabase.rpc('registrar_mermas_ruta', built.args);
          if (error) return { error: mensajeErrorInventarioRuta(error) };
          borrarOperacion(storage, key);
          if (data?.replay) {
            await log('Cierre Ruta', 'Rutas', `Mermas de la ruta ${rutaId} ya registradas (reintento): no se duplicaron`);
          }
          return { data };
        } catch (e) {
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // Cierre de ruta, paso 1 (087): ventas y cobros (086, idempotente por
      // operación) + mermas aún no registradas (lote idempotente) + balance
      // canónico para el conteo. NO cierra la ruta.
      prepararCierreRuta: async (reporte = {}) => {
        const { rutaId, choferNombre, entregas, mermas: mermasLocales } = reporte;
        if (!rutaId) return { error: 'No se puede cerrar sin ruta activa' };
        const storage = typeof localStorage !== 'undefined' ? localStorage : null;
        try {
          // F4 (086): UN operacion_id por cierre financiero, persistido por
          // ruta; un reintento devuelve el resultado almacenado sin repetir
          // ventas exprés, pagos ni CxC.
          const entregasPayload = normalizarEntregasCierre(entregas);
          const opCierre = resolverOperacionCierre(leerOperacionCierre(storage, rutaId), claveCierreFinanciero(rutaId, entregasPayload));
          guardarOperacionCierre(storage, rutaId, opCierre);
          const built = buildCerrarFinancieroArgs({
            operacionId: opCierre.id,
            rutaId,
            entregas: entregasPayload,
            usuarioId: uid(),
            usuarioNombre: choferNombre || uname(),
          });
          if (built.error) return { error: built.error };
          const { data: finData, error: finErr } = await supabase.rpc('cerrar_ruta_financiero', built.args);
          if (finErr) return { error: mensajeErrorCierreFinanciero(finErr) };
          const finRes = interpretarCierreFinanciero(finData);
          if (finRes.replay) {
            await log('Cierre Ruta', 'Rutas', `Cierre financiero de la ruta ${rutaId} ya registrado (reintento): sin efectos repetidos`);
          }
          if (finRes.saltadas.length > 0) {
            await log('Cierre Ruta', 'Rutas', `Cobros omitidos (ya pagadas): ${finRes.saltadas.map(x => x.folio || x.orden_id).join(', ')}`);
          }

          const pendientesMerma = (Array.isArray(mermasLocales) ? mermasLocales : []).filter(m => m && !m.registrada);
          let mermasRegistradas = [];
          if (pendientesMerma.length > 0) {
            const rm = await actionsRef.current.registrarMermasRuta(rutaId, pendientesMerma);
            if (rm.error) return { error: rm.error, financiero: true };
            mermasRegistradas = pendientesMerma.map(m => m.id);
          }

          const bal = await actionsRef.current.obtenerBalanceRuta(rutaId);
          rf();
          if (bal.error) return { error: bal.error, financiero: true, mermasRegistradas };
          return { balance: bal.data, mermasRegistradas };
        } catch (err) {
          console.error('[prepararCierreRuta] excepción:', err);
          return { error: err?.message || 'No se pudo preparar el cierre' };
        }
      },

      // Cierre de ruta, paso 2 (087): conteo físico → el servidor valida
      // contra el balance del camión (faltante/sobrante → rechazo con detalle,
      // sin efectos), devuelve a los cuartos de origen, escribe la devolución
      // y cierra la ruta. Idempotente por operacion_id (persistido por ruta).
      finalizarInventarioRuta: async (rutaId, conteo, meta = {}) => {
        const storage = typeof localStorage !== 'undefined' ? localStorage : null;
        const norm = normalizarConteo(conteo);
        if (norm.error) return { error: norm.error };
        const key = claveStorageCierreInventario(rutaId);
        const op = resolverOperacionCierre(leerOperacion(storage, key), claveCierreInventario(rutaId, norm.conteo));
        guardarOperacion(storage, key, op);
        const built = buildFinalizarInventarioArgs({ operacionId: op.id, rutaId, conteo: norm.conteo });
        if (built.error) return { error: built.error };
        try {
          const { data, error } = await supabase.rpc('finalizar_inventario_ruta', built.args);
          if (error) {
            const det = detalleErrorInventario(error);
            return { error: mensajeErrorInventarioRuta(error), faltante: det.faltante, sobrante: det.sobrante };
          }
          // Cierre confirmado: ninguna operación de esta ruta queda pendiente.
          borrarOperacion(storage, key);
          borrarOperacion(storage, claveStorageMermasRuta(rutaId));
          borrarOperacionCierre(storage, rutaId);
          const dev = data?.devolucion && typeof data.devolucion === 'object' ? data.devolucion : {};
          const devTxt = Object.entries(dev).map(([sku, q]) => `${q}×${sku}`).join(', ') || '0';
          if (!data?.replay) {
            await log(meta.admin ? 'Cerrar' : 'Cierre Ruta', 'Rutas',
              `${data?.folio || `Ruta ${rutaId}`} — devuelto al cuarto: ${devTxt}${meta.detalle ? ` — ${meta.detalle}` : ''}`);
            notify('venta', 'Ruta cerrada', `${data?.actor || uname() || ''} cerró ${data?.folio || 'la ruta'} — devolución ${devTxt}`, '🚛', String(rutaId));
          }
          rf();
          return { data };
        } catch (e) {
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── AUDITORÍA ──
      logAudit: async (accion, modulo, detalle) => {
        await log(accion, modulo, detalle);
      },

      // ── CONFIGURACIÓN EMPRESA (singleton id=1) ──
      // Refetch puntual del singleton (NO refetcheAll). Usado por la vista
      // de Configuración tras un update para no esperar al debounce de Realtime.
      getConfigEmpresa: async () => {
        try {
          const { data, error } = await supabase
            .from('configuracion_empresa')
            .select('*')
            .eq('id', 1)
            .maybeSingle();
          if (error) {
            return { error: error.message || 'Error al leer configuración de empresa' };
          }
          return { data: data ? toCamel(data) : null };
        } catch (e) {
          return { error: e?.message || 'Error inesperado' };
        }
      },

      updateConfigEmpresa: async (payload = {}) => {
        const guard = requireAdmin();
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          const update = {};
          if (payload.razonSocial      !== undefined) update.razon_social      = String(payload.razonSocial || '').trim();
          if (payload.rfc              !== undefined) update.rfc               = String(payload.rfc || '').trim().toUpperCase();
          if (payload.direccionFiscal  !== undefined) update.direccion_fiscal  = payload.direccionFiscal || null;
          if (payload.codigoPostal     !== undefined) update.codigo_postal     = payload.codigoPostal || null;
          // Migración 056: número exterior/interior del domicilio fiscal.
          if (payload.numeroExterior   !== undefined) update.numero_exterior   = payload.numeroExterior || null;
          if (payload.numeroInterior   !== undefined) update.numero_interior   = payload.numeroInterior || null;
          if (payload.telefono         !== undefined) update.telefono          = payload.telefono || null;
          if (payload.correo           !== undefined) update.correo            = payload.correo || null;
          if (payload.regimenFiscal    !== undefined) update.regimen_fiscal    = payload.regimenFiscal || null;
          if (payload.logoUrl          !== undefined) update.logo_url          = payload.logoUrl || null;
          if (Object.keys(update).length === 0) return { error: 'Nada que actualizar' };
          if (update.razon_social !== undefined && !update.razon_social) {
            return { error: 'Razón social requerida' };
          }
          if (update.rfc !== undefined && !update.rfc) {
            return { error: 'RFC requerido' };
          }
          update.updated_at = new Date().toISOString();

          const { error } = await supabase
            .from('configuracion_empresa')
            .update(update)
            .eq('id', 1);
          if (error) {
            t()?.error('Error al actualizar configuración de empresa');
            return { error: error.message || 'Error al actualizar configuración de empresa' };
          }
          await log('Editar', 'Configuración Empresa', `Razon social: ${update.razon_social || '(sin cambio)'}`);
          rf();
          return undefined;
        } catch (e) {
          const msg = e?.message || 'Error inesperado al actualizar configuración de empresa';
          t()?.error(msg);
          return { error: msg };
        }
      },

      // ── RESET MASIVO DEL SISTEMA ──
      // Borra todos los datos transaccionales pero preserva catálogos.
      // Pensada para pre-producción: permite a Admin limpiar el sistema
      // antes de operar con datos reales.
      // Requiere confirmacion === 'RESETEAR' para activarse.
    };
  }

  return { data, actions: actionsRef.current, loading, error };
}
