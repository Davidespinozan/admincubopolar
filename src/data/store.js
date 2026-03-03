import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { n, s, eqId } from '../utils/safe';

const toCamel = (obj) => {
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (obj === null || typeof obj !== 'object') return obj;
  const o = {};
  for (const [k, v] of Object.entries(obj)) {
    o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return o;
};
const toSnake = (obj) => {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const o = {};
  for (const [k, v] of Object.entries(obj)) {
    o[k.replace(/[A-Z]/g, c => '_' + c.toLowerCase())] = v;
  }
  return o;
};

const db = {
  async fetchAll(table) {
    if (!supabase) return [];
    const { data, error } = await supabase.from(table).select('*').order('id', { ascending: true });
    if (error) { console.error(`fetch ${table}:`, error.message); return []; }
    return (data || []).map(toCamel);
  },
  async insert(table, row) {
    if (!supabase) return null;
    const { data, error } = await supabase.from(table).insert(toSnake(row)).select().single();
    if (error) { console.error(`insert ${table}:`, error.message, toSnake(row)); return null; }
    return toCamel(data);
  },
  async update(table, id, changes) {
    if (!supabase) return null;
    const { data, error } = await supabase.from(table).update(toSnake(changes)).eq('id', id).select().single();
    if (error) { console.error(`update ${table}:`, error.message); return null; }
    return toCamel(data);
  },
  async upsertCF(row) {
    if (!supabase) return null;
    const { data, error } = await supabase.from('cuartos_frios').upsert(toSnake(row)).select().single();
    if (error) { console.error('upsert cuartos_frios:', error.message); return null; }
    return toCamel(data);
  },
  async remove(table, id) {
    if (!supabase) return;
    await supabase.from(table).delete().eq('id', id);
  },
};

const genFolio = (prefix, arr) => {
  const max = arr.reduce((m, x) => {
    const num = parseInt(s(x.folio).replace(/\D/g, ''), 10);
    return num > m ? num : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
};

export function useStore() {
  const [data, setData] = useState({
    clientes: [], productos: [], preciosEsp: [], ordenes: [], rutas: [],
    produccion: [], inventarioMov: [], cuartosFrios: [], comodatos: [],
    leads: [], empleados: [], nominaPeriodos: [], nominaRecibos: [],
    movContables: [], mermas: [], auditoria: [], usuarios: [], _loaded: false,
  });
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      const [clientes, productos, preciosEsp, ordenes, rutas, produccion,
        inventarioMov, cuartosFrios, comodatos, leads, empleados,
        nominaPeriodos, nominaRecibos, movContables, mermas, auditoria, usuarios
      ] = await Promise.all([
        db.fetchAll('clientes'), db.fetchAll('productos'), db.fetchAll('precios_esp'),
        db.fetchAll('ordenes'), db.fetchAll('rutas'), db.fetchAll('produccion'),
        db.fetchAll('inventario_mov'), db.fetchAll('cuartos_frios'), db.fetchAll('comodatos'),
        db.fetchAll('leads'), db.fetchAll('empleados'), db.fetchAll('nomina_periodos'),
        db.fetchAll('nomina_recibos'), db.fetchAll('movimientos_contables'),
        db.fetchAll('mermas'), db.fetchAll('auditoria'), db.fetchAll('usuarios'),
      ]);
      setData({ clientes, productos, preciosEsp, ordenes, rutas, produccion,
        inventarioMov, cuartosFrios, comodatos, leads, empleados,
        nominaPeriodos, nominaRecibos, movContables, mermas, auditoria, usuarios, _loaded: true });
    })();
  }, []);

  const logAudit = useCallback(async (usuario, accion, modulo, detalle) => {
    const entry = { usuario, accion, modulo, detalle };
    db.insert('auditoria', entry);
    setData(d => ({ ...d, auditoria: [{ ...entry, fecha: new Date().toISOString(), id: Date.now() }, ...d.auditoria].slice(0, 500) }));
  }, []);

  const actions = useMemo(() => ({
    addCliente: async (c) => {
      const row = await db.insert('clientes', { ...c, estatus: 'Activo', saldo: 0 });
      if (row) setData(d => ({ ...d, clientes: [...d.clientes, row] }));
      logAudit('Sistema', 'Crear', 'Clientes', `Cliente ${s(c.nombre)} creado`);
      return row;
    },
    updateCliente: async (id, c) => {
      const row = await db.update('clientes', id, c);
      if (row) setData(d => ({ ...d, clientes: d.clientes.map(x => eqId(x.id, id) ? row : x) }));
    },
    deactivateCliente: async (id) => {
      await db.update('clientes', id, { estatus: 'Inactivo' });
      setData(d => ({ ...d, clientes: d.clientes.map(x => eqId(x.id, id) ? { ...x, estatus: 'Inactivo' } : x) }));
    },
    addProducto: async (p) => {
      const row = await db.insert('productos', { ...p, stock: n(p.stock), precio: n(p.precio) });
      if (row) setData(d => ({ ...d, productos: [...d.productos, row] }));
    },
    updateProducto: async (id, p) => {
      const row = await db.update('productos', id, p);
      if (row) setData(d => ({ ...d, productos: d.productos.map(x => eqId(x.id, id) ? row : x) }));
    },
    addPrecioEsp: async (p) => {
      const row = await db.insert('precios_esp', p);
      if (row) setData(d => ({ ...d, preciosEsp: [...d.preciosEsp, row] }));
    },
    deletePrecioEsp: async (id) => {
      await db.remove('precios_esp', id);
      setData(d => ({ ...d, preciosEsp: d.preciosEsp.filter(x => !eqId(x.id, id)) }));
    },
    addOrden: async (o) => {
      const folio = genFolio('OV', data.ordenes);
      const row = await db.insert('ordenes', { ...o, folio, estatus: 'Creada', clienteNombre: o.cliente || o.clienteNombre });
      if (row) {
        setData(d => ({ ...d, ordenes: [...d.ordenes, row] }));
        if (n(o.total) > 0) {
          db.insert('movimientos_contables', {
            fecha: o.fecha || new Date().toISOString().slice(0, 10),
            tipo: 'Ingreso', categoria: 'Ventas',
            concepto: `Venta ${folio} — ${s(o.cliente || o.clienteNombre)}`,
            monto: n(o.total), ordenId: row.id,
          });
        }
      }
      logAudit('Sistema', 'Crear', 'Ventas', `Orden ${folio} — $${n(o.total)}`);
      return row;
    },
    updateOrdenEstatus: async (id, est) => {
      await db.update('ordenes', id, { estatus: est });
      setData(d => ({ ...d, ordenes: d.ordenes.map(x => eqId(x.id, id) ? { ...x, estatus: est } : x) }));
    },
    addProduccion: async (p) => {
      const folio = genFolio('OP', data.produccion);
      const row = await db.insert('produccion', { ...p, folio, fecha: new Date().toISOString().slice(0, 10), estatus: 'Confirmada' });
      if (row) setData(d => ({ ...d, produccion: [...d.produccion, row] }));
      // Bolsas NO se descuentan aquí — la encargada de almacén registra la salida
      // Pero SÍ registramos el consumo como movimiento para control cruzado (partida doble)
      const empaqueMap = { "HC-25K": "EMP-25", "HC-5K": "EMP-5", "HT-25K": "EMP-25", "BH-50K": null };
      const bolsaSku = empaqueMap[p.sku];
      if (bolsaSku && n(p.cantidad) > 0) {
        db.insert('inventario_mov', { tipo: 'Consumo', producto: bolsaSku, cantidad: n(p.cantidad), origen: 'Producción ' + folio, usuario: 'Producción' });
      }
      const hielo = data.productos.find(x => s(x.sku) === p.sku);
      if (hielo) {
        const ns = n(hielo.stock) + n(p.cantidad);
        db.update('productos', hielo.id, { stock: ns });
        setData(d => ({ ...d, productos: d.productos.map(x => eqId(x.id, hielo.id) ? { ...x, stock: ns } : x) }));
      }
      logAudit('Sistema', 'Producir', 'Producción', `${n(p.cantidad)}× ${p.sku}`);
    },
    meterACuartoFrio: async (cfId, sku, cantidad) => {
      const cf = data.cuartosFrios.find(x => s(x.id) === cfId);
      if (!cf) return;
      const stock = { ...(cf.stock || {}) };
      stock[sku] = (stock[sku] || 0) + n(cantidad);
      db.upsertCF({ id: cfId, nombre: cf.nombre, temp: cf.temp, capacidad: cf.capacidad, stock });
      setData(d => ({ ...d, cuartosFrios: d.cuartosFrios.map(x => s(x.id) === cfId ? { ...x, stock } : x) }));
    },
    sacarDeCuartoFrio: async (cfId, sku, cantidad, motivo) => {
      const cf = data.cuartosFrios.find(x => s(x.id) === cfId);
      if (!cf) return;
      const stock = { ...(cf.stock || {}) };
      stock[sku] = Math.max(0, (stock[sku] || 0) - n(cantidad));
      db.upsertCF({ id: cfId, nombre: cf.nombre, temp: cf.temp, capacidad: cf.capacidad, stock });
      setData(d => ({ ...d, cuartosFrios: d.cuartosFrios.map(x => s(x.id) === cfId ? { ...x, stock } : x) }));
      db.insert('inventario_mov', { tipo: 'Salida', producto: sku, cantidad: n(cantidad), origen: cfId, destino: motivo, usuario: 'Sistema' });
    },
    registrarMerma: async (sku, cantidad, causa, origen, fotoUrl) => {
      const row = await db.insert('mermas', { sku, cantidad: n(cantidad), causa, origen, fotoUrl });
      if (row) setData(d => ({ ...d, mermas: [...d.mermas, row] }));
      const prod = data.productos.find(x => s(x.sku) === sku);
      if (prod) {
        const ns = Math.max(0, n(prod.stock) - n(cantidad));
        db.update('productos', prod.id, { stock: ns });
        setData(d => ({ ...d, productos: d.productos.map(x => eqId(x.id, prod.id) ? { ...x, stock: ns } : x) }));
      }
    },
    addMovContable: async (m) => {
      const row = await db.insert('movimientos_contables', m);
      if (row) setData(d => ({ ...d, movContables: [...d.movContables, row] }));
    },
    addLead: async (l) => {
      const row = await db.insert('leads', { ...l, estatus: 'Nuevo' });
      if (row) setData(d => ({ ...d, leads: [...d.leads, row] }));
    },
    updateLead: async (id, changes) => {
      const row = await db.update('leads', id, changes);
      if (row) setData(d => ({ ...d, leads: d.leads.map(x => eqId(x.id, id) ? row : x) }));
    },
    addComodato: async (c) => {
      const row = await db.insert('comodatos', { ...c, estatus: 'Activo' });
      if (row) setData(d => ({ ...d, comodatos: [...d.comodatos, row] }));
    },
    updateComodato: async (id, changes) => {
      const row = await db.update('comodatos', id, changes);
      if (row) setData(d => ({ ...d, comodatos: d.comodatos.map(x => eqId(x.id, id) ? row : x) }));
    },
    addEmpleado: async (e) => {
      const row = await db.insert('empleados', { ...e, estatus: 'Activo' });
      if (row) setData(d => ({ ...d, empleados: [...d.empleados, row] }));
    },
    updateEmpleado: async (id, changes) => {
      const row = await db.update('empleados', id, changes);
      if (row) setData(d => ({ ...d, empleados: d.empleados.map(x => eqId(x.id, id) ? row : x) }));
    },
    addNominaPeriodo: async (p) => {
      const row = await db.insert('nomina_periodos', p);
      if (row) setData(d => ({ ...d, nominaPeriodos: [...d.nominaPeriodos, row] }));
      return row;
    },
    addNominaRecibo: async (r) => {
      const row = await db.insert('nomina_recibos', r);
      if (row) setData(d => ({ ...d, nominaRecibos: [...d.nominaRecibos, row] }));
    },
    addUsuario: async (u) => {
      const row = await db.insert('usuarios', { ...u, estatus: 'Activo' });
      if (row) setData(d => ({ ...d, usuarios: [...d.usuarios, row] }));
      return row;
    },
    updateUsuario: async (id, changes) => {
      const row = await db.update('usuarios', id, changes);
      if (row) setData(d => ({ ...d, usuarios: d.usuarios.map(x => eqId(x.id, id) ? row : x) }));
    },
    addRuta: async (r) => {
      const folio = genFolio('R', data.rutas);
      const row = await db.insert('rutas', { ...r, folio, estatus: 'Pendiente' });
      if (row) setData(d => ({ ...d, rutas: [...d.rutas, row] }));
    },
    updateRutaEstatus: async (id, est) => {
      await db.update('rutas', id, { estatus: est });
      setData(d => ({ ...d, rutas: d.rutas.map(x => eqId(x.id, id) ? { ...x, estatus: est } : x) }));
    },
// === MISSING DELETE ACTIONS ===
    deleteCliente: async (id) => {
      await db.remove('clientes', id);
      setData(d => ({ ...d, clientes: d.clientes.filter(x => !eqId(x.id, id)) }));
      logAudit('Admin', 'Eliminó Cliente', 'Clientes', 'ID: ' + id);
    },
    deleteProducto: async (id) => {
      await db.remove('productos', id);
      setData(d => ({ ...d, productos: d.productos.filter(x => !eqId(x.id, id)) }));
      logAudit('Admin', 'Eliminó Producto', 'Catálogo', 'ID: ' + id);
    },
    deleteOrden: async (id) => {
      await db.remove('ordenes', id);
      setData(d => ({ ...d, ordenes: d.ordenes.filter(x => !eqId(x.id, id)) }));
    },
    deleteLead: async (id) => {
      await db.remove('leads', id);
      setData(d => ({ ...d, leads: d.leads.filter(x => !eqId(x.id, id)) }));
    },
    deleteComodato: async (id) => {
      await db.remove('comodatos', id);
      setData(d => ({ ...d, comodatos: d.comodatos.filter(x => !eqId(x.id, id)) }));
    },
    deleteEmpleado: async (id) => {
      await db.remove('empleados', id);
      setData(d => ({ ...d, empleados: d.empleados.filter(x => !eqId(x.id, id)) }));
      logAudit('Admin', 'Eliminó Empleado', 'Empleados', 'ID: ' + id);
    },
    deleteUsuario: async (id) => {
      await db.remove('usuarios', id);
      setData(d => ({ ...d, usuarios: d.usuarios.filter(x => !eqId(x.id, id)) }));
      logAudit('Admin', 'Eliminó Usuario', 'Usuarios', 'ID: ' + id);
    },
    deleteMovContable: async (id) => {
      await db.remove('movimientos_contables', id);
      setData(d => ({ ...d, movContables: d.movContables.filter(x => !eqId(x.id, id)) }));
    },
    deleteRuta: async (id) => {
      await db.remove('rutas', id);
      setData(d => ({ ...d, rutas: d.rutas.filter(x => !eqId(x.id, id)) }));
    },
    updateMovContable: async (id, m) => {
      const row = await db.update('movimientos_contables', id, m);
      if (row) setData(d => ({ ...d, movContables: d.movContables.map(x => eqId(x.id, id) ? row : x) }));
    },
    updateRuta: async (id, r) => {
      const row = await db.update('rutas', id, r);
      if (row) setData(d => ({ ...d, rutas: d.rutas.map(x => eqId(x.id, id) ? row : x) }));
    },
    addCuartoFrio: async (cf) => {
      const row = await db.insert('cuartos_frios', cf);
      if (row) setData(d => ({ ...d, cuartosFrios: [...d.cuartosFrios, row] }));
      logAudit('Admin', 'Creó Cuarto Frío', 'Congeladores', cf.nombre);
    },
    updateCuartoFrio: async (id, cf) => {
      const row = await db.update('cuartos_frios', id, cf);
      if (row) setData(d => ({ ...d, cuartosFrios: d.cuartosFrios.map(x => eqId(x.id, id) ? row : x) }));
    },
    deleteCuartoFrio: async (id) => {
      await db.remove('cuartos_frios', id);
      setData(d => ({ ...d, cuartosFrios: d.cuartosFrios.filter(x => !eqId(x.id, id)) }));
    },
    deleteMerma: async (id) => {
      await db.remove('mermas', id);
      setData(d => ({ ...d, mermas: d.mermas.filter(x => !eqId(x.id, id)) }));
    },
    deleteProduccion: async (id) => {
      await db.remove('produccion', id);
      setData(d => ({ ...d, produccion: d.produccion.filter(x => !eqId(x.id, id)) }));
    },
        movimientoBolsa: async (sku, cantidad, tipo, motivo, usuario) => {
      const prod = data.productos.find(x => s(x.sku) === sku);
      if (!prod) return;
      const ns = tipo === 'Entrada' ? n(prod.stock) + n(cantidad) : Math.max(0, n(prod.stock) - n(cantidad));
      db.update('productos', prod.id, { stock: ns });
      setData(d => ({ ...d, productos: d.productos.map(x => eqId(x.id, prod.id) ? { ...x, stock: ns } : x) }));
      db.insert('inventario_mov', { tipo, producto: sku, cantidad: n(cantidad), origen: motivo, usuario: usuario || 'Sistema' });
    },

    // ─── CONFIRMAR PRODUCCIÓN ────────────────────────
    confirmarProduccion: async (id) => {
      await db.update('produccion', id, { estatus: 'Confirmada' });
      setData(d => ({ ...d, produccion: d.produccion.map(x => eqId(x.id, id) ? { ...x, estatus: 'Confirmada' } : x) }));
    },

    // ─── TRASPASO ENTRE CUARTOS FRÍOS ────────────────
    traspasoEntreUbicaciones: async (t) => {
      const { origen, destino, sku, cantidad } = t;
      const qty = n(cantidad);
      if (qty <= 0) return;
      // Deduct from origin
      const cfOrigen = data.cuartosFrios.find(x => s(x.id) === origen);
      const cfDestino = data.cuartosFrios.find(x => s(x.id) === destino);
      if (!cfOrigen || !cfDestino) return;
      const stockOrigen = { ...(cfOrigen.stock || {}) };
      stockOrigen[sku] = Math.max(0, (stockOrigen[sku] || 0) - qty);
      const stockDestino = { ...(cfDestino.stock || {}) };
      stockDestino[sku] = (stockDestino[sku] || 0) + qty;
      db.upsertCF({ id: origen, nombre: cfOrigen.nombre, temp: cfOrigen.temp, capacidad: cfOrigen.capacidad, stock: stockOrigen });
      db.upsertCF({ id: destino, nombre: cfDestino.nombre, temp: cfDestino.temp, capacidad: cfDestino.capacidad, stock: stockDestino });
      setData(d => ({ ...d, cuartosFrios: d.cuartosFrios.map(x => {
        if (s(x.id) === origen) return { ...x, stock: stockOrigen };
        if (s(x.id) === destino) return { ...x, stock: stockDestino };
        return x;
      })}));
      db.insert('inventario_mov', { tipo: 'Traspaso', producto: sku, cantidad: qty, origen: origen + ' → ' + destino, usuario: 'Sistema' });
    },

    // ─── CERRAR RUTA COMPLETA (Chofer) ───────────────
    cerrarRutaCompleta: async (reporte) => {
      const { choferId, choferNombre, entregas, mermas, cobros } = reporte;
      // Find chofer's active ruta and mark Completada
      const miRuta = data.rutas.find(r => {
        const cn = s(r.choferNombre || r.chofer).toLowerCase();
        return cn.includes(s(choferNombre).toLowerCase()) && (r.estatus === 'En progreso' || r.estatus === 'Pendiente');
      });
      if (miRuta) {
        db.update('rutas', miRuta.id, { estatus: 'Completada' });
        setData(d => ({ ...d, rutas: d.rutas.map(r => eqId(r.id, miRuta.id) ? { ...r, estatus: 'Completada' } : r) }));
      }
      // Log entregas as orders
      for (const e of (entregas || [])) {
        const ordRow = await db.insert('ordenes', {
          folio: e.folio, clienteNombre: e.cliente, fecha: new Date().toISOString().slice(0, 10),
          productos: (e.items || []).map(i => i.sku + '×' + i.cant).join(', '),
          total: n(e.total), estatus: 'Entregada', metodoPago: e.pago,
          requiereFactura: e.factura || false,
          rutaId: miRuta?.id,
        });
        if (ordRow && n(e.total) > 0) {
          db.insert('movimientos_contables', {
            fecha: new Date().toISOString().slice(0, 10), tipo: 'Ingreso', categoria: 'Ventas',
            concepto: 'Entrega ' + (e.folio || '') + ' — ' + (e.cliente || 'Exprés'), monto: n(e.total),
          });
        }
      }
      // Log mermas
      for (const m of (mermas || [])) {
        db.insert('mermas', { sku: m.sku, cantidad: n(m.cant), causa: m.causa, origen: 'Ruta ' + choferNombre, fotoUrl: m.foto || '' });
      }
      // Audit
      const totalEfectivo = cobros?.Efectivo || 0;
      logAudit(choferNombre || 'Chofer', 'Cierre Ruta', 'Rutas', 'Entregas: ' + (entregas?.length || 0) + ', Efectivo: $' + totalEfectivo + ', Mermas: ' + (mermas?.length || 0));
    },

    // ─── ASIGNAR ORDENES A RUTA ──────────────────────
    asignarOrdenesARuta: async (rutaId, ordenIds, totalBolsas) => {
      for (const oid of ordenIds) {
        db.update('ordenes', oid, { rutaId });
      }
      db.update('rutas', rutaId, { ordenes: ordenIds.length, carga: totalBolsas + ' bolsas' });
      setData(d => ({
        ...d,
        ordenes: d.ordenes.map(o => ordenIds.includes(o.id) ? { ...o, rutaId } : o),
        rutas: d.rutas.map(r => eqId(r.id, rutaId) ? { ...r, ordenes: ordenIds.length, carga: totalBolsas + ' bolsas' } : r),
      }));
    },

    // ─── CERRAR RUTA ─────────────────────────────────
    cerrarRuta: async (rutaId, devuelto) => {
      await db.update('rutas', rutaId, { estatus: 'Cerrada' });
      setData(d => ({ ...d, rutas: d.rutas.map(r => eqId(r.id, rutaId) ? { ...r, estatus: 'Cerrada', devuelto: devuelto || 0 } : r) }));
    },

    // ─── PRODUCIR Y CONGELAR (combo) ─────────────────
    producirYCongelar: async (p) => {
      await actions.addProduccion(p);
      if (p.destino) await actions.meterACuartoFrio(p.destino, p.sku, n(p.cantidad));
    },

    timbrar: async (folio) => {
      const ord = data.ordenes.find(x => x.folio === folio);
      if (ord) {
        db.update('ordenes', ord.id, { estatus: 'Facturada' });
        setData(d => ({ ...d, ordenes: d.ordenes.map(x => x.folio === folio ? { ...x, estatus: 'Facturada' } : x) }));
      }
    },
  }), [data, logAudit]);

  const slices = useMemo(() => ({
    ...data,
    contabilidad: {
      ingresos: (data.movContables || []).filter(m => m.tipo === 'Ingreso'),
      egresos: (data.movContables || []).filter(m => m.tipo === 'Egreso'),
    },
    facturacionPendiente: data.ordenes.filter(o => o.requiereFactura && o.estatus !== 'Facturada' && o.estatus !== 'Cancelada'),
    conciliacion: [], alertas: [], umbrales: [],
  }), [data]);

  return { data: slices, actions, loaded: data._loaded };
}
