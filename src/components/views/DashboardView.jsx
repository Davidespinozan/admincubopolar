import { useMemo } from 'react';
import { Icons } from '../ui/Icons';
import { StatusBadge, DataTable, CapacityBar, StatCard } from '../ui/Components';
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

// Static — no need to recreate on every render
const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

export default function DashboardView({ data }) {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const d = hoy.getDate();

  const inicioDia = useMemo(() => new Date(y, m, d), [y, m, d]);
  const inicioSemana = useMemo(() => {
    const base = new Date(y, m, d);
    const dow = base.getDay();
    const diff = (dow + 6) % 7;
    base.setDate(base.getDate() - diff);
    base.setHours(0, 0, 0, 0);
    return base;
  }, [y, m, d]);
  const inicioMes = useMemo(() => new Date(y, m, 1), [y, m]);

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
  const estatusVenta = useMemo(() => new Set(["entregada", "facturada"]), []);

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

  const tableroDemanda = useMemo(() => {
    return productosHielo.map(p => {
      const sku = s(p.sku);
      const pendientes = n(pedidosPendPorSku[sku]);
      const stock = n(stockCuartosPorSku[sku]);
      const faltante = Math.max(0, pendientes - stock);
      const producidoHoy = n(producidoHoyPorSku[sku]);
      return {
        id: sku,
        sku,
        producto: s(p.nombre),
        pendientes,
        stock,
        faltante,
        producidoHoy,
      };
    });
  }, [productosHielo, pedidosPendPorSku, stockCuartosPorSku, producidoHoyPorSku]);

  const ventasResumen = useMemo(() => {
    let dia = 0, semana = 0, mes = 0;
    for (const ord of (data.ordenes || [])) {
      const est = s(ord.estatus).toLowerCase();
      if (!estatusVenta.has(est)) continue;
      const dt = parseFecha(ord.fecha);
      if (!dt) continue;
      const tot = n(ord.total);
      if (dt >= inicioDia) dia += tot;
      if (dt >= inicioSemana) semana += tot;
      if (dt >= inicioMes) mes += tot;
    }
    return { dia, semana, mes };
  }, [data.ordenes, estatusVenta, inicioDia, inicioSemana, inicioMes]);

  const clientesActivos = useMemo(
    () => (data.clientes || []).filter(c => s(c.estatus || 'Activo') === 'Activo').length,
    [data.clientes]
  );

  const rutasAct = useMemo(
    () => (data.rutas || []).filter(r => s(r.estatus).toLowerCase() === "en progreso").length,
    [data.rutas]
  );

  const alertasActivas = useMemo(
    () => (data.alertas || []).filter(a => !!s(a.msg || a.mensaje || a.detalle)),
    [data.alertas]
  );

  const totalProdHoy = useMemo(
    () => tableroDemanda.reduce((sum, row) => sum + n(row.producidoHoy), 0),
    [tableroDemanda]
  );
  const ordPend = useMemo(
    () => tableroDemanda.reduce((sum, row) => sum + n(row.pendientes), 0),
    [tableroDemanda]
  );
  const totalInv = useMemo(
    () => tableroDemanda.reduce((sum, row) => sum + n(row.stock), 0),
    [tableroDemanda]
  );

  // ── FIX P7: .slice() inside JSX creates new array ref every render ──
  const recentMov = useMemo(() => data.inventarioMov.slice(0, 5), [data.inventarioMov]);

  const fechaStr = `${DIAS[hoy.getDay()]}, ${hoy.getDate()} de ${MESES[hoy.getMonth()]} ${hoy.getFullYear()}`;
  const turno = hoy.getHours() < 14 ? "Turno matutino" : "Turno vespertino";

  // ── FIX P8: stat card config was recreated every render as inline array literal ──
  const stats = useMemo(() => [
    { label: "Producido hoy", val: totalProdHoy.toLocaleString(), unit: "bolsas", bg: "bg-blue-50", txt: "text-blue-500", icon: Icons.Factory },
    { label: "Por entregar", val: ordPend, unit: "órdenes", bg: "bg-amber-50", txt: "text-amber-500", icon: Icons.ShoppingCart },
    { label: "Rutas activas", val: rutasAct, unit: "en calle", bg: "bg-emerald-50", txt: "text-emerald-500", icon: Icons.Truck },
    { label: "Hielo disponible", val: totalInv.toLocaleString(), unit: "bolsas", bg: "bg-cyan-50", txt: "text-cyan-500", icon: Icons.Package },
  ], [totalProdHoy, ordPend, rutasAct, totalInv]);

  const resumenGeneral = useMemo(() => [
    { label: "Ventas hoy", val: `$${n(ventasResumen.dia).toLocaleString()}`, sub: "pesos", bg: "bg-emerald-50", txt: "text-emerald-600", icon: Icons.DollarSign },
    { label: "Ventas semana", val: `$${n(ventasResumen.semana).toLocaleString()}`, sub: "pesos", bg: "bg-blue-50", txt: "text-blue-600", icon: Icons.Calculator },
    { label: "Ventas mes", val: `$${n(ventasResumen.mes).toLocaleString()}`, sub: "pesos", bg: "bg-indigo-50", txt: "text-indigo-600", icon: Icons.Wallet },
    { label: "Clientes activos", val: n(clientesActivos).toLocaleString(), sub: "clientes", bg: "bg-cyan-50", txt: "text-cyan-600", icon: Icons.Users },
    { label: "Rutas en progreso", val: n(rutasAct).toLocaleString(), sub: "rutas", bg: "bg-amber-50", txt: "text-amber-600", icon: Icons.Truck },
    { label: "Alertas", val: n(alertasActivas.length).toLocaleString(), sub: "activas", bg: "bg-red-50", txt: "text-red-600", icon: Icons.AlertTriangle },
  ], [ventasResumen, clientesActivos, rutasAct, alertasActivas.length]);

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

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.85fr] md:mb-6">
        <section className="relative overflow-hidden rounded-[34px] border border-slate-900/8 bg-[#07131a] px-5 py-6 text-white shadow-[0_28px_60px_rgba(3,14,19,0.22)] md:px-8 md:py-8">
          <div className="absolute right-[-10%] top-[-14%] h-52 w-52 rounded-full bg-cyan-300/18 blur-3xl" />
          <div className="absolute bottom-[-18%] left-[-4%] h-44 w-44 rounded-full bg-amber-200/14 blur-3xl" />
          <div className="relative">
            <p className="erp-kicker text-cyan-200/70">Centro de mando</p>
            <h1 className="font-display mt-3 max-w-3xl text-3xl font-bold tracking-[-0.06em] text-white md:text-5xl">
              Cadena fría, despacho y caja en una sola lectura.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
              {fechaStr}. {turno}. La vista prioriza faltantes, liquidez y ritmo operativo para decidir sin ruido.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-[22px] border border-white/10 bg-white/8 p-4 backdrop-blur-xl">
                <p className="erp-kicker text-white/40">Ventas hoy</p>
                <p className="mt-2 text-2xl font-bold tracking-[-0.04em] text-white">${n(ventasResumen.dia).toLocaleString()}</p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/8 p-4 backdrop-blur-xl">
                <p className="erp-kicker text-white/40">Pendiente</p>
                <p className="mt-2 text-2xl font-bold tracking-[-0.04em] text-white">{ordPend.toLocaleString()}</p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/8 p-4 backdrop-blur-xl">
                <p className="erp-kicker text-white/40">Liquidez</p>
                <p className={`mt-2 text-2xl font-bold tracking-[-0.04em] ${balance.posicion >= 0 ? 'text-cyan-200' : 'text-red-300'}`}>${balance.posicion.toLocaleString()}</p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/8 p-4 backdrop-blur-xl">
                <p className="erp-kicker text-white/40">Alertas</p>
                <p className="mt-2 text-2xl font-bold tracking-[-0.04em] text-white">{alertasActivas.length}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 md:gap-4">
          {stats.map((item, i) => (
            <StatCard key={i} label={item.label} value={item.val} unit={item.unit} icon={item.icon} />
          ))}
        </div>
      </div>

      {/* Resumen general */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 md:p-5 mb-4 md:mb-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700 md:mb-4"><Icons.Dashboard /> Resumen general</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {resumenGeneral.map((item, i) => (
            <div key={i} className="rounded-[20px] border border-slate-200/80 bg-white/72 p-3 shadow-[0_10px_24px_rgba(8,20,27,0.04)]">
              <div className="flex items-start justify-between mb-1.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.16em]">{item.label}</p>
                <span className={`flex h-8 w-8 items-center justify-center rounded-[14px] ${item.bg} ${item.txt}`}><item.icon /></span>
              </div>
              <p className="font-display text-[1.45rem] font-bold leading-tight tracking-[-0.04em] text-slate-900">{item.val}</p>
              <p className="text-[11px] text-slate-400">{item.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Estado de Resultados y Balance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 md:mb-6">
        {/* Estado de Resultados */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 md:p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Icons.Calculator /> Estado de Resultados</h3>
          <div className="flex gap-2 mb-3">
            <button className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Mes</button>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Ventas</span>
              <span className="text-sm font-bold text-emerald-600">+${estadoResultados.mes.ventasTot.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Costo de ventas</span>
              <span className="text-sm font-bold text-red-500">-${estadoResultados.mes.costoDeVentas.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 bg-slate-50 rounded-lg px-2 -mx-2">
              <span className="text-sm font-semibold text-slate-700">Utilidad bruta</span>
              <span className={`text-sm font-bold ${estadoResultados.mes.utilidadBruta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                ${estadoResultados.mes.utilidadBruta.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Gastos operativos</span>
              <span className="text-sm font-bold text-red-500">-${estadoResultados.mes.gastosOp.toLocaleString()}</span>
            </div>
            <div className="-mx-2 flex justify-between rounded-[16px] bg-slate-900 px-3 py-2 text-white">
              <span className="text-sm font-bold text-white/82">Utilidad</span>
              <span className={`text-sm font-extrabold ${estadoResultados.mes.utilidad >= 0 ? 'text-cyan-200' : 'text-red-300'}`}>
                ${estadoResultados.mes.utilidad.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Balance Simplificado */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 md:p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Icons.Wallet /> Balance Financiero</h3>
          <div className="space-y-2">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Efectivo cobrado hoy</span>
              <span className="text-sm font-bold text-emerald-600">${balance.efectivoHoy.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Cuentas por cobrar</span>
              <span className="text-sm font-bold text-amber-600">${balance.cxcTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-sm text-slate-600">Cuentas por pagar</span>
              <span className="text-sm font-bold text-red-500">${balance.cxpTotal.toLocaleString()}</span>
            </div>
            <div className="-mx-2 flex justify-between rounded-[16px] bg-slate-900 px-3 py-2 text-white">
              <span className="text-sm font-bold text-white/82">Posición financiera</span>
              <span className={`text-sm font-extrabold ${balance.posicion >= 0 ? 'text-cyan-200' : 'text-red-300'}`}>
                ${balance.posicion.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Demanda vs Producción */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 md:p-5 mb-4 md:mb-6">
        <h3 className="text-sm font-bold text-slate-700 mb-3 md:mb-4 flex items-center gap-2"><Icons.Factory /> Demanda vs producción</h3>
        {tableroDemanda.length === 0 ? <EmptyState message="Sin productos de hielo" /> :
          <DataTable
            columns={[
              { key: "sku", label: "SKU", render: v => <span className="font-mono text-xs font-bold text-blue-600">{s(v)}</span> },
              { key: "producto", label: "Producto", bold: true },
              { key: "pendientes", label: "Pedidos pendientes", render: v => n(v).toLocaleString() },
              { key: "stock", label: "Stock disponible", render: v => n(v).toLocaleString() },
              { key: "faltante", label: "Faltante por producir", render: v => <span className={`font-bold ${n(v) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{n(v).toLocaleString()}</span> },
              { key: "producidoHoy", label: "Producido hoy", render: v => n(v).toLocaleString() },
            ]}
            data={tableroDemanda}
            cardTitle={r => `${s(r.sku)} · ${s(r.producto)}`}
            cardSubtitle={r => <span className="text-xs text-slate-500">Pend: {n(r.pendientes)} · Stock: {n(r.stock)} · Faltante: {n(r.faltante)} · Hoy: {n(r.producidoHoy)}</span>}
          />}
      </div>

      {/* Cuartos + Alertas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-4 md:mb-6">
        <div className="md:col-span-2 bg-white border border-slate-100 rounded-2xl p-4 md:p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-3 md:mb-4 flex items-center gap-2"><Icons.Thermometer /> Cuartos Fríos</h3>
          {(data.cuartosFrios || []).length === 0 ? <EmptyState message="Sin cuartos fríos" /> :
          <div className="flex sm:grid sm:grid-cols-3 gap-3 overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0 snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0">
            {(data.cuartosFrios || []).map(cf => (
              <div key={cf.id} className="min-w-[220px] sm:min-w-0 flex-shrink-0 sm:flex-shrink rounded-[22px] bg-slate-50 p-3.5 md:p-4 border border-slate-100 snap-start">
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
        <div className="bg-white border border-slate-100 rounded-2xl p-4 md:p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-3 md:mb-4 flex items-center gap-2"><Icons.AlertTriangle /> Alertas</h3>
          {alertasActivas.length === 0 ? <EmptyState message="Sin alertas activas" /> :
          <div className="space-y-2 md:space-y-3">
            {alertasActivas.map((a, i) => (
              <div key={a.id ?? i} className="flex items-start gap-2.5 md:gap-3 rounded-[20px] border border-slate-100 bg-slate-50 p-2.5 md:p-3">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${s(a.tipo)==="critica"?"bg-red-500":s(a.tipo)==="accionable"?"bg-amber-500":"bg-blue-400"}`} />
                <div><p className="text-xs font-medium text-slate-700">{s(a.msg || a.mensaje || a.detalle)}</p><p className="text-xs text-slate-400 mt-0.5">{fmtDateTime(a.created_at)}</p></div>
              </div>
            ))}
          </div>}
        </div>
      </div>

      {/* Rutas */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 md:p-5 mb-4 md:mb-6">
        <h3 className="text-sm font-bold text-slate-700 mb-3 md:mb-4 flex items-center gap-2"><Icons.Truck /> Rutas del día</h3>
        {(data.rutas || []).length === 0 ? <EmptyState message="Sin rutas programadas" /> :
        <div className="flex md:grid md:grid-cols-4 gap-3 overflow-x-auto md:overflow-x-visible pb-1 md:pb-0 snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0">
          {(data.rutas || []).map(r => (
            <div key={r.id} className="min-w-[200px] md:min-w-0 snap-start rounded-[22px] border border-slate-100 p-3.5 md:p-4 transition-colors hover:border-cyan-300 flex-shrink-0 md:flex-shrink">
              <div className="flex items-center justify-between mb-2"><span className="text-sm font-bold text-slate-700">{s(r.nombre)}</span><StatusBadge status={r.estatus}/></div>
              <p className="text-xs text-slate-500 mb-2.5">{s(r.chofer)}</p>
              <div className="flex items-center justify-between text-xs mb-1"><span className="text-slate-400">{n(r.entregadas)}/{n(r.ordenes)}</span></div>
              <CapacityBar pct={n(r.ordenes)>0?(n(r.entregadas)/n(r.ordenes))*100:0}/>
            </div>
          ))}
        </div>}
      </div>

      {/* Últimos movimientos */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 md:p-5">
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
