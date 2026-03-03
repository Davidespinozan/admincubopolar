import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
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

// Fetch helper — returns [] on error, never throws
const safeRows = async (query) => {
  const { data, error } = await query;
  if (error) console.warn('[supaStore] ❌', error.message, '| code:', error.code);
  return data || [];
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
  nominaRecibos: [], movContables: [], mermas: [],
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
      const [com, lea, emp, nomP, nomR, movC, mer] = await Promise.all([
        safeRows(supabase.from('comodatos').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('leads').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('empleados').select('*').order('id')),
        safeRows(supabase.from('nomina_periodos').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('nomina_recibos').select('*').order('id', { ascending: false })),
        safeRows(supabase.from('movimientos_contables').select('*').order('id', { ascending: false }).limit(500)),
        safeRows(supabase.from('mermas').select('*').order('id', { ascending: false }).limit(200)),
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
        pagos: (pag || []).map(p => ({ ...p, monto: Number(p.monto) })),
        comodatos: (com || []).map(toCamel),
        leads: (lea || []).map(toCamel),
        empleados: (emp || []).map(toCamel),
        nominaPeriodos: (nomP || []).map(toCamel),
        nominaRecibos:  (nomR || []).map(toCamel),
        movContables,
        mermas: (mer || []).map(m => ({ ...toCamel(m), cantidad: Number(m.cantidad) })),
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
      'movimientos_contables', 'mermas', 'nomina_periodos',
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
        });
        if (error) { t()?.error('Error al crear producto'); return error; }
        log('Crear', 'Productos', `${p.sku} — ${p.nombre}`);
        rf();
      },

      updateProducto: async (id, p) => {
        const { error } = await supabase.from('productos').update({
          nombre: p.nombre, tipo: p.tipo, ubicacion: p.ubicacion,
          precio: Number(p.precio),
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

        const [{ data: prods }, { data: pes }] = await Promise.all([
          supabase.from('productos').select('sku, precio, stock'),
          supabase.from('precios_esp').select('sku, precio').eq('cliente_id', o.clienteId),
        ]);

        for (const item of items) {
          const p = (prods || []).find(x => x.sku === item.sku);
          if (!p) return { message: `SKU ${item.sku} no existe` };
          // Note: productos.stock is not kept in sync for finished goods — stock lives
          // in cuartos_frios.stock. Do not block here; UI already shows a warning.
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

        // Build insert payload — include user association columns only if provided
        // (they may not exist in all Supabase environments; ignored silently if missing)
        const ordenInsert = {
          folio, cliente_id: o.clienteId,
          cliente_nombre: clienteNombre,
          productos: productosStr,
          fecha: o.fecha || new Date().toISOString().slice(0, 10),
          total, estatus: 'Creada',
        };
        if (o.usuarioId != null) { ordenInsert.usuario_id = o.usuarioId; ordenInsert.vendedor_id = o.usuarioId; }
        if (o.authId)            { ordenInsert.auth_id = o.authId; ordenInsert.usuario_auth_id = o.authId; }

        const { data: newOrd, error: e1 } = await supabase.from('ordenes').insert(ordenInsert).select('id').single();
        if (e1) { t()?.error('Error al crear orden'); return e1; }

        const { error: e2 } = await supabase.from('orden_lineas').insert(
          lineas.map(l => ({ ...l, orden_id: newOrd.id }))
        );

        await log('Crear', 'Órdenes', `${folio} — $${total}`);

        if (!e2) rf();
        return e2;
      },

      updateOrdenEstatus: async (id, nuevoEst) => {
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
          ({ error } = await supabase.from('ordenes').update({ estatus: nuevoEst }).eq('id', id));
        }
        if (error) { t()?.error('Error al actualizar orden'); return error; }

        // Auto-registrar ingreso contable al cobrar (Entregada)
        if (nuevoEst === 'Entregada') {
          const { data: ord } = await supabase.from('ordenes').select('folio, total, cliente_id').eq('id', id).single();
          if (ord && n(ord.total) > 0) {
            const cli = ord.cliente_id
              ? (await supabase.from('clientes').select('nombre').eq('id', ord.cliente_id).single())?.data
              : null;
            await supabase.from('movimientos_contables').insert({
              fecha: new Date().toISOString().slice(0, 10),
              tipo: 'Ingreso', categoria: 'Ventas',
              concepto: `Cobro ${s(ord.folio)} — ${cli?.nombre || 'Cliente'}`,
              monto: centavos(n(ord.total)),
            });
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
        const { error } = await supabase.rpc('confirmar_produccion', { p_id: id, p_uid: uid() });
        if (error) { t()?.error('Error al confirmar producción'); return error; }
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
        const { error } = await supabase.from('rutas').insert({
          folio, nombre: r.nombre, chofer_id: r.choferId || null,
          estatus: 'Programada', carga: r.carga,
        });
        if (error) { t()?.error('Error al crear ruta'); return error; }
        log('Crear', 'Rutas', `${folio} — ${r.nombre}`);
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
        const cargaTxt = Object.entries(desglose).map(([sku, qty]) => `${qty}×${sku}`).join(', ') || `${totalBolsas} bolsas`;
        await supabase.from('rutas').update({ carga: cargaTxt }).eq('id', rutaId);
        log('Asignar órdenes', 'Rutas', `Ruta #${rutaId} — ${ordenIds.length} órdenes — ${cargaTxt}`);
        rf();
      },

      cerrarRuta: async (rutaId, devuelto) => {
        await supabase.from('rutas').update({ estatus: 'Cerrada', devuelto: devuelto || 0 }).eq('id', rutaId);
        log('Cerrar', 'Rutas', `Ruta #${rutaId} — devuelto: ${devuelto || 0}`);
        rf();
      },

      // ── FACTURACIÓN ──
      timbrar: async (folio) => {
        const { error } = await supabase.rpc('timbrar_orden', { p_folio: folio, p_uid: uid() });
        if (error) { t()?.error('Error al timbrar orden'); return error; }
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
        if (error) { t()?.error('Error al crear período de nómina'); return error; }
        log('Crear', 'Nómina', `Período ${p.inicio || ''} — ${p.fin || ''}`);
        rf();
        return row;
      },

      addNominaRecibo: async (r) => {
        const { error } = await supabase.from('nomina_recibos').insert(r);
        if (error) { t()?.error('Error al guardar recibo de nómina'); return error; }
        log('Crear', 'Nómina Recibo', `Empleado ${r.empleado_id}`);
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
      movimientoBolsa: async (sku, cantidad, tipo, motivo, costo) => {
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

        // Auto-registrar egreso contable cuando es compra de empaques (Entrada)
        if (tipo === 'Entrada' && Number(costo) > 0) {
          await supabase.from('movimientos_contables').insert({
            fecha: new Date().toISOString().slice(0, 10),
            tipo: 'Egreso', categoria: 'Proveedores',
            concepto: `Compra empaques: ${cantidad}×${sku}`,
            monto: centavos(Number(costo)),
          });
        }

        log(tipo, 'Almacén Bolsas', `${sku} x${cantidad} — ${motivo}`);
        rf();
      },

      // ── CERRAR RUTA COMPLETA (chofer) ──
      cerrarRutaCompleta: async (reporte) => {
        const { choferNombre, entregas, mermas: mermasArr, cobros, carga } = reporte;
        const hoy = new Date().toISOString().slice(0, 10);

        // 1. Crear órdenes + líneas + ingreso contable por cada entrega
        for (const e of (entregas || [])) {
          const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_ov_seq' });
          const folio = `OV-${String(seq || 42).padStart(4, '0')}`;
          // Build productos string from items
          const itemsStr = (e.items || []).map(it => `${it.cant || it.qty || 0}×${it.sku}`).join(', ');
          const clienteNombre = s(e.cliente) || 'Público en general';
          const { data: newOrd, error: ordErr } = await supabase.from('ordenes').insert({
            folio, cliente_id: e.clienteId || null,
            cliente_nombre: clienteNombre,
            productos: itemsStr || 'Varios',
            fecha: hoy, total: centavos(n(e.total)), estatus: 'Entregada',
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

          // Auto-ingreso contable
          if (newOrd && n(e.total) > 0) {
            await supabase.from('movimientos_contables').insert({
              fecha: hoy, tipo: 'Ingreso', categoria: 'Ventas',
              concepto: `Entrega ${folio} — ${e.cliente || 'Exprés'}`,
              monto: centavos(n(e.total)),
            });
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

          // Regresar al primer cuarto frío disponible
          if (Object.keys(devueltoPorSku).length > 0) {
            const { data: cfs } = await supabase.from('cuartos_frios').select('id, stock').limit(1);
            const cf = cfs?.[0];
            if (cf) {
              const stockObj = (cf.stock && typeof cf.stock === 'object') ? { ...cf.stock } : {};
              for (const [sku, qty] of Object.entries(devueltoPorSku)) {
                stockObj[sku] = (Number(stockObj[sku] || 0)) + qty;
                await supabase.from('inventario_mov').insert({
                  tipo: 'Entrada', producto: sku, cantidad: qty,
                  origen: `Devolución ruta ${choferNombre}`, usuario: choferNombre || uname(),
                });
              }
              await supabase.from('cuartos_frios').update({ stock: stockObj }).eq('id', cf.id);
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
