import { useState, useCallback, useMemo, useEffect, lazy, Suspense, Component } from 'react';
import { Icons } from './ui/Icons';
import DashboardView from './views/DashboardView';

// Lazy-load all module views — splits ~1MB main chunk into on-demand pieces
const ClientesView      = lazy(() => import('./views/ClientesView.jsx').then(m => ({ default: m.ClientesView })));
const ProductosView     = lazy(() => import('./views/ProductosView.jsx').then(m => ({ default: m.ProductosView })));
const PreciosView       = lazy(() => import('./views/PreciosView.jsx').then(m => ({ default: m.PreciosView })));
const ProduccionView    = lazy(() => import('./views/ProduccionView.jsx').then(m => ({ default: m.ProduccionView })));
const InventarioView    = lazy(() => import('./views/InventarioView.jsx').then(m => ({ default: m.InventarioView })));
const OrdenesView       = lazy(() => import('./views/OrdenesView.jsx').then(m => ({ default: m.OrdenesView })));
const RutasView         = lazy(() => import('./views/RutasView.jsx').then(m => ({ default: m.RutasView })));
const FacturacionView   = lazy(() => import('./views/FacturacionView.jsx').then(m => ({ default: m.FacturacionView })));
const ConciliacionView  = lazy(() => import('./views/ConciliacionView.jsx').then(m => ({ default: m.ConciliacionView })));
const AuditoriaView     = lazy(() => import('./views/AuditoriaView.jsx').then(m => ({ default: m.AuditoriaView })));
const ConfiguracionView = lazy(() => import('./views/ConfiguracionView.jsx').then(m => ({ default: m.ConfiguracionView })));
const AlmacenBolsasView = lazy(() => import('./views/AlmacenBolsasView.jsx').then(m => ({ default: m.AlmacenBolsasView })));
const EmpleadosView     = lazy(() => import('./views/EmpleadosView.jsx').then(m => ({ default: m.EmpleadosView })));
const NominaView        = lazy(() => import('./views/NominaView.jsx').then(m => ({ default: m.NominaView })));
const ContabilidadView  = lazy(() => import('./views/ContabilidadView.jsx').then(m => ({ default: m.ContabilidadView })));
const CobrosView        = lazy(() => import('./views/CobrosView.jsx').then(m => ({ default: m.CobrosView })));
const CostosView        = lazy(() => import('./views/CostosView.jsx').then(m => ({ default: m.CostosView })));
const CuentasPorPagarView = lazy(() => import('./views/CuentasPorPagarView.jsx').then(m => ({ default: m.CuentasPorPagarView })));

// Auto-reload when a lazy chunk can't load (stale deployment)
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => window.location.reload());
}

class ChunkErrorBoundary extends Component {
  componentDidCatch(err) {
    if (err?.message?.includes('MIME') || err?.message?.includes('Failed to fetch') || err?.message?.includes('dynamically imported')) {
      window.location.reload();
    }
  }
  render() { return this.props.children; }
}

/*
  ADMIN: 4 áreas — Operación, Comercial, Finanzas, Equipo
  Mobile: bottom nav 5 items + "Más" overflow
  Desktop: sidebar grouped by area with section headers
*/

const AREAS = [
  { id: "operacion", label: "Operación", icon: "Factory", color: "blue",
    items: [
      { id: "dashboard", label: "Resumen", icon: "Dashboard" },
      { id: "produccion", label: "Producción", icon: "Factory" },
      { id: "inventario", label: "Congeladores", icon: "Warehouse" },
      { id: "comodatos", label: "Comodatos", icon: "Truck" },
      { id: "rutas", label: "Rutas", icon: "Truck" },
      { id: "bolsas", label: "Insumos", icon: "Box" },
    ]
  },
  { id: "comercial", label: "Comercial", icon: "ShoppingCart", color: "emerald",
    items: [
      { id: "ordenes", label: "Ventas", icon: "ShoppingCart" },
      { id: "clientes", label: "Clientes", icon: "Users" },
      { id: "leads", label: "Leads", icon: "UserCheck" },
      { id: "precios", label: "Precios", icon: "DollarSign" },
      { id: "productos", label: "Catálogo", icon: "Package" },
    ]
  },
  { id: "finanzas", label: "Finanzas", icon: "Wallet", color: "amber",
    items: [
      { id: "contabilidad", label: "Ingresos / Egresos", icon: "Calculator" },
      { id: "cobros", label: "Cuentas por Cobrar", icon: "DollarSign" },
      { id: "proveedores", label: "Cuentas por Pagar", icon: "CreditCard" },
      { id: "costos", label: "Costos y Gastos", icon: "Receipt" },
      { id: "facturacion", label: "Facturación", icon: "FileText" },
      { id: "conciliacion", label: "Cortes de caja", icon: "ClipboardCheck" },
      { id: "nomina", label: "Nómina", icon: "Wallet" },
    ]
  },
  { id: "equipo", label: "Equipo", icon: "Users", color: "purple",
    items: [
      { id: "empleados", label: "Empleados", icon: "UserCheck" },
      { id: "auditoria", label: "Historial", icon: "Shield" },
      { id: "configuracion", label: "Ajustes", icon: "Settings" },
    ]
  },
];

const ALL_ITEMS = AREAS.flatMap(a => a.items);
const BOTTOM_PRIMARY = ["dashboard", "ordenes", "produccion", "contabilidad"];
const AREA_META = {
  operacion: {
    tagline: 'Cadena fria y despacho',
    subtitle: 'planta, stock y rutas',
    chip: 'border-cyan-200/80 bg-cyan-100/80 text-cyan-900',
    glow: 'from-cyan-300/50 via-sky-200/40 to-transparent',
  },
  comercial: {
    tagline: 'Ventas y relacion comercial',
    subtitle: 'pedidos, clientes y pricing',
    chip: 'border-emerald-200/80 bg-emerald-100/80 text-emerald-900',
    glow: 'from-emerald-300/40 via-teal-200/30 to-transparent',
  },
  finanzas: {
    tagline: 'Caja, cobranza y control',
    subtitle: 'ingresos, egresos y conciliacion',
    chip: 'border-amber-200/80 bg-amber-100/80 text-amber-900',
    glow: 'from-amber-200/50 via-orange-200/30 to-transparent',
  },
  equipo: {
    tagline: 'Gobierno operativo',
    subtitle: 'personas, auditoria y ajustes',
    chip: 'border-violet-200/80 bg-violet-100/80 text-violet-900',
    glow: 'from-violet-200/40 via-slate-200/30 to-transparent',
  },
};

export default function CuboPolarERP({ user, data, actions, onLogout, onViewAs }) {
  const [view, setView] = useState('dashboard');
  const [moreOpen, setMoreOpen] = useState(false);
  const [alertasOpen, setAlertasOpen] = useState(false);

  const vp = useMemo(() => ({ data, actions }), [data, actions]);
  const alertasActivas = useMemo(() => {
    return (data.alertas || []).filter(a => {
      const msg = (a?.msg || a?.mensaje || a?.detalle || a?.titulo || '').toString().trim();
      const est = (a?.estatus || '').toString().toLowerCase();
      return !!msg && est !== 'resuelta' && est !== 'cerrada';
    });
  }, [data.alertas]);

  useEffect(() => {
    if (!alertasOpen && !moreOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setAlertasOpen(false);
        setMoreOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [alertasOpen, moreOpen]);

  const renderView = () => {
    switch (view) {
      case 'dashboard': return <DashboardView data={data} />;
      case 'clientes': return <ClientesView {...vp} />;
      case 'productos': return <ProductosView {...vp} />;
      case 'bolsas': return <AlmacenBolsasView {...vp} />;
      case 'precios': return <PreciosView {...vp} />;
      case 'produccion': return <ProduccionView {...vp} />;
      case 'inventario': return <InventarioView {...vp} />;
      case 'ordenes': return <OrdenesView {...vp} />;
      case 'rutas': return <RutasView {...vp} />;
      case 'facturacion': return <FacturacionView {...vp} />;
      case 'conciliacion': return <ConciliacionView data={data} />;
      case 'auditoria': return <AuditoriaView data={data} />;
      case 'nomina': return <NominaView {...vp} />;
      case 'contabilidad': return <ContabilidadView {...vp} />;
      case 'cobros': return <CobrosView {...vp} />;
      case 'proveedores': return <CuentasPorPagarView {...vp} />;
      case 'costos': return <CostosView {...vp} />;
      case 'empleados': return <EmpleadosView {...vp} />;
      case 'configuracion': return <ConfiguracionView {...vp} />;
      case 'comodatos': return <ComodatosView {...vp} />;
      case 'leads': return <LeadsView {...vp} />;
      default: return <DashboardView data={data} />;
    }
  };

  const go = useCallback((id) => { setView(id); setMoreOpen(false); }, []);
  const current = ALL_ITEMS.find(n => n.id === view);
  const currentArea = AREAS.find(area => area.items.some(item => item.id === view)) || AREAS[0];
  const currentMeta = AREA_META[currentArea?.id] || AREA_META.operacion;
  const AreaIcon = Icons[currentArea?.icon] || Icons.Dashboard;

  return (
    <div className="min-h-screen text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className={`absolute left-[-10%] top-[-8%] h-[24rem] w-[24rem] rounded-full bg-gradient-to-br ${currentMeta.glow} blur-3xl`} />
        <div className="absolute bottom-[-10%] right-[-6%] h-[22rem] w-[22rem] rounded-full bg-gradient-to-br from-slate-200/60 via-white/20 to-transparent blur-3xl" />
      </div>

      {/* ═══ SIDEBAR — desktop ═══ */}
      <aside className="fixed left-0 top-0 z-40 hidden h-full w-[300px] flex-col overflow-hidden border-r border-blue-200/60 bg-gradient-to-b from-blue-950 via-slate-900 to-slate-900 text-slate-100 shadow-[0_20px_50px_rgba(8,20,27,0.18)] lg:flex xl:w-[320px]">
        <div className="flex-shrink-0 border-b border-white/8 px-6 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/10 bg-white/8 shadow-[0_18px_32px_rgba(2,10,15,0.28)]">
              <img src="/icon-192.png" alt="CuboPolar" className="h-8 w-8" />
            </div>
            <div>
              <span className="font-display text-lg font-bold tracking-[-0.05em] text-white">CUBOPOLAR</span>
              <span className="block text-[11px] uppercase tracking-[0.22em] text-slate-400">ERP operativo</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-4">
          {AREAS.map(area => (
            <div key={area.id} className="mb-4">
              <div className="mb-2 flex items-center gap-2 px-3">
                <span className="h-2 w-2 rounded-full bg-white/28" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{area.label}</p>
              </div>
              <div className="space-y-1">
                {area.items.map(item => {
                  const Ic = Icons[item.icon] || Icons.Package;
                  const active = view === item.id;
                  return (
                    <button key={item.id} onClick={() => go(item.id)}
                      className={`w-full rounded-[18px] px-3 py-2.5 text-left text-sm transition-all ${active ? 'bg-blue-50 text-blue-900 shadow-[0_16px_28px_rgba(2,10,15,0.16)]' : 'text-slate-300/82 hover:bg-white/6 hover:text-white'}`}>
                      <span className="flex items-center gap-3">
                        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[14px] ${active ? 'bg-blue-600 text-white' : 'bg-white/6 text-slate-300'}`}><Ic /></span>
                      <span className="truncate">{item.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {onViewAs && (
          <div className="flex-shrink-0 border-t border-white/8 px-4 py-4">
            <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Ver como...</p>
            <div className="grid grid-cols-2 gap-1">
              {["Chofer","Ventas","Producción","Almacén Bolsas"].map(r => (
                <button key={r} onClick={()=>onViewAs(r)} className="rounded-[14px] border border-white/10 bg-white/6 px-2 py-2 text-[11px] font-semibold text-white transition-all hover:bg-white/10">{r}</button>
              ))}
            </div>
          </div>
        )}
        <div className="flex h-[76px] flex-shrink-0 items-center justify-between border-t border-white/8 px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-cyan-200 text-sm font-bold text-slate-950">{user?.nombre?.[0] || "A"}</div>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{user?.nombre || "Admin"}</p><p className="truncate text-xs text-slate-400">{user?.rol}</p></div>
          </div>
          {onLogout && <button onClick={onLogout} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/8 hover:text-white" title="Cerrar sesión" aria-label="Cerrar sesión"><Icons.X /></button>}
        </div>
      </aside>

      {/* ═══ TOPBAR ═══ */}
      <header className="sticky top-0 z-30 px-3 pt-3 lg:ml-[300px] lg:px-6 lg:pt-4 xl:ml-[320px]" style={{paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)"}}>
        <div className="erp-panel erp-shell-blur flex flex-wrap items-start justify-between gap-3 rounded-[28px] px-4 py-3.5 sm:flex-nowrap lg:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[16px] bg-slate-900 text-cyan-200 shadow-[0_16px_28px_rgba(8,20,27,0.18)] lg:hidden">
              <img src="/icon-192.png" alt="CuboPolar" className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${currentMeta.chip}`}>{currentArea?.label}</span>
              </div>
              <div className="mt-2 min-w-0">
                <p className="font-display truncate text-lg font-bold tracking-[-0.04em] text-slate-900 sm:text-xl lg:text-[1.55rem]">{current?.label || "Resumen"}</p>
                <p className="mt-1 max-w-2xl text-xs text-slate-500 sm:text-sm">{currentMeta.subtitle}</p>
              </div>
            </div>
          </div>
          <div className="relative flex w-full items-center justify-end gap-2 sm:w-auto">
            <button onClick={() => setAlertasOpen(!alertasOpen)} className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[16px] border border-slate-200 bg-white/80 text-slate-500 transition-colors hover:bg-white hover:text-slate-800" title="Ver alertas" aria-label="Ver alertas" aria-haspopup="dialog" aria-expanded={alertasOpen}>
              <Icons.Bell />{alertasActivas.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full" />}
            </button>
            {alertasOpen && (
              <div className="erp-panel absolute right-0 top-14 z-[70] max-h-96 w-[calc(100vw-32px)] overflow-y-auto rounded-[24px] sm:w-96 md:w-[22rem]" role="dialog" aria-modal="false" aria-label="Alertas activas">
                <div className="border-b border-slate-200/80 px-4 py-3.5">
                  <p className="text-sm font-semibold text-slate-900">Alertas activas</p>
                  <p className="mt-0.5 text-xs text-slate-500">Pendientes que requieren revisión.</p>
                </div>
                {alertasActivas.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-400">Sin alertas activas</div>
                ) : (
                  <div className="space-y-2 p-3">
                    {alertasActivas.map((a, i) => (
                      <div key={i} className="rounded-[18px] border border-slate-200/80 bg-white px-4 py-3">
                        <p className="text-sm font-semibold text-slate-800">{a.titulo || 'Alerta'}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{a.msg || a.mensaje || a.detalle}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {alertasOpen && <div className="fixed inset-0 z-[60]" onClick={() => setAlertasOpen(false)} aria-hidden="true" />}
            <div className="hidden lg:flex items-center gap-2 ml-2 pl-3 border-l border-slate-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-cyan-200">{user?.nombre?.[0] || "A"}</div>
              <span className="text-sm font-semibold text-slate-700">{user?.nombre || "Admin"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ═══ MAIN ═══ */}
      <main className="px-3 pb-24 pt-4 sm:px-4 lg:ml-[300px] lg:px-6 lg:pb-6 lg:pt-6 xl:ml-[320px]">
        <div className="relative">
          <div className={`pointer-events-none absolute inset-x-8 top-0 h-16 rounded-[32px] bg-gradient-to-r ${currentMeta.glow} opacity-45 blur-3xl`} />
          <div className="relative"><ChunkErrorBoundary><Suspense fallback={<div className="flex h-48 items-center justify-center text-sm text-slate-400">Cargando...</div>}>{renderView()}</Suspense></ChunkErrorBoundary></div>
        </div>
      </main>

      {/* ═══ BOTTOM NAV — mobile ═══ */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-blue-200/60 bg-white/96 text-slate-900 backdrop-blur-xl lg:hidden" style={{paddingBottom: "env(safe-area-inset-bottom, 0px)"}}>
        <div className="flex items-stretch">
          {BOTTOM_PRIMARY.map(id => {
            const item = ALL_ITEMS.find(n => n.id === id);
            if (!item) return null;
            const Ic = Icons[item.icon] || Icons.Package;
            const active = view === id && !moreOpen;
            return (
              <button key={id} onClick={() => go(id)}
                className={`flex min-h-[60px] flex-1 flex-col items-center justify-center px-1 py-2 transition-colors ${active ? 'text-blue-600' : 'text-slate-400 active:text-slate-700'}`}>
                <Ic />
                <span className="mt-0.5 max-w-full truncate px-0.5 text-[11px] font-semibold leading-none sm:text-xs">{
                  id === "dashboard" ? "Inicio" :
                  id === "contabilidad" ? "Dinero" :
                  id === "produccion" ? "Prod." :
                  item.label.split(" ")[0]
                }</span>
              </button>
            );
          })}
          <button onClick={() => setMoreOpen(!moreOpen)}
            className={`flex min-h-[60px] flex-1 flex-col items-center justify-center px-1 py-2 transition-colors ${moreOpen || !BOTTOM_PRIMARY.includes(view) ? 'text-blue-600' : 'text-slate-400 active:text-slate-700'}`}>
            <Icons.MoreH />
            <span className="mt-0.5 text-[11px] font-semibold leading-none sm:text-xs">Más</span>
          </button>
        </div>
      </nav>

      {/* ═══ "MÁS" OVERFLOW — mobile ═══ */}
      {moreOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-slate-950/68 backdrop-blur-md" />
          <div className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto rounded-t-[30px] border-t border-blue-200/80 bg-white text-slate-900 shadow-[0_-24px_60px_rgba(8,20,27,0.24)] safe-bottom" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Más módulos">
            <div className="mx-auto mb-2 mt-3 h-1 w-10 rounded-full bg-slate-200" />
            <div className="px-4 pb-4">
              {AREAS.map(area => (
                <div key={area.id} className="mb-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{area.label}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {area.items.filter(i => !BOTTOM_PRIMARY.includes(i.id)).map(item => {
                      const Ic = Icons[item.icon] || Icons.Package;
                      const active = view === item.id;
                      return (
                        <button key={item.id} onClick={() => go(item.id)}
                          className={`flex min-h-[68px] flex-col items-center justify-center rounded-[18px] py-3 transition-colors ${active ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-50 text-slate-600 active:bg-slate-100'}`}>
                          <Ic />
                          <span className="text-[10px] font-semibold mt-1.5 leading-tight text-center truncate max-w-full px-1">{item.label.split(" ")[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {onViewAs && (
                <div className="mt-1 border-t border-white/8 pt-3">
                  <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Ver como...</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {["Chofer","Ventas","Producción","Almacén Bolsas"].map(r => (
                      <button key={r} onClick={()=>{onViewAs(r);setMoreOpen(false)}} className="rounded-[16px] border border-blue-200 bg-blue-50 px-2 py-2.5 text-xs font-semibold text-blue-700 active:bg-blue-100">{r}</button>
                    ))}
                  </div>
                </div>
              )}
              {onLogout && (
                <button onClick={onLogout} className="mt-2 flex w-full items-center justify-center gap-2 rounded-[16px] border border-red-200 py-3 text-red-600 active:bg-red-50">
                  <Icons.X /><span className="text-xs font-semibold">Cerrar sesión</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ PLACEHOLDER VIEWS for new modules ═══

function ComodatosView({ data, actions }) {
  const [modal, setModal] = useState(null);
  const empty = { clienteId: "", negocio: "", direccion: "", contacto: "", congeladorModelo: "", capacidad: "60", stockMaximo: "60", frecuencia: "Diario" };
  const [form, setForm] = useState(empty);
  const comodatos = data.comodatos || [];
  const clientesActivos = (data.clientes || []).filter(c => c.estatus === 'Activo');

  const save = async () => {
    if (!form.clienteId || !form.negocio.trim()) return;
    if (modal === 'new') {
      await actions.addComodato({ ...form, clienteId: Number(form.clienteId), capacidad: parseInt(form.capacidad), stockMaximo: parseInt(form.stockMaximo), stockActual: 0 });
    } else {
      await actions.updateComodato(modal.id, { ...form, clienteId: Number(form.clienteId), capacidad: parseInt(form.capacidad), stockMaximo: parseInt(form.stockMaximo) });
    }
    setModal(null); setForm(empty);
  };

  const openEdit = (c) => {
    setForm({
      clienteId: String(c.clienteId || c.cliente_id || ''),
      negocio: c.negocio || '',
      direccion: c.direccion || '',
      contacto: c.contacto || '',
      congeladorModelo: c.congeladorModelo || c.congelador_modelo || '',
      capacidad: String(c.capacidad || 60),
      stockMaximo: String(c.stockMaximo || c.stock_maximo || 60),
      frecuencia: c.frecuencia || 'Diario',
    });
    setModal(c);
  };

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Comodatos</h2><p className="text-xs text-slate-400">Congeladores en negocios. El chofer repone y cobra.</p></div>
      <button onClick={() => { setForm(empty); setModal('new'); }} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl min-h-[44px]">+ Nuevo</button>
    </div>
    {comodatos.length > 0 ? comodatos.map(c => (
      <div key={c.id} className="bg-white rounded-xl p-4 border border-slate-100">
        {(() => {
          const cliente = (data.clientes || []).find(cli => String(cli.id) === String(c.clienteId || c.cliente_id));
          return (
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-bold text-slate-800">{c.negocio}</p>
            <p className="text-xs text-slate-500 font-semibold">Cliente: {cliente?.nombre || 'Sin cliente'}</p>
            <p className="text-xs text-slate-400">{c.direccion} · {c.contacto}</p>
          </div>
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${c.estatus === "Activo" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.estatus}</span>
        </div>
          );
        })()}
        <div className="flex gap-2 mt-2 flex-wrap">
          {c.congeladorModelo && <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-1 rounded-lg">{c.congeladorModelo}</span>}
          <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-1 rounded-lg">Cap: {c.capacidad}</span>
          <span className="text-xs bg-amber-50 text-amber-700 font-semibold px-2 py-1 rounded-lg">Stock: {c.stockActual || 0}</span>
          <span className="text-xs bg-purple-50 text-purple-700 font-semibold px-2 py-1 rounded-lg">{c.frecuencia}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          <button onClick={() => openEdit(c)} className="px-3 py-2 bg-blue-50 text-blue-700 text-xs font-bold rounded-xl border border-blue-200">✏️ Editar</button>
          <button onClick={async () => {
            if (window.confirm(`¿${c.estatus === 'Activo' ? 'Desactivar' : 'Activar'} comodato "${c.negocio}"?`)) {
              await actions.updateComodato(c.id, { estatus: c.estatus === 'Activo' ? 'Inactivo' : 'Activo' });
            }
          }} className="px-3 py-2 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-200">
            {c.estatus === 'Activo' ? '🗑 Desactivar' : '✅ Activar'}
          </button>
          <button onClick={async () => {
            if (window.confirm(`¿Eliminar comodato "${c.negocio}"?`)) {
              await actions.deleteComodato(c.id);
            }
          }} className="px-3 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl border border-slate-200">Eliminar</button>
        </div>
      </div>
    )) : <p className="text-sm text-slate-400 text-center py-8">Sin comodatos. Usa + Nuevo para registrar.</p>}
    {modal && (
      <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50" onClick={() => setModal(null)}>
        <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <h3 className="font-bold text-lg text-slate-800 mb-4">{modal === 'new' ? 'Nuevo comodato' : 'Editar comodato'}</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cliente *</label>
              <select value={form.clienteId} onChange={e => setForm({...form, clienteId: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm bg-white">
                <option value="">Seleccionar cliente activo...</option>
                {clientesActivos.map(cli => <option key={cli.id} value={cli.id}>{cli.nombre}</option>)}
              </select>
            </div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Negocio *</label><input value={form.negocio} onChange={e => setForm({...form, negocio: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" placeholder="OXXO Centro" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dirección</label><input value={form.direccion} onChange={e => setForm({...form, direccion: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Teléfono contacto</label><input value={form.contacto} onChange={e => setForm({...form, contacto: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Modelo congelador</label><input value={form.congeladorModelo} onChange={e => setForm({...form, congeladorModelo: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" placeholder="Imbera VR-17" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Capacidad</label><input type="number" value={form.capacidad} onChange={e => setForm({...form, capacidad: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Stock máximo</label><input type="number" value={form.stockMaximo} onChange={e => setForm({...form, stockMaximo: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Frecuencia</label><select value={form.frecuencia} onChange={e => setForm({...form, frecuencia: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm"><option>Diario</option><option>Cada 2 días</option><option>Cada 3 días</option><option>Semanal</option></select></div>
            </div>
          </div>
          {modal !== 'new' && (
            <div className="space-y-2 mt-4">
              <button onClick={async () => {
                if (window.confirm(`¿Desactivar comodato "${form.negocio}"?`)) {
                  await actions.updateComodato(modal.id, { estatus: 'Inactivo' });
                  setModal(null);
                }
              }} className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl border border-red-200">🗑 Desactivar comodato</button>
              <button onClick={async () => {
                if (window.confirm(`¿Eliminar comodato "${form.negocio}"?`)) {
                  await actions.deleteComodato(modal.id);
                  setModal(null);
                }
              }} className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-xl border border-slate-200">Eliminar comodato</button>
            </div>
          )}
          <button onClick={save} disabled={!form.clienteId || !form.negocio.trim()} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">Guardar comodato</button>
        </div>
      </div>
    )}
  </div>);
}

function LeadsView({ data, actions }) {
  const [modal, setModal] = useState(false);
  const empty = { nombre: "", telefono: "", correo: "", mensaje: "", origen: "Landing page" };
  const [form, setForm] = useState(empty);
  const leads = data.leads || [];

  const save = async () => {
    if (!form.nombre.trim()) return;
    await actions.addLead(form);
    setModal(false); setForm(empty);
  };

  const cambiarEstatus = async (id, est) => {
    await actions.updateLead(id, { estatus: est });
  };

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Leads ({leads.length})</h2><p className="text-xs text-slate-400">Contactos de landing page y otros canales</p></div>
      <button onClick={() => { setForm(empty); setModal(true); }} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl min-h-[44px]">+ Nuevo</button>
    </div>
    {leads.length > 0 ? leads.map(l => (
      <div key={l.id} className="bg-white rounded-xl p-4 border border-slate-100">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-bold text-slate-800">{l.nombre}</p>
            <p className="text-xs text-slate-400">{l.telefono}{l.correo ? ` · ${l.correo}` : ""}</p>
          </div>
          <select value={l.estatus} onChange={e => cambiarEstatus(l.id, e.target.value)}
            className={`text-xs font-bold px-2 py-1 rounded-full border-0 cursor-pointer ${
              l.estatus === "Nuevo" ? "bg-blue-100 text-blue-700" :
              l.estatus === "Contactado" ? "bg-amber-100 text-amber-700" :
              l.estatus === "Convertido" ? "bg-emerald-100 text-emerald-700" :
              "bg-slate-100 text-slate-500"
            }`}>
            <option>Nuevo</option><option>Contactado</option><option>Convertido</option><option>Descartado</option>
          </select>
        </div>
        {l.mensaje && <p className="text-xs text-slate-500 mt-1 bg-slate-50 rounded-lg p-2">{l.mensaje}</p>}
        <p className="text-[10px] text-slate-400 mt-1">{l.origen} · {l.fecha}</p>
      </div>
    )) : <p className="text-sm text-slate-400 text-center py-8">Sin leads. Usa + Nuevo para registrar uno manual.</p>}
    {modal && (
      <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50" onClick={() => setModal(false)}>
        <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-5" onClick={e => e.stopPropagation()}>
          <h3 className="font-bold text-lg text-slate-800 mb-4">Nuevo lead</h3>
          <div className="space-y-3">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre *</label><input value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Teléfono</label><input value={form.telefono} onChange={e => setForm({...form, telefono: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Correo</label><input value={form.correo} onChange={e => setForm({...form, correo: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            </div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mensaje</label><textarea value={form.mensaje} onChange={e => setForm({...form, mensaje: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" rows={2} /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Origen</label><select value={form.origen} onChange={e => setForm({...form, origen: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm"><option>Landing page</option><option>WhatsApp</option><option>Teléfono</option><option>Referido</option><option>Redes sociales</option></select></div>
          </div>
          <button onClick={save} disabled={!form.nombre.trim()} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">Guardar lead</button>
        </div>
      </div>
    )}
  </div>);
}
