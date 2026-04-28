import { useMemo } from 'react';
import { Icons } from '../ui/Icons';
import { StatusBadge, DataTable, CapacityBar } from '../ui/Components';
import { EmptyState } from '../ui/Skeleton';
import { s, n, fmtDate, fmtDateTime } from '../../utils/safe';

// ── FIX P3: ALL DERIVED STATE NOW MEMOIZED ──
// BEFORE: 4 reduce/filter calls ran on every render — even when user
// just opened a modal or typed in a search field on another view.
// With 1000 ordenes + 500 produccion: ~3000 iterations per render, ~60fps drop on mobile.
//
// AFTER: Each computation is memoized against its specific data dependency.
// Also: inventarioMov.slice(0,5) created a new array ref every render,
// causing DataTable to re-render even though the data was identical.


export default function DashboardView({ data, user }) {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const d = hoy.getDate();

  const inicioDia = useMemo(() => new Date(y, m, d), [y, m, d]);

  const productosHielo = useMemo(
    () => (data.productos || []).filter(p => s(p.tipo) === "Producto Terminado"),
    [data.productos]
  );

  const parseFecha = (val) => {
    if (!val) return null;
    const dt = new Date(val);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const estatusPendientes = useMemo(() => new Set(["creada", "asignada", "pendiente", "en proceso", "en_proceso", "enprogreso"]), []);
  const pedidosPendPorSku = useMemo(() => {
    const acc = {};
    for (const p of productosHielo) acc[s(p.sku)] = 0;

    for (const ord of (data.ordenes || [])) {
      const est = s(ord.estatus).toLowerCase();
      if (!estatusPendientes.has(est)) continue;

      if (Array.isArray(ord.preciosSnapshot) && ord.preciosSnapshot.length > 0) {
        for (const ln of ord.preciosSnapshot) {
          const sku = s(ln.sku);
          if (!sku) continue;
          acc[sku] = (acc[sku] || 0) + n(ln.qty || ln.cantidad);
        }
        continue;
      }

      const raw = s(ord.productos);
      if (!raw) continue;
      raw.split(',').forEach(part => {
        const mt = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
        if (!mt) return;
        const qty = Number(mt[1] || 0);
        const sku = s(mt[2]);
        if (!sku) return;
        acc[sku] = (acc[sku] || 0) + qty;
      });
    }
    return acc;
  }, [data.ordenes, productosHielo, estatusPendientes]);

  const stockCuartosPorSku = useMemo(() => {
    const acc = {};
    for (const p of productosHielo) acc[s(p.sku)] = 0;
    for (const cf of (data.cuartosFrios || [])) {
      const st = (cf?.stock && typeof cf.stock === 'object') ? cf.stock : {};
      for (const [sku, qty] of Object.entries(st)) {
        acc[s(sku)] = (acc[s(sku)] || 0) + n(qty);
      }
    }
    return acc;
  }, [data.cuartosFrios, productosHielo]);

  const producidoHoyPorSku = useMemo(() => {
    const acc = {};
    for (const p of productosHielo) acc[s(p.sku)] = 0;
    for (const pr of (data.produccion || [])) {
      const dt = parseFecha(pr.fecha);
      if (!dt) continue;
      if (dt < inicioDia) continue;
      const sku = s(pr.sku);
      acc[sku] = (acc[sku] || 0) + n(pr.cantidad);
    }
    return acc;
  }, [data.produccion, productosHielo, inicioDia]);

  const reservadoEnRutasPorSku = useMemo(() => {
    const acc = {};
    for (const p of productosHielo) acc[s(p.sku)] = 0;
    const rutasActivas = (data.rutas || []).filter(r => {
      const est = s(r.estatus).toLowerCase();
      return est === 'programada' || est === 'en progreso' || est === 'en_progreso';
    });
    for (const ruta of rutasActivas) {
      const carga = ruta.carga_autorizada || ruta.cargaAutorizada || ruta.carga || {};
      for (const [sku, qty] of Object.entries(carga)) {
        acc[s(sku)] = (acc[s(sku)] || 0) + Number(qty || 0);
      }
    }
    return acc;
  }, [data.rutas, productosHielo]);

  const tableroDemanda = useMemo(() => {
    return productosHielo.map(p => {
      const sku = s(p.sku);
      const pendientes = n(pedidosPendPorSku[sku]);
      const stockBruto = n(stockCuartosPorSku[sku]);
      const reservado = n(reservadoEnRutasPorSku[sku]);
      const stock = Math.max(0, stockBruto - reservado);
      const producidoHoy = n(producidoHoyPorSku[sku]);
      const stockMinimo = n(p.stock_minimo);
      const faltante = Math.max(0, pendientes + stockMinimo - stock);
      return {
        id: sku,
        sku,
        producto: s(p.nombre),
        pendientes,
        stock,
        stockMinimo,
        faltante,
        producidoHoy,
      };
    });
  }, [productosHielo, pedidosPendPorSku, stockCuartosPorSku, reservadoEnRutasPorSku, producidoHoyPorSku]);

  const alertasActivas = useMemo(() => {
    const raw = (data.alertas || []).filter(a => !!s(a.msg || a.mensaje || a.detalle));
    const grupos = new Map();
    for (const a of raw) {
      const msg = s(a.msg || a.mensaje || a.detalle);
      // Extrae cliente y monto si la alerta es tipo "CxC vencida"
      const matchCxC = msg.match(/CxC vencida.*?—\s*(.+?)\s*—\s*\$(\d+(?:[.,]\d+)?)/);
      if (matchCxC) {
        const cliente = matchCxC[1].trim();
        const monto = parseFloat(matchCxC[2].replace(',', ''));
        const key = `cxc:${cliente}`;
        if (!grupos.has(key)) {
          grupos.set(key, { ...a, _cliente: cliente, _total: 0, _count: 0, _tipo: 'cxc' });
        }
        const g = grupos.get(key);
        g._total += monto;
        g._count += 1;
        g.msg = `${cliente} te debe $${g._total.toLocaleString()} (${g._count} ${g._count === 1 ? 'factura vencida' : 'facturas vencidas'})`;
        g.tipo = 'critica';
      } else {
        // Alertas que no son de CxC pasan tal cual
        grupos.set(`other:${a.id || msg}`, a);
      }
    }
    return Array.from(grupos.values());
  }, [data.alertas]);

  const ordPend = useMemo(
    () => (data.ordenes || []).filter(o => estatusPendientes.has(s(o.estatus).toLowerCase())).length,
    [data.ordenes, estatusPendientes]
  );

  // ── FIX P7: .slice() inside JSX creates new array ref every render ──
  const recentMov = useMemo(() => data.inventarioMov.slice(0, 5), [data.inventarioMov]);

  const ventasResumen = useMemo(() => {
    const hoyStr = new Date().toISOString().slice(0, 10);
    const sem = new Date(); sem.setDate(sem.getDate() - 7);
    const semStr = sem.toISOString().slice(0, 10);
    const mesStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    let dia = 0, semana = 0, mes = 0;
    const estatusVenta = new Set(["entregada", "facturada"]);
    for (const ord of (data.ordenes || [])) {
      if (!estatusVenta.has(s(ord.estatus).toLowerCase())) continue;
      const f = s(ord.fecha).slice(0, 10);
      const tot = n(ord.total);
      if (f === hoyStr) dia += tot;
      if (f >= semStr) semana += tot;
      if (f >= mesStr) mes += tot;
    }
    return { dia, semana, mes };
  }, [data.ordenes]);

  // ── ESTADO DE RESULTADOS ──
  const estadoResultados = useMemo(() => {
    const movs = data.contabilidad || { ingresos: [], egresos: [] };
    const historial = data.costosHistorial || [];
    
    const calcPeriodo = (filtro, filtroHist) => {
      const ingresos = (movs.ingresos || []).filter(filtro);
      const egresos = (movs.egresos || []).filter(filtro);
      const costos = historial.filter(filtroHist);
      
      // Ingresos por ventas
      const ventasTot = ingresos.filter(i => s(i.categoria) === 'Ventas' || s(i.categoria) === 'Cobranza').reduce((sum, i) => sum + n(i.monto), 0);
      
      // Costo de ventas: Empaque usado en producción
      const costoDeVentas = costos.filter(c => s(c.tipo) === 'Producción' || s(c.categoria) === 'Empaque').reduce((sum, c) => sum + n(c.monto), 0);
      
      // Gastos operativos: Todo lo demás de costos_historial + egresos contables
      const costosOp = costos.filter(c => s(c.tipo) !== 'Producción' && s(c.categoria) !== 'Empaque').reduce((sum, c) => sum + n(c.monto), 0);
      // Para no duplicar, solo sumar egresos que NO vengan de costos_historial (sin movimiento_id vinculado)
      const egresosSinVinculo = egresos.filter(e => !e.referencia?.includes('Costo fijo') && !e.referencia?.includes('costo_historial')).reduce((sum, e) => sum + n(e.monto), 0);
      const gastosOp = costosOp + egresosSinVinculo;
      
      // Utilidad bruta y neta
      const utilidadBruta = ventasTot - costoDeVentas;
      const utilidad = utilidadBruta - gastosOp;
      
      return { ventasTot, costoDeVentas, gastosOp, utilidadBruta, utilidad };
    };
    
    const hoyStr = new Date().toISOString().slice(0, 10);
    const sem = new Date(); sem.setDate(sem.getDate() - 7);
    const semStr = sem.toISOString().slice(0, 10);
    const mes = new Date(); mes.setDate(1);
    const mesStr = mes.toISOString().slice(0, 10);
    
    const filtroFecha = (fecha) => (m) => s(m.fecha) >= fecha;
    const filtroHistFecha = (fecha) => (c) => (s(c.fecha) || s(c.createdAt)) >= fecha;
    
    return {
      dia: calcPeriodo(m => s(m.fecha) === hoyStr, c => (s(c.fecha) || s(c.createdAt) || '').startsWith(hoyStr)),
      semana: calcPeriodo(filtroFecha(semStr), filtroHistFecha(semStr)),
      mes: calcPeriodo(filtroFecha(mesStr), filtroHistFecha(mesStr)),
    };
  }, [data.contabilidad, data.costosHistorial]);

  // ── BALANCE SIMPLIFICADO ──
  const balance = useMemo(() => {
    // Efectivo cobrado hoy
    const hoyStr = new Date().toISOString().slice(0, 10);
    const efectivoHoy = (data.pagos || [])
      .filter(p => s(p.fecha) === hoyStr && (s(p.metodoPago) === 'Efectivo' || s(p.metodo_pago) === 'Efectivo'))
      .reduce((s, p) => s + n(p.monto), 0);
    // Cuentas por cobrar
    const cxcTotal = (data.cuentasPorCobrar || [])
      .filter(c => c.estatus !== 'Pagada')
      .reduce((s, c) => s + n(c.saldoPendiente), 0);
    // Cuentas por pagar
    const cxpTotal = (data.cuentasPorPagar || [])
      .filter(c => c.estatus !== 'Pagada')
      .reduce((s, c) => s + n(c.saldoPendiente), 0);
    const posicion = efectivoHoy + cxcTotal - cxpTotal;
    return { efectivoHoy, cxcTotal, cxpTotal, posicion };
  }, [data.pagos, data.cuentasPorCobrar, data.cuentasPorPagar]);

  // ── ZONA 1: Saludo según hora ──
  const saludo = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Buen día';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }, []);

  // ── ZONA 1: Resumen accionable de "hoy" ──
  const accionablesHoy = useMemo(() => {
    const acciones = [];

    // Entregas pendientes
    if (ordPend > 0) {
      acciones.push({
        tipo: 'entregas',
        texto: `${ordPend} ${ordPend === 1 ? 'entrega pendiente' : 'entregas pendientes'}`,
        cta: 'Ver entregas',
        target: 'ordenes',
      });
    }

    // Producción faltante (suma de toda la columna "faltante")
    const faltanteTotal = tableroDemanda.reduce((sum, r) => sum + n(r.faltante), 0);
    if (faltanteTotal > 0) {
      acciones.push({
        tipo: 'produccion',
        texto: `Faltan ${faltanteTotal.toLocaleString()} productos por producir`,
        cta: 'Producir',
        target: 'produccion',
      });
    }

    // Cobros pendientes (cliente que más debe)
    if (balance.cxcTotal > 0) {
      // Buscar al cliente que más debe
      const porCliente = {};
      for (const c of (data.cuentasPorCobrar || [])) {
        if (c.estatus === 'Pagada') continue;
        const cli = s(c.cliente || c.clienteNombre || 'Cliente');
        porCliente[cli] = (porCliente[cli] || 0) + n(c.saldoPendiente);
      }
      const topCliente = Object.entries(porCliente).sort((a, b) => b[1] - a[1])[0];
      if (topCliente) {
        acciones.push({
          tipo: 'cobro',
          texto: `${topCliente[0]} te debe $${topCliente[1].toLocaleString()}`,
          cta: 'Cobrar',
          target: 'cobros',
        });
      }
    }

    return acciones;
  }, [ordPend, tableroDemanda, balance.cxcTotal, data.cuentasPorCobrar]);

  return (
    <div>
      {/* ═══ ZONA 1: HOY (lo accionable) ═══ */}
      {accionablesHoy.length > 0 && (
        <div className="mb-4 md:mb-6 rounded-[28px] border border-slate-200/80 bg-gradient-to-br from-white via-white to-cyan-50/40 p-5 md:p-7 shadow-[0_18px_40px_rgba(8,20,27,0.08)]">
          <div className="mb-4 md:mb-5">
            <p className="font-display text-xl md:text-2xl font-bold tracking-[-0.03em] text-slate-900">
              {saludo}{user?.nombre ? `, ${user.nombre}` : ''} ☀️
            </p>
            <p className="text-sm text-slate-500 mt-1">Esto es lo que necesitas atender hoy</p>
          </div>

          <div className="space-y-2.5 md:space-y-3 mb-5">
            {accionablesHoy.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-[18px] border border-slate-100 bg-white px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                    a.tipo === 'entregas' ? 'bg-blue-50 text-blue-600' :
                    a.tipo === 'produccion' ? 'bg-amber-50 text-amber-600' :
                    'bg-emerald-50 text-emerald-600'
                  }`}>
                    {a.tipo === 'entregas' ? <Icons.Truck /> : a.tipo === 'produccion' ? <Icons.Factory /> : <Icons.DollarSign />}
                  </span>
                  <p className="text-sm md:text-base font-semibold text-slate-800 truncate">{a.texto}</p>
                </div>
              </div>
            ))}
          </div>

          {accionablesHoy.length === 0 && (
            <p className="text-sm text-slate-500 italic">Todo al día. No hay pendientes urgentes.</p>
          )}
        </div>
      )}

      {/* ═══ ZONA 2: ESTA SEMANA (números clave en una sola línea) ═══ */}
      <div className="mb-4 md:mb-6 rounded-[24px] border border-slate-200/80 bg-white p-4 md:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 mb-3">Esta semana</p>
        <div className="grid grid-cols-3 gap-3 md:gap-6">
          <div>
            <p className="text-xs text-slate-500 mb-1">Vendiste</p>
            <p className="font-display text-xl md:text-2xl font-bold text-slate-900">${n(ventasResumen.semana).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Ganaste (mes)</p>
            <p className={`font-display text-xl md:text-2xl font-bold ${estadoResultados.mes.utilidad >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              ${estadoResultados.mes.utilidad.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Te deben</p>
            <p className={`font-display text-xl md:text-2xl font-bold ${balance.cxcTotal > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
              ${balance.cxcTotal.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* ═══ ZONA 3: ALERTAS PROMOVIDAS ARRIBA ═══ */}
      {alertasActivas.length > 0 && (
        <div className="mb-4 md:mb-6 rounded-[24px] border border-slate-200/80 bg-white p-4 md:p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-3 md:mb-4 flex items-center gap-2"><Icons.AlertTriangle /> Necesita tu atención</h3>
          <div className="space-y-2 md:space-y-3">
            {alertasActivas.slice(0, 5).map((a, i) => (
              <div key={a.id ?? i} className="flex items-start gap-2.5 rounded-[14px] border border-slate-100 bg-slate-50/60 p-3">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${s(a.tipo)==="critica"?"bg-red-500":s(a.tipo)==="accionable"?"bg-amber-500":"bg-blue-400"}`} />
                <p className="text-sm font-medium text-slate-700 flex-1">{s(a.msg || a.mensaje || a.detalle)}</p>
              </div>
            ))}
            {alertasActivas.length > 5 && (
              <p className="text-xs text-slate-400 text-center pt-1">+{alertasActivas.length - 5} más</p>
            )}
          </div>
        </div>
      )}


      {/* Estado de Resultados y Balance */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:mb-6 md:grid-cols-2">
        {/* Estado de Resultados */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4 md:p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Icons.Calculator /> Cómo va el mes</h3>
          <div className="flex gap-2 mb-3">
            <button className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Mes</button>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Ventas</span>
              <span className="text-sm font-bold text-emerald-600">+${estadoResultados.mes.ventasTot.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Costo del hielo</span>
              <span className="text-sm font-bold text-red-500">-${estadoResultados.mes.costoDeVentas.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 bg-slate-50 rounded-lg px-2 -mx-2">
              <span className="text-sm font-semibold text-slate-700">Ganancia antes de gastos</span>
              <span className={`text-sm font-bold ${estadoResultados.mes.utilidadBruta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                ${estadoResultados.mes.utilidadBruta.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Otros gastos</span>
              <span className="text-sm font-bold text-red-500">-${estadoResultados.mes.gastosOp.toLocaleString()}</span>
            </div>
            <div className="-mx-2 flex justify-between rounded-[16px] bg-slate-900 px-3 py-2 text-white">
              <span className="text-sm font-bold text-white/82">Ganancia</span>
              <span className={`text-sm font-extrabold ${estadoResultados.mes.utilidad >= 0 ? 'text-cyan-200' : 'text-red-300'}`}>
                ${estadoResultados.mes.utilidad.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Balance Simplificado */}
        <div className="rounded-2xl border border-slate-100 bg-white p-4 md:p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Icons.Wallet /> Tu dinero</h3>
          <div className="space-y-2">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Cobrado hoy en efectivo</span>
              <span className="text-sm font-bold text-emerald-600">${balance.efectivoHoy.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Te deben</span>
              <span className="text-sm font-bold text-amber-600">${balance.cxcTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Debes</span>
              <span className="text-sm font-bold text-red-500">${balance.cxpTotal.toLocaleString()}</span>
            </div>
            <div className="-mx-2 flex justify-between rounded-[16px] bg-slate-900 px-3 py-2 text-white">
              <span className="text-sm font-bold text-white/82">Saldo a favor</span>
              <span className={`text-sm font-extrabold ${balance.posicion >= 0 ? 'text-cyan-200' : 'text-red-300'}`}>
                ${balance.posicion.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Demanda vs Producción */}
      <div className="mb-4 rounded-2xl border border-slate-100 bg-white p-4 md:mb-6 md:p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-3 md:mb-4 flex items-center gap-2"><Icons.Factory /> Qué necesitas producir</h3>
        {tableroDemanda.length === 0 ? <EmptyState message="Sin productos de hielo" /> :
          <DataTable
            columns={[
              { key: "sku", label: "SKU", render: v => <span className="font-mono text-xs font-bold text-blue-600">{s(v)}</span> },
              { key: "producto", label: "Producto", bold: true },
              { key: "pendientes", label: "Pedidos", render: v => n(v).toLocaleString() },
              { key: "stock", label: "Tienes en stock", render: (v, r) => {
                const bajo = n(r.stockMinimo) > 0 && n(v) < n(r.stockMinimo);
                return <span className={`font-bold ${bajo ? 'text-red-600' : ''}`}>{n(v).toLocaleString()}{bajo && <span className="text-[10px] text-red-400 ml-1">▼ bajo mín</span>}</span>;
              }},
              { key: "stockMinimo", label: "Mínimo", render: v => n(v) > 0 ? <span className="text-xs text-slate-500">{n(v).toLocaleString()}</span> : <span className="text-xs text-slate-300">—</span> },
              { key: "faltante", label: "Por producir", render: v => <span className={`font-bold ${n(v) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{n(v).toLocaleString()}</span> },
              { key: "producidoHoy", label: "Hecho hoy", render: v => n(v).toLocaleString() },
            ]}
            data={tableroDemanda}
            cardTitle={r => `${s(r.sku)} · ${s(r.producto)}`}
            cardSubtitle={r => <span className="text-xs text-slate-500">Pend: {n(r.pendientes)} · Stock: {n(r.stock)}{n(r.stockMinimo) > 0 ? ` (mín ${n(r.stockMinimo)})` : ''} · Faltante: {n(r.faltante)} · Hoy: {n(r.producidoHoy)}</span>}
          />}
      </div>

      {/* Cuartos Fríos */}
      <div className="mb-4 md:mb-6">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 md:p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-3 md:mb-4 flex items-center gap-2"><Icons.Thermometer /> Cuartos Fríos</h3>
          {(data.cuartosFrios || []).length === 0 ? <EmptyState message="Sin cuartos fríos" /> :
          <div className="flex sm:grid sm:grid-cols-3 gap-3 overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0 snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0">
            {(data.cuartosFrios || []).map(cf => (
              <div key={cf.id} className="min-w-[220px] sm:min-w-0 flex-shrink-0 sm:flex-shrink rounded-[20px] border border-slate-100 bg-slate-50 p-3.5 md:p-4 snap-start">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-700">{s(cf.nombre)}</span>
                  <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">{n(cf.temp, -50, 10)}°C</span>
                </div>
                <CapacityBar pct={n(cf.capacidad)} />
                <p className="text-xs text-slate-400 mt-1.5">{n(cf.capacidad)}%</p>
                <div className="mt-1.5 space-y-0.5">{cf.stock ? Object.entries(cf.stock).map(([sku,qty])=><div key={sku} className="flex justify-between text-xs"><span className="text-slate-500">{sku}</span><span className="font-bold text-slate-700">{qty}</span></div>) : <p className="text-xs text-slate-500">{s(cf.productos)}</p>}</div>
              </div>
            ))}
          </div>}
        </div>
      </div>

      {/* Rutas */}
      <div className="mb-4 rounded-2xl border border-slate-100 bg-white p-4 md:mb-6 md:p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-3 md:mb-4 flex items-center gap-2"><Icons.Truck /> Rutas del día</h3>
        {(data.rutas || []).length === 0 ? <EmptyState message="Sin rutas programadas" /> :
        <div className="flex md:grid md:grid-cols-4 gap-3 overflow-x-auto md:overflow-x-visible pb-1 md:pb-0 snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0">
          {(data.rutas || []).map(r => (
            <div key={r.id} className="min-w-[200px] md:min-w-0 snap-start rounded-[20px] border border-slate-100 p-3.5 transition-colors hover:border-cyan-300 md:p-4 flex-shrink-0 md:flex-shrink">
              <div className="flex items-center justify-between mb-2"><span className="text-sm font-bold text-slate-700">{s(r.nombre)}</span><StatusBadge status={r.estatus}/></div>
              <p className="text-xs text-slate-500 mb-2.5">{s(r.chofer)}</p>
              <div className="flex items-center justify-between text-xs mb-1"><span className="text-slate-400">{n(r.entregadas)}/{n(r.ordenes)}</span></div>
              <CapacityBar pct={n(r.ordenes)>0?(n(r.entregadas)/n(r.ordenes))*100:0}/>
            </div>
          ))}
        </div>}
      </div>

      {/* Últimos movimientos */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 md:p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-3 md:mb-4 flex items-center gap-2"><Icons.ClipboardCheck /> Últimos movimientos</h3>
        <DataTable columns={[
          { key: "fecha", label: "Fecha", hideOnMobile: true, render: v => fmtDateTime(v) },
          { key: "tipo", label: "Tipo", badge: true, render: v => <StatusBadge status={v} /> },
          { key: "producto", label: "Producto", bold: true, primary: true },
          { key: "cantidad", label: "Cant.", render: v => {const num=n(v,-999999);return<span className={`font-mono font-semibold ${num>0?"text-emerald-600":num<0?"text-red-500":"text-slate-600"}`}>{num>0?`+${num}`:num}</span>} },
          { key: "origen", label: "Ref.", hideOnMobile: true },
          { key: "usuario", label: "Usuario", hideOnMobile: true },
        ]} data={recentMov}
        cardTitle={r => {const num=n(r.cantidad,-999999);return `${num>0?'+'+num:num} ${s(r.producto)}`}}
        cardSubtitle={r => <span className="text-xs text-slate-400">{fmtDateTime(r.fecha)} · {s(r.origen)}</span>}
        />
      </div>
    </div>
  );
}
