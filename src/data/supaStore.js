import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { backendPost } from '../lib/backend';
import { n, s, centavos } from '../utils/safe';
import { useToast } from '../components/ui/Toast';

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
  contabilidad: { ingresos: [], egresos: [] },
};

export function useSupaStore(userId, userName) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const uidRef = useRef(userId);
  uidRef.current = userId;
  const userNameRef = useRef(userName || '');
  userNameRef.current = userName || '';

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

      // Tablas opcionales
      const [com, lea, emp, nomP, nomR, movC, mer, cxc, costF, costH, cxp, pagProv] = await Promise.all([
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
        return {
          ...r,
          chofer: choferLabel,
          cargaTxt,
          choferId: r.chofer_id,
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
          if (!p || s(p.tipo) === "Producto Terminado") {
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
        mermas: (mer || []).map(m => ({ ...toCamel(m), cantidad: Number(m.cantidad) })),
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
        contabilidad: contabilidadObj,
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
                try { data.subscription.unsubscribe(); } catch (e) {}
              }
            });
            sub = data && data.subscription;
            return;
          }
        } catch (e) {
          // ignore and continue to fetch
        }
      }
      if (!cancelled) fetchAll();
    };

    run();

    return () => { cancelled = true; if (sub && sub.unsubscribe) try { sub.unsubscribe(); } catch (e) {} };
  }, [fetchAll, userId]);

  // ── Realtime subscriptions ──────────────────────────────────
  useEffect(() => {
    const tables = [
      'clientes', 'productos', 'ordenes', 'rutas',
      'produccion', 'inventario_mov', 'pagos', 'auditoria',
      'cuartos_frios', 'comodatos', 'leads', 'empleados',
      'movimientos_contables', 'mermas', 'nomina_periodos', 'cuentas_por_cobrar',
      'cuentas_por_pagar', 'costos_fijos',
    ];
    const channels = tables.map(table =>
      supabase.channel(`rt_${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, () => fetchAll())
        .subscribe()
    );
    return () => { channels.forEach(ch => supabase.removeChannel(ch)); };
  }, [fetchAll]);

  // ── Actions ─────────────────────────────────────────────────
  const actionsRef = useRef(null);
  if (!actionsRef.current) {
    const uid   = () => uidRef.current;
    const uname = () => userNameRef.current || 'Usuario';
    const rf    = () => fetchAll();
    const t     = () => toastRef.current;
    const log   = (accion, modulo, detalle) =>
      supabase.from('auditoria').insert({ usuario: uname(), accion, modulo, detalle }).then(() => {});

    const a = actionsRef.current = {

      // ── CLIENTES ──
      addCliente: async (c) => {
        const { data: newCli, error } = await supabase.from('clientes').insert({
          nombre: c.nombre, rfc: c.rfc, regimen: c.regimen,
          uso_cfdi: c.usoCfdi || 'G03', cp: c.cp, correo: c.correo,
          tipo: c.tipo, contacto: c.contacto,
          calle: c.calle || null, colonia: c.colonia || null,
          ciudad: c.ciudad || 'Hermosillo', zona: c.zona || null,
          latitud: c.latitud || null, longitud: c.longitud || null,
        }).select('id').single();
        if (error) {
          console.error('[addCliente]', error.message, error.code);
          t()?.error('Error al crear cliente: ' + error.message);
          return error;
        }
        rf();
        log('Crear', 'Clientes', `${c.nombre}`);
        return newCli; // { id } returned so callers can use real Supabase ID
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
        if (c.calle    !== undefined) update.calle    = c.calle || null;
        if (c.colonia  !== undefined) update.colonia  = c.colonia || null;
        if (c.ciudad   !== undefined) update.ciudad   = c.ciudad || null;
        if (c.zona     !== undefined) update.zona     = c.zona || null;
        if (c.latitud  !== undefined) update.latitud  = c.latitud || null;
        if (c.longitud !== undefined) update.longitud = c.longitud || null;
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
        const { error } = await supabase.from('clientes').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar cliente'); return error; }
        log('Eliminar', 'Clientes', `ID ${id}`);
        rf();
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
        const { error } = await supabase.from('productos').update({
          nombre: p.nombre, tipo: p.tipo, ubicacion: p.ubicacion,
          precio: Number(p.precio) || 0,
          costo_unitario: Number(p.costo_unitario || p.costoUnitario) || 0,
          proveedor: p.proveedor || null,
          empaque_sku: p.empaque_sku || p.empaqueSku || null,
        }).eq('id', id);
        if (error) { t()?.error('Error al actualizar producto'); return error; }
        log('Editar', 'Productos', `ID ${id} — ${p.nombre}`);
        rf();
      },

      deleteProducto: async (id) => {
        const { error } = await supabase.from('productos').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar producto'); return error; }
        log('Eliminar', 'Productos', `ID ${id}`);
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

      // ── ÓRDENES ──
      addOrden: async (o) => {
        const items = s(o.productos).split(',').map(x => x.trim()).filter(Boolean).map(item => {
          const m = item.match(/^(\d+)\s*[×x]\s*(.+)$/i);
          return m ? { qty: parseInt(m[1], 10), sku: m[2].trim() } : null;
        }).filter(Boolean);
        if (items.length === 0) return { message: 'Productos inválidos' };

        // Validar cantidades positivas
        if (items.some(i => i.qty <= 0)) {
          return { message: 'Las cantidades deben ser positivas' };
        }

        const [{ data: prods }, { data: pes }] = await Promise.all([
          supabase.from('productos').select('sku, precio, stock'),
          supabase.from('precios_esp').select('sku, precio').eq('cliente_id', o.clienteId),
        ]);

        for (const item of items) {
          const p = (prods || []).find(x => x.sku === item.sku);
          if (!p) return { message: `SKU ${item.sku} no existe` };
          // Validar que el precio no es negativo
          const pe = (pes || []).find(x => x.sku === item.sku);
          const precio = pe ? Number(pe.precio) : Number(p?.precio || 0);
          if (precio < 0) return { message: `Precio inválido para ${item.sku}` };
        }

        let total = 0;
        const lineas = items.map(item => {
          const p  = (prods || []).find(x => x.sku === item.sku);
          const pe = (pes   || []).find(x => x.sku === item.sku);
          const unitPrice = centavos(pe ? Number(pe.precio) : Number(p?.precio || 0));
          const subtotal  = centavos(item.qty * unitPrice);
          total += subtotal;
          return { sku: item.sku, cantidad: item.qty, precio_unit: unitPrice, subtotal };
        });
        total = centavos(total);

        // Validar que el total sea positivo
        if (total <= 0) {
          return { message: 'El total de la orden debe ser mayor a 0' };
        }

        const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_ov_seq' });
        const folio = `OV-${String(seq || 42).padStart(4, '0')}`;

        // Build productos string from parsed items
        const productosStr = o.productos || items.map(i => `${i.qty}×${i.sku}`).join(', ');

        // Resolve cliente name
        let clienteNombre = s(o.cliente);
        if (!clienteNombre && o.clienteId) {
          const { data: cli } = await supabase.from('clientes').select('nombre').eq('id', o.clienteId).single();
          clienteNombre = cli?.nombre || 'Público en general';
        }
        if (!clienteNombre) clienteNombre = 'Público en general';

        // Build insert payload — only include columns that exist in ordenes table
        const ordenInsert = {
          folio,
          cliente_id: o.clienteId || null,
          cliente_nombre: clienteNombre,
          productos: productosStr,
          fecha: o.fecha || new Date().toISOString().slice(0, 10),
          total,
          estatus: 'Creada',
          metodo_pago: o.metodoPago || 'Efectivo',
          vendedor_id: o.usuarioId || null,
        };

        const { data: newOrd, error: e1 } = await supabase.from('ordenes').insert(ordenInsert).select('id, folio, cliente_nombre, productos, total, estatus, fecha, metodo_pago, cliente_id, requiere_factura').single();
        if (e1) { t()?.error('Error al crear orden'); return e1; }

        const { error: e2 } = await supabase.from('orden_lineas').insert(
          lineas.map(l => ({ ...l, orden_id: newOrd.id }))
        );

        await log('Crear', 'Órdenes', `${folio} — $${total}`);

        if (!e2) rf();
        if (e2) return e2;
        // Return the created order so callers can use it immediately
        return { orden: { ...newOrd, cliente: newOrd.cliente_nombre } };
      },

      updateOrdenEstatus: async (id, nuevoEst, metodoPago = null) => {
        let error;
        if (nuevoEst === 'Asignada') {
          ({ error } = await supabase.rpc('asignar_orden', { p_id: id, p_ruta: null, p_uid: uid() }));
        } else if (nuevoEst === 'Cancelada') {
          const { data: ord } = await supabase.from('ordenes').select('estatus').eq('id', id).single();
          if (ord?.estatus === 'Asignada') {
            ({ error } = await supabase.rpc('cancelar_orden_asignada', { p_id: id, p_uid: uid() }));
          } else {
            ({ error } = await supabase.from('ordenes').update({ estatus: nuevoEst }).eq('id', id));
          }
        } else {
          const updateObj = { estatus: nuevoEst };
          if (metodoPago) updateObj.metodo_pago = metodoPago;
          ({ error } = await supabase.from('ordenes').update(updateObj).eq('id', id));
        }
        if (error) { t()?.error('Error al actualizar orden'); return error; }

        // Auto-registrar ingreso o CxC al cobrar (Entregada)
        if (nuevoEst === 'Entregada') {
          const { data: ord } = await supabase.from('ordenes').select('id, folio, total, cliente_id, metodo_pago, facturama_id').eq('id', id).single();
          if (ord && n(ord.total) > 0) {
            const cli = ord.cliente_id
              ? (await supabase.from('clientes').select('nombre').eq('id', ord.cliente_id).single())?.data
              : null;
            const mPago = metodoPago || s(ord.metodo_pago) || 'Efectivo';
            const esCredito = mPago.toLowerCase().includes('crédito') || mPago.toLowerCase().includes('fiado');

            if (esCredito && ord.cliente_id) {
              // Crédito: crear cuenta por cobrar
              const fechaVenc = new Date();
              fechaVenc.setDate(fechaVenc.getDate() + 30);
              await supabase.from('cuentas_por_cobrar').insert({
                cliente_id: ord.cliente_id,
                orden_id: id,
                fecha_venta: new Date().toISOString().slice(0, 10),
                fecha_vencimiento: fechaVenc.toISOString().slice(0, 10),
                monto_original: centavos(n(ord.total)),
                monto_pagado: 0,
                saldo_pendiente: centavos(n(ord.total)),
                concepto: `${s(ord.folio)} — ${cli?.nombre || 'Cliente'}`,
                estatus: 'Pendiente',
              });
              // Incrementar saldo del cliente
              await supabase.rpc('increment_saldo', { p_cli: ord.cliente_id, p_delta: centavos(n(ord.total)) });
            } else {
              // Contado: registrar ingreso contable
              await supabase.from('movimientos_contables').insert({
                fecha: new Date().toISOString().slice(0, 10),
                tipo: 'Ingreso', categoria: 'Ventas',
                concepto: `Cobro ${s(ord.folio)} — ${cli?.nombre || 'Cliente'}`,
                monto: centavos(n(ord.total)),
              });
            }
          }

          // Sync payment status with Facturama if invoice exists
          if (ord.facturama_id) {
            try {
              await backendPost('billing-sync-payment', { ordenId: ord.id });
            } catch (syncErr) {
              console.warn('[syncFacturama]', syncErr.message);
            }
          }
        }

        await log('Cambiar estatus', 'Órdenes', `Orden #${id} → ${nuevoEst}`);

        rf();
      },

      deleteOrden: async (id) => {
        const { error } = await supabase.from('ordenes').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar orden'); return error; }
        log('Eliminar', 'Órdenes', `ID ${id}`);
        rf();
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

        const qty = Number(p.cantidad || 0);
        if (qty > 0) {
          const fallbackEmpaque = {
            'HC-25K': 'EMP-25',
            'HC-5K': 'EMP-5',
            'HT-25K': 'EMP-25',
            'BH-50K': null,
          };

          let empaqueSku = fallbackEmpaque[p.sku] || null;
          try {
            const { data: prodRow, error: prodErr } = await supabase
              .from('productos')
              .select('empaque_sku')
              .eq('sku', p.sku)
              .single();
            if (!prodErr && prodRow?.empaque_sku) empaqueSku = prodRow.empaque_sku;
          } catch (e) {
          }

          if (empaqueSku) {
            const { data: empaqueProd, error: empaqueErr } = await supabase
              .from('productos')
              .select('id,stock')
              .eq('sku', empaqueSku)
              .single();

            if (!empaqueErr && empaqueProd) {
              const newStock = Math.max(0, Number(empaqueProd.stock || 0) - qty);
              await supabase.from('productos').update({ stock: newStock }).eq('id', empaqueProd.id);

              await supabase.from('inventario_mov').insert({
                tipo: 'Salida',
                producto: empaqueSku,
                cantidad: qty,
                origen: `Producción ${folio}`,
                usuario: uname(),
              });
            }
          }
        }
        rf();
      },

      confirmarProduccion: async (id) => {
        // Obtener datos de la producción antes de confirmar
        const { data: prod } = await supabase.from('produccion').select('*').eq('id', id).single();
        
        // Confirmar en backend
        const { error } = await supabase.rpc('confirmar_produccion', { p_id: id, p_uid: uid() });
        if (error) { t()?.error('Error al confirmar producción'); return error; }
        
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
              const hoy = new Date().toISOString().slice(0, 10);
              const periodo = hoy.slice(0, 7);
              
              // Actualizar costo en la producción
              await supabase.from('produccion').update({
                costo_empaque: costoUnitario,
                costo_total: costoTotal,
              }).eq('id', id);
              
              // Registrar costo de producción en historial
              await supabase.from('costos_historial').insert({
                tipo: 'Producción',
                categoria: 'Costo de Ventas',
                concepto: `Producción ${prod.folio || id}: ${cantidad}× ${prod.sku} (empaque: ${producto.empaque_sku})`,
                monto: costoTotal,
                periodo,
                fecha: hoy,
              });
            }
          }
        }
        
        log('Confirmar', 'Producción', `ID ${id}`);
        rf();
      },

      deleteProduccion: async (id) => {
        const { error } = await supabase.from('produccion').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar registro de producción'); return error; }
        log('Eliminar', 'Producción', `ID ${id}`);
        rf();
      },

      producirYCongelar: async (p) => {
        const err = await a.addProduccion(p);
        if (!err && p.destino) await a.meterACuartoFrio(p.destino, p.sku, Number(p.cantidad));
      },

      // ── CUARTOS FRÍOS — CRUD ──
      addCuartoFrio: async (cf) => {
        const { error } = await supabase.from('cuartos_frios').insert({
          nombre: cf.nombre, temp: cf.temp, capacidad: cf.capacidad, stock: {},
        });
        if (error) { t()?.error('Error al crear cuarto frío'); return error; }
        log('Crear', 'Cuartos Fríos', `${cf.nombre}`);
        rf();
      },

      updateCuartoFrio: async (id, cf) => {
        const update = {};
        if (cf.nombre    !== undefined) update.nombre    = cf.nombre;
        if (cf.temp      !== undefined) update.temp      = cf.temp;
        if (cf.capacidad !== undefined) update.capacidad = cf.capacidad;
        const { error } = await supabase.from('cuartos_frios').update(update).eq('id', id);
        if (error) { t()?.error('Error al actualizar cuarto frío'); return error; }
        log('Editar', 'Cuartos Fríos', `ID ${id}`);
        rf();
      },

      deleteCuartoFrio: async (id) => {
        const { error } = await supabase.from('cuartos_frios').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar cuarto frío'); return error; }
        log('Eliminar', 'Cuartos Fríos', `ID ${id}`);
        rf();
      },

      // ── CUARTOS FRÍOS — STOCK (JSONB) ──
      meterACuartoFrio: async (cfId, sku, cantidad) => {
        const { data: row } = await supabase
          .from('cuartos_frios').select('stock').eq('id', cfId).single();
        const current = (row?.stock && typeof row.stock === 'object') ? row.stock : {};
        const updated = { ...current, [sku]: (Number(current[sku] || 0) + Number(cantidad)) };
        await supabase.from('cuartos_frios').update({ stock: updated }).eq('id', cfId);
        await supabase.from('inventario_mov').insert({
          tipo: 'Entrada', producto: sku, cantidad: Number(cantidad),
          origen: `Entrada a ${cfId}`, usuario: uname(),
        });
        log('Entrada CF', 'Cuartos Fríos', `${cantidad}×${sku} → ${cfId}`);
        rf();
      },

      sacarDeCuartoFrio: async (cfId, sku, cantidad, motivo) => {
        const { data: row } = await supabase
          .from('cuartos_frios').select('stock').eq('id', cfId).single();
        const current = (row?.stock && typeof row.stock === 'object') ? row.stock : {};
        const updated = {
          ...current,
          [sku]: Math.max(0, Number(current[sku] || 0) - Number(cantidad)),
        };
        await supabase.from('cuartos_frios').update({ stock: updated }).eq('id', cfId);
        await supabase.from('inventario_mov').insert({
          tipo: 'Salida', producto: sku, cantidad: Number(cantidad),
          origen: motivo || String(cfId), usuario: uname(),
        });
        log('Salida CF', 'Cuartos Fríos', `${cantidad}×${sku} de ${cfId} — ${motivo || 'Sin motivo'}`);
        rf();
      },

      traspasoEntreUbicaciones: async ({ origen, destino, sku, cantidad }) => {
        const qty = Number(cantidad);
        if (qty <= 0) return;

        const [{ data: rowOrig }, { data: rowDest }] = await Promise.all([
          supabase.from('cuartos_frios').select('stock').eq('id', origen).single(),
          supabase.from('cuartos_frios').select('stock').eq('id', destino).single(),
        ]);

        const stockOrig = (rowOrig?.stock && typeof rowOrig.stock === 'object') ? rowOrig.stock : {};
        const stockDest = (rowDest?.stock && typeof rowDest.stock === 'object') ? rowDest.stock : {};

        await Promise.all([
          supabase.from('cuartos_frios').update({
            stock: { ...stockOrig, [sku]: Math.max(0, Number(stockOrig[sku] || 0) - qty) },
          }).eq('id', origen),
          supabase.from('cuartos_frios').update({
            stock: { ...stockDest, [sku]: Number(stockDest[sku] || 0) + qty },
          }).eq('id', destino),
        ]);

        await supabase.from('inventario_mov').insert({
          tipo: 'Traspaso', producto: sku, cantidad: qty,
          origen: `${origen} → ${destino}`, usuario: uname(),
        });
        log('Traspaso', 'Cuartos Fríos', `${qty}×${sku} de ${origen} → ${destino}`);
        rf();
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

        await supabase.from('productos').update({ stock: target }).eq('sku', sku);

        await supabase.from('inventario_mov').insert({
          tipo: delta >= 0 ? 'Entrada' : 'Salida',
          producto: sku,
          cantidad: Math.abs(delta),
          origen: `Ajuste manual: ${motivo || 'Sin motivo'}`,
          usuario: uname(),
        });

        await log('Ajustar', 'Inventario', `${sku}: ${actual} → ${target}. Motivo: ${motivo || 'Sin motivo'}`);

        rf();
      },

      // ── RUTAS ──
      addRuta: async (r) => {
        const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_r_seq' });
        const folio = `R-${String(seq || 13).padStart(3, '0')}`;
        const hoy = new Date().toISOString();
        const cargaObj = r.carga || {};
        
        const { error } = await supabase.from('rutas').insert({
          folio, 
          nombre: r.nombre, 
          chofer_id: r.choferId || null,
          estatus: 'Programada', 
          carga: cargaObj,                     // JSONB: {"HC-25K": 50, ...}
          carga_autorizada: r.cargaAutorizada || cargaObj,
          extra_autorizado: r.extraAutorizado || {},
          clientes_asignados: r.clientesAsignados || [],  // [{clienteId, orden}]
          autorizado_at: hoy,
        });
        if (error) { t()?.error('Error al crear ruta'); return error; }
        
        // Descontar carga autorizada usando RPC atómica
        if (Object.keys(cargaObj).length > 0) {
          const { data: cuartos } = await supabase.from('cuartos_frios').select('id, stock').order('id');
          if (cuartos && cuartos.length > 0) {
            // Calcular cambios distribuyendo entre cuartos fríos
            const changes = [];
            for (const [sku, qtyNeeded] of Object.entries(cargaObj)) {
              let remaining = Number(qtyNeeded);
              for (const cf of cuartos) {
                if (remaining <= 0) break;
                const stockObj = (cf.stock && typeof cf.stock === 'object') ? cf.stock : {};
                const available = Number(stockObj[sku] || 0);
                if (available > 0) {
                  const toTake = Math.min(available, remaining);
                  remaining -= toTake;
                  changes.push({
                    cuarto_id: cf.id,
                    sku,
                    delta: -toTake,  // Negativo para descontar
                    tipo: 'Salida',
                    origen: `Carga ruta ${folio}`,
                    usuario: uname(),
                  });
                }
              }
            }
            
            // Ejecutar todos los cambios de forma atómica
            if (changes.length > 0) {
              const { error: rpcErr } = await supabase.rpc('update_stocks_atomic', {
                p_changes: changes
              });
              if (rpcErr) {
                console.error('[addRuta] Error en descuento atómico:', rpcErr.message);
                t()?.error('Error al descontar inventario');
              }
            }
          }
        }
        
        // Log con detalle de carga
        const cargaTxt = Object.entries(cargaObj).map(([sku, qty]) => `${qty}×${sku}`).join(', ') || '—';
        log('Autorizar', 'Rutas', `${folio} — ${r.nombre} — Carga: ${cargaTxt}`);
        rf();
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
        await Promise.all(ordenIds.map(oid =>
          supabase.from('ordenes').update({ ruta_id: rutaId }).eq('id', oid)
        ));
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
        await supabase.from('rutas').update({ 
          estatus: 'Cerrada', 
          devolucion: devolucionObj,
        }).eq('id', rutaId);
        
        // Regresar devolución al primer cuarto frío
        const { data: cuartos } = await supabase.from('cuartos_frios').select('id, stock').limit(1);
        if (cuartos && cuartos.length > 0) {
          const cf = cuartos[0];
          const stockActual = cf.stock || {};
          for (const [sku, qty] of Object.entries(devolucionObj)) {
            if (qty > 0) {
              stockActual[sku] = (stockActual[sku] || 0) + qty;
            }
          }
          await supabase.from('cuartos_frios').update({ stock: stockActual }).eq('id', cf.id);
        }
        
        const devTxt = Object.entries(devolucionObj).filter(([_,v]) => v > 0).map(([sku, qty]) => `${qty}×${sku}`).join(', ') || '0';
        log('Cerrar', 'Rutas', `Ruta #${rutaId} — devuelto: ${devTxt}`);
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
        rf();
      },

      // ── PAGOS ──
      registrarPago: async (clienteId, monto, referencia) => {
        const { error } = await supabase.rpc('registrar_pago', {
          p_cli: clienteId, p_monto: centavos(monto),
          p_ref: referencia, p_uid: uid(),
        });
        if (error) { t()?.error('Error al registrar pago'); return error; }
        log('Registrar', 'Pagos', `Cliente #${clienteId} — $${monto} — ${referencia || 'Sin ref'}`);
        rf();
      },

      // Cobrar contra una cuenta por cobrar específica
      cobrarCxC: async (cxcId, monto, metodoPago, referencia) => {
        const hoy = new Date().toISOString().slice(0, 10);
        const montoNum = centavos(n(monto));

        // Obtener la CxC actual
        const { data: cxc, error: e1 } = await supabase
          .from('cuentas_por_cobrar')
          .select('*')
          .eq('id', cxcId)
          .single();
        if (e1 || !cxc) { t()?.error('Cuenta por cobrar no encontrada'); return e1; }

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
        await supabase.from('pagos').insert({
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
        });

        // Registrar ingreso contable
        await supabase.from('movimientos_contables').insert({
          fecha: hoy, tipo: 'Ingreso', categoria: 'Cobranza',
          concepto: `Cobro CxC #${cxcId} — ${s(cxc.concepto) || 'Cliente'}`,
          monto: montoNum,
          orden_id: cxc.orden_id,
        });

        // Reducir saldo del cliente
        if (cxc.cliente_id) {
          await supabase.rpc('increment_saldo', { p_cli: cxc.cliente_id, p_delta: -montoNum });
        }

        log('Cobrar', 'Cuentas por Cobrar', `CxC #${cxcId} — $${monto} — ${nuevoEstatus}`);
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
        const hoy = fecha || new Date().toISOString().slice(0, 10);
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
        const fechaUsar = fecha || new Date().toISOString().slice(0, 10);
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
          fecha_emision: cxp.fechaEmision || new Date().toISOString().slice(0, 10),
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
        const hoy = new Date().toISOString().slice(0, 10);
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
        if (e3) { t()?.error('Error al registrar egreso'); return e3; }

        await supabase.from('pagos_proveedores').insert({
          cxp_id: cxpId,
          monto: montoNum,
          fecha: hoy,
          metodo_pago: metodoPago || 'Transferencia',
          referencia: referencia || '',
          movimiento_id: movimiento?.id,
        });

        t()?.success(`Pago registrado: $${monto}`);
        log('Pagar', 'Cuentas por Pagar', `CxP #${cxpId} — $${monto} — ${nuevoEstatus}`);
        rf();
      },

      // ── MERMAS ──
      registrarMerma: async (sku, cantidad, causa, origen, fotoUrl) => {
        const { error } = await supabase.from('mermas').insert({
          sku, cantidad: Number(cantidad), causa, origen, foto_url: fotoUrl || '',
        });
        if (error) { t()?.error('Error al registrar merma'); return error; }
        log('Registrar', 'Mermas', `${cantidad}×${sku} — ${causa}`);
        rf();
      },

      deleteMerma: async (id) => {
        const { error } = await supabase.from('mermas').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar merma'); return error; }
        log('Eliminar', 'Mermas', `ID ${id}`);
        rf();
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
          fecha: new Date().toISOString().slice(0, 10),
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
      addEmpleado: async (e) => {
        const { error } = await supabase.from('empleados').insert({
          nombre: e.nombre, puesto: e.puesto, telefono: e.telefono,
          salario_base: Number(e.salarioBase || e.salario_base || 0),
          banco: e.banco, cuenta: e.cuenta, estatus: 'Activo',
        });
        if (error) { t()?.error('Error al guardar empleado'); return error; }
        log('Crear', 'Empleados', `${e.nombre} — ${e.puesto}`);
        rf();
      },

      updateEmpleado: async (id, e) => {
        const update = {};
        if (e.nombre       !== undefined) update.nombre       = e.nombre;
        if (e.puesto       !== undefined) update.puesto       = e.puesto;
        if (e.telefono     !== undefined) update.telefono     = e.telefono;
        if (e.salarioBase  !== undefined) update.salario_base = Number(e.salarioBase);
        if (e.salario_base !== undefined) update.salario_base = Number(e.salario_base);
        if (e.banco        !== undefined) update.banco        = e.banco;
        if (e.cuenta       !== undefined) update.cuenta       = e.cuenta;
        if (e.estatus      !== undefined) update.estatus      = e.estatus;
        const { error } = await supabase.from('empleados').update(update).eq('id', id);
        if (error) { t()?.error('Error al actualizar empleado'); return error; }
        log('Editar', 'Empleados', `ID ${id}`);
        rf();
      },

      deleteEmpleado: async (id) => {
        const { error } = await supabase.from('empleados').delete().eq('id', id);
        if (error) { t()?.error('Error al eliminar empleado'); return error; }
        log('Eliminar', 'Empleados', `ID ${id}`);
        rf();
      },

      // ── NÓMINA ──
      addNominaPeriodo: async (p) => {
        const { data: row, error } = await supabase.from('nomina_periodos').insert(p).select().single();
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
        const hoy = new Date().toISOString().slice(0, 10);
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
        const { data: prod } = await supabase.from('productos').select('id, stock').eq('sku', sku).single();
        if (!prod) return;
        const newStock = tipo === 'Entrada'
          ? Number(prod.stock) + Number(cantidad)
          : Math.max(0, Number(prod.stock) - Number(cantidad));
        await supabase.from('productos').update({ stock: newStock }).eq('id', prod.id);
        await supabase.from('inventario_mov').insert({
          tipo, producto: sku, cantidad: Number(cantidad),
          origen: motivo, usuario: uname(),
        });

        // Auto-registrar movimiento contable cuando es compra de empaques (Entrada)
        if (tipo === 'Entrada' && Number(costo) > 0) {
          const hoy = new Date().toISOString().slice(0, 10);
          const montoTotal = centavos(Number(costo));
          
          if (esCredito && proveedor) {
            // Compra a crédito: crear cuenta por pagar (no egreso aún)
            const fechaVenc = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            await supabase.from('cuentas_por_pagar').insert({
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
            log('Compra crédito', 'Almacén Bolsas', `${cantidad}×${sku} → CxP: $${Number(costo)} — ${proveedor}`);
          } else {
            // Compra de contado: egreso directo
            await supabase.from('movimientos_contables').insert({
              fecha: hoy,
              tipo: 'Egreso', categoria: 'Proveedores',
              concepto: `Compra empaques: ${cantidad}×${sku}${proveedor ? ' — ' + proveedor : ''}`,
              monto: montoTotal,
            });
          }
        }

        log(tipo, 'Almacén Bolsas', `${sku} x${cantidad} — ${motivo}`);
        rf();
      },

      // ── CERRAR RUTA COMPLETA (chofer) ──
      cerrarRutaCompleta: async (reporte) => {
        const { rutaId, choferNombre, entregas, mermas: mermasArr, cobros, carga } = reporte;
        const hoy = new Date().toISOString().slice(0, 10);
        // Default vencimiento: 15 días para crédito
        const fechaVenc = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // 0. Actualizar estatus de la ruta a Cerrada para mantener consistencia con la UI
        if (rutaId) {
          const { error: rutaErr } = await supabase.from('rutas').update({
            estatus: 'Cerrada',
            fecha_fin: hoy,
          }).eq('id', rutaId);
          if (rutaErr) console.warn('[cerrarRutaCompleta] Error actualizando ruta:', rutaErr.message);
        }

        // 1. Crear órdenes + líneas + ingreso/pago/CxC solo para ventas exprés.
        // Las órdenes ya asignadas a la ruta se cobran/entregan antes y no deben duplicarse al cierre.
        for (const e of (entregas || [])) {
          const esVentaExpress = Boolean(e?.express) || !e?.ordenId;
          if (!esVentaExpress) continue;

          const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_ov_seq' });
          const folio = `OV-${String(seq || 42).padStart(4, '0')}`;
          // Build productos string from items
          const itemsStr = (e.items || []).map(it => `${it.cant || it.qty || 0}×${it.sku}`).join(', ');
          const clienteNombre = s(e.cliente) || 'Público en general';
          const total = centavos(n(e.total));
          const metodoPago = s(e.pago) || 'Efectivo';
          const esCredito = metodoPago === 'Crédito';

          const { data: newOrd, error: ordErr } = await supabase.from('ordenes').insert({
            folio, cliente_id: e.clienteId || null,
            cliente_nombre: clienteNombre,
            productos: itemsStr || 'Varios',
            fecha: hoy, total, estatus: 'Entregada',
            metodo_pago: metodoPago,
            ruta_id: rutaId || null,
          }).select('id').single();
          if (ordErr) console.warn('[cerrarRutaCompleta] orden insert error:', ordErr.message);

          // Insertar líneas de la orden
          if (newOrd && e.items && e.items.length > 0) {
            await supabase.from('orden_lineas').insert(
              e.items.map(it => ({
                orden_id: newOrd.id, sku: it.sku,
                cantidad: Number(it.cant || it.qty || 0),
                precio_unit: centavos(Number(it.precio || 0)),
                subtotal: centavos(Number(it.cant || it.qty || 0) * Number(it.precio || 0)),
              }))
            );
          }

          if (newOrd && total > 0) {
            if (esCredito) {
              // Crédito: crear cuenta por cobrar (NO ingreso contable aún)
              if (e.clienteId) {
                await supabase.from('cuentas_por_cobrar').insert({
                  cliente_id: e.clienteId,
                  orden_id: newOrd.id,
                  fecha_venta: hoy,
                  fecha_vencimiento: fechaVenc,
                  monto_original: total,
                  monto_pagado: 0,
                  saldo_pendiente: total,
                  concepto: `${folio} — ${clienteNombre}`,
                  estatus: 'Pendiente',
                });
                // Incrementar saldo del cliente
                await supabase.rpc('increment_saldo', { p_cli: e.clienteId, p_delta: total });
              }
            } else {
              // Cobrado: registrar pago + ingreso contable
              await supabase.from('pagos').insert({
                cliente_id: e.clienteId || 0,
                orden_id: newOrd.id,
                monto: total,
                metodo_pago: metodoPago,
                fecha: hoy,
                referencia: s(e.referencia) || folio,
                saldo_antes: 0, saldo_despues: 0,
                usuario_id: uid(),
              });
              await supabase.from('movimientos_contables').insert({
                fecha: hoy, tipo: 'Ingreso', categoria: 'Ventas',
                concepto: `Cobro ${folio} — ${clienteNombre} (${metodoPago})`,
                monto: total,
                orden_id: newOrd.id,
              });
            }
          }
        }

        // 2. Registrar mermas
        for (const m of (mermasArr || [])) {
          await supabase.from('mermas').insert({
            sku: m.sku, cantidad: Number(m.cant), causa: m.causa,
            origen: 'Ruta ' + choferNombre, foto_url: m.foto || '',
          });
        }

        // 3. Conciliar devuelto → regresar stock sobrante al primer cuarto frío
        if (carga && typeof carga === 'object') {
          // Calcular entregado por SKU
          const entregadoPorSku = {};
          for (const e of (entregas || [])) {
            for (const it of (e.items || [])) {
              entregadoPorSku[it.sku] = (entregadoPorSku[it.sku] || 0) + Number(it.cant || it.qty || 0);
            }
          }
          // Calcular merma por SKU
          const mermaPorSku = {};
          for (const m of (mermasArr || [])) {
            mermaPorSku[m.sku] = (mermaPorSku[m.sku] || 0) + Number(m.cant || 0);
          }

          // Devuelto = cargado - entregado - merma
          const devueltoPorSku = {};
          for (const [sku, cargado] of Object.entries(carga)) {
            const entregado = entregadoPorSku[sku] || 0;
            const merma = mermaPorSku[sku] || 0;
            const devuelto = Number(cargado) - entregado - merma;
            if (devuelto > 0) devueltoPorSku[sku] = devuelto;
          }

          // Regresar al primer cuarto frío disponible usando RPC atómica
          if (Object.keys(devueltoPorSku).length > 0) {
            const { data: cfs } = await supabase.from('cuartos_frios').select('id').limit(1);
            const cfId = cfs?.[0]?.id;
            if (cfId) {
              // Usar función RPC atómica para actualizar stocks
              const changes = Object.entries(devueltoPorSku).map(([sku, qty]) => ({
                cuarto_id: cfId,
                sku,
                delta: qty,
                tipo: 'Entrada',
                origen: `Devolución ruta ${choferNombre}`,
                usuario: choferNombre || uname(),
              }));
              
              const { error: rpcErr } = await supabase.rpc('update_stocks_atomic', { 
                p_changes: changes 
              });
              
              if (rpcErr) {
                console.error('[cerrarRutaCompleta] Error en devolución atómica:', rpcErr.message);
                t()?.error('Error al devolver stock: ' + rpcErr.message);
              }
            }
            const devTxt = Object.entries(devueltoPorSku).map(([sku, qty]) => `${qty}×${sku}`).join(', ');
            log('Devolución', 'Rutas', `${choferNombre} devolvió: ${devTxt}`);
          }
        }

        await log('Cierre Ruta', 'Rutas', `Chofer: ${choferNombre}, Entregas: ${(entregas || []).length}, Mermas: ${(mermasArr || []).length}, Efectivo: $${cobros?.Efectivo || 0}`);
        rf();
      },

      // ── AUDITORÍA ──
      logAudit: async (accion, modulo, detalle) => {
        await log(accion, modulo, detalle);
      },
    };
  }

  return { data, actions: actionsRef.current, loading, error };
}
