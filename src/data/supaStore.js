import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { backendPost } from '../lib/backend';
import { n, s, centavos, todayLocalISO } from '../utils/safe';
import { useToast } from '../components/ui/Toast';
import { parseProductos, validateItems, buildLineas, formatFolio, buildOrdenPayload, validateCancelacion, buildAnotacionCancelacion, validateEdicionOrden, parseLineasEdicion, buildUpdateFieldsOrden, validateTransicionOrden, validateMarcarNoEntregada, buildNoEntregaPayload, calcReversoChangesNoEntrega } from './ordenLogic';
import { seleccionarCuartoFIFOInverso, validarMermaParaReverso, buildReversoMermaChange, matchConceptoMerma, decidirBorrarMovimientoContable } from './mermasLogic';
import { buildUpdateFieldsProduccion, calcReversoChangesProduccion } from './produccionLogic';
import { validateDevolucion, calcDevolucionChanges, calcAjustePago, calcTotalDevolucion } from './devolucionesLogic';
import { calcularEsperadoPorRuta, validateCierre, buildCierrePayload, buildPagosSnapshot, fechaCierreDesdeRuta } from './cierreCajaLogic';
import {
  validateConfirmarCarga,
  validateFirmarCarga,
  puedeFirmarRuta,
  excedeAutorizacion,
  calcularChangesInventario,
  calcDevolucionLegacy,
} from './rutasLogic';
import { geocodeDireccion, buildDireccion } from '../utils/geocoding';

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
  comodatos: [], leads: [], empleados: [], nominaPeriodos: [],
  nominaRecibos: [], movContables: [], mermas: [], cuentasPorCobrar: [],
  cuentasPorPagar: [], pagosProveedores: [],
  costosFijos: [], costosHistorial: [],
  camiones: [],
  invoiceAttempts: [],
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

  // ── Fetch all data ──────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      // Tablas core
      const [cli, prod, pe, ord, ol, rut, pro, mov, cf, aud, usr, umb, pag] = await Promise.all([
        safeRows(supabase.from('clientes').select('*').order('id')),
        safeRows(supabase.from('productos').select('*').order('id')),
        safeRows(supabase.from('precios_esp').select('*').order('id')),
        safeRows(supabase.from('ordenes').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('orden_lineas').select('*').order('orden_id')),
        safeRows(supabase.from('rutas').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('produccion').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('inventario_mov').select('*').order('id', { ascending: false }).limit(200)),
        safeRows(supabase.from('cuartos_frios').select('*')),
        safeRows(supabase.from('auditoria').select('*').order('id', { ascending: false }).limit(500)),
        safeRows(supabase.from('usuarios').select('*').order('id')),
        safeRows(supabase.from('umbrales').select('*')),
        safeRows(supabase.from('pagos').select('*').order('id', { ascending: false }).limit(200)),
      ]);

      // Configuracion de empresa (singleton id=1)
      const { data: configEmpresaRow } = await supabase
        .from('configuracion_empresa')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      // Tablas opcionales
      const [com, lea, emp, nomP, nomR, movC, mer, cxc, costF, costH, cxp, pagProv, invAttempts, cam, notif, chUbi, devs, cierres] = await Promise.all([
        safeRows(supabase.from('comodatos').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('leads').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('empleados').select('*').order('id')),
        safeRows(supabase.from('nomina_periodos').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('nomina_recibos').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('movimientos_contables').select('*').order('id', { ascending: false }).limit(500)),
        safeRows(supabase.from('mermas').select('*').order('id', { ascending: false }).limit(200)),
        safeRows(supabase.from('cuentas_por_cobrar').select('*').order('id', { ascending: false }).limit(500)),
        safeRows(supabase.from('costos_fijos').select('*').order('id')),
        safeRows(supabase.from('costos_historial').select('*').order('id', { ascending: false }).limit(200)),
        safeRows(supabase.from('cuentas_por_pagar').select('*').order('id', { ascending: false }).limit(500)),
        safeRows(supabase.from('pagos_proveedores').select('*').order('id', { ascending: false }).limit(200)),
        safeRows(supabase.from('invoice_attempts').select('orden_id, provider_reference, status, created_at, request_payload').order('id', { ascending: false }).limit(300)),
        safeRows(supabase.from('camiones').select('*').order('id')),
        safeRows(supabase.from('notificaciones').select('*').order('id', { ascending: false }).limit(100)),
        safeRows(supabase.from('chofer_ubicaciones').select('*').order('created_at', { ascending: false }).limit(50)),
        safeRows(supabase.from('devoluciones').select('*').order('id', { ascending: false }).limit(200)),
        safeRows(supabase.from('cierres_diarios').select('*').order('id', { ascending: false }).limit(200)),
      ]);
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
        return {
          ...o,
          clienteId: o.cliente_id,
          cliente: c?.nombre || '',
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
      const clientesMapped = clientes.map(c => ({
        ...c,
        usoCfdi: c.uso_cfdi,
        saldo: Number(c.saldo),
      }));

      // ── Map precios especiales ──
      const preciosEsp = (pe || []).map(p => {
        const c = clientes.find(x => x.id === p.cliente_id);
        return { ...p, clienteId: p.cliente_id, clienteNom: c?.nombre || '', precio: Number(p.precio) };
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

      // ── Map inventario_mov (usa "producto" y "usuario" como texto) ──
      const inventarioMov = (mov || []).map(m => ({
        ...m,
        producto: m.producto || m.sku || '',   // columna real: "producto"
        sku:      m.producto || m.sku || '',   // alias para compatibilidad
        cantidad: Number(m.cantidad),
        usuario:  m.usuario || 'Sistema',      // columna real: "usuario" texto
      }));

      // ── Map produccion ──
      const produccion = (pro || []).map(p => ({
        ...p,
        cantidad: Number(p.cantidad),
      }));

      // ── Build facturacionPendiente ──
      const facturacionPendiente = ordenes
        .filter(o => o.estatus === 'Entregada')
        .map(o => {
          const c = clientes.find(x => x.id === o.cliente_id);
          return {
            id: o.id, folio: o.folio, cliente: c?.nombre || '',
            rfc: c?.rfc || '', fecha: o.fecha, total: Number(o.total),
          };
        });

      // ── Map cuartos_frios (id: TEXT, stock: JSONB)
      // Normalize: coerce temp/capacidad to numbers and keep only "Producto Terminado" in stock
      const cuartosFrios = (cf || []).map(q => {
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

      // ── Alertas de complemento pendiente (PPD sin complemento) ──
      const complementoMap = {};
      for (const a of (invAttempts || [])) {
        const payload = a.request_payload || {};
        if (payload.CfdiType === 'P' && a.orden_id && a.status === 'success') {
          complementoMap[a.orden_id] = true;
        }
      }
      for (const o of ordenes) {
        if (o.facturama_id && s(o.metodo_pago).toLowerCase().includes('crédito') && !complementoMap[o.id]) {
          alertas.push({
            id: `comp-${o.id}`,
            tipo: 'accionable',
            msg: `Complemento pendiente — ${s(o.folio)} (PPD)`,
            created_at: new Date().toISOString(),
          });
        }
      }

      // ── Alertas de CxC próximas a vencer ──
      const hoyStr = todayLocalISO();
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

      // ── Map auditoria (usa "usuario" como texto directo) ──
      const auditoria = (aud || []).map(a => ({
        ...a,
        usuario: a.usuario || 'Sistema',   // columna real: "usuario" texto
      }));

      // ── Map umbrales ──
      const umbralesMapped = umbrales.map(u => {
        const p = productos.find(x => x.sku === u.sku);
        return { ...u, producto: p ? `${p.sku} (${p.nombre})` : u.sku };
      });

      // ── Map movimientos contables ──
      const movContables = (movC || []).map(m => ({
        ...toCamel(m),
        monto: Number(m.monto),
      }));
      const contabilidadObj = {
        ingresos: movContables.filter(m => m.tipo === 'Ingreso'),
        egresos:  movContables.filter(m => m.tipo === 'Egreso'),
      };

      const mermasMapped = await Promise.all((mer || []).map(async (m) => {
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

      setData({
        clientes: clientesMapped,
        productos: productos.map(p => ({ ...p, stock: Number(p.stock), precio: Number(p.precio) })),
        preciosEsp,
        ordenes,
        rutas: rutasMapped,
        produccion,
        inventarioMov,
        cuartosFrios,
        alertas,
        facturacionPendiente,
        conciliacion: [],
        auditoria,
        usuarios,
        umbrales: umbralesMapped,
        pagos: (pag || []).map(p => ({ ...toCamel(p), monto: Number(p.monto) })),
        comodatos: (com || []).map(toCamel),
        leads: (lea || []).map(toCamel),
        empleados: (emp || []).map(toCamel),
        nominaPeriodos: (nomP || []).map(toCamel),
        nominaRecibos:  (nomR || []).map(toCamel),
        movContables,
        mermas: mermasMapped,
        cuentasPorCobrar: (cxc || []).map(c => ({
          ...toCamel(c),
          montoOriginal: Number(c.monto_original),
          montoPagado: Number(c.monto_pagado),
          saldoPendiente: Number(c.saldo_pendiente),
        })),
        costosFijos: (costF || []).map(c => ({
          ...toCamel(c),
          monto: Number(c.monto),
        })),
        costosHistorial: (costH || []).map(c => ({
          ...toCamel(c),
          monto: Number(c.monto),
        })),
        cuentasPorPagar: (cxp || []).map(c => ({
          ...toCamel(c),
          montoOriginal: Number(c.monto_original),
          montoPagado: Number(c.monto_pagado),
          saldoPendiente: Number(c.saldo_pendiente),
        })),
        pagosProveedores: (pagProv || []).map(p => ({
          ...toCamel(p),
          monto: Number(p.monto),
        })),
        invoiceAttempts: (invAttempts || []).map(toCamel),
        camiones: (cam || []).map(toCamel),
        notificaciones: (notif || []).map(toCamel),
        choferUbicaciones: (chUbi || []).map(toCamel),
        devoluciones: (devs || []).map(d => ({
          ...toCamel(d),
          total: Number(d.total),
        })),
        cierresDiarios: (cierres || []).map(c => ({
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
        contabilidad: contabilidadObj,
        configEmpresa: configEmpresaRow ? toCamel(configEmpresaRow) : null,
      });

      setLoading(false);
      setError(null);
    } catch (err) {
      console.error('[fetchAll] ❌ catch error:', err?.message || err);
      setError(err.message);
      setLoading(false);
    }
  }, []);

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

  // ── Realtime subscriptions ──────────────────────────────────
  // Debounce 500ms: con 18 tablas suscritas, una operación común (ej. cierre
  // de ruta) puede disparar 5+ eventos en milésimas de segundo. Sin debounce
  // cada evento dispara fetchAll() completo (18 tablas + 200 mov + 500 audit)
  // y satura la conexión. Con debounce, los eventos en burst se colapsan en
  // un único refetch.
  useEffect(() => {
    const tables = [
      'clientes', 'productos', 'ordenes', 'rutas',
      'produccion', 'inventario_mov', 'pagos', 'auditoria',
      'cuartos_frios', 'comodatos', 'leads', 'empleados',
      'movimientos_contables', 'mermas', 'nomina_periodos', 'cuentas_por_cobrar',
      'cuentas_por_pagar', 'costos_fijos', 'devoluciones', 'cierres_diarios',
    ];
    let debounceTimer = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        fetchAll();
      }, 500);
    };
    const channels = tables.map(table =>
      supabase.channel(`rt_${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, debouncedFetch)
        .subscribe()
    );
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      channels.forEach(ch => supabase.removeChannel(ch));
    };
  }, [fetchAll]);

  // ── Actions ─────────────────────────────────────────────────
  const actionsRef = useRef(null);
  if (!actionsRef.current) {
    const uid   = () => uidRef.current;
    const uname = () => userNameRef.current || 'Usuario';
    const urol  = () => userRolRef.current || '';
    const rf    = () => fetchAll();
    const t     = () => toastRef.current;
    const log   = (accion, modulo, detalle) =>
      supabase.from('auditoria').insert({ usuario: uname(), accion, modulo, detalle }).then(() => {});

    // Defensa en profundidad: además de RLS, valida rol en cliente para
    // acciones destructivas. Devuelve el shape estándar { error } si rechaza.
    const requireAdmin = () => urol() === 'Admin'
      ? null
      : { error: 'Solo Admin puede ejecutar esta acción' };

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

    const a = actionsRef.current = {

      // ── CLIENTES ──
      addCliente: async (c) => {
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
            ciudad: c.ciudad || null, zona: c.zona || null,
            latitud, longitud,
            credito_autorizado: c.creditoAutorizado ?? false,
            limite_credito: Number(c.limiteCredito) || 0,
          }).select('id').single();
          if (error) {
            console.error('[addCliente]', error.message, error.code);
            t()?.error('Error al crear cliente: ' + error.message);
            return error;
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
        if (error) { t()?.error('Error al actualizar cliente'); return error; }
        log('Editar', 'Clientes', `ID ${id}`);
        rf();
      },

      deactivateCliente: async (id) => {
        const { error } = await supabase.from('clientes').update({ estatus: 'Inactivo' }).eq('id', id);
        if (error) { t()?.error('Error al desactivar cliente'); return error; }
        log('Desactivar', 'Clientes', `ID ${id}`);
        rf();
      },

      deleteCliente: async (id) => {
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
        const { error } = await supabase.from('productos').insert({
          sku: p.sku, nombre: p.nombre, tipo: p.tipo,
          stock: Number(p.stock) || 0, ubicacion: p.ubicacion,
          precio: Number(p.precio) || 0,
          costo_unitario: Number(p.costo_unitario || p.costoUnitario) || 0,
          proveedor: p.proveedor || null,
          empaque_sku: p.empaque_sku || p.empaqueSku || null,
        });
        if (error) { t()?.error('Error al crear producto'); return error; }
        log('Crear', 'Productos', `${p.sku} — ${p.nombre}`);
        rf();
      },

      updateProducto: async (id, p) => {
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
          costo_unitario: Number(p.costo_unitario || p.costoUnitario) || 0,
          proveedor: p.proveedor || null,
          empaque_sku: p.empaque_sku || p.empaqueSku || null,
        };
        if (p.stock !== undefined && p.stock !== null && p.stock !== '') update.stock = Number(p.stock) || 0;
        const { error } = await supabase.from('productos').update(update).eq('id', id);
        if (error) { t()?.error('Error al actualizar producto: ' + error.message); return error; }
        log('Editar', 'Productos', `ID ${id} — ${p.nombre}`);
        rf();
      },

      deleteProducto: async (id) => {
        const { error } = await supabase.from('productos').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar producto'); return error; }
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
        const { error } = await supabase.from('precios_esp').insert({
          cliente_id: p.clienteId, sku: p.sku, precio: Number(p.precio),
        });
        if (error) { t()?.error('Error al guardar precio especial'); return error; }
        log('Crear', 'Precios Especiales', `${p.sku} — $${p.precio}`);
        rf();
      },

      deletePrecioEsp: async (id) => {
        const { error } = await supabase.from('precios_esp').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar precio especial'); return error; }
        log('Eliminar', 'Precios Especiales', `ID ${id}`);
        rf();
      },

      // Edita solo el precio (cliente y sku son inmutables — para cambiarlos
      // el usuario debe borrar y crear nuevo, evitando bugs de identidad).
      updatePrecioEsp: async (id, payload = {}) => {
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
      addOrden: async (o) => {
        try {
          const items = parseProductos(o.productos);
          const itemsErr = validateItems(items);
          if (itemsErr) return { message: itemsErr };

          const [
            { data: prods, error: errProds },
            { data: pes, error: errPes },
            { data: cuartos, error: errCfs },
          ] = await Promise.all([
            supabase.from('productos').select('sku, precio'),
            supabase.from('precios_esp').select('sku, precio').eq('cliente_id', o.clienteId),
            supabase.from('cuartos_frios').select('stock'),
          ]);
          if (errProds) {
            console.warn('[addOrden] select productos:', errProds.message);
            t()?.error('No se pudieron leer los productos');
            return { message: errProds.message };
          }
          if (errPes) {
            console.warn('[addOrden] select precios_esp:', errPes.message);
            t()?.error('No se pudieron leer los precios especiales');
            return { message: errPes.message };
          }
          if (errCfs) {
            console.warn('[addOrden] select cuartos_frios:', errCfs.message);
            t()?.error('No se pudieron leer cuartos fríos');
            return { message: errCfs.message };
          }

          const built = buildLineas(items, prods || [], pes || []);
          if (built.error) return { message: built.error };
          const { lineas, total } = built;

          // Validación de stock disponible. El stock real vive en
          // cuartos_frios.stock (JSONB) — productos.stock es legacy y queda
          // en 0 cuando se produce vía producirYCongelar (que solo actualiza
          // cuartos_frios). Sumar desde JSONB de cada cuarto activo.
          const stockBySku = {};
          for (const cf of (cuartos || [])) {
            const cfStock = (cf?.stock && typeof cf.stock === 'object') ? cf.stock : {};
            for (const [sku, qty] of Object.entries(cfStock)) {
              stockBySku[sku] = (stockBySku[sku] || 0) + Number(qty || 0);
            }
          }
          const pedidoBySku = {};
          for (const l of lineas) pedidoBySku[l.sku] = (pedidoBySku[l.sku] || 0) + Number(l.cantidad || 0);
          for (const [sku, pedido] of Object.entries(pedidoBySku)) {
            const disponible = stockBySku[sku] ?? 0;
            if (pedido > disponible) {
              const msg = `Stock insuficiente para ${sku} (disponible: ${disponible}, pedido: ${pedido})`;
              t()?.error(msg);
              return { message: msg };
            }
          }

          // Validación de límite de crédito. Solo aplica a ventas a crédito
          // y requiere clienteId (las ventas público en general no aplican).
          if (s(o.tipoCobro) === 'Credito' && o.clienteId) {
            const { data: cliCred, error: errCred } = await supabase
              .from('clientes')
              .select('saldo, limite_credito, credito_autorizado, nombre')
              .eq('id', o.clienteId)
              .maybeSingle();
            if (errCred) {
              console.warn('[addOrden] select cliente para crédito:', errCred.message);
              t()?.error('No se pudo verificar el crédito del cliente');
              return { message: errCred.message };
            }
            if (!cliCred?.credito_autorizado) {
              const msg = 'Cliente no tiene crédito autorizado';
              t()?.error(msg);
              return { message: msg };
            }
            const limite = Number(cliCred.limite_credito) || 0;
            const saldo = Number(cliCred.saldo) || 0;
            const disponible = limite - saldo;
            if (Number(total) > disponible) {
              const msg = `Excede límite de crédito. Disponible: $${disponible.toLocaleString('es-MX')}`;
              t()?.error(msg);
              return { message: msg };
            }
          }

          const { data: seq, error: errSeq } = await supabase.rpc('nextval', { seq_name: 'folio_ov_seq' });
          if (errSeq) {
            console.warn('[addOrden] rpc nextval:', errSeq.message);
            t()?.error('No se pudo generar folio');
            return { message: errSeq.message };
          }
          if (!seq) {
            t()?.error('No se pudo generar folio. Reintenta.');
            return { message: 'No se pudo generar folio. Reintenta.' };
          }
          const folio = formatFolio(seq);

          // Build productos string from parsed items
          const productosStr = o.productos || items.map(i => `${i.qty}×${i.sku}`).join(', ');

          // Resolve cliente name
          let clienteNombre = s(o.cliente);
          if (!clienteNombre && o.clienteId) {
            const { data: cli, error: errCli } = await supabase.from('clientes').select('nombre').eq('id', o.clienteId).single();
            if (errCli) {
              console.warn('[addOrden] select clientes (no crítico):', errCli.message);
            }
            clienteNombre = cli?.nombre || 'Público en general';
          }
          if (!clienteNombre) clienteNombre = 'Público en general';

          // Build insert payload — only include columns that exist in ordenes table
          const ordenInsert = buildOrdenPayload(o, {
            folio,
            clienteNombre,
            total,
            productosStr,
          });

          const { data: newOrd, error: e1 } = await supabase.from('ordenes').insert(ordenInsert).select('id, folio, cliente_nombre, productos, total, estatus, fecha, metodo_pago, cliente_id, requiere_factura, direccion_entrega, referencia_entrega, latitud_entrega, longitud_entrega').single();
          if (e1) { t()?.error('Error al crear orden'); return e1; }

          const { error: e2 } = await supabase.from('orden_lineas').insert(
            lineas.map(l => ({ ...l, orden_id: newOrd.id }))
          );
          if (e2) {
            // Rollback: borrar la orden creada para evitar orden huérfana sin líneas
            await supabase.from('ordenes').delete().eq('id', newOrd.id);
            console.warn('[addOrden] insert orden_lineas, rollback orden:', e2.message);
            t()?.error('No se pudieron guardar las líneas — orden revertida');
            return e2;
          }

          await log('Crear', 'Órdenes', `${folio} — $${total}`);
          notify('venta', 'Nueva orden creada', `${folio} — ${clienteNombre} — $${total.toLocaleString()}`, '🧾', folio);
          rf();
          // Return the created order so callers can use it immediately
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
                const { data: existingCxc, error: errExCxc } = await supabase
                  .from('cuentas_por_cobrar')
                  .select('id')
                  .eq('orden_id', id)
                  .maybeSingle();
                if (errExCxc) {
                  console.warn('[updateOrdenEstatus] select existingCxc:', errExCxc.message);
                  downstreamError = errExCxc;
                } else if (!existingCxc) {
                  const fechaVenc = new Date();
                  fechaVenc.setDate(fechaVenc.getDate() + 30);
                  const { error: cxcError } = await supabase.from('cuentas_por_cobrar').insert({
                    cliente_id: ord.cliente_id,
                    orden_id: id,
                    fecha_venta: todayLocalISO(),
                    fecha_vencimiento: todayLocalISO(fechaVenc),
                    monto_original: centavos(n(ord.total)),
                    monto_pagado: 0,
                    saldo_pendiente: centavos(n(ord.total)),
                    concepto: `${s(ord.folio)} — ${cli?.nombre || 'Cliente'}`,
                    estatus: 'Pendiente',
                  });
                  if (cxcError) {
                    downstreamError = cxcError;
                  } else {
                    notify('credito', 'Venta a crédito', `${s(ord.folio)} — ${cli?.nombre || 'Cliente'} — $${n(ord.total).toLocaleString()} a 30 días`, '💳', s(ord.folio));
                    const { error: saldoError } = await supabase.rpc('increment_saldo', {
                      p_cli: ord.cliente_id,
                      p_delta: centavos(n(ord.total)),
                    });
                    if (saldoError) downstreamError = saldoError;
                  }
                }
              } else {
                const { data: existingIngreso, error: errExIng } = await supabase
                  .from('movimientos_contables')
                  .select('id')
                  .eq('orden_id', id)
                  .eq('tipo', 'Ingreso')
                  .eq('categoria', 'Ventas')
                  .maybeSingle();
                if (errExIng) {
                  console.warn('[updateOrdenEstatus] select existingIngreso:', errExIng.message);
                  downstreamError = errExIng;
                } else if (!existingIngreso) {
                  const { error: ingresoError } = await supabase.from('movimientos_contables').insert({
                    fecha: todayLocalISO(),
                    tipo: 'Ingreso', categoria: 'Ventas',
                    concepto: `Cobro ${s(ord.folio)} — ${cli?.nombre || 'Cliente'}`,
                    monto: centavos(n(ord.total)),
                    orden_id: id,
                  });
                  if (ingresoError) downstreamError = ingresoError;
                }
              }

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

          // Borrar CxC sin pagos (ya validamos monto_pagado === 0 arriba)
          if (cxc) {
            const { error: errDelCxc } = await supabase
              .from('cuentas_por_cobrar')
              .delete()
              .eq('id', cxc.id);
            if (errDelCxc) {
              console.warn('[cancelarOrden] delete cxc:', errDelCxc.message);
              t()?.error('No se pudo borrar la CxC asociada');
              return { error: errDelCxc.message };
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
      marcarNoEntregada: async (ordenId, motivo, reagendar = false) => {
        try {
          if (!ordenId) return { error: 'Orden requerida' };

          // 1. Leer orden + líneas
          const { data: orden, error: errOrd } = await supabase
            .from('ordenes')
            .select('id, folio, estatus, ruta_id')
            .eq('id', ordenId)
            .single();
          if (errOrd || !orden) {
            return { error: errOrd?.message || 'Orden no encontrada' };
          }

          // 2. Validación pura (FSM + motivo)
          const validErr = validateMarcarNoEntregada(orden, motivo);
          if (validErr) {
            t()?.error(validErr.error);
            return validErr;
          }

          const folio = s(orden.folio) || `ID ${ordenId}`;

          // 3. Leer líneas para devolver stock
          const { data: lineas, error: errLin } = await supabase
            .from('orden_lineas')
            .select('sku, cantidad')
            .eq('orden_id', ordenId);
          if (errLin) {
            console.warn('[marcarNoEntregada] select orden_lineas:', errLin.message);
            t()?.error('No se pudieron leer las líneas de la orden');
            return { error: errLin.message };
          }

          // 4. Calcular reverso (devolución al primer cuarto activo)
          const { data: cuartos, error: errCfs } = await supabase
            .from('cuartos_frios')
            .select('id, nombre, stock')
            .order('id');
          if (errCfs) {
            t()?.error('No se pudieron leer cuartos fríos');
            return { error: errCfs.message };
          }
          const { changes } = calcReversoChangesNoEntrega(
            lineas || [],
            cuartos || [],
            uname() || 'Chofer',
            folio
          );

          // 5. Aplicar reverso (entrada al cuarto). Si no hay líneas o el
          // total es 0, simplemente saltamos sin RPC.
          if (changes.length > 0) {
            const { error: errRpc } = await supabase.rpc('update_stocks_atomic', {
              p_changes: changes,
            });
            if (errRpc) {
              console.warn('[marcarNoEntregada] rpc update_stocks_atomic:', errRpc.message);
              t()?.error('No se pudo devolver el stock — orden NO marcada');
              return { error: 'No se pudo devolver el stock — orden NO marcada. ' + (errRpc.message || '') };
            }
          }

          // 6. UPDATE orden (estatus + tracking)
          const payload = buildNoEntregaPayload(motivo, reagendar);
          const { error: errUpd } = await supabase
            .from('ordenes')
            .update(payload)
            .eq('id', ordenId);
          if (errUpd) {
            // Best-effort revert del stock para no dejar discrepancia
            if (changes.length > 0) {
              const reverse = changes.map(c => ({ ...c, delta: -c.delta, tipo: 'Rollback no entregada', origen: `Rollback ${folio}` }));
              await supabase.rpc('update_stocks_atomic', { p_changes: reverse });
            }
            console.warn('[marcarNoEntregada] update orden:', errUpd.message);
            t()?.error('No se pudo marcar como No entregada — stock revertido');
            return { error: errUpd.message };
          }

          // 7. Audit
          const cantTxt = changes.length > 0
            ? changes.map(c => `${c.delta}×${c.sku}`).join(', ')
            : 'sin líneas';
          await log('No entregada', 'Órdenes',
            `${folio} — ${s(motivo)}${reagendar ? ' (reagendar)' : ''} — devuelto: ${cantTxt}`
          );

          rf();
          return undefined;
        } catch (e) {
          console.error('[marcarNoEntregada] excepción:', e);
          t()?.error('Error inesperado al marcar como No entregada');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // Edita orden en estatus 'Creada': UPDATE campos top-level + reemplazo
      // de líneas (DELETE + INSERT). Recalcula total desde las líneas nuevas.
      updateOrden: async (ordenId, payload = {}) => {
        try {
          if (!ordenId) return { error: 'Orden requerida' };

          const { data: ord, error: errOrd } = await supabase
            .from('ordenes')
            .select('estatus')
            .eq('id', ordenId)
            .single();
          if (errOrd || !ord) {
            const msg = errOrd?.message || 'Orden no encontrada';
            t()?.error(msg);
            return { error: msg };
          }

          // Validación pura — extraída a ordenLogic.validateEdicionOrden
          const edicionErr = validateEdicionOrden(s(ord.estatus));
          if (edicionErr) return edicionErr;

          const { lines, ...resto } = payload;

          // Si vienen líneas nuevas, recalcular total y validar SKUs/precios
          let totalNuevo = null;
          let lineasNuevas = null;
          if (Array.isArray(lines)) {
            const items = parseLineasEdicion(lines);
            const itemsErr = validateItems(items);
            if (itemsErr) return { error: itemsErr };

            const [{ data: prods }, { data: pes }] = await Promise.all([
              supabase.from('productos').select('sku, precio, stock'),
              supabase.from('precios_esp').select('sku, precio').eq('cliente_id', resto.clienteId || resto.cliente_id || null),
            ]);
            const built = buildLineas(items, prods || [], pes || []);
            if (built.error) return { error: built.error };
            totalNuevo = built.total;
            lineasNuevas = built.lineas;
          }

          // Construir UPDATE — extraído a ordenLogic.buildUpdateFieldsOrden
          const updateFields = buildUpdateFieldsOrden(resto, lineasNuevas, totalNuevo);

          if (Object.keys(updateFields).length > 0) {
            const { error: errUpd } = await supabase
              .from('ordenes')
              .update(updateFields)
              .eq('id', ordenId);
            if (errUpd) {
              t()?.error('No se pudieron actualizar los datos de la orden');
              return { error: errUpd.message };
            }
          }

          // Reemplazo atómico-ish de líneas: DELETE + INSERT
          if (lineasNuevas) {
            const { error: errDel } = await supabase
              .from('orden_lineas')
              .delete()
              .eq('orden_id', ordenId);
            if (errDel) {
              t()?.error('No se pudieron borrar las líneas previas');
              return { error: errDel.message };
            }
            const { error: errIns } = await supabase
              .from('orden_lineas')
              .insert(lineasNuevas.map(l => ({ ...l, orden_id: ordenId })));
            if (errIns) {
              t()?.error('Error al insertar líneas nuevas — orden quedó sin líneas');
              return { error: errIns.message, partial: true };
            }
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
      addProduccion: async (p) => {
        const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_op_seq' });
        const folio = `OP-${String(seq || 89).padStart(3, '0')}`;
        const { error } = await supabase.from('produccion').insert({
          folio, turno: p.turno, maquina: p.maquina,
          sku: p.sku, cantidad: Number(p.cantidad),
        });
        if (error) { t()?.error('Error al registrar producción'); return error; }
        log('Producir', 'Producción', `${folio} — ${p.sku} x${Number(p.cantidad)}`);
        notify('produccion', 'Producción registrada', `${folio} — ${Number(p.cantidad).toLocaleString()} ${p.sku}`, '🏭', folio);

        const qty = Number(p.cantidad || 0);
        if (qty > 0) {
          // Siempre buscar en DB — nunca usar fallback hardcoded para SKUs
          let empaqueSku = null;
          const { data: prodRow, error: prodErr } = await supabase
            .from('productos').select('empaque_sku').eq('sku', p.sku).maybeSingle();
          if (prodErr) {
            notify('advertencia', 'Advertencia producción', `No se pudo leer el empaque de ${p.sku}`, '⚠️', folio);
          } else if (prodRow?.empaque_sku) {
            empaqueSku = prodRow.empaque_sku;
          }

          if (empaqueSku) {
            const { data: empaqueProd, error: empaqueErr } = await supabase
              .from('productos').select('id, stock').eq('sku', empaqueSku).single();

            if (!empaqueErr && empaqueProd) {
              const stockOriginal = Number(empaqueProd.stock || 0);
              const newStock = Math.max(0, stockOriginal - qty);
              const { error: updateErr } = await supabase.from('productos')
                .update({ stock: newStock }).eq('id', empaqueProd.id);

              if (updateErr) {
                notify('advertencia', 'Error empaque', `No se pudo decrementar ${empaqueSku} en producción ${folio}`, '⚠️', folio);
              } else {
                const { error: movErr } = await supabase.from('inventario_mov').insert({
                  tipo: 'Salida', producto: empaqueSku, cantidad: qty,
                  origen: `Producción ${folio}`, usuario: uname(),
                });
                if (movErr) {
                  // Revertir el decremento de stock si falla el movimiento
                  await supabase.from('productos').update({ stock: stockOriginal }).eq('id', empaqueProd.id);
                  notify('advertencia', 'Error empaque', `No se pudo registrar movimiento de ${empaqueSku} — stock revertido`, '⚠️', folio);
                }
              }
            }
          }
        }
        rf();
      },

      confirmarProduccion: async (id) => {
        // Obtener datos de la producción antes de confirmar
        const { data: prod } = await supabase.from('produccion').select('*').eq('id', id).single();
        
        // Confirmar en backend (actualiza productos.stock)
        const { error } = await supabase.rpc('confirmar_produccion', { p_produccion_id: id, p_usuario_id: uid() });
        if (error) { t()?.error('Error al confirmar producción'); return error; }

        // Añadir el producto al cuarto frío para que esté disponible en rutas
        if (prod) {
          const qty = Number(prod.cantidad || 0);
          if (qty > 0 && prod.sku) {
            const { data: cfsConf } = await supabase.from('cuartos_frios').select('id').order('id').limit(1);
            if (cfsConf && cfsConf.length > 0) {
              await supabase.rpc('update_stocks_atomic', {
                p_changes: [{ cuarto_id: cfsConf[0].id, sku: prod.sku, delta: qty, tipo: 'Entrada', origen: `Producción ${prod.folio || id}`, usuario: uname() }],
              });
            }
          }
        }

        // Calcular costo de producción (costo del empaque consumido)
        if (prod) {
          const cantidad = Number(prod.cantidad || 0);
          // Buscar el producto y su empaque asociado
          const { data: producto } = await supabase.from('productos').select('sku, empaque_sku').eq('sku', prod.sku).single();
          if (producto?.empaque_sku) {
            // Buscar costo del empaque
            const { data: empaque } = await supabase.from('productos').select('costo_unitario').eq('sku', producto.empaque_sku).single();
            const costoUnitario = Number(empaque?.costo_unitario || 0);
            const costoTotal = centavos(cantidad * costoUnitario);
            
            if (costoTotal > 0) {
              const hoy = todayLocalISO();
              const periodo = hoy.slice(0, 7);
              const concepto = `Producción ${prod.folio || id}: ${cantidad}× ${prod.sku} (empaque: ${producto.empaque_sku})`;

              // Actualizar costo en la producción
              await supabase.from('produccion').update({
                costo_empaque: costoUnitario,
                costo_total: costoTotal,
              }).eq('id', id);

              // Registrar costo de producción en historial
              await supabase.from('costos_historial').insert({
                tipo: 'Producción',
                categoria: 'Costo de Ventas',
                concepto,
                monto: costoTotal,
                periodo,
                fecha: hoy,
              });

              // Registrar egreso contable para que aparezca en estado de resultados
              await supabase.from('movimientos_contables').insert({
                fecha: hoy,
                tipo: 'Egreso',
                categoria: 'Costo de Ventas',
                concepto,
                monto: costoTotal,
              });
            }
          }
        }
        
        log('Confirmar', 'Producción', `ID ${id}`);
        notify('produccion', 'Producción confirmada', `Orden ${prod?.folio || id} confirmada`, '✅', prod?.folio || String(id));
        rf();
      },

      updateProduccion: async (id, fields) => {
        // SKU NO es editable: cambiar SKU requeriría revertir stock. Si
        // admin se equivoca, debe Eliminar (con reverso) y volver a registrar.
        // Cantidad sí editable pero NO toca stock — admin ajusta manualmente
        // via InventarioView si la corrección lo amerita.
        // Construcción del payload pura — extraída a produccionLogic.
        const upd = buildUpdateFieldsProduccion(fields);
        if (!upd) return { error: 'Nada que actualizar' };
        const { error } = await supabase.from('produccion').update(upd).eq('id', id);
        if (error) { t()?.error('Error al actualizar producción'); return error; }
        log('Editar', 'Producción', `ID ${id} — ${Object.keys(upd).join(', ')}`);
        rf();
      },

      // Borra producción regresando el stock al cuarto frío disponible
      // (FIFO inverso multi-cuarto). Si el stock ya se consumió y no hay
      // suficiente disponible, la migración 047 hace RAISE EXCEPTION y
      // la eliminación falla con mensaje claro.
      deleteProduccion: async (id) => {
        try {
          if (!id) return { error: 'Producción requerida' };

          // 1. SELECT producción
          const { data: prod, error: errSel } = await supabase
            .from('produccion')
            .select('id, folio, sku, cantidad, tipo')
            .eq('id', id)
            .single();
          if (errSel || !prod) {
            return { error: errSel?.message || 'Producción no encontrada' };
          }

          const sku = s(prod.sku);
          const cant = n(prod.cantidad);
          const folio = s(prod.folio) || `ID ${id}`;
          // Las transformaciones tienen tipo='Transformacion' y otra lógica
          // de stock; aquí solo manejamos producción normal.
          const esTransformacion = s(prod.tipo) === 'Transformacion';

          // 2. Borrado sin reverso si no hay nada que revertir
          if (esTransformacion || !sku || cant <= 0) {
            const { error: errDel } = await supabase.from('produccion').delete().eq('id', id);
            if (errDel) { t()?.error('Error al eliminar producción'); return { error: errDel.message }; }
            await log('Eliminar (sin reverso)', 'Producción', `${folio} — ${esTransformacion ? 'transformación' : 'sin cantidad/SKU'}`);
            rf();
            return undefined;
          }

          // 3. FIFO inverso: distribuir el descuento entre cuartos con stock
          const { data: cuartos, error: errCfs } = await supabase
            .from('cuartos_frios')
            .select('id, nombre, stock')
            .order('id');
          if (errCfs) {
            t()?.error('No se pudieron leer cuartos fríos');
            return { error: errCfs.message };
          }
          // Distribución pura — extraída a produccionLogic.
          const { changes, faltante } = calcReversoChangesProduccion(
            { sku, cantidad: cant, folio },
            cuartos || [],
            uname() || 'Admin'
          );
          if (faltante > 0) {
            const msg = `No se puede eliminar: faltan ${faltante} ${sku} en cuartos fríos (probablemente ya se vendió o salió).`;
            t()?.error(msg);
            return { error: msg };
          }

          // 4. Aplicar reverso
          if (changes.length > 0) {
            const { error: errRpc } = await supabase.rpc('update_stocks_atomic', { p_changes: changes });
            if (errRpc) {
              console.warn('[deleteProduccion] rpc update_stocks_atomic:', errRpc.message);
              t()?.error('No se pudo regresar el stock — producción NO eliminada');
              return { error: 'No se pudo regresar el stock — producción NO eliminada. ' + (errRpc.message || '') };
            }
          }

          // 5. Borrar la fila
          const { error: errDel } = await supabase.from('produccion').delete().eq('id', id);
          if (errDel) {
            console.warn('[deleteProduccion] CRÍTICO: stock revertido pero producción no se pudo borrar:', errDel);
            t()?.error('Stock regresado pero la producción no se pudo borrar. Revísalo en Supabase.');
            return { error: 'Stock regresado pero la producción no se pudo borrar. Revísalo en Supabase.' };
          }

          await log('Eliminar con reverso', 'Producción', `${folio} — ${cant}×${sku}`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[deleteProduccion] excepción:', e);
          t()?.error('Error inesperado al eliminar producción');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      producirYCongelar: async (p) => {
        const errProd = await a.addProduccion(p);
        if (errProd) return errProd;

        if (p.destino) {
          const errMeter = await a.meterACuartoFrio(p.destino, p.sku, Number(p.cantidad));
          if (errMeter) {
            // La producción ya quedó registrada pero no entró al CF.
            // Rollback completo (eliminar la producción) es complejo y puede
            // confundir; admin puede meterla al CF manualmente desde Inventario.
            console.warn('[producirYCongelar] producción ok pero meterACuartoFrio falló:', errMeter?.message || errMeter);
            return {
              error: errMeter?.message || 'Producción registrada pero no entró al cuarto frío',
              partial: true,
            };
          }
        }

        return undefined;
      },

      // ── TRANSFORMACIÓN: barra → hielo triturado/picado ──
      // input_sku: SKU de la barra consumida (ej. BH-50K)
      // input_kg: kg totales de barra consumidos
      // output_sku: SKU del producto derivado (ej. HT-TRITURADO)
      // output_kg: kg totales de producto obtenido
      // merma_kg se calcula automáticamente como input_kg - output_kg
      addTransformacion: async ({ input_sku, input_kg, output_sku, output_kg, notas }) => {
        const inputKg  = Number(input_kg  || 0);
        const outputKg = Number(output_kg || 0);
        if (inputKg <= 0 || outputKg <= 0) return new Error('Cantidades inválidas');
        if (outputKg > inputKg) return new Error('El output no puede ser mayor al input');

        const mermaKg      = Math.max(0, inputKg - outputKg);
        const rendimiento  = Math.round((outputKg / inputKg) * 10000) / 100; // e.g. 78.40

        // Verificar stock del insumo (input_sku en productos.stock)
        const { data: inputProd, error: inputErr } = await supabase
          .from('productos').select('id, stock, nombre').eq('sku', input_sku).single();
        if (inputErr || !inputProd) return new Error('Insumo no encontrado: ' + input_sku);
        if (Number(inputProd.stock || 0) < inputKg) {
          return new Error(`Stock insuficiente de ${input_sku}: tienes ${inputProd.stock} kg, necesitas ${inputKg}`);
        }

        const { data: outputProd, error: outputErr } = await supabase
          .from('productos').select('id, stock, nombre').eq('sku', output_sku).single();
        if (outputErr || !outputProd) return new Error('Producto derivado no encontrado: ' + output_sku);

        const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_op_seq' });
        const folio = `TR-${String(seq || 1).padStart(3, '0')}`;
        const hoy   = todayLocalISO();

        // Registrar la transformación en produccion
        const { error: insErr } = await supabase.from('produccion').insert({
          folio,
          fecha:          hoy,
          turno:          'Transformación',
          maquina:        'Manual',
          sku:            output_sku,
          cantidad:       Math.round(outputKg),
          estatus:        'Confirmada',
          tipo:           'Transformacion',
          input_sku,
          input_kg:       inputKg,
          output_kg:      outputKg,
          merma_kg:       mermaKg,
          rendimiento,
          destino:        notas || null,
        });
        if (insErr) { t()?.error('Error al registrar transformación'); return insErr; }

        // Descontar insumo (barras)
        const { error: e2 } = await supabase.from('productos')
          .update({ stock: Math.max(0, Number(inputProd.stock) - inputKg) })
          .eq('id', inputProd.id);
        if (e2) { t()?.error('Error al descontar insumo'); return e2; }

        // Incrementar producto derivado (triturado)
        const { error: e3 } = await supabase.from('productos')
          .update({ stock: Number(outputProd.stock || 0) + outputKg })
          .eq('id', outputProd.id);
        if (e3) {
          // Rollback: restaurar stock del insumo
          await supabase.from('productos').update({ stock: Number(inputProd.stock) }).eq('id', inputProd.id);
          t()?.error('Error al incrementar producto derivado');
          return e3;
        }

        // Movimientos de inventario
        const now = new Date().toISOString();
        const { error: e4 } = await supabase.from('inventario_mov').insert([
          { tipo: 'Salida',  producto: input_sku,  cantidad: inputKg,  origen: `Transformación ${folio}`, usuario: uname(), fecha: now },
          { tipo: 'Entrada', producto: output_sku, cantidad: outputKg, origen: `Transformación ${folio}`, usuario: uname(), fecha: now },
        ]);
        if (e4) { t()?.error('Error al registrar movimientos de inventario'); }

        // Registrar merma si la hay
        if (mermaKg > 0) {
          await supabase.from('mermas').insert({
            sku:      input_sku,
            cantidad: Math.round(mermaKg),
            causa:    'Merma de proceso — transformación',
            origen:   `Transformación ${folio}`,
            foto_url: '',
          });
        }

        log('Transformar', 'Producción', `${folio} — ${inputKg}kg ${input_sku} → ${outputKg}kg ${output_sku} (merma ${mermaKg}kg, rend. ${rendimiento}%)`);
        rf();
        return null;
      },

      // ── CUARTOS FRÍOS — CRUD ──
      // cuartos_frios.id es TEXT (ver migración 023). No tiene auto-increment
      // ni default, así que el id se genera client-side con patrón "CF-N"
      // tomando el siguiente número libre desde los existentes.
      addCuartoFrio: async (cf) => {
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
        const update = {};
        if (cf.nombre    !== undefined) update.nombre    = cf.nombre;
        if (cf.temp      !== undefined) update.temp      = cf.temp;
        if (cf.capacidad_tarimas !== undefined) update.capacidad_tarimas = Number(cf.capacidad_tarimas) || 0;
        const { error } = await supabase.from('cuartos_frios').update(update).eq('id', id);
        if (error) { t()?.error('Error al actualizar cuarto frío'); return error; }
        log('Editar', 'Cuartos Fríos', `ID ${id}`);
        rf();
      },

      // Bloquea DELETE si el cuarto tiene stock asociado para evitar pérdida
      // silenciosa de inventario. El admin debe vaciar/trasladar el stock primero.
      deleteCuartoFrio: async (id) => {
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
      meterACuartoFrio: async (cfId, sku, cantidad) => {
        const { data: row, error: rowErr } = await supabase
          .from('cuartos_frios').select('stock').eq('id', cfId).single();
        if (rowErr) { t()?.error('Error al leer cuarto frío'); return rowErr; }
        const current = (row?.stock && typeof row.stock === 'object') ? row.stock : {};
        const updated = { ...current, [sku]: (Number(current[sku] || 0) + Number(cantidad)) };
        const { error: updateErr } = await supabase.from('cuartos_frios').update({ stock: updated }).eq('id', cfId);
        if (updateErr) { t()?.error('Error al actualizar cuarto frío'); return updateErr; }
        const { error: movErr } = await supabase.from('inventario_mov').insert({
          tipo: 'Entrada', producto: sku, cantidad: Number(cantidad),
          origen: `Entrada a ${cfId}`, usuario: uname(),
        });
        if (movErr) {
          await supabase.from('cuartos_frios').update({ stock: current }).eq('id', cfId);
          t()?.error('Error al registrar movimiento de inventario');
          return movErr;
        }
        log('Entrada CF', 'Cuartos Fríos', `${cantidad}×${sku} → ${cfId}`);
        rf();
      },

      sacarDeCuartoFrio: async (cfId, sku, cantidad, motivo) => {
        try {
          const { data: row, error: rowErr } = await supabase
            .from('cuartos_frios').select('stock').eq('id', cfId).single();
          if (rowErr) { t()?.error('Error al leer cuarto frío'); return rowErr; }
          const current = (row?.stock && typeof row.stock === 'object') ? row.stock : {};
          const actual = Number(current[sku] || 0);
          const qty = Number(cantidad);
          if (qty <= 0) return { message: 'Cantidad inválida' };
          if (actual < qty) {
            t()?.error('Inventario insuficiente en cuarto frío');
            return { message: 'Inventario insuficiente en cuarto frío' };
          }
          const updated = {
            ...current,
            [sku]: actual - qty,
          };
          const { error: updateErr } = await supabase.from('cuartos_frios').update({ stock: updated }).eq('id', cfId);
          if (updateErr) { t()?.error('Error al actualizar cuarto frío'); return updateErr; }
          const { error: movErr } = await supabase.from('inventario_mov').insert({
            tipo: 'Salida', producto: sku, cantidad: qty,
            origen: motivo || String(cfId), usuario: uname(),
          });
          if (movErr) {
            await supabase.from('cuartos_frios').update({ stock: current }).eq('id', cfId);
            t()?.error('Error al registrar movimiento de inventario');
            return movErr;
          }
          log('Salida CF', 'Cuartos Fríos', `${cantidad}×${sku} de ${cfId} — ${motivo || 'Sin motivo'}`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[sacarDeCuartoFrio] excepción:', e);
          t()?.error('Error inesperado al sacar del cuarto frío');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      traspasoEntreUbicaciones: async ({ origen, destino, sku, cantidad }) => {
        try {
          const qty = Number(cantidad);
          if (qty <= 0) return { message: 'Cantidad inválida' };
          if (origen === destino) return { message: 'Origen y destino deben ser diferentes' };

          const [{ data: rowOrig, error: errO }, { data: rowDest, error: errD }] = await Promise.all([
            supabase.from('cuartos_frios').select('stock').eq('id', origen).single(),
            supabase.from('cuartos_frios').select('stock').eq('id', destino).single(),
          ]);
          if (errO || errD || !rowOrig || !rowDest) { t()?.error('Error al leer cuartos fríos'); return errO || errD; }

          const stockOrig = (rowOrig?.stock && typeof rowOrig.stock === 'object') ? rowOrig.stock : {};
          const stockDest = (rowDest?.stock && typeof rowDest.stock === 'object') ? rowDest.stock : {};
          const disponible = Number(stockOrig[sku] || 0);
          if (disponible < qty) { t()?.error(`Stock insuficiente: ${disponible} disponible, se requieren ${qty}`); return { message: 'Stock insuficiente' }; }

          // Actualizar origen primero
          const { error: e1 } = await supabase.from('cuartos_frios').update({
            stock: { ...stockOrig, [sku]: disponible - qty },
          }).eq('id', origen);
          if (e1) { t()?.error('Error al descontar de origen'); return e1; }

          const { error: e2 } = await supabase.from('cuartos_frios').update({
            stock: { ...stockDest, [sku]: Number(stockDest[sku] || 0) + qty },
          }).eq('id', destino);
          if (e2) {
            // Rollback origen
            await supabase.from('cuartos_frios').update({ stock: stockOrig }).eq('id', origen);
            t()?.error('Error al incrementar destino — traspaso revertido');
            return e2;
          }

          // Registrar movimiento (secundario): si falla NO se hace rollback
          // de los stocks porque el traspaso real sí ocurrió.
          const { error: errMov } = await supabase.from('inventario_mov').insert({
            tipo: 'Traspaso', producto: sku, cantidad: qty,
            origen: `${origen} → ${destino}`, usuario: uname(),
          });
          if (errMov) {
            console.warn('[traspasoEntreUbicaciones] insert inventario_mov (no crítico):', errMov.message);
            t()?.error('Traspaso aplicado, pero el movimiento de inventario no se registró.');
            log('Traspaso', 'Cuartos Fríos', `${qty}×${sku} de ${origen} → ${destino}`);
            rf();
            return { error: errMov.message, partial: true };
          }

          log('Traspaso', 'Cuartos Fríos', `${qty}×${sku} de ${origen} → ${destino}`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[traspasoEntreUbicaciones] excepción:', e);
          t()?.error('Error inesperado en traspaso');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      ajustarStockCuarto: async ({ cuartoId, ajustes, motivo }) => {
        try {
          if (!cuartoId) return { message: 'Cuarto frío requerido' };
          if (!Array.isArray(ajustes) || ajustes.length === 0) return { message: 'Sin ajustes' };
          const motivoTxt = String(motivo || '').trim();
          if (!motivoTxt) return { message: 'Motivo requerido' };

          const { data: cuarto, error: cfErr } = await supabase
            .from('cuartos_frios')
            .select('id,nombre,stock')
            .eq('id', cuartoId)
            .single();
          if (cfErr || !cuarto) { t()?.error('Error al leer cuarto frío'); return cfErr || { message: 'Cuarto no encontrado' }; }

          const stockPrev = (cuarto.stock && typeof cuarto.stock === 'object') ? { ...cuarto.stock } : {};
          const stockNuevo = { ...stockPrev };
          const cambiosReales = [];

          for (const a of ajustes) {
            const sku = String(a?.sku || '').trim();
            if (!sku) continue;
            const nueva = Number(a?.nuevaCantidad);
            if (!Number.isFinite(nueva) || nueva < 0) continue;
            const actual = Number(stockPrev[sku] || 0);
            if (nueva === actual) continue;
            if (nueva === 0) {
              delete stockNuevo[sku];
            } else {
              stockNuevo[sku] = nueva;
            }
            cambiosReales.push({ sku, actual, nueva, delta: nueva - actual });
          }

          if (cambiosReales.length === 0) return { message: 'Sin cambios reales' };

          const { error: updErr } = await supabase
            .from('cuartos_frios')
            .update({ stock: stockNuevo })
            .eq('id', cuartoId);
          if (updErr) { t()?.error('Error al actualizar stock del cuarto frío'); return updErr; }

          const movRows = cambiosReales.map(c => ({
            tipo: c.delta >= 0 ? 'Entrada' : 'Salida',
            producto: c.sku,
            cantidad: Math.abs(c.delta),
            origen: `Ajuste ${s(cuarto.nombre)}: ${motivoTxt}`,
            usuario: uname(),
          }));
          const { error: movErr } = await supabase.from('inventario_mov').insert(movRows);
          if (movErr) {
            console.warn('[ajustarStockCuarto] insert inventario_mov (no crítico):', movErr.message);
            t()?.error('Stock ajustado, pero el movimiento de inventario no se registró.');
          }

          // Sincronizar productos.stock con la suma global (solo SKUs afectados)
          const skusAfectados = cambiosReales.map(c => c.sku);
          const { data: cuartosTodos, error: cfTodosErr } = await supabase
            .from('cuartos_frios')
            .select('stock');
          if (!cfTodosErr && Array.isArray(cuartosTodos)) {
            const totales = {};
            for (const sku of skusAfectados) totales[sku] = 0;
            for (const cf of cuartosTodos) {
              const st = (cf.stock && typeof cf.stock === 'object') ? cf.stock : {};
              for (const sku of skusAfectados) {
                totales[sku] += Number(st[sku] || 0);
              }
            }
            const updates = skusAfectados.map(sku =>
              supabase.from('productos').update({ stock: totales[sku] }).eq('sku', sku)
            );
            const results = await Promise.all(updates);
            const failed = results.find(r => r.error);
            if (failed?.error) {
              console.warn('[ajustarStockCuarto] sync productos.stock:', failed.error.message);
              t()?.error('Stock ajustado, pero la sincronización de productos falló.');
            }
          }

          const detalle = cambiosReales
            .map(c => `${c.sku}: ${c.actual} → ${c.nueva}`)
            .join(', ');
          await log('Ajustar', 'Cuartos Fríos', `${s(cuarto.nombre)} — ${detalle}. Motivo: ${motivoTxt}`);

          rf();
          return undefined;
        } catch (e) {
          console.error('[ajustarStockCuarto] excepción:', e);
          t()?.error('Error inesperado al ajustar stock del cuarto');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      ajustarExistenciaManual: async ({ sku, nuevaExistencia, motivo }) => {
        const target = Number(nuevaExistencia);
        if (!sku || Number.isNaN(target) || target < 0) {
          const err = { message: 'Datos de ajuste inválidos' };
          t()?.error(err.message);
          return err;
        }

        const { data: cuartos, error: cfErr } = await supabase
          .from('cuartos_frios')
          .select('id,nombre,stock');

        if (cfErr) {
          t()?.error('Error al leer cuartos fríos');
          return cfErr;
        }

        const rooms = (cuartos || []).map(cf => ({
          ...cf,
          stockObj: (cf.stock && typeof cf.stock === 'object') ? { ...cf.stock } : {},
          currentQty: Number((cf.stock && typeof cf.stock === 'object') ? (cf.stock[sku] || 0) : 0),
        }));

        const actual = rooms.reduce((acc, cf) => acc + cf.currentQty, 0);
        const delta = target - actual;

        if (delta !== 0) {
          if (delta > 0) {
            const targetRoom = rooms.find(cf => cf.currentQty > 0) || rooms[0];
            if (!targetRoom) {
              const err = { message: 'No hay cuartos fríos para aplicar ajuste' };
              t()?.error(err.message);
              return err;
            }
            targetRoom.stockObj[sku] = Number(targetRoom.currentQty) + delta;
          } else {
            let remaining = Math.abs(delta);
            for (const room of rooms) {
              if (remaining <= 0) break;
              const qty = Number(room.stockObj[sku] || 0);
              if (qty <= 0) continue;
              const take = Math.min(qty, remaining);
              room.stockObj[sku] = qty - take;
              remaining -= take;
            }
            if (remaining > 0) {
              const err = { message: 'No se pudo descontar ajuste completo' };
              t()?.error(err.message);
              return err;
            }
          }

          const updates = rooms
            .filter(room => Number(room.stockObj[sku] || 0) !== Number(room.currentQty || 0))
            .map(room => supabase.from('cuartos_frios').update({ stock: room.stockObj }).eq('id', room.id));

          if (updates.length > 0) {
            const results = await Promise.all(updates);
            const failed = results.find(r => r.error);
            if (failed?.error) {
              t()?.error('Error al actualizar stock en cuartos fríos');
              return failed.error;
            }
          }
        }

        const { error: prodErr } = await supabase.from('productos').update({ stock: target }).eq('sku', sku);
        if (prodErr) { t()?.error('Error al actualizar stock de producto'); return prodErr; }

        const { error: movErr } = await supabase.from('inventario_mov').insert({
          tipo: delta >= 0 ? 'Entrada' : 'Salida',
          producto: sku,
          cantidad: Math.abs(delta),
          origen: `Ajuste manual: ${motivo || 'Sin motivo'}`,
          usuario: uname(),
        });
        if (movErr) { t()?.error('Error al registrar movimiento de inventario'); }

        await log('Ajustar', 'Inventario', `${sku}: ${actual} → ${target}. Motivo: ${motivo || 'Sin motivo'}`);

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
        if (error) { t()?.error('Error al crear ruta'); return error; }

        // Fase 18: ya NO se descuenta inventario al autorizar.
        // El descuento ocurre cuando el chofer confirma carga (confirmarCargaRuta).

        // Log con detalle de carga autorizada
        const cargaTxt = Object.entries(cargaObj).map(([sku, qty]) => `${qty}×${sku}`).join(', ') || '—';
        log('Autorizar', 'Rutas', `${folio} — ${r.nombre} — Autorizado: ${cargaTxt}`);
        rf();
        return { id: newRuta?.id, folio };
      },

      confirmarCargaRuta: async (rutaId, cargaReal) => {
        // cargaReal: { "HC-25K": 80, "HC-5K": 50, ... } — lo que el chofer realmente cargó
        const inputErr = validateConfirmarCarga(rutaId, cargaReal);
        if (inputErr) {
          t()?.error('Datos de carga inválidos');
          return new Error(inputErr.error);
        }

        // Obtener la ruta para validar
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

        if (ruta.estatus === 'Cerrada' || ruta.estatus === 'Completada') {
          t()?.error('No se puede cargar una ruta cerrada');
          return new Error('Ruta cerrada');
        }

        // Validar que cargaReal no excede carga_autorizada + extra_autorizado
        const exceso = excedeAutorizacion(cargaReal, ruta.carga_autorizada, ruta.extra_autorizado);
        if (exceso) {
          t()?.error(`No puedes cargar ${exceso.qty} de ${exceso.sku}. Máximo autorizado: ${exceso.max}`);
          return new Error(`Excede autorización: ${exceso.sku}`);
        }

        // Obtener cuartos fríos para calcular distribución del descuento
        const { data: cuartos, error: cfErr } = await supabase
          .from('cuartos_frios').select('id, stock').order('id');
        if (cfErr) {
          t()?.error('Error al consultar cuartos fríos');
          return cfErr;
        }
        if (!cuartos || cuartos.length === 0) {
          t()?.error('No hay cuartos fríos configurados');
          return new Error('Sin cuartos fríos');
        }

        // Calcular cambios distribuyendo el descuento entre cuartos fríos
        const { changes, faltantes } = calcularChangesInventario(cargaReal, cuartos, {
          folio: ruta.folio,
          usuario: uname() || 'Chofer',
        });
        if (faltantes.length > 0) {
          const f = faltantes[0];
          const qtyNeeded = Number(cargaReal[f.sku]);
          t()?.error(`Inventario insuficiente para cargar ${qtyNeeded} de ${f.sku}`);
          return new Error(`Stock insuficiente: ${f.sku}`);
        }

        // Claim atómico ANTES de descontar inventario: solo un dispositivo
        // pasa este UPDATE (carga_confirmada_at IS NULL). Cierra el TOCTOU
        // del check anterior, que era reproducible con dos dispositivos
        // del mismo chofer enviando confirmación al mismo tiempo.
        const estatusOriginal = ruta.estatus;
        const { data: claim, error: claimErr } = await supabase.from('rutas').update({
          carga_real: cargaReal,
          carga_confirmada_at: new Date().toISOString(),
          carga_confirmada_por: uid(),
          estatus: 'Cargada',
        }).eq('id', rutaId).is('carga_confirmada_at', null).select('id');
        if (claimErr) {
          t()?.error('No se pudo confirmar la carga');
          return claimErr;
        }
        if (!claim || claim.length === 0) {
          t()?.error('Esta ruta ya fue confirmada por otro dispositivo');
          return new Error('Carga ya confirmada (claim race)');
        }

        // Aplicar descuentos atómicamente. Si falla, revertir el claim
        // para que la ruta vuelva a estar disponible para confirmar.
        if (changes.length > 0) {
          const { error: rpcErr } = await supabase.rpc('update_stocks_atomic', {
            p_changes: changes,
          });
          if (rpcErr) {
            await supabase.from('rutas').update({
              carga_real: null,
              carga_confirmada_at: null,
              carga_confirmada_por: null,
              estatus: estatusOriginal,
            }).eq('id', rutaId);
            t()?.error('Error al descontar inventario');
            return rpcErr;
          }
        }

        await checkStockBajo(Object.keys(cargaReal));
        const cargaTxt = Object.entries(cargaReal).map(([sku, qty]) => `${qty}×${sku}`).join(', ') || '—';
        await log('Confirmar carga', 'Rutas', `${ruta.folio} — ${cargaTxt}`);
        rf();
        return null;
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
        // Producción/Admin firma la carga. Esto sí descuenta inventario.
        // opciones: { excepcion: bool, motivoExcepcion: string }
        const inputErr = validateFirmarCarga(rutaId, firmaBase64, opciones);
        if (inputErr) {
          // Mensajes específicos al usuario según qué falló
          if (inputErr.error === 'Sin ruta') t()?.error('Ruta inválida');
          else if (inputErr.error === 'Sin firma') t()?.error('Firma requerida');
          else if (inputErr.error === 'Sin justificación') t()?.error('Justificación requerida para carga sin firma');
          return new Error(inputErr.error);
        }

        const { data: ruta, error: rutaErr } = await supabase
          .from('rutas')
          .select('id, folio, estatus, carga_real, carga_confirmada_at')
          .eq('id', rutaId)
          .single();
        if (rutaErr || !ruta) {
          t()?.error('Ruta no encontrada');
          return rutaErr || new Error('No encontrada');
        }

        const checkRuta = puedeFirmarRuta(ruta);
        if (!checkRuta.ok) {
          if (checkRuta.razon === 'Ya confirmada') t()?.error('Carga ya confirmada anteriormente');
          else if (checkRuta.razon === 'Sin carga') t()?.error('No hay carga real registrada');
          return new Error(checkRuta.razon);
        }
        const cargaReal = checkRuta.cargaReal;

        // Descontar inventario de cuartos fríos
        const { data: cuartos, error: cfErr } = await supabase
          .from('cuartos_frios').select('id, stock').order('id');
        if (cfErr) {
          t()?.error('Error al consultar cuartos fríos');
          return cfErr;
        }
        if (!cuartos || cuartos.length === 0) {
          t()?.error('No hay cuartos fríos');
          return new Error('Sin cuartos fríos');
        }

        const { changes, faltantes } = calcularChangesInventario(cargaReal, cuartos, {
          folio: ruta.folio,
          usuario: uname() || 'Sistema',
          origenSuffix: opciones.excepcion ? ' (sin firma)' : '',
        });
        if (faltantes.length > 0) {
          const f = faltantes[0];
          t()?.error(`Inventario insuficiente: ${f.sku}`);
          return new Error(`Stock insuficiente: ${f.sku}`);
        }

        // Claim atómico de la firma ANTES de descontar inventario:
        // solo un firmante (Producción/Admin) pasa el UPDATE con
        // carga_confirmada_at IS NULL. Cierra el TOCTOU del check
        // puedeFirmarRuta arriba.
        const estatusOriginal = ruta.estatus;
        const updateData = {
          carga_confirmada_at: new Date().toISOString(),
          carga_confirmada_por: uid(),
          estatus: 'Cargada',
        };
        if (opciones.excepcion) {
          updateData.firma_excepcion = true;
          updateData.firma_excepcion_motivo = s(opciones.motivoExcepcion).trim();
          updateData.firma_carga = null;
        } else {
          updateData.firma_carga = firmaBase64;
          updateData.firma_excepcion = false;
        }

        const { data: claim, error: claimErr } = await supabase
          .from('rutas')
          .update(updateData)
          .eq('id', rutaId)
          .is('carga_confirmada_at', null)
          .select('id');
        if (claimErr) {
          t()?.error('No se pudo registrar firma');
          return claimErr;
        }
        if (!claim || claim.length === 0) {
          t()?.error('Esta carga ya fue firmada por otro dispositivo');
          return new Error('Carga ya firmada (claim race)');
        }

        // Descontar inventario. Si falla, revertir el claim de firma.
        if (changes.length > 0) {
          const { error: rpcErr } = await supabase.rpc('update_stocks_atomic', {
            p_changes: changes,
          });
          if (rpcErr) {
            await supabase.from('rutas').update({
              carga_confirmada_at: null,
              carga_confirmada_por: null,
              firma_carga: null,
              firma_excepcion: false,
              firma_excepcion_motivo: null,
              estatus: estatusOriginal,
            }).eq('id', rutaId);
            t()?.error('Error al descontar inventario');
            return rpcErr;
          }
        }

        await checkStockBajo(Object.keys(cargaReal));
        const tipo = opciones.excepcion ? 'Carga sin firma' : 'Firma carga';
        const detalle = opciones.excepcion
          ? `${ruta.folio} — Excepción: ${opciones.motivoExcepcion}`
          : `${ruta.folio} — Firmado`;
        await log(tipo, 'Rutas', detalle);
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
        if (error) { t()?.error('Error al actualizar ruta'); return error; }
        log('Editar', 'Rutas', `Ruta #${id}`);
        rf();
      },

      deleteRuta: async (id) => {
        const { error } = await supabase.from('rutas').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar ruta'); return error; }
        log('Eliminar', 'Rutas', `ID ${id}`);
        rf();
      },

      asignarOrdenesARuta: async (rutaId, ordenIds, totalBolsas) => {
        // 1. Asignar ruta_id a todas las órdenes seleccionadas
        await supabase.from('ordenes').update({ ruta_id: rutaId }).in('id', ordenIds);

        // 2. Mover Creada → Asignada (FSM correcto: chofer luego puede pasar a Entregada).
        //    Solo afecta las que estén en 'Creada'; respeta órdenes ya en otro estado.
        await supabase.from('ordenes')
          .update({ estatus: 'Asignada' })
          .in('id', ordenIds)
          .eq('estatus', 'Creada');

        // Build desglose by SKU from orden_lineas
        const { data: lineas } = await supabase.from('orden_lineas').select('sku, cantidad').in('orden_id', ordenIds);
        const desglose = {};
        for (const l of (lineas || [])) {
          const sku = l.sku || '?';
          desglose[sku] = (desglose[sku] || 0) + Number(l.cantidad || 0);
        }
        // Actualizar carga con desglose JSONB
        await supabase.from('rutas').update({ carga: desglose }).eq('id', rutaId);
        const cargaTxt = Object.entries(desglose).map(([sku, qty]) => `${qty}×${sku}`).join(', ') || `${totalBolsas} bolsas`;
        log('Asignar órdenes', 'Rutas', `Ruta #${rutaId} — ${ordenIds.length} órdenes — ${cargaTxt}`);
        rf();
      },

      cerrarRuta: async (rutaId, devolucion) => {
        // devolucion ahora es un objeto: {"HC-25K": 5, "HC-5K": 3, ...}
        const devolucionObj = (typeof devolucion === 'object') ? devolucion : { bolsas: devolucion || 0 };

        // Obtener primer cuarto frío para regresar devolución
        const { data: cuartos } = await supabase.from('cuartos_frios').select('id').order('id').limit(1);
        const cuartoId = cuartos?.[0]?.id;
        if (!cuartoId) { t()?.error('No hay cuarto frío configurado'); return new Error('Sin cuarto frío'); }

        // Usar RPC atómica: valida que no esté ya cerrada, regresa stock, marca Cerrada
        const { error } = await supabase.rpc('cerrar_ruta_atomic', {
          p_ruta_id: rutaId,
          p_devoluciones: devolucionObj,
          p_cuarto_frio_id: cuartoId,
          p_entregas: [],
          p_total_cobrado: 0,
          p_total_credito: 0,
          p_usuario: uname() || 'Admin',
        });
        if (error) {
          if (error.message?.includes('ya está cerrada')) {
            t()?.error('Esta ruta ya fue cerrada');
          } else {
            t()?.error('Error al cerrar la ruta');
          }
          return error;
        }

        const devTxt = Object.entries(devolucionObj).filter(([_,v]) => v > 0).map(([sku, qty]) => `${qty}×${sku}`).join(', ') || '0';
        log('Cerrar', 'Rutas', `Ruta #${rutaId} — devuelto: ${devTxt}`);
        rf();
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

          // Fetch order lines with product names
          const [{ data: lineas }, { data: prods }] = await Promise.all([
            supabase.from('orden_lineas').select('sku, cantidad, precio_unit, subtotal').eq('orden_id', ordenId),
            supabase.from('productos').select('sku, nombre'),
          ]);

          const items = (lineas || []).map(l => {
            const prod = prods.find(p => s(p.sku) === s(l.sku));
            return {
              name: prod ? s(prod.nombre) || s(l.sku) : s(l.sku),
              sku: s(l.sku),
              quantity: l.cantidad,
              unitPrice: l.precio_unit,
            };
          });

          let cliente = null;
          if (orden.cliente_id) {
            const { data: cli } = await supabase
              .from('clientes')
              .select('nombre, correo')
              .eq('id', orden.cliente_id)
              .single();
            cliente = cli;
          }

          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const payload = await backendPost('billing-create-checkout', {
            provider,
            ordenId: orden.id,
            amount: n(orden.total),
            currency: 'MXN',
            description: `Orden ${orden.folio} — ${orden.cliente_nombre || 'Cliente'}`,
            items: items.length > 0 ? items : undefined,
            customer: {
              email: cliente?.correo || undefined,
              name: cliente?.nombre || orden.cliente_nombre || 'Cliente',
            },
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

      reintentarComplemento: async (ordenId) => {
        const { data: ord } = await supabase.from('ordenes').select('facturama_uuid, folio').eq('id', ordenId).single();
        if (!ord?.facturama_uuid) { t()?.error('La orden no tiene UUID de factura'); return { message: 'Sin UUID' }; }
        const { data: cxc } = await supabase.from('cuentas_por_cobrar').select('*').eq('orden_id', ordenId).order('id', { ascending: false }).limit(1).single();
        if (!cxc) { t()?.error('No se encontró cuenta por cobrar para esta orden'); return { message: 'Sin CxC' }; }
        if (Number(cxc.monto_pagado) <= 0) { t()?.error('No hay pagos registrados para generar complemento'); return { message: 'Sin pagos' }; }
        try {
          await backendPost('billing-create-complemento', {
            cxcId: cxc.id,
            monto: Number(cxc.monto_pagado),
            metodoPago: 'Transferencia',
            saldoAntes: Number(cxc.monto_original),
            saldoDespues: Number(cxc.saldo_pendiente),
          });
          notify('complemento', 'Complemento generado', `Complemento de pago para ${s(ord.folio)} (reintento)`, '📎', String(ordenId));
          t()?.success('Complemento de pago generado exitosamente');
          log('Complemento', 'Facturación', `Reintento orden ${ordenId}`);
          rf();
        } catch (err) {
          t()?.error('Error al generar complemento: ' + (err.message || ''));
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
      registrarPago: async (clienteId, monto, referencia) => {
        try {
          if (!clienteId) return { error: 'Cliente requerido' };
          const montoNum = Number(monto);
          if (!Number.isFinite(montoNum) || montoNum <= 0) {
            return { error: 'Monto debe ser mayor a 0' };
          }
          const { error } = await supabase.rpc('registrar_pago', {
            p_cliente_id: clienteId,
            p_monto: centavos(montoNum),
            p_referencia: referencia,
            p_usuario_id: uid(),
          });
          if (error) {
            const msg = error.message || 'Error al registrar pago';
            t()?.error(msg);
            return { error: msg };
          }
          log('Registrar', 'Pagos', `Cliente #${clienteId} — $${montoNum} — ${referencia || 'Sin ref'}`);
          rf();
          return undefined;
        } catch (e) {
          const msg = e?.message || 'Error inesperado al registrar pago';
          t()?.error(msg);
          return { error: msg };
        }
      },

      // Cobrar contra una cuenta por cobrar específica
      cobrarCxC: async (cxcId, monto, metodoPago, referencia) => {
        const hoy = todayLocalISO();
        const montoNum = centavos(n(monto));

        // Obtener la CxC actual
        const { data: cxc, error: e1 } = await supabase
          .from('cuentas_por_cobrar')
          .select('*')
          .eq('id', cxcId)
          .single();
        if (e1 || !cxc) { t()?.error('Cuenta por cobrar no encontrada'); return e1; }
        if (cxc.estatus === 'Pagada') { t()?.error('Esta cuenta ya fue liquidada'); return; }

        const nuevoMontoPagado = centavos(Number(cxc.monto_pagado) + montoNum);
        const nuevoSaldo = centavos(Number(cxc.monto_original) - nuevoMontoPagado);
        const nuevoEstatus = nuevoSaldo <= 0 ? 'Pagada' : (nuevoMontoPagado > 0 ? 'Parcial' : 'Pendiente');

        // Actualizar CxC
        const { error: e2 } = await supabase
          .from('cuentas_por_cobrar')
          .update({
            monto_pagado: nuevoMontoPagado,
            saldo_pendiente: Math.max(0, nuevoSaldo),
            estatus: nuevoEstatus,
          })
          .eq('id', cxcId);
        if (e2) { t()?.error('Error al actualizar cuenta'); return e2; }

        // Registrar pago
        const { data: pagoInsertado, error: pagoError } = await supabase.from('pagos').insert({
          cliente_id: cxc.cliente_id,
          orden_id: cxc.orden_id,
          cxc_id: cxcId,
          monto: montoNum,
          metodo_pago: metodoPago || 'Efectivo',
          fecha: hoy,
          referencia: referencia || `Abono CxC #${cxcId}`,
          saldo_antes: cxc.saldo_pendiente,
          saldo_despues: Math.max(0, nuevoSaldo),
          usuario_id: uid(),
        }).select('id').single();
        if (pagoError) {
          await supabase.from('cuentas_por_cobrar').update({
            monto_pagado: cxc.monto_pagado,
            saldo_pendiente: cxc.saldo_pendiente,
            estatus: cxc.estatus,
          }).eq('id', cxcId);
          t()?.error('Error al registrar pago');
          return pagoError;
        }

        // Registrar ingreso contable
        const { data: ingresoInsertado, error: ingresoError } = await supabase.from('movimientos_contables').insert({
          fecha: hoy, tipo: 'Ingreso', categoria: 'Cobranza',
          concepto: `Cobro CxC #${cxcId} — ${s(cxc.concepto) || 'Cliente'}`,
          monto: montoNum,
          orden_id: cxc.orden_id,
        }).select('id').single();
        if (ingresoError) {
          await supabase.from('pagos').delete().eq('id', pagoInsertado?.id);
          await supabase.from('cuentas_por_cobrar').update({
            monto_pagado: cxc.monto_pagado,
            saldo_pendiente: cxc.saldo_pendiente,
            estatus: cxc.estatus,
          }).eq('id', cxcId);
          t()?.error('Error al registrar ingreso contable');
          return ingresoError;
        }

        // Reducir saldo del cliente
        if (cxc.cliente_id) {
          const { error: saldoError } = await supabase.rpc('increment_saldo', { p_cli: cxc.cliente_id, p_delta: -montoNum });
          if (saldoError) {
            await supabase.from('movimientos_contables').delete().eq('id', ingresoInsertado?.id);
            await supabase.from('pagos').delete().eq('id', pagoInsertado?.id);
            await supabase.from('cuentas_por_cobrar').update({
              monto_pagado: cxc.monto_pagado,
              saldo_pendiente: cxc.saldo_pendiente,
              estatus: cxc.estatus,
            }).eq('id', cxcId);
            t()?.error('Error al actualizar saldo del cliente');
            return saldoError;
          }
        }

        // Generar Complemento de Pago (CFDI tipo P) automáticamente si la orden tiene factura PPD timbrada
        if (cxc.orden_id) {
          const { data: ordenFacturada } = await supabase
            .from('ordenes')
            .select('facturama_uuid, metodo_pago, folio')
            .eq('id', cxc.orden_id)
            .maybeSingle();
          const esPPD = s(ordenFacturada?.metodo_pago).toLowerCase().includes('crédito');
          if (ordenFacturada?.facturama_uuid && esPPD) {
            try {
              await backendPost('billing-create-complemento', {
                cxcId,
                monto: montoNum,
                metodoPago: metodoPago || 'Efectivo',
                saldoAntes: cxc.saldo_pendiente,
                saldoDespues: Math.max(0, nuevoSaldo),
              });
              notify('complemento', 'Complemento generado', `Complemento de pago automático para ${s(ordenFacturada.folio)}`, '📎', String(cxc.orden_id));
              t()?.success('Complemento de pago generado automáticamente');
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
      aplicarCostoFijo: async (costoFijoId, fecha, referencia) => {
        const hoy = fecha || todayLocalISO();
        const periodo = hoy.slice(0, 7); // "2026-03"

        // Buscar el costo
        const { data: costo } = await supabase.from('costos_fijos').select('*').eq('id', costoFijoId).single();
        if (!costo) { t()?.error('Costo no encontrado'); return { message: 'Costo no encontrado' }; }

        // Crear egreso en movimientos_contables
        const { data: movimiento, error: e1 } = await supabase.from('movimientos_contables').insert({
          fecha: hoy,
          tipo: 'Egreso',
          categoria: costo.categoria,
          concepto: `${costo.nombre} (${costo.frecuencia})`,
          monto: centavos(costo.monto),
          referencia: referencia || '',
        }).select('id').single();
        if (e1) { t()?.error('Error al registrar egreso'); return e1; }

        // Registrar en historial
        await supabase.from('costos_historial').insert({
          costo_fijo_id: costoFijoId,
          tipo: 'Fijo',
          categoria: costo.categoria,
          concepto: costo.nombre,
          monto: centavos(costo.monto),
          periodo,
          fecha: hoy,
          referencia: referencia || '',
          movimiento_id: movimiento?.id,
        });

        t()?.success(`Gasto aplicado: ${costo.nombre}`);
        log('Aplicar', 'Costos', `${costo.nombre} — $${costo.monto}`);
        rf();
      },

      // Registrar costo variable (ej: compra de empaques, gastos puntuales)
      registrarCostoVariable: async (categoria, concepto, monto, referencia, fecha) => {
        const fechaUsar = fecha || todayLocalISO();
        const periodo = fechaUsar.slice(0, 7);

        // Crear egreso
        const { data: movimiento, error: e1 } = await supabase.from('movimientos_contables').insert({
          fecha: fechaUsar,
          tipo: 'Egreso',
          categoria,
          concepto,
          monto: centavos(monto),
          referencia: referencia || '',
        }).select('id').single();
        if (e1) { t()?.error('Error al registrar gasto'); return e1; }

        // Registrar en historial
        await supabase.from('costos_historial').insert({
          tipo: 'Variable',
          categoria,
          concepto,
          monto: centavos(monto),
          periodo,
          fecha: fechaUsar,
          referencia: referencia || '',
          movimiento_id: movimiento?.id,
        });

        log('Registrar', 'Costos', `Variable: ${concepto} — $${monto}`);
        rf();
      },

      // ── CUENTAS POR PAGAR (Proveedores) ──
      addCuentaPorPagar: async (cxp) => {
        const montoOriginal = centavos(n(cxp.montoOriginal || cxp.monto));
        const { error } = await supabase.from('cuentas_por_pagar').insert({
          proveedor: cxp.proveedor,
          concepto: cxp.concepto,
          monto_original: montoOriginal,
          monto_pagado: 0,
          saldo_pendiente: montoOriginal,
          fecha_emision: cxp.fechaEmision || todayLocalISO(),
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
      pagarCuentaPorPagar: async (cxpId, monto, metodoPago, referencia) => {
        const hoy = todayLocalISO();
        const montoNum = centavos(n(monto));

        // Obtener la CxP actual
        const { data: cxp, error: e1 } = await supabase
          .from('cuentas_por_pagar')
          .select('*')
          .eq('id', cxpId)
          .single();
        if (e1 || !cxp) { t()?.error('Cuenta por pagar no encontrada'); return e1; }

        const nuevoMontoPagado = centavos(Number(cxp.monto_pagado) + montoNum);
        const nuevoSaldo = centavos(Number(cxp.monto_original) - nuevoMontoPagado);
        const nuevoEstatus = nuevoSaldo <= 0 ? 'Pagada' : (nuevoMontoPagado > 0 ? 'Parcial' : 'Pendiente');

        // Actualizar CxP
        const { error: e2 } = await supabase
          .from('cuentas_por_pagar')
          .update({
            monto_pagado: nuevoMontoPagado,
            saldo_pendiente: Math.max(0, nuevoSaldo),
            estatus: nuevoEstatus,
          })
          .eq('id', cxpId);
        if (e2) { t()?.error('Error al actualizar cuenta'); return e2; }

        // Registrar pago a proveedor
        const { data: movimiento, error: e3 } = await supabase.from('movimientos_contables').insert({
          fecha: hoy, tipo: 'Egreso', categoria: 'Proveedores',
          concepto: `Pago a ${s(cxp.proveedor)} — ${s(cxp.concepto)}`,
          monto: montoNum,
          referencia: referencia || '',
        }).select('id').single();
        if (e3) {
          await supabase.from('cuentas_por_pagar').update({
            monto_pagado: cxp.monto_pagado,
            saldo_pendiente: cxp.saldo_pendiente,
            estatus: cxp.estatus,
          }).eq('id', cxpId);
          t()?.error('Error al registrar egreso');
          return e3;
        }

        const { error: pagoProvError } = await supabase.from('pagos_proveedores').insert({
          cxp_id: cxpId,
          monto: montoNum,
          fecha: hoy,
          metodo_pago: metodoPago || 'Transferencia',
          referencia: referencia || '',
          movimiento_id: movimiento?.id,
        });
        if (pagoProvError) {
          await supabase.from('movimientos_contables').delete().eq('id', movimiento?.id);
          await supabase.from('cuentas_por_pagar').update({
            monto_pagado: cxp.monto_pagado,
            saldo_pendiente: cxp.saldo_pendiente,
            estatus: cxp.estatus,
          }).eq('id', cxpId);
          t()?.error('Error al registrar pago a proveedor');
          return pagoProvError;
        }

        t()?.success(`Pago registrado: $${monto}`);
        log('Pagar', 'Cuentas por Pagar', `CxP #${cxpId} — $${monto} — ${nuevoEstatus}`);
        rf();
      },

      // ── MERMAS ──
      registrarMerma: async (sku, cantidad, causa, origen, fotoUrl) => {
        try {
          const { data: mermaRow, error } = await supabase.from('mermas').insert({
            sku,
            cantidad: Number(cantidad),
            causa,
            origen,
            foto_url: fotoUrl || '',
            usuario_id: uid() || null,
          }).select('id').single();
          if (error) {
            console.warn('[registrarMerma] insert mermas:', error.message);
            t()?.error('Error al registrar merma');
            return error;
          }
          const mermaId = mermaRow?.id;

          // Descontar del inventario en cuartos fríos. Si falla, hacemos
          // rollback de la merma (DELETE) — son operaciones críticas que
          // deben ir juntas o no ir.
          const qty = Number(cantidad);
          if (qty > 0) {
            const { data: cuartos, error: errCfs } = await supabase
              .from('cuartos_frios').select('id, stock').order('id');
            if (errCfs) {
              if (mermaId) await supabase.from('mermas').delete().eq('id', mermaId);
              console.warn('[registrarMerma] select cuartos_frios, rollback merma:', errCfs.message);
              t()?.error('No se pudo leer cuartos fríos — merma revertida');
              return { error: errCfs.message };
            }

            if (cuartos && cuartos.length > 0) {
              const changes = [];
              let remaining = qty;
              for (const cf of cuartos) {
                if (remaining <= 0) break;
                const available = Number((cf.stock || {})[sku] || 0);
                if (available > 0) {
                  const toTake = Math.min(available, remaining);
                  remaining -= toTake;
                  changes.push({ cuarto_id: cf.id, sku, delta: -toTake, tipo: 'Merma', origen: causa || origen || 'Merma', usuario: uname() });
                }
              }
              if (changes.length > 0) {
                const { error: errRpc } = await supabase.rpc('update_stocks_atomic', { p_changes: changes });
                if (errRpc) {
                  if (mermaId) await supabase.from('mermas').delete().eq('id', mermaId);
                  console.warn('[registrarMerma] rpc update_stocks_atomic, rollback merma:', errRpc.message);
                  t()?.error('No se pudo descontar el inventario — merma revertida');
                  return { error: errRpc.message };
                }
              }
            }

            // Registrar egreso contable por el costo de la merma.
            // Si esto falla NO hacemos rollback: la merma + descuento son
            // críticos y ya están bien. El asiento contable es secundario y
            // puede regenerarse manualmente desde admin.
            const { data: prod, error: errProd } = await supabase
              .from('productos').select('costo_unitario, nombre').eq('sku', sku).maybeSingle();
            if (errProd) {
              console.warn('[registrarMerma] select costo unit (no crítico):', errProd.message);
            } else {
              const costoUnit = Number(prod?.costo_unitario || 0);
              if (costoUnit > 0) {
                const costoMerma = centavos(qty * costoUnit);
                const { error: errEgr } = await supabase.from('movimientos_contables').insert({
                  fecha: todayLocalISO(),
                  tipo: 'Egreso',
                  categoria: 'Mermas',
                  concepto: `Merma ${qty}× ${sku}${prod?.nombre ? ` (${prod.nombre})` : ''} — ${causa || origen || 'Sin causa'}`,
                  monto: costoMerma,
                });
                if (errEgr) {
                  console.warn('[registrarMerma] insert egreso contable (no crítico):', errEgr.message);
                  notify('advertencia', 'Asiento contable pendiente', `Merma ${qty}× ${sku} — egreso contable no se registró, regístralo manual.`, '⚠️', sku);
                  t()?.error('Merma registrada, pero el egreso contable no. Regístralo manual.');
                  // Continuamos al éxito: side effects principales sí ocurrieron.
                  await checkStockBajo([sku]);
                  rf();
                  return { error: errEgr.message, partial: true };
                }
              }
            }
          }

          notify('merma', 'Merma registrada', `${cantidad}× ${sku} — ${causa || origen || 'Sin causa'}`, '⚠️', sku);
          log('Registrar', 'Mermas', `${cantidad}×${sku} — ${causa}`);
          await checkStockBajo([sku]);
          rf();
          return undefined;
        } catch (e) {
          console.error('[registrarMerma] excepción:', e);
          t()?.error('Error inesperado al registrar merma');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      deleteMerma: async (id) => {
        const { error } = await supabase.from('mermas').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar merma'); return error; }
        log('Eliminar', 'Mermas', `ID ${id}`);
        rf();
      },

      // Borra una merma desde admin, regresando el stock al primer cuarto
      // frío activo (FIFO inverso) y borrando el egreso contable asociado y
      // la foto en Storage best-effort. NO modifica deleteMerma porque el
      // reset masivo del sistema usa esa otra ruta sin reverso.
      borrarMermaConReverso: async (id) => {
        try {
          if (!id) return { error: 'Merma requerida' };

          // 1. SELECT merma completa
          const { data: merma, error: errSel } = await supabase
            .from('mermas')
            .select('*')
            .eq('id', id)
            .single();
          if (errSel || !merma) {
            return { error: errSel?.message || 'Merma no encontrada' };
          }

          const sku = s(merma.sku);
          const cant = n(merma.cantidad);
          const fotoPath = s(merma.foto_url);
          const causa = s(merma.causa);
          const origen = s(merma.origen);
          const fecha = s(merma.fecha);

          // Validación pura — extraída a mermasLogic.validarMermaParaReverso.
          // Defensivo: si cantidad ≤ 0 (no debería por CHECK), borrar sin reverso.
          const validErr = validarMermaParaReverso({ ...merma, sku, cantidad: cant });
          if (validErr) {
            const { error: errDel } = await supabase.from('mermas').delete().eq('id', id);
            if (errDel) {
              t()?.error('Error al borrar merma');
              return { error: errDel.message };
            }
            await log('Borrar (sin reverso)', 'Mermas', `ID ${id} — ${validErr.error}`);
            rf();
            return undefined;
          }

          // 2. RPC update_stocks_atomic con FIFO inverso (regresar al primer
          //    cuarto frío activo)
          const { data: cuartos, error: errCfs } = await supabase
            .from('cuartos_frios')
            .select('id, nombre')
            .order('id');
          if (errCfs) {
            t()?.error('No se pudieron leer cuartos fríos');
            return { error: errCfs.message };
          }
          // Selección pura — extraída a mermasLogic.seleccionarCuartoFIFOInverso
          const cuartoDestino = seleccionarCuartoFIFOInverso(cuartos);
          if (!cuartoDestino) {
            return { error: 'No hay cuartos fríos activos para regresar el stock' };
          }

          // Construcción del change pura — extraída a mermasLogic.buildReversoMermaChange
          const change = buildReversoMermaChange(
            { ...merma, sku, cantidad: cant, causa },
            cuartoDestino,
            uname() || 'Admin'
          );
          const { error: errRpc } = await supabase.rpc('update_stocks_atomic', {
            p_changes: [change],
          });
          if (errRpc) {
            console.warn('[borrarMermaConReverso] rpc update_stocks_atomic:', errRpc.message);
            t()?.error('No se pudo regresar el stock — merma NO borrada');
            return { error: 'No se pudo regresar el stock — merma NO borrada. ' + (errRpc.message || '') };
          }

          // 3. DELETE de movimiento contable asociado (best-effort, match único)
          let avisoMovsMultiples = false;
          try {
            // Match pura — extraída a mermasLogic.matchConceptoMerma
            const conceptoMatch = matchConceptoMerma({ sku, cantidad: cant });
            const { data: movs } = await supabase
              .from('movimientos_contables')
              .select('id')
              .eq('categoria', 'Mermas')
              .ilike('concepto', `%${conceptoMatch}%`)
              .gte('fecha', fecha)
              .lte('fecha', fecha);

            // Decisión pura — extraída a mermasLogic.decidirBorrarMovimientoContable
            const decision = decidirBorrarMovimientoContable(movs);
            if (decision.accion === 'delete') {
              await supabase.from('movimientos_contables').delete().eq('id', decision.id);
            } else if (decision.accion === 'aviso') {
              avisoMovsMultiples = true;
              console.warn(`[borrarMermaConReverso] múltiples egresos contables matchean merma ${id}, ninguno borrado`);
            }
          } catch (eMov) {
            console.warn('[borrarMermaConReverso] best-effort delete movimiento contable:', eMov);
          }

          // 4. DELETE de foto en Storage (best-effort)
          if (fotoPath) {
            try {
              // Si es path relativo (no http/data/blob), borrar del bucket
              if (!/^https?:\/\//.test(fotoPath) && !/^data:/.test(fotoPath) && !/^blob:/.test(fotoPath)) {
                await supabase.storage.from('mermas').remove([fotoPath]);
              }
            } catch (eFoto) {
              console.warn('[borrarMermaConReverso] best-effort delete foto:', eFoto);
            }
          }

          // 5. DELETE de la merma
          const { error: errDel } = await supabase.from('mermas').delete().eq('id', id);
          if (errDel) {
            console.warn('[borrarMermaConReverso] CRÍTICO: stock revertido pero merma no se pudo borrar:', errDel);
            t()?.error('Stock regresado pero la merma no se pudo borrar. Revísalo en Supabase.');
            return { error: 'Stock regresado pero la merma no se pudo borrar. Revísalo en Supabase.' };
          }

          // 6. Audit
          await log('Borrar con reverso', 'Mermas',
            `ID ${id} — ${cant}×${sku} → ${s(cuartoDestino.nombre)} | causa: ${causa || '—'} | origen: ${origen || '—'}`
          );

          rf();
          if (avisoMovsMultiples) {
            return { partial: true, error: 'Merma borrada y stock regresado, pero el egreso contable no se eliminó automáticamente (múltiples coincidencias). Revísalo en Contabilidad.' };
          }
          return undefined;
        } catch (e) {
          console.error('[borrarMermaConReverso] excepción:', e);
          t()?.error('Error inesperado al borrar merma');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── DEVOLUCIONES POST-ENTREGA ──
      // Registra una devolución de cliente: regresa stock al cuarto frío
      // destino y ajusta finanzas según tipo de reembolso.
      // Solo Admin (require_admin). Una orden solo puede tener UNA devolución
      // (MVP) — la flag `tiene_devolucion` bloquea la siguiente.
      // Si la orden estaba Facturada, se marca requiere_nota_credito=true
      // y queda pendiente generar CFDI tipo E (integración futura).
      registrarDevolucion: async (payload = {}) => {
        const guard = requireAdmin();
        if (guard) { t()?.error(guard.error); return guard; }

        const { ordenId, items, motivo, tipoReembolso, cuartoDestino, notas } = payload;
        try {
          if (!ordenId) return { error: 'Orden requerida' };

          // 1. SELECT orden + lineas en paralelo
          const [{ data: orden, error: errOrd }, { data: lineas, error: errLin }] = await Promise.all([
            supabase
              .from('ordenes')
              .select('id, folio, estatus, metodo_pago, total, cliente_id, tiene_devolucion')
              .eq('id', ordenId)
              .single(),
            supabase
              .from('orden_lineas')
              .select('sku, cantidad, precio_unit, subtotal')
              .eq('orden_id', ordenId),
          ]);
          if (errOrd || !orden) {
            return { error: errOrd?.message || 'Orden no encontrada' };
          }
          if (errLin) {
            console.warn('[registrarDevolucion] select orden_lineas:', errLin.message);
            t()?.error('No se pudieron leer las líneas de la orden');
            return { error: errLin.message };
          }

          // Normalizar líneas para usar precio_unitario en helpers
          const lineasOriginales = (lineas || []).map(l => ({
            sku: l.sku,
            cantidad: Number(l.cantidad),
            precio_unitario: Number(l.precio_unit),
          }));

          // 2. Validación pura
          const validErr = validateDevolucion({
            orden,
            items,
            lineasOriginales,
            motivo,
            tipoReembolso,
            cuartoDestino,
          });
          if (validErr) {
            t()?.error(validErr.error);
            return validErr;
          }

          const folio = s(orden.folio) || `ID ${ordenId}`;
          const usuario = uname() || 'Admin';
          const total = calcTotalDevolucion(items, lineasOriginales);
          if (total <= 0) {
            return { error: 'Total devuelto inválido' };
          }

          // 3. Calcular changes de stock + ajuste financiero
          const { changes } = calcDevolucionChanges(items, cuartoDestino, usuario, folio);
          const ajuste = calcAjustePago({
            orden,
            totalDevuelto: total,
            tipoReembolso,
          });

          // 4. INSERT devoluciones (registro principal)
          const itemsConPrecio = items.map(it => {
            const orig = lineasOriginales.find(l => l.sku === it.sku);
            const precio = Number(it.precio_unitario ?? orig?.precio_unitario ?? 0);
            return {
              sku: it.sku,
              cantidad: Number(it.cantidad),
              precio_unitario: precio,
              subtotal: centavos(Number(it.cantidad) * precio),
            };
          });
          const { data: devRow, error: errDev } = await supabase
            .from('devoluciones')
            .insert({
              orden_id: ordenId,
              cliente_id: orden.cliente_id || null,
              motivo: String(motivo).trim(),
              tipo_reembolso: tipoReembolso,
              total,
              items: itemsConPrecio,
              cuarto_destino: cuartoDestino,
              usuario,
              notas: s(notas).trim() || null,
              requiere_nota_credito: ajuste.requiereNotaCredito,
            })
            .select('id')
            .single();
          if (errDev || !devRow) {
            console.warn('[registrarDevolucion] insert devoluciones:', errDev?.message);
            t()?.error('No se pudo registrar la devolución');
            return { error: errDev?.message || 'Error al registrar devolución' };
          }
          const devolucionId = devRow.id;

          // 5. Aplicar reverso de stock (delta positivo)
          if (changes.length > 0) {
            const { error: errRpc } = await supabase.rpc('update_stocks_atomic', { p_changes: changes });
            if (errRpc) {
              // Rollback: borrar la devolución insertada
              await supabase.from('devoluciones').delete().eq('id', devolucionId);
              console.warn('[registrarDevolucion] rpc update_stocks_atomic:', errRpc.message);
              t()?.error('No se pudo regresar el stock — devolución revertida');
              return { error: 'No se pudo regresar el stock — devolución revertida. ' + (errRpc.message || '') };
            }
          }

          // 6. Ajuste financiero según tipo
          let ajustePartial = false;
          let ajusteMsg = null;

          if (ajuste.accion === 'egreso' && total > 0) {
            const { error: errEgr } = await supabase.from('movimientos_contables').insert({
              fecha: todayLocalISO(),
              tipo: 'Egreso',
              categoria: 'Devoluciones',
              concepto: ajuste.conceptoEgreso || `Devolución cliente ${folio}`,
              monto: total,
              orden_id: ordenId,
            });
            if (errEgr) {
              // Stock + devolución ya están bien; el egreso contable es secundario.
              // Best-effort: avisar y continuar (mismo patrón que registrarMerma).
              console.warn('[registrarDevolucion] insert egreso (parcial):', errEgr.message);
              notify('advertencia', 'Asiento contable pendiente',
                `Devolución ${folio} — egreso contable no se registró, regístralo manual.`,
                '⚠️', folio);
              ajustePartial = true;
              ajusteMsg = 'Devolución registrada y stock regresado, pero el egreso contable no. Regístralo manual.';
            }

            // Si era venta a crédito, además reducir CxC
            if (ajuste.ajustaCxC && orden.cliente_id) {
              const { data: cxc, error: errCxc } = await supabase
                .from('cuentas_por_cobrar')
                .select('id, monto_pagado, monto_original, saldo_pendiente, estatus')
                .eq('orden_id', ordenId)
                .maybeSingle();
              if (!errCxc && cxc) {
                const nuevoMontoOriginal = centavos(Number(cxc.monto_original) - total);
                const nuevoSaldo = centavos(Math.max(0, Number(cxc.saldo_pendiente) - total));
                const pagado = Number(cxc.monto_pagado || 0);
                const nuevoEstatus = nuevoMontoOriginal <= 0 ? 'Pagada'
                  : pagado >= nuevoMontoOriginal ? 'Pagada'
                  : pagado > 0 ? 'Parcial'
                  : 'Pendiente';
                const { error: errUpdCxc } = await supabase
                  .from('cuentas_por_cobrar')
                  .update({
                    monto_original: Math.max(0, nuevoMontoOriginal),
                    saldo_pendiente: nuevoSaldo,
                    estatus: nuevoEstatus,
                  })
                  .eq('id', cxc.id);
                if (!errUpdCxc) {
                  await supabase.rpc('increment_saldo', { p_cli: orden.cliente_id, p_delta: -total });
                } else {
                  console.warn('[registrarDevolucion] update CxC (parcial):', errUpdCxc.message);
                  ajustePartial = true;
                  ajusteMsg = 'Devolución registrada pero la CxC no se ajustó. Revísala manualmente.';
                }
              }
            }
          }

          // 7. Marcar la orden con flag (idempotente: si falla, devolución
          //    ya está bien — no rompemos por esto).
          const { error: errFlag } = await supabase
            .from('ordenes')
            .update({ tiene_devolucion: true })
            .eq('id', ordenId);
          if (errFlag) {
            console.warn('[registrarDevolucion] update orden.tiene_devolucion (no crítico):', errFlag.message);
          }

          // 8. Audit
          const itemsTxt = items.map(it => `${it.cantidad}×${it.sku}`).join(', ');
          await log('Devolución', 'Órdenes',
            `${folio} — ${tipoReembolso} — ${itemsTxt} — $${total} — ${s(motivo).trim()}`
          );

          if (ajuste.requiereNotaCredito) {
            notify('credito', 'Nota de crédito pendiente',
              `${folio} — Genera CFDI tipo E desde Facturación cuando esté integrado.`,
              '📄', folio);
          }

          rf();
          if (ajustePartial) {
            return { partial: true, error: ajusteMsg, devolucionId };
          }
          return { devolucionId };
        } catch (e) {
          console.error('[registrarDevolucion] excepción:', e);
          t()?.error('Error inesperado al registrar devolución');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── CIERRE DE CAJA POR RUTA ──
      // Registra el corte de caja oficial de una ruta. Compara contado
      // físico (capturado por admin) vs esperado del sistema (suma de
      // pagos.metodo_pago de las órdenes de la ruta).
      // UNIQUE(fecha, ruta_id) impide cerrar dos veces la misma ruta.
      cerrarCajaRuta: async (payload = {}) => {
        const guard = requireAdmin();
        if (guard) { t()?.error(guard.error); return guard; }

        const { rutaId, contadoEfectivo, contadoTransferencia, motivoDiferencia, notas } = payload;
        try {
          if (!rutaId) return { error: 'Ruta requerida' };

          // 1. SELECT ruta + verificar estatus terminal y que no haya cierre previo
          const { data: ruta, error: errRuta } = await supabase
            .from('rutas')
            .select('id, folio, chofer_id, estatus, fecha_fin, created_at')
            .eq('id', rutaId)
            .single();
          if (errRuta || !ruta) {
            return { error: errRuta?.message || 'Ruta no encontrada' };
          }
          const estTerminales = ['Completada', 'Cerrada'];
          if (!estTerminales.includes(s(ruta.estatus))) {
            const msg = `Solo se cierra caja de rutas Completadas o Cerradas (estatus actual: ${s(ruta.estatus)})`;
            t()?.error(msg);
            return { error: msg };
          }

          const fechaCierre = fechaCierreDesdeRuta(ruta);

          // 2. Verificar que NO haya cierre previo (defensa adicional al UNIQUE)
          const { data: prev, error: errPrev } = await supabase
            .from('cierres_diarios')
            .select('id')
            .eq('ruta_id', rutaId)
            .eq('fecha', fechaCierre)
            .maybeSingle();
          if (errPrev) {
            console.warn('[cerrarCajaRuta] check cierre previo:', errPrev.message);
          } else if (prev) {
            const msg = 'Esta ruta ya tiene cierre de caja registrado para esta fecha';
            t()?.error(msg);
            return { error: msg };
          }

          // 3. SELECT órdenes de la ruta + pagos asociados
          const { data: ordenesRuta, error: errOrd } = await supabase
            .from('ordenes')
            .select('id, folio')
            .eq('ruta_id', rutaId);
          if (errOrd) {
            t()?.error('No se pudieron leer órdenes de la ruta');
            return { error: errOrd.message };
          }
          const ordenIds = (ordenesRuta || []).map(o => o.id);
          const ordenFolioPorId = Object.fromEntries((ordenesRuta || []).map(o => [String(o.id), s(o.folio)]));

          let pagosDeRuta = [];
          if (ordenIds.length > 0) {
            const { data: pagos, error: errPag } = await supabase
              .from('pagos')
              .select('id, monto, metodo_pago, orden_id, fecha, created_at')
              .in('orden_id', ordenIds);
            if (errPag) {
              t()?.error('No se pudieron leer pagos de la ruta');
              return { error: errPag.message };
            }
            pagosDeRuta = pagos || [];
          }

          // 4. Calcular esperado (puro)
          const esperado = calcularEsperadoPorRuta(pagosDeRuta);
          const contado = {
            efectivo: Number(contadoEfectivo || 0),
            transferencia: Number(contadoTransferencia || 0),
          };

          // 5. Validar (puro)
          const validErr = validateCierre({ esperado, contado, motivoDiferencia });
          if (validErr) {
            t()?.error(validErr.error);
            return validErr;
          }

          // 6. Construir payload + snapshot
          const pagosSnapshot = buildPagosSnapshot(pagosDeRuta, ordenFolioPorId);
          const insertPayload = buildCierrePayload({
            ruta,
            fechaCierre,
            esperado,
            contado,
            motivoDiferencia,
            notas,
            usuario: uname() || 'Admin',
            pagosSnapshot,
          });

          // 7. INSERT
          const { data: cierreRow, error: errIns } = await supabase
            .from('cierres_diarios')
            .insert(insertPayload)
            .select('id, diferencia')
            .single();
          if (errIns || !cierreRow) {
            // 23505 = unique violation (otra invocación ganó la carrera)
            if (errIns?.code === '23505') {
              return { error: 'Esta ruta ya tiene cierre de caja registrado para esta fecha' };
            }
            console.warn('[cerrarCajaRuta] insert:', errIns?.message);
            t()?.error('No se pudo registrar el cierre');
            return { error: errIns?.message || 'Error al registrar cierre' };
          }

          // 8. Audit
          const dif = Number(cierreRow.diferencia || 0);
          const difTxt = dif === 0 ? 'cuadrado' : dif > 0 ? `sobrante $${dif}` : `faltante $${Math.abs(dif)}`;
          await log('Cierre caja', 'Conciliación',
            `${s(ruta.folio) || `Ruta ${rutaId}`} (${fechaCierre}) — ${difTxt}${motivoDiferencia ? ` — ${s(motivoDiferencia)}` : ''}`
          );

          rf();
          return { cierreId: cierreRow.id, diferencia: dif };
        } catch (e) {
          console.error('[cerrarCajaRuta] excepción:', e);
          t()?.error('Error inesperado al cerrar caja');
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
        const { error } = await supabase.from('leads').insert({
          nombre: l.nombre, telefono: l.telefono, correo: l.correo,
          mensaje: l.mensaje, origen: l.origen, estatus: 'Nuevo',
          fecha: todayLocalISO(),
        });
        if (error) { t()?.error('Error al guardar lead'); return error; }
        log('Crear', 'Leads', `${l.nombre}`);
        rf();
      },

      updateLead: async (id, changes) => {
        const { error } = await supabase.from('leads').update(changes).eq('id', id);
        if (error) { t()?.error('Error al actualizar lead'); return error; }
        log('Editar', 'Leads', `ID ${id}`);
        rf();
      },

      deleteLead: async (id) => {
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
      addNominaPeriodo: async (p) => {
        const { error } = await supabase.from('nomina_periodos').insert(p).select().single();
        if (error) { 
          console.error('[addNominaPeriodo]', error.message, error.code, error.details);
          t()?.error('Error al crear período de nómina: ' + error.message); 
          return { error }; // Devolver objeto con error para distinguir de éxito
        }
        log('Crear', 'Nómina', `Período ${p.fecha_inicio || ''} — ${p.fecha_fin || ''}`);
        rf();
        return null; // null = éxito
      },

      addNominaRecibo: async (r) => {
        const { error } = await supabase.from('nomina_recibos').insert(r);
        if (error) { t()?.error('Error al guardar recibo de nómina'); return error; }
        log('Crear', 'Nómina Recibo', `Empleado ${r.empleado_id}`);
        rf();
      },

      // Pagar nómina — registra egreso automático en movimientos_contables
      pagarNomina: async (periodoId) => {
        const hoy = todayLocalISO();
        const periodo = hoy.slice(0, 7);

        // Obtener el periodo de nómina
        const { data: nomPeriodo } = await supabase.from('nomina_periodos').select('*').eq('id', periodoId).single();
        if (!nomPeriodo) { t()?.error('Período no encontrado'); return { message: 'Período no encontrado' }; }

        // Calcular total de todos los recibos del periodo
        const { data: recibos } = await supabase.from('nomina_recibos').select('neto_a_pagar').eq('periodo_id', periodoId);
        const totalNeto = (recibos || []).reduce((sum, r) => sum + Number(r.neto_a_pagar || 0), 0);

        if (totalNeto <= 0) { t()?.error('No hay neto a pagar'); return { message: 'No hay neto' }; }

        // Crear egreso en movimientos_contables
        const { data: movimiento, error: e1 } = await supabase.from('movimientos_contables').insert({
          fecha: hoy,
          tipo: 'Egreso',
          categoria: 'Nómina',
          concepto: `Pago nómina ${nomPeriodo.periodo || periodoId}`,
          monto: centavos(totalNeto),
        }).select('id').single();
        if (e1) { t()?.error('Error al registrar egreso'); return e1; }

        // Actualizar periodo como pagado
        await supabase.from('nomina_periodos').update({
          total_neto: centavos(totalNeto),
          estatus: 'Pagado',
          pagado_at: new Date().toISOString(),
          movimiento_id: movimiento?.id,
        }).eq('id', periodoId);

        // Registrar en historial de costos
        await supabase.from('costos_historial').insert({
          tipo: 'Nómina',
          categoria: 'Nómina',
          concepto: `Pago nómina ${nomPeriodo.periodo || periodoId}`,
          monto: centavos(totalNeto),
          periodo,
          fecha: hoy,
          movimiento_id: movimiento?.id,
        });

        t()?.success(`Nómina pagada: $${totalNeto.toLocaleString()}`);
        log('Pagar', 'Nómina', `Período ${nomPeriodo.periodo || periodoId} — $${totalNeto}`);
        rf();
      },

      // ── USUARIOS ──
      addUsuario: async (u) => {
        const { data: row, error } = await supabase.from('usuarios').insert({
          nombre: u.nombre, email: u.email, rol: u.rol, auth_id: u.auth_id, estatus: u.estatus || 'Activo',
        }).select().single();
        if (error) { t()?.error(`Error al crear usuario: ${error.message}`); return error; }
        log('Crear', 'Usuarios', `${u.nombre} (${u.rol})`);
        rf();
        return row;
      },

      updateUsuario: async (id, u) => {
        const { error } = await supabase.from('usuarios').update(u).eq('id', id);
        if (error) { t()?.error('Error al actualizar usuario'); return error; }
        log('Editar', 'Usuarios', `ID ${id}`);
        rf();
      },

      deleteUsuario: async (id) => {
        const { error } = await supabase.from('usuarios').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar usuario'); return error; }
        log('Eliminar', 'Usuarios', `ID ${id}`);
        rf();
      },

      // ── ALMACÉN BOLSAS ──
      movimientoBolsa: async (sku, cantidad, tipo, motivo, costo, proveedor, esCredito) => {
        try {
          const { data: prod, error: errProd } = await supabase
            .from('productos').select('id, stock').eq('sku', sku).single();
          if (errProd || !prod) {
            const msg = errProd?.message || `Producto no encontrado: ${sku}`;
            console.warn('[movimientoBolsa] select productos:', msg);
            t()?.error('No se encontró el producto');
            return { error: msg };
          }
          const prevStock = Number(prod.stock || 0);
          const newStock = tipo === 'Entrada'
            ? prevStock + Number(cantidad)
            : Math.max(0, prevStock - Number(cantidad));

          const { error: errUpd } = await supabase
            .from('productos').update({ stock: newStock }).eq('id', prod.id);
          if (errUpd) {
            console.warn('[movimientoBolsa] update stock:', errUpd.message);
            t()?.error('No se pudo actualizar el stock');
            return { error: errUpd.message || 'Error actualizando stock' };
          }

          const { error: errMov } = await supabase.from('inventario_mov').insert({
            tipo, producto: sku, cantidad: Number(cantidad),
            origen: motivo, usuario: uname(),
          });
          if (errMov) {
            // Rollback del stock al valor previo
            await supabase.from('productos').update({ stock: prevStock }).eq('id', prod.id);
            console.warn('[movimientoBolsa] insert inventario_mov, rollback stock:', errMov.message);
            t()?.error('No se pudo registrar el movimiento — stock revertido');
            return { error: errMov.message || 'Error registrando movimiento' };
          }

          // Auto-registrar movimiento contable cuando es compra de empaques (Entrada)
          // Si esto falla NO se hace rollback de stock+mov: la operación principal
          // ya quedó. El consumer recibe { error, partial: true } y puede mostrar
          // "movimiento ok, contabilidad pendiente".
          if (tipo === 'Entrada' && Number(costo) > 0) {
            const hoy = todayLocalISO();
            const montoTotal = centavos(Number(costo));

            if (esCredito && proveedor) {
              const fechaVenc = todayLocalISO(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
              const { error: errCxp } = await supabase.from('cuentas_por_pagar').insert({
                proveedor: proveedor,
                concepto: `Compra empaques: ${cantidad}×${sku}`,
                monto_original: montoTotal,
                monto_pagado: 0,
                saldo_pendiente: montoTotal,
                fecha_emision: hoy,
                fecha_vencimiento: fechaVenc,
                categoria: 'Proveedores',
                estatus: 'Pendiente',
              });
              if (errCxp) {
                console.warn('[movimientoBolsa] insert CxP (parcial):', errCxp.message);
                t()?.error('Movimiento registrado, pero la cuenta por pagar no se creó. Regístrala desde Cuentas por Pagar.');
                rf();
                return { error: errCxp.message, partial: true };
              }
              log('Compra crédito', 'Almacén Bolsas', `${cantidad}×${sku} → CxP: $${Number(costo)} — ${proveedor}`);
            } else {
              const { error: errEgr } = await supabase.from('movimientos_contables').insert({
                fecha: hoy,
                tipo: 'Egreso', categoria: 'Proveedores',
                concepto: `Compra empaques: ${cantidad}×${sku}${proveedor ? ' — ' + proveedor : ''}`,
                monto: montoTotal,
              });
              if (errEgr) {
                console.warn('[movimientoBolsa] insert egreso (parcial):', errEgr.message);
                t()?.error('Movimiento registrado, pero el egreso contable no se creó. Regístralo desde Movimientos.');
                rf();
                return { error: errEgr.message, partial: true };
              }
            }
          }

          log(tipo, 'Almacén Bolsas', `${sku} x${cantidad} — ${motivo}`);
          rf();
          return undefined;
        } catch (e) {
          console.error('[movimientoBolsa] excepción:', e);
          t()?.error('Error inesperado al registrar movimiento');
          return { error: e?.message || 'Error inesperado' };
        }
      },

      // ── CERRAR RUTA COMPLETA (chofer) ──
      cerrarRutaCompleta: async (reporte) => {
        const { rutaId, choferNombre, entregas, mermas: mermasArr, cobros, carga } = reporte;
        const hoy = todayLocalISO();
        const fechaVenc = todayLocalISO(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000));
        const createdOrderIds = [];
        const updatedOrders = [];
        const createdPagoIds = [];
        const createdMovIds = [];
        const createdCxcIds = [];
        const createdMermaIds = [];
        const saldoAdjustments = [];
        const mermaStockReversal = [];

        try {
          for (const e of (entregas || [])) {
            const esVentaExpress = Boolean(e?.express) || !e?.ordenId;

            if (!esVentaExpress) {
              const { data: existingOrd, error: existingOrdErr } = await supabase
                .from('ordenes')
                .select('id, folio, cliente_id, cliente_nombre, total, estatus, metodo_pago, ruta_id')
                .eq('id', e.ordenId)
                .single();
              if (existingOrdErr || !existingOrd) throw existingOrdErr || new Error('No se pudo encontrar la orden asignada');

              const metodoPago = s(e.pago || existingOrd.metodo_pago) || 'Efectivo';
              const esCredito = metodoPago === 'Crédito';
              const clienteNombre = s(e.cliente) || s(existingOrd.cliente_nombre) || 'Cliente';
              const total = centavos(n(e.total || existingOrd.total));

              const { error: updateOrdErr } = await supabase
                .from('ordenes')
                .update({
                  estatus: 'Entregada',
                  metodo_pago: metodoPago,
                  ruta_id: rutaId || existingOrd.ruta_id || null,
                })
                .eq('id', existingOrd.id);
              if (updateOrdErr) throw updateOrdErr;

              updatedOrders.push({
                id: existingOrd.id,
                estatus: existingOrd.estatus,
                metodo_pago: existingOrd.metodo_pago,
                ruta_id: existingOrd.ruta_id,
              });

              if (total > 0) {
                if (esCredito && existingOrd.cliente_id) {
                  const { data: existingCxc } = await supabase
                    .from('cuentas_por_cobrar')
                    .select('id')
                    .eq('orden_id', existingOrd.id)
                    .maybeSingle();

                  if (!existingCxc) {
                    const { data: cxcRow, error: cxcErr } = await supabase.from('cuentas_por_cobrar').insert({
                      cliente_id: existingOrd.cliente_id,
                      orden_id: existingOrd.id,
                      fecha_venta: hoy,
                      fecha_vencimiento: fechaVenc,
                      monto_original: total,
                      monto_pagado: 0,
                      saldo_pendiente: total,
                      concepto: `${s(existingOrd.folio)} — ${clienteNombre}`,
                      estatus: 'Pendiente',
                    }).select('id').single();
                    if (cxcErr || !cxcRow) throw cxcErr || new Error('No se pudo crear la cuenta por cobrar');
                    createdCxcIds.push(cxcRow.id);

                    const { error: saldoErr } = await supabase.rpc('increment_saldo', { p_cli: existingOrd.cliente_id, p_delta: total });
                    if (saldoErr) throw saldoErr;
                    saldoAdjustments.push({ clienteId: existingOrd.cliente_id, delta: total });
                  }
                } else {
                  const referencia = s(e.referencia) || `${s(existingOrd.folio) || `ORD-${existingOrd.id}`}-${metodoPago}`;
                  const { data: existingPago } = await supabase
                    .from('pagos')
                    .select('id')
                    .eq('referencia', referencia)
                    .maybeSingle();

                  if (!existingPago) {
                    const { data: pagoRow, error: pagoErr } = await supabase.from('pagos').insert({
                      cliente_id: existingOrd.cliente_id || 0,
                      orden_id: existingOrd.id,
                      monto: total,
                      metodo_pago: metodoPago,
                      fecha: hoy,
                      referencia,
                      saldo_antes: 0,
                      saldo_despues: 0,
                      usuario_id: uid(),
                    }).select('id').single();
                    if (pagoErr || !pagoRow) throw pagoErr || new Error('No se pudo registrar el pago');
                    createdPagoIds.push(pagoRow.id);
                  }

                  const { data: existingIngreso } = await supabase
                    .from('movimientos_contables')
                    .select('id')
                    .eq('orden_id', existingOrd.id)
                    .eq('tipo', 'Ingreso')
                    .eq('categoria', 'Ventas')
                    .maybeSingle();

                  if (!existingIngreso) {
                    const { data: movRow, error: movErr } = await supabase.from('movimientos_contables').insert({
                      fecha: hoy,
                      tipo: 'Ingreso',
                      categoria: 'Ventas',
                      concepto: `Cobro ${s(existingOrd.folio)} — ${clienteNombre} (${metodoPago})`,
                      monto: total,
                      orden_id: existingOrd.id,
                    }).select('id').single();
                    if (movErr || !movRow) throw movErr || new Error('No se pudo registrar el ingreso');
                    createdMovIds.push(movRow.id);
                  }
                }
              }

              continue;
            }

            const { data: seq, error: seqErr } = await supabase.rpc('nextval', { seq_name: 'folio_ov_seq' });
            if (seqErr) throw seqErr;

            const folio = `OV-${String(seq || 42).padStart(4, '0')}`;
            const itemsStr = (e.items || []).map(it => `${it.cant || it.qty || 0}×${it.sku}`).join(', ');
            const clienteNombre = s(e.cliente) || 'Público en general';
            const total = centavos(n(e.total));
            const metodoPago = s(e.pago) || 'Efectivo';
            const esCredito = metodoPago === 'Crédito';

            const { data: newOrd, error: ordErr } = await supabase.from('ordenes').insert({
              folio,
              cliente_id: e.clienteId || null,
              cliente_nombre: clienteNombre,
              productos: itemsStr || 'Varios',
              fecha: hoy,
              total,
              estatus: 'Entregada',
              metodo_pago: metodoPago,
              ruta_id: rutaId || null,
            }).select('id').single();
            if (ordErr || !newOrd) throw ordErr || new Error('No se pudo crear la orden exprés');
            createdOrderIds.push(newOrd.id);

            if (e.items && e.items.length > 0) {
              const { error: lineErr } = await supabase.from('orden_lineas').insert(
                e.items.map(it => ({
                  orden_id: newOrd.id,
                  sku: it.sku,
                  cantidad: Number(it.cant || it.qty || 0),
                  precio_unit: centavos(Number(it.precio || 0)),
                  subtotal: centavos(Number(it.cant || it.qty || 0) * Number(it.precio || 0)),
                }))
              );
              if (lineErr) throw lineErr;
            }

            if (total > 0) {
              if (esCredito) {
                if (e.clienteId) {
                  const { data: cxcRow, error: cxcErr } = await supabase.from('cuentas_por_cobrar').insert({
                    cliente_id: e.clienteId,
                    orden_id: newOrd.id,
                    fecha_venta: hoy,
                    fecha_vencimiento: fechaVenc,
                    monto_original: total,
                    monto_pagado: 0,
                    saldo_pendiente: total,
                    concepto: `${folio} — ${clienteNombre}`,
                    estatus: 'Pendiente',
                  }).select('id').single();
                  if (cxcErr || !cxcRow) throw cxcErr || new Error('No se pudo crear la cuenta por cobrar');
                  createdCxcIds.push(cxcRow.id);

                  const { error: saldoErr } = await supabase.rpc('increment_saldo', { p_cli: e.clienteId, p_delta: total });
                  if (saldoErr) throw saldoErr;
                  saldoAdjustments.push({ clienteId: e.clienteId, delta: total });
                }
              } else {
                const { data: pagoRow, error: pagoErr } = await supabase.from('pagos').insert({
                  cliente_id: e.clienteId || 0,
                  orden_id: newOrd.id,
                  monto: total,
                  metodo_pago: metodoPago,
                  fecha: hoy,
                  referencia: s(e.referencia) || folio,
                  saldo_antes: 0,
                  saldo_despues: 0,
                  usuario_id: uid(),
                }).select('id').single();
                if (pagoErr || !pagoRow) throw pagoErr || new Error('No se pudo registrar el pago');
                createdPagoIds.push(pagoRow.id);

                const { data: movRow, error: movErr } = await supabase.from('movimientos_contables').insert({
                  fecha: hoy,
                  tipo: 'Ingreso',
                  categoria: 'Ventas',
                  concepto: `Cobro ${folio} — ${clienteNombre} (${metodoPago})`,
                  monto: total,
                  orden_id: newOrd.id,
                }).select('id').single();
                if (movErr || !movRow) throw movErr || new Error('No se pudo registrar el ingreso');
                createdMovIds.push(movRow.id);
              }
            }
          }

          for (const m of (mermasArr || [])) {
            const { data: mermaRow, error: mermaErr } = await supabase.from('mermas').insert({
              sku: m.sku,
              cantidad: Number(m.cant),
              causa: m.causa,
              origen: 'Ruta ' + choferNombre,
              foto_url: m.foto || '',
              ruta_id: rutaId || null,
            }).select('id').single();
            if (mermaErr || !mermaRow) throw mermaErr || new Error('No se pudo registrar la merma');
            createdMermaIds.push(mermaRow.id);
          }

          // Descontar mermas del stock en cuartos fríos (BUG FIX: antes no se descontaba)
          if (mermasArr && mermasArr.length > 0) {
            const { data: cuartosMerma, error: cfMermaErr } = await supabase
              .from('cuartos_frios').select('id, stock').order('id');
            if (cfMermaErr) throw cfMermaErr;
            if (cuartosMerma && cuartosMerma.length > 0) {
              const mermaChanges = [];
              for (const m of mermasArr) {
                let remaining = Number(m.cant || 0);
                for (const cf of cuartosMerma) {
                  if (remaining <= 0) break;
                  const available = Number((cf.stock || {})[m.sku] || 0);
                  if (available > 0) {
                    const toTake = Math.min(available, remaining);
                    remaining -= toTake;
                    mermaChanges.push({
                      cuarto_id: cf.id, sku: m.sku, delta: -toTake,
                      tipo: 'Merma', origen: `Merma ruta ${choferNombre}`,
                      usuario: choferNombre || uname(),
                    });
                  }
                }
              }
              if (mermaChanges.length > 0) {
                const { error: mermaStockErr } = await supabase.rpc('update_stocks_atomic', { p_changes: mermaChanges });
                if (mermaStockErr) throw mermaStockErr;
                // Guardar reversal para rollback
                mermaStockReversal.push(...mermaChanges.map(c => ({ ...c, delta: -c.delta, tipo: 'Entrada', origen: 'Rollback merma ruta' })));
              }
              // Egreso contable por costo de cada merma
              for (const m of mermasArr) {
                const cant = Number(m.cant || 0);
                if (cant <= 0) continue;
                const { data: prodMerma } = await supabase.from('productos')
                  .select('costo_unitario, nombre').eq('sku', m.sku).maybeSingle();
                const costoUnit = Number(prodMerma?.costo_unitario || 0);
                if (costoUnit > 0) {
                  const { data: egresoRow, error: egresoErr } = await supabase.from('movimientos_contables').insert({
                    fecha: hoy, tipo: 'Egreso', categoria: 'Mermas',
                    concepto: `Merma ruta ${choferNombre}: ${cant}× ${m.sku}${prodMerma?.nombre ? ` (${prodMerma.nombre})` : ''} — ${m.causa || 'Sin causa'}`,
                    monto: centavos(cant * costoUnit),
                  }).select('id').single();
                  if (!egresoErr && egresoRow) createdMovIds.push(egresoRow.id);
                }
              }
              await checkStockBajo(mermasArr.map(m => m.sku));
            }
          }

          // Fase 18: detectar si la ruta es legacy (creada antes del modelo "carga real").
          // Las legacy descontaron inventario al autorizar, así que el cierre debe devolver
          // sobrante al CF como antes. Las nuevas no descontaron al autorizar — descontaron
          // al confirmar carga — así que NO se devuelve nada aquí (el sobrante físico se
          // registra manualmente como entrada al CF cuando el chofer regresa al almacén).
          let esLegacy = false;
          if (rutaId) {
            const { data: rutaInfo } = await supabase
              .from('rutas').select('carga_confirmada_at').eq('id', rutaId).single();
            esLegacy = !rutaInfo?.carga_confirmada_at;
          }

          if (esLegacy && carga && typeof carga === 'object') {
            // ── COMPORTAMIENTO LEGACY (rutas viejas que descontaron al autorizar) ──
            const devueltoPorSku = calcDevolucionLegacy(carga, entregas, mermasArr);
            if (Object.keys(devueltoPorSku).length > 0) {
              const { data: cfs, error: cfErr } = await supabase.from('cuartos_frios').select('id').limit(1);
              if (cfErr) throw cfErr;
              const cfId = cfs?.[0]?.id;
              if (!cfId) throw new Error('No hay cuarto frío para devolver inventario');
              const changes = Object.entries(devueltoPorSku).map(([sku, qty]) => ({
                cuarto_id: cfId, sku, delta: qty,
                tipo: 'Entrada', origen: `Devolución ruta ${choferNombre} (legacy)`,
                usuario: choferNombre || uname(),
              }));
              const { error: rpcErr } = await supabase.rpc('update_stocks_atomic', { p_changes: changes });
              if (rpcErr) throw rpcErr;
              const devTxt = Object.entries(devueltoPorSku).map(([sku, qty]) => `${qty}×${sku}`).join(', ');
              await log('Devolución legacy', 'Rutas', `${choferNombre} devolvió: ${devTxt}`);
            }
          }

          if (rutaId) {
            const { error: rutaErr } = await supabase.from('rutas').update({
              estatus: 'Cerrada',
              fecha_fin: hoy,
            }).eq('id', rutaId);
            if (rutaErr) throw rutaErr;
          }

          await log('Cierre Ruta', 'Rutas', `Chofer: ${choferNombre}, Entregas: ${(entregas || []).length}, Mermas: ${(mermasArr || []).length}, Efectivo: $${cobros?.Efectivo || 0}`);
          notify('venta', 'Ruta cerrada', `${choferNombre} cerró ruta — ${(entregas || []).length} entregas, $${(cobros?.Efectivo || 0).toLocaleString()} efectivo`, '🚛', String(rutaId));
          rf();
        } catch (err) {
          for (const ord of updatedOrders.reverse()) {
            await supabase.from('ordenes').update({
              estatus: ord.estatus,
              metodo_pago: ord.metodo_pago,
              ruta_id: ord.ruta_id,
            }).eq('id', ord.id);
          }
          for (const saldoAdj of saldoAdjustments.reverse()) {
            await supabase.rpc('increment_saldo', { p_cli: saldoAdj.clienteId, p_delta: -saldoAdj.delta });
          }
          if (mermaStockReversal.length) await supabase.rpc('update_stocks_atomic', { p_changes: mermaStockReversal });
          if (createdMermaIds.length) await supabase.from('mermas').delete().in('id', createdMermaIds);
          if (createdMovIds.length) await supabase.from('movimientos_contables').delete().in('id', createdMovIds);
          if (createdPagoIds.length) await supabase.from('pagos').delete().in('id', createdPagoIds);
          if (createdCxcIds.length) await supabase.from('cuentas_por_cobrar').delete().in('id', createdCxcIds);
          if (createdOrderIds.length) {
            await supabase.from('orden_lineas').delete().in('orden_id', createdOrderIds);
            await supabase.from('ordenes').delete().in('id', createdOrderIds);
          }
          t()?.error('No se pudo cerrar la ruta correctamente');
          return err;
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
      resetSistema: async ({ confirmacion, motivo = '' } = {}) => {
        const guard = requireAdmin();
        if (guard) { t()?.error(guard.error); return guard; }
        try {
          if (confirmacion !== 'RESETEAR') {
            return { error: 'Confirmación inválida. Debes escribir RESETEAR.' };
          }

          const usuario = uname() || 'Admin';
          const inicioReset = new Date().toISOString();

          // Orden defensivo: hijos antes que padres (tolera FKs sin CASCADE)
          const tablas = [
            'pagos',
            'cuentas_por_cobrar',
            'orden_lineas',
            'invoice_attempts',
            'mermas',
            'inventario_mov',
            'chofer_ubicaciones',
            'ordenes',
            'rutas',
            'produccion',
            'nomina_recibos',
            'nomina_periodos',
            'pagos_proveedores',
            'cuentas_por_pagar',
            'movimientos_contables',
            'costos_historial',
            'notificaciones',
            'error_log',
          ];

          const errores = [];

          for (const tabla of tablas) {
            const { error } = await supabase.from(tabla).delete().neq('id', 0);
            if (error) errores.push({ tabla, error: error.message });
          }

          // Reset stock de cuartos fríos (JSONB → {})
          const { error: errCF } = await supabase
            .from('cuartos_frios')
            .update({ stock: {} })
            .neq('id', 0);
          if (errCF) errores.push({ tabla: 'cuartos_frios.stock', error: errCF.message });

          // Reset stock de productos
          const { error: errProd } = await supabase
            .from('productos')
            .update({ stock: 0 })
            .neq('id', 0);
          if (errProd) errores.push({ tabla: 'productos.stock', error: errProd.message });

          // Auditoria NO se borra: cumplimiento SAT y trazabilidad histórica.
          // El reset solo agrega la entrada de RESET_SISTEMA al historial.

          // Audit log del reset
          const detalle = JSON.stringify({
            motivo: motivo || 'Sin motivo',
            tablas_afectadas: tablas,
            inicio: inicioReset,
            errores: errores.length > 0 ? errores : null,
          });
          const { error: errInsAud } = await supabase.from('auditoria').insert({
            usuario,
            accion: 'RESET_SISTEMA',
            modulo: 'Sistema',
            detalle,
          });
          if (errInsAud) {
            console.warn('[resetSistema] insert auditoria final falló:', errInsAud.message);
          }

          rf();

          if (errores.length > 0) {
            const msg = `Reset parcial: ${errores.length} ${errores.length === 1 ? 'tabla con error' : 'tablas con errores'}`;
            t()?.error(msg);
            return { error: msg, partial: true, detalles: errores };
          }

          return undefined;
        } catch (e) {
          console.error('[resetSistema] excepción:', e);
          t()?.error('Error inesperado durante reset');
          return { error: e?.message || 'Error inesperado durante reset' };
        }
      },
    };
  }

  return { data, actions: actionsRef.current, loading, error };
}
