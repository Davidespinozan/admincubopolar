import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { n, s, centavos } from '../utils/safe';

// ═══════════════════════════════════════════════════════════════
// useSupaStore — Drop-in replacement for useStore
// Same API: { data, actions }
// Components don't need ANY changes.
// ═══════════════════════════════════════════════════════════════

const EMPTY = {
  clientes: [], productos: [], preciosEsp: [], ordenes: [],
  rutas: [], produccion: [], inventarioMov: [], cuartosFrios: [],
  alertas: [], facturacionPendiente: [], conciliacion: [],
  auditoria: [], usuarios: [], umbrales: [], pagos: [],
};

export function useSupaStore(userId) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const uidRef = useRef(userId);
  uidRef.current = userId;

  // ── Fetch all data ──────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [
        { data: cli }, { data: prod }, { data: pe },
        { data: ord }, { data: ol }, { data: rut },
        { data: pro }, { data: mov }, { data: cf },
        { data: cfs }, { data: aud }, { data: usr },
        { data: umb }, { data: pag },
      ] = await Promise.all([
        supabase.from('clientes').select('*').order('id'),
        supabase.from('productos').select('*').order('id'),
        supabase.from('precios_esp').select('*').order('id'),
        supabase.from('ordenes').select('*').order('id', { ascending: false }),
        supabase.from('orden_lineas').select('*').order('orden_id'),
        supabase.from('rutas').select('*').order('id', { ascending: false }),
        supabase.from('produccion').select('*').order('id', { ascending: false }),
        supabase.from('inventario_mov').select('*').order('id', { ascending: false }).limit(200),
        supabase.from('cuartos_frios').select('*'),
        supabase.from('cuarto_frio_stock').select('*'),
        supabase.from('auditoria').select('*').order('id', { ascending: false }).limit(500),
        supabase.from('usuarios').select('*').order('id'),
        supabase.from('umbrales').select('*'),
        supabase.from('pagos').select('*').order('id', { ascending: false }).limit(200),
      ]);

      const clientes = cli || [];
      const productos = prod || [];
      const ordenLineas = ol || [];
      const rutas = rut || [];
      const usuarios = usr || [];
      const umbrales = umb || [];
      const cuartoFrioStock = cfs || [];

      // ── Map ordenes: snake_case → camelCase + denormalized fields ──
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
            sku: l.sku, qty: l.cantidad, unitPrice: Number(l.precio_unit), lineTotal: Number(l.subtotal),
          })),
        };
      });

      // ── Map clientes: uso_cfdi → usoCfdi for form compatibility ──
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

      // ── Map rutas: compute ordenes/entregadas dynamically ──
      const rutasMapped = rutas.map(r => {
        const linked = (ord || []).filter(o => o.ruta_id === r.id);
        const u = usuarios.find(x => x.id === r.chofer_id);
        return {
          ...r,
          chofer: u?.nombre || '—',
          ordenes: linked.length,
          entregadas: linked.filter(o => o.estatus === 'Entregada' || o.estatus === 'Facturada').length,
        };
      });

      // ── Map inventario movimientos ──
      const inventarioMov = (mov || []).map(m => ({
        ...m,
        producto: m.sku,
        cantidad: Number(m.cantidad),
        usuario: usuarios.find(u => u.id === m.usuario_id)?.nombre || 'Sistema',
      }));

      // ── Map produccion ──
      const produccion = (pro || []).map(p => ({
        ...p,
        cantidad: Number(p.cantidad),
      }));

      // ── Build facturacionPendiente from Entregada ordenes ──
      const facturacionPendiente = ordenes
        .filter(o => o.estatus === 'Entregada')
        .map(o => {
          const c = clientes.find(x => x.id === o.cliente_id);
          return { id: o.id, folio: o.folio, cliente: c?.nombre || '', rfc: c?.rfc || '', fecha: o.fecha, total: Number(o.total) };
        });

      // ── Build cuartos fríos with products string ──
      const cuartosFrios = (cf || []).map(q => {
        const stocks = cuartoFrioStock.filter(s => s.cuarto_frio_id === q.id);
        return { ...q, productos: stocks.map(s => `${s.sku}: ${s.cantidad}`).join(' · ') };
      });

      // ── Build live alerts from stock vs umbrales ──
      const alertas = umbrales.map(u => {
        const p = productos.find(x => x.sku === u.sku);
        if (!p) return null;
        const stock = Number(p.stock);
        if (stock <= u.critica) return { id: u.id, tipo: 'critica', msg: `${p.nombre} bajo mínimo — ${stock} unidades`, created_at: new Date().toISOString() };
        if (stock <= u.accionable) return { id: u.id, tipo: 'accionable', msg: `${p.nombre} nivel bajo — ${stock} unidades`, created_at: new Date().toISOString() };
        return null;
      }).filter(Boolean);

      // ── Map auditoria ──
      const auditoria = (aud || []).map(a => ({
        ...a,
        usuario: usuarios.find(u => u.id === a.usuario_id)?.nombre || 'Sistema',
      }));

      // ── Map umbrales ──
      const umbralesMapped = umbrales.map(u => {
        const p = productos.find(x => x.sku === u.sku);
        return { ...u, producto: p ? `${p.sku} (${p.nombre})` : u.sku };
      });

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
        conciliacion: [], // Generated per-ruta in ConciliacionView
        auditoria,
        usuarios,
        umbrales: umbralesMapped,
        pagos: (pag || []).map(p => ({ ...p, monto: Number(p.monto) })),
      });

      setLoading(false);
      setError(null);
    } catch (err) {
      console.error('Supabase fetch error:', err);
      setError(err.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Realtime subscriptions ──────────────────────────────────
  useEffect(() => {
    const tables = ['clientes','productos','ordenes','orden_lineas','rutas','produccion','inventario_mov','pagos','auditoria','precios_esp'];
    const channels = tables.map(table =>
      supabase.channel(`rt_${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, () => fetchAll())
        .subscribe()
    );
    return () => { channels.forEach(ch => supabase.removeChannel(ch)); };
  }, [fetchAll]);

  // ── Actions ─────────────────────────────────────────────────
  // Uses ref pattern so actions are stable (never recreated)
  // but always access current userId via uidRef

  const actionsRef = useRef(null);
  if (!actionsRef.current) {
    const uid = () => uidRef.current;
    const rf = () => fetchAll();

    actionsRef.current = {

    // ── CLIENTES ──
    addCliente: async (c) => {
      const { error } = await supabase.from('clientes').insert({
        nombre: c.nombre, rfc: c.rfc, regimen: c.regimen,
        uso_cfdi: c.usoCfdi || 'G03', cp: c.cp, correo: c.correo,
        tipo: c.tipo, contacto: c.contacto,
      });
      if (!error) rf();
      return error;
    },

    updateCliente: async (id, c) => {
      const update = {};
      if (c.nombre !== undefined) update.nombre = c.nombre;
      if (c.rfc !== undefined) update.rfc = c.rfc;
      if (c.regimen !== undefined) update.regimen = c.regimen;
      if (c.usoCfdi !== undefined) update.uso_cfdi = c.usoCfdi;
      if (c.cp !== undefined) update.cp = c.cp;
      if (c.correo !== undefined) update.correo = c.correo;
      if (c.tipo !== undefined) update.tipo = c.tipo;
      if (c.contacto !== undefined) update.contacto = c.contacto;
      // saldo NOT updated — only via timbrar/registrarPago
      const { error } = await supabase.from('clientes').update(update).eq('id', id);
      if (!error) rf();
      return error;
    },

    deactivateCliente: async (id) => {
      const { error } = await supabase.from('clientes').update({ estatus: 'Inactivo' }).eq('id', id);
      if (!error) rf();
      return error;
    },

    // ── PRODUCTOS ──
    addProducto: async (p) => {
      const { error } = await supabase.from('productos').insert({
        sku: p.sku, nombre: p.nombre, tipo: p.tipo,
        stock: Number(p.stock) || 0, ubicacion: p.ubicacion, precio: Number(p.precio) || 0,
      });
      if (!error) rf();
      return error;
    },

    updateProducto: async (id, p) => {
      const { error } = await supabase.from('productos').update({
        nombre: p.nombre, tipo: p.tipo, ubicacion: p.ubicacion, precio: Number(p.precio),
        // stock NOT touched — only via move_stock()
      }).eq('id', id);
      if (!error) rf();
      return error;
    },

    // ── PRECIOS ESPECIALES ──
    addPrecioEsp: async (p) => {
      const { error } = await supabase.from('precios_esp').insert({
        cliente_id: p.clienteId, sku: p.sku, precio: Number(p.precio),
      });
      if (!error) rf();
      return error;
    },

    deletePrecioEsp: async (id) => {
      const { error } = await supabase.from('precios_esp').delete().eq('id', id);
      if (!error) rf();
      return error;
    },

    // ── ÓRDENES ──
    addOrden: async (o) => {
      // 1. Parse products string
      const items = s(o.productos).split(',').map(x => x.trim()).filter(Boolean).map(item => {
        const m = item.match(/^(\d+)\s*[×x]\s*(.+)$/i);
        return m ? { qty: parseInt(m[1], 10), sku: m[2].trim() } : null;
      }).filter(Boolean);
      if (items.length === 0) return { message: 'Productos inválidos' };

      // 2. Get prices from DB (always fresh, not from local state)
      const [{ data: prods }, { data: pes }] = await Promise.all([
        supabase.from('productos').select('sku, precio, stock'),
        supabase.from('precios_esp').select('sku, precio').eq('cliente_id', o.clienteId),
      ]);

      // 3. Validate stock
      for (const item of items) {
        const p = (prods || []).find(x => x.sku === item.sku);
        if (!p) return { message: `SKU ${item.sku} no existe` };
        if (Number(p.stock) < item.qty) return { message: `Stock insuficiente: ${item.sku}` };
      }

      // 4. Calculate total with centavo precision
      let total = 0;
      const lineas = items.map(item => {
        const p = (prods || []).find(x => x.sku === item.sku);
        const pe = (pes || []).find(x => x.sku === item.sku);
        const unitPrice = centavos(pe ? Number(pe.precio) : Number(p?.precio || 0));
        const subtotal = centavos(item.qty * unitPrice);
        total += subtotal;
        return { sku: item.sku, cantidad: item.qty, precio_unit: unitPrice, subtotal };
      });
      total = centavos(total);

      // 5. Get next folio
      const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_ov_seq' });
      const folio = `OV-${String(seq || 42).padStart(4, '0')}`;

      // 6. Insert orden
      const { data: newOrd, error: e1 } = await supabase.from('ordenes').insert({
        folio, cliente_id: o.clienteId,
        fecha: o.fecha || new Date().toISOString().slice(0, 10),
        total, estatus: 'Creada',
      }).select('id').single();
      if (e1) return e1;

      // 7. Insert line items with price snapshots
      const { error: e2 } = await supabase.from('orden_lineas').insert(
        lineas.map(l => ({ ...l, orden_id: newOrd.id }))
      );

      // 8. Audit
      await supabase.from('auditoria').insert({
        usuario_id: uid(), accion: 'Crear', modulo: 'Órdenes',
        detalle: `${folio} — $${total}`,
      });

      if (!e2) rf();
      return e2;
    },

    updateOrdenEstatus: async (id, nuevoEst) => {
      let error;

      if (nuevoEst === 'Asignada') {
        ({ error } = await supabase.rpc('asignar_orden', {
          p_id: id, p_ruta: null, p_uid: uid(),
        }));
      } else if (nuevoEst === 'Cancelada') {
        // Check current status first
        const { data: ord } = await supabase.from('ordenes').select('estatus').eq('id', id).single();
        if (ord?.estatus === 'Asignada') {
          ({ error } = await supabase.rpc('cancelar_orden_asignada', { p_id: id, p_uid: uid() }));
        } else {
          ({ error } = await supabase.from('ordenes').update({ estatus: nuevoEst }).eq('id', id));
        }
      } else {
        ({ error } = await supabase.from('ordenes').update({ estatus: nuevoEst }).eq('id', id));
      }

      if (!error) rf();
      return error;
    },

    // ── PRODUCCIÓN ──
    addProduccion: async (p) => {
      const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_op_seq' });
      const folio = `OP-${String(seq || 89).padStart(3, '0')}`;
      const { error } = await supabase.from('produccion').insert({
        folio, turno: p.turno, maquina: p.maquina, sku: p.sku, cantidad: Number(p.cantidad),
      });
      if (!error) rf();
      return error;
    },

    confirmarProduccion: async (id) => {
      const { error } = await supabase.rpc('confirmar_produccion', { p_id: id, p_uid: uid() });
      if (!error) rf();
      return error;
    },

    // ── RUTAS ──
    addRuta: async (r) => {
      const { data: seq } = await supabase.rpc('nextval', { seq_name: 'folio_r_seq' });
      const folio = `R-${String(seq || 13).padStart(3, '0')}`;
      const { error } = await supabase.from('rutas').insert({
        folio, nombre: r.nombre, chofer_id: r.choferId || null,
        estatus: 'Programada', carga: r.carga,
      });
      if (!error) rf();
      return error;
    },

    updateRutaEstatus: async (id, est) => {
      const { error } = await supabase.from('rutas').update({ estatus: est }).eq('id', id);
      if (!error) rf();
      return error;
    },

    // ── FACTURACIÓN ──
    timbrar: async (folio) => {
      const { error } = await supabase.rpc('timbrar_orden', { p_folio: folio, p_uid: uid() });
      if (!error) rf();
      return error;
    },

    // ── PAGOS ──
    registrarPago: async (clienteId, monto, referencia) => {
      const { error } = await supabase.rpc('registrar_pago', {
        p_cli: clienteId, p_monto: centavos(monto), p_ref: referencia, p_uid: uid(),
      });
      if (!error) rf();
      return error;
    },
  };
  }

  return { data, actions: actionsRef.current, loading, error };
}
