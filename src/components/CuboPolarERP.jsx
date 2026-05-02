import { useState, useCallback, useMemo, useEffect, lazy, Suspense, Component } from 'react';
import { Icons } from './ui/Icons';
import { useConfirm } from './ui/Modal';
import { useToast } from './ui/Toast';
import DashboardView from './views/DashboardView';
import BotonFirmasPendientes from './BotonFirmasPendientes';
import { logErrorToDb } from '../utils/errorLog';
import { traducirError } from '../utils/errorMessages';

// Lazy-load all module views — splits ~1MB main chunk into on-demand pieces
const ClientesView      = lazy(() => import('./views/ClientesView.jsx').then(m => ({ default: m.ClientesView })));
const ProductosView     = lazy(() => import('./views/ProductosView.jsx').then(m => ({ default: m.ProductosView })));
const PreciosView       = lazy(() => import('./views/PreciosView.jsx').then(m => ({ default: m.PreciosView })));
const ProduccionView    = lazy(() => import('./views/ProduccionView.jsx').then(m => ({ default: m.ProduccionView })));
const InventarioView    = lazy(() => import('./views/InventarioView.jsx').then(m => ({ default: m.InventarioView })));
const MermasView        = lazy(() => import('./views/MermasView.jsx').then(m => ({ default: m.MermasView })));
const OrdenesView       = lazy(() => import('./views/OrdenesView.jsx').then(m => ({ default: m.OrdenesView })));
const RutasView         = lazy(() => import('./views/RutasView.jsx').then(m => ({ default: m.RutasView })));
const FacturacionView   = lazy(() => import('./views/FacturacionView.jsx').then(m => ({ default: m.FacturacionView })));
const ConciliacionView  = lazy(() => import('./views/ConciliacionView.jsx').then(m => ({ default: m.ConciliacionView })));
const AuditoriaView     = lazy(() => import('./views/AuditoriaView.jsx').then(m => ({ default: m.AuditoriaView })));
const KardexView        = lazy(() => import('./views/KardexView.jsx').then(m => ({ default: m.KardexView })));
const ConfiguracionView = lazy(() => import('./views/ConfiguracionView.jsx').then(m => ({ default: m.ConfiguracionView })));
const AlmacenBolsasView = lazy(() => import('./views/AlmacenBolsasView.jsx').then(m => ({ default: m.AlmacenBolsasView })));
const EmpleadosView     = lazy(() => import('./views/EmpleadosView.jsx').then(m => ({ default: m.EmpleadosView })));
const NominaView        = lazy(() => import('./views/NominaView.jsx').then(m => ({ default: m.NominaView })));
const ContabilidadView  = lazy(() => import('./views/ContabilidadView.jsx').then(m => ({ default: m.ContabilidadView })));
const CobrosView        = lazy(() => import('./views/CobrosView.jsx').then(m => ({ default: m.CobrosView })));
const CostosView        = lazy(() => import('./views/CostosView.jsx').then(m => ({ default: m.CostosView })));
const CuentasPorPagarView = lazy(() => import('./views/CuentasPorPagarView.jsx').then(m => ({ default: m.CuentasPorPagarView })));
const DevolucionesView    = lazy(() => import('./views/DevolucionesView.jsx').then(m => ({ default: m.DevolucionesView })));

// Auto-reload when a lazy chunk can't load (stale deployment)
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => window.location.reload());
}

// Boundary alrededor del Suspense que renderiza la vista activa.
// - Si el error ES de chunk loading (deploy stale), auto-reload (comportamiento previo).
// - Si el error es de render (ReferenceError, etc., como CapacityBar), muestra
//   UI inline para que el chrome del admin (sidebar/topbar/drawer) se preserve y
//   el usuario pueda navegar a otra vista o reintentar.
function isChunkError(err) {
  const msg = err?.message || '';
  return msg.includes('MIME')
    || msg.includes('Failed to fetch')
    || msg.includes('dynamically imported');
}

class ChunkErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    if (isChunkError(error)) {
      // Chunk error: vamos a recargar; no hace falta marcar hasError.
      return null;
    }
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (isChunkError(error)) {
      window.location.reload();
      return;
    }
    logErrorToDb(error, info, { tipo: 'boundary', boundary: 'view', view: this.props.viewName || 'unknown' });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleCopyDetails = () => {
    const { error } = this.state;
    const text = [
      `Error: ${error?.message || 'Unknown error'}`,
      `Stack: ${error?.stack || 'No stack'}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const isDev = import.meta.env.DEV;
    const { error } = this.state;
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 sm:p-6">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-red-900">Algo salió mal en esta vista</h2>
              <p className="text-sm text-red-800 mt-1">
                Ocurrió un error al renderizar el contenido. Puedes intentar de nuevo o navegar a otra sección desde el menú.
              </p>
            </div>
          </div>
          {isDev && error && (
            <details className="mb-4 text-xs">
              <summary className="cursor-pointer text-red-700 font-semibold">Detalles técnicos (solo dev)</summary>
              <pre className="mt-2 p-3 bg-red-100 rounded text-red-900 overflow-auto max-h-60">{error.message}{'\n\n'}{error.stack}</pre>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={this.handleRetry} className="px-4 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 min-h-[44px]">
              Intentar de nuevo
            </button>
            <button onClick={this.handleReload} className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-200 min-h-[44px]">
              Recargar página
            </button>
            <button onClick={this.handleCopyDetails} className="px-4 py-2.5 bg-slate-100 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-200 min-h-[44px]">
              Copiar detalles
            </button>
          </div>
        </div>
      </div>
    );
  }
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
      { id: "mermas", label: "Mermas", icon: "AlertTriangle" },
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
      { id: "contabilidad", label: "Movimientos", icon: "Calculator" },
      { id: "cobros", label: "Por cobrar", icon: "DollarSign" },
      { id: "proveedores", label: "Por pagar", icon: "CreditCard" },
      { id: "devoluciones", label: "Devoluciones", icon: "Truck" },
      { id: "costos", label: "Costos", icon: "Receipt" },
      { id: "facturacion", label: "Facturación", icon: "FileText" },
      { id: "conciliacion", label: "Cortes", icon: "ClipboardCheck" },
      { id: "nomina", label: "Nómina", icon: "Wallet" },
    ]
  },
  { id: "equipo", label: "Equipo", icon: "Users", color: "purple",
    items: [
      { id: "empleados", label: "Empleados", icon: "UserCheck" },
      { id: "kardex", label: "Kardex", icon: "ClipboardCheck" },
      { id: "auditoria", label: "Auditoría", icon: "Shield" },
      { id: "configuracion", label: "Ajustes", icon: "Settings" },
    ]
  },
];

const ALL_ITEMS = AREAS.flatMap(a => a.items);
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
    tagline: 'Tu dinero',
    subtitle: 'lo que entra, lo que sale, lo que falta',
    chip: 'border-amber-200/80 bg-amber-100/80 text-amber-900',
    glow: 'from-amber-200/50 via-orange-200/30 to-transparent',
  },
  equipo: {
    tagline: 'Tu equipo',
    subtitle: 'personas y configuracion',
    chip: 'border-violet-200/80 bg-violet-100/80 text-violet-900',
    glow: 'from-violet-200/40 via-slate-200/30 to-transparent',
  },
};

export default function CuboPolarERP({ user, data, actions, onLogout, onViewAs }) {
  const [view, setView] = useState('dashboard');

  // Estado de áreas expandidas/colapsadas en sidebar (con persistencia)
  const [areasExpandidas, setAreasExpandidas] = useState(() => {
    try {
      const saved = localStorage.getItem('cubopolar_sidebar_areas');
      if (saved) return JSON.parse(saved);
    } catch { /* noop */ }
    // Default: Operación y Comercial abiertas, Finanzas y Equipo cerradas
    return { operacion: true, comercial: true, finanzas: false, equipo: false };
  });

  // Persistir cambios en localStorage
  useEffect(() => {
    try {
      localStorage.setItem('cubopolar_sidebar_areas', JSON.stringify(areasExpandidas));
    } catch { /* noop */ }
  }, [areasExpandidas]);

  // Si el usuario navega a un módulo dentro de un área cerrada, abrirla.
  // Solo depende de `view`: si incluyera `areasExpandidas`, contraer
  // manualmente el área del view actual la reabriría inmediatamente.
  useEffect(() => {
    const currentArea = AREAS.find(area => area.items.some(item => item.id === view));
    if (!currentArea) return;
    setAreasExpandidas(prev => prev[currentArea.id] ? prev : { ...prev, [currentArea.id]: true });
  }, [view]);

  const toggleArea = (areaId) => {
    setAreasExpandidas(prev => ({ ...prev, [areaId]: !prev[areaId] }));
  };
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [alertasOpen, setAlertasOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const notifNoLeidas = useMemo(() => (data.notificaciones || []).filter(n => !n.leida), [data.notificaciones]);
  const notifRecientes = useMemo(() => (data.notificaciones || []).slice(0, 30), [data.notificaciones]);

  const vp = useMemo(() => ({ data, actions, user }), [data, actions, user]);
  const alertasActivas = useMemo(() => {
    return (data.alertas || []).filter(a => {
      const msg = (a?.msg || a?.mensaje || a?.detalle || a?.titulo || '').toString().trim();
      const est = (a?.estatus || '').toString().toLowerCase();
      return !!msg && est !== 'resuelta' && est !== 'cerrada';
    });
  }, [data.alertas]);

  useEffect(() => {
    if (!alertasOpen && !mobileDrawerOpen && !notifOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setAlertasOpen(false);
        setMobileDrawerOpen(false);
        setNotifOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [alertasOpen, mobileDrawerOpen, notifOpen]);

  const renderView = () => {
    switch (view) {
      case 'dashboard': return <DashboardView data={data} user={user} onNavigate={go} />;
      case 'clientes': return <ClientesView {...vp} />;
      case 'productos': return <ProductosView {...vp} />;
      case 'bolsas': return <AlmacenBolsasView {...vp} />;
      case 'precios': return <PreciosView {...vp} />;
      case 'produccion': return <ProduccionView {...vp} />;
      case 'inventario': return <InventarioView {...vp} />;
      case 'mermas': return <MermasView {...vp} />;
      case 'ordenes': return <OrdenesView {...vp} />;
      case 'rutas': return <RutasView {...vp} />;
      case 'facturacion': return <FacturacionView {...vp} />;
      case 'conciliacion': return <ConciliacionView data={data} />;
      case 'auditoria': return <AuditoriaView data={data} />;
      case 'nomina': return <NominaView {...vp} />;
      case 'contabilidad': return <ContabilidadView {...vp} />;
      case 'cobros': return <CobrosView {...vp} />;
      case 'proveedores': return <CuentasPorPagarView {...vp} />;
      case 'devoluciones': return <DevolucionesView {...vp} />;
      case 'costos': return <CostosView {...vp} />;
      case 'empleados': return <EmpleadosView {...vp} />;
      case 'configuracion': return <ConfiguracionView {...vp} />;
      case 'comodatos': return <ComodatosView {...vp} />;
      case 'leads': return <LeadsView {...vp} />;
      case 'kardex': return <KardexView data={data} />;
      default: return <DashboardView data={data} />;
    }
  };

  const go = useCallback((id) => { setView(id); setMobileDrawerOpen(false); }, []);
  const current = ALL_ITEMS.find(n => n.id === view);
  const currentArea = AREAS.find(area => area.items.some(item => item.id === view)) || AREAS[0];
  const currentMeta = AREA_META[currentArea?.id] || AREA_META.operacion;

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
          {AREAS.map(area => {
            const expandida = areasExpandidas[area.id];
            return (
              <div key={area.id} className="mb-3">
                <button
                  onClick={() => toggleArea(area.id)}
                  className="mb-2 flex w-full items-center gap-2 rounded-[12px] px-3 py-1.5 transition-colors hover:bg-white/6 group"
                >
                  <span className={`h-2 w-2 rounded-full transition-colors ${expandida ? 'bg-cyan-300' : 'bg-white/28'}`} />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 group-hover:text-slate-200 flex-1 text-left">{area.label}</p>
                  <svg
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expandida ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                {expandida && (
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
                )}
              </div>
            );
          })}
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
      <header className="sticky top-0 z-30 px-3 pt-2 lg:ml-[300px] lg:px-6 lg:pt-4 xl:ml-[320px]" style={{paddingTop: "max(env(safe-area-inset-top, 0px), 0.5rem)"}}>
        <div className="erp-panel erp-shell-blur flex items-center justify-between gap-2 rounded-[22px] px-4 py-2.5 lg:rounded-[28px] lg:px-5 lg:py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden flex h-10 w-10 -ml-1 mr-1 flex-shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
              aria-label="Abrir menú"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>
            <p className="font-display truncate text-base font-bold tracking-[-0.04em] text-slate-900 lg:text-[1.55rem]">{current?.label || "Resumen"}</p>
          </div>
          <div className="relative flex flex-shrink-0 items-center gap-2">
            <BotonFirmasPendientes user={user} data={data} actions={actions} />
            <button onClick={() => { setAlertasOpen(!alertasOpen); setNotifOpen(false); }} className="relative flex h-9 w-9 items-center justify-center rounded-[14px] border border-slate-200 bg-white/80 text-slate-500 transition-colors hover:bg-white hover:text-slate-800 lg:h-11 lg:w-11 lg:rounded-[16px]" title="Ver alertas" aria-label="Ver alertas" aria-haspopup="dialog" aria-expanded={alertasOpen}>
              <Icons.Bell />{alertasActivas.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />}
            </button>
            {alertasOpen && (
              <div className="erp-panel absolute right-0 top-12 z-[70] max-h-96 w-[calc(100vw-32px)] overflow-y-auto rounded-[24px] sm:w-96 md:w-[22rem]" role="dialog" aria-modal="false" aria-label="Alertas activas">
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
            {/* Notification bell */}
            <button onClick={() => { setNotifOpen(!notifOpen); setAlertasOpen(false); }} className="relative flex h-9 w-9 items-center justify-center rounded-[14px] border border-slate-200 bg-white/80 text-slate-500 transition-colors hover:bg-white hover:text-slate-800 lg:h-11 lg:w-11 lg:rounded-[16px]" title="Notificaciones" aria-label="Notificaciones">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              {notifNoLeidas.length > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-blue-600 text-white text-[10px] font-bold rounded-full px-1">{notifNoLeidas.length > 9 ? '9+' : notifNoLeidas.length}</span>}
            </button>
            {notifOpen && (
              <div className="erp-panel absolute right-0 top-12 z-[70] max-h-[28rem] w-[calc(100vw-32px)] overflow-y-auto rounded-[24px] sm:w-96 md:w-[24rem]" role="dialog" aria-modal="false" aria-label="Notificaciones">
                <div className="border-b border-slate-200/80 px-4 py-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Notificaciones</p>
                    <p className="mt-0.5 text-xs text-slate-500">{notifNoLeidas.length > 0 ? `${notifNoLeidas.length} sin leer` : 'Al día'}</p>
                  </div>
                  {notifNoLeidas.length > 0 && <button onClick={() => actions.marcarTodasLeidas()} className="text-xs text-blue-600 font-semibold hover:text-blue-800">Marcar todas</button>}
                </div>
                {notifRecientes.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-400">Sin notificaciones</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {notifRecientes.map(nt => (
                      <div key={nt.id} className={`px-4 py-3 flex gap-3 items-start cursor-pointer hover:bg-slate-50 transition-colors ${!nt.leida ? 'bg-blue-50/50' : ''}`} onClick={() => !nt.leida && actions.marcarNotifLeida(nt.id)}>
                        <span className="text-lg flex-shrink-0 mt-0.5">{nt.icono || '🔔'}</span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm ${!nt.leida ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{nt.titulo}</p>
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{nt.mensaje}</p>
                          <p className="text-[10px] text-slate-400 mt-1">{nt.createdAt ? new Date(nt.createdAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</p>
                        </div>
                        {!nt.leida && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-2" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {notifOpen && <div className="fixed inset-0 z-[60]" onClick={() => setNotifOpen(false)} aria-hidden="true" />}
            <div className="hidden lg:flex items-center gap-2 ml-2 pl-3 border-l border-slate-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-cyan-200">{user?.nombre?.[0] || "A"}</div>
              <span className="text-sm font-semibold text-slate-700">{user?.nombre || "Admin"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ═══ DRAWER LATERAL — mobile ═══ */}
      {mobileDrawerOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/40 z-40 animate-fadeIn"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside
            className="lg:hidden fixed top-0 left-0 bottom-0 w-[85%] max-w-[320px] bg-white z-50 shadow-2xl overflow-y-auto animate-slideInLeft flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Menú principal"
          >
            {/* Header */}
            <div
              className="sticky top-0 bg-white border-b border-slate-100 px-4 pb-3 flex items-center justify-between z-10"
              style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)" }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 flex-shrink-0 rounded-xl bg-slate-900 flex items-center justify-center">
                  <img src="/icon-192.png" alt="CuboPolar" className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-900 leading-tight">CUBOPOLAR</p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">ERP Operativo</p>
                </div>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="h-9 w-9 flex-shrink-0 rounded-xl hover:bg-slate-100 flex items-center justify-center"
                aria-label="Cerrar menú"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>

            {/* Áreas con módulos */}
            <nav className="flex-1 px-3 py-3">
              {AREAS.map(area => (
                <div key={area.id} className="mb-4">
                  <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {area.label}
                  </p>
                  <div className="space-y-0.5">
                    {area.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => { setView(item.id); setMobileDrawerOpen(false); }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                          view === item.id
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100 active:bg-slate-200'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            {/* Footer: usuario + Ver como + Cerrar sesión */}
            <div
              className="border-t border-slate-100 px-3 pt-3 sticky bottom-0 bg-white"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.75rem)" }}
            >
              {user && (
                <div className="flex items-center gap-3 px-3 py-2 mb-2">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-cyan-200 to-cyan-300 text-slate-900 flex items-center justify-center text-sm font-extrabold">
                    {(user.nombre || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{user.nombre || 'Usuario'}</p>
                    <p className="text-xs text-slate-500 truncate">{user.rol || ''}</p>
                  </div>
                </div>
              )}
              {onViewAs && (
                <div className="mb-2 px-1">
                  <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Ver como…</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {["Chofer","Ventas","Producción","Almacén Bolsas"].map(r => (
                      <button
                        key={r}
                        onClick={() => { onViewAs(r); setMobileDrawerOpen(false); }}
                        className="rounded-xl border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700 active:bg-blue-100"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {onLogout && (
                <button
                  onClick={() => { onLogout(); setMobileDrawerOpen(false); }}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  Cerrar sesión
                </button>
              )}
            </div>
          </aside>
        </>
      )}

      {/* ═══ MAIN ═══ */}
      <main className="px-3 pt-4 sm:px-4 lg:ml-[300px] lg:px-6 lg:pb-6 lg:pt-6 xl:ml-[320px]">
        <div className="relative">
          <div className={`pointer-events-none absolute inset-x-8 top-0 h-16 rounded-[32px] bg-gradient-to-r ${currentMeta.glow} opacity-45 blur-3xl`} />
          <div className="relative"><ChunkErrorBoundary><Suspense fallback={<div className="flex h-48 items-center justify-center text-sm text-slate-400">Cargando...</div>}>{renderView()}</Suspense></ChunkErrorBoundary></div>
        </div>
      </main>

    </div>
  );
}

// ═══ PLACEHOLDER VIEWS for new modules ═══

function ComodatosView({ data, actions }) {
  const [askConfirm, ConfirmEl] = useConfirm();
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
    {ConfirmEl}
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
          <button onClick={() => askConfirm(
            c.estatus === 'Activo' ? 'Desactivar comodato' : 'Activar comodato',
            c.estatus === 'Activo'
              ? `¿Marcar comodato "${c.negocio}" como inactivo? Podrás reactivarlo después.`
              : `¿Reactivar comodato "${c.negocio}"?`,
            async () => { await actions.updateComodato(c.id, { estatus: c.estatus === 'Activo' ? 'Inactivo' : 'Activo' }); },
            c.estatus === 'Activo'
          )} className="px-3 py-2 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-200">
            {c.estatus === 'Activo' ? '🗑 Desactivar' : '✅ Activar'}
          </button>
          <button onClick={() => askConfirm(
            'Eliminar comodato',
            `¿Eliminar comodato "${c.negocio}"? Esta acción no se puede deshacer.`,
            async () => { await actions.deleteComodato(c.id); },
            true
          )} className="px-3 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl border border-slate-200">Eliminar</button>
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
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Capacidad</label><input type="number" min="0" value={form.capacidad} onChange={e => setForm({...form, capacidad: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Stock máximo</label><input type="number" min="0" value={form.stockMaximo} onChange={e => setForm({...form, stockMaximo: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Frecuencia</label><select value={form.frecuencia} onChange={e => setForm({...form, frecuencia: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm"><option>Diario</option><option>Cada 2 días</option><option>Cada 3 días</option><option>Semanal</option></select></div>
            </div>
          </div>
          {modal !== 'new' && (
            <div className="space-y-2 mt-4">
              <button onClick={() => askConfirm(
                'Desactivar comodato',
                `¿Marcar comodato "${form.negocio}" como inactivo? Podrás reactivarlo después.`,
                async () => { await actions.updateComodato(modal.id, { estatus: 'Inactivo' }); setModal(null); },
                true
              )} className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl border border-red-200">🗑 Desactivar comodato</button>
              <button onClick={() => askConfirm(
                'Eliminar comodato',
                `¿Eliminar comodato "${form.negocio}"? Esta acción no se puede deshacer.`,
                async () => { await actions.deleteComodato(modal.id); setModal(null); },
                true
              )} className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-xl border border-slate-200">Eliminar comodato</button>
            </div>
          )}
          <button onClick={save} disabled={!form.clienteId || !form.negocio.trim()} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl text-sm mt-4 disabled:opacity-40">Guardar comodato</button>
        </div>
      </div>
    )}
  </div>);
}

function LeadsView({ data, actions }) {
  const [askConfirm, ConfirmEl] = useConfirm();
  const toast = useToast();
  const [modal, setModal] = useState(false); // false | "new" | <lead obj>
  const empty = { nombre: "", telefono: "", correo: "", mensaje: "", origen: "Landing page" };
  const [form, setForm] = useState(empty);
  const leads = data.leads || [];

  const openNew = () => { setForm(empty); setModal("new"); };

  const openEdit = (l) => {
    setForm({
      nombre: l.nombre || "",
      telefono: l.telefono || "",
      correo: l.correo || "",
      mensaje: l.mensaje || "",
      origen: l.origen || "Landing page",
    });
    setModal(l);
  };

  const save = async () => {
    if (!form.nombre.trim()) return;
    let err;
    if (modal === "new") {
      err = await actions.addLead(form);
    } else {
      err = await actions.updateLead(modal.id, form);
    }
    if (err && (err.error || err.message || err.code)) {
      toast?.error(traducirError(err, modal === "new" ? "No se pudo crear el lead" : "No se pudo actualizar el lead"));
      return;
    }
    toast?.success(modal === "new" ? "Lead registrado" : "Lead actualizado");
    setModal(false); setForm(empty);
  };

  const cambiarEstatus = async (id, est) => {
    await actions.updateLead(id, { estatus: est });
  };

  const eliminarLead = (l) => {
    askConfirm(
      'Eliminar lead',
      `¿Eliminar a "${l.nombre}" permanentemente?`,
      async () => {
        const result = await actions.deleteLead(l.id);
        if (result && (result.error || result.message || result.code)) {
          toast?.error('Error: ' + (result.error || result.message || 'No se pudo eliminar'));
          return;
        }
        toast?.success('Lead eliminado');
      },
      true
    );
  };

  return (<div className="space-y-4">
    {ConfirmEl}
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Leads ({leads.length})</h2><p className="text-xs text-slate-400">Contactos de landing page y otros canales</p></div>
      <button onClick={openNew} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl min-h-[44px]">+ Nuevo</button>
    </div>
    {leads.length > 0 ? leads.map(l => (
      <div key={l.id} className="bg-white rounded-xl p-4 border border-slate-100">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">{l.nombre}</p>
            <p className="text-xs text-slate-400 truncate">{l.telefono}{l.correo ? ` · ${l.correo}` : ""}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <select value={l.estatus} onChange={e => cambiarEstatus(l.id, e.target.value)}
              className={`text-xs font-bold px-2 py-1 rounded-full border-0 cursor-pointer ${
                l.estatus === "Nuevo" ? "bg-blue-100 text-blue-700" :
                l.estatus === "Contactado" ? "bg-amber-100 text-amber-700" :
                l.estatus === "Convertido" ? "bg-emerald-100 text-emerald-700" :
                "bg-slate-100 text-slate-500"
              }`}>
              <option>Nuevo</option><option>Contactado</option><option>Convertido</option><option>Descartado</option>
            </select>
            <button onClick={() => openEdit(l)} title="Editar" aria-label="Editar lead" className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition-colors">✏️</button>
            <button onClick={() => eliminarLead(l)} title="Eliminar" aria-label="Eliminar lead" className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-colors">🗑</button>
          </div>
        </div>
        {l.mensaje && <p className="text-xs text-slate-500 mt-1 bg-slate-50 rounded-lg p-2">{l.mensaje}</p>}
        <p className="text-[10px] text-slate-400 mt-1">{l.origen} · {l.fecha}</p>
      </div>
    )) : <p className="text-sm text-slate-400 text-center py-8">Sin leads. Usa + Nuevo para registrar uno manual.</p>}
    {modal && (
      <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50" onClick={() => setModal(false)}>
        <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-5" onClick={e => e.stopPropagation()}>
          <h3 className="font-bold text-lg text-slate-800 mb-4">{modal === "new" ? "Nuevo lead" : `Editar lead — ${modal.nombre || ""}`}</h3>
          <div className="space-y-3">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre *</label><input value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Teléfono</label><input value={form.telefono} onChange={e => setForm({...form, telefono: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Correo</label><input value={form.correo} onChange={e => setForm({...form, correo: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" /></div>
            </div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mensaje</label><textarea value={form.mensaje} onChange={e => setForm({...form, mensaje: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm" rows={2} /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Origen</label><select value={form.origen} onChange={e => setForm({...form, origen: e.target.value})} className="w-full px-3 py-2.5 border rounded-xl text-sm"><option>Landing page</option><option>WhatsApp</option><option>Teléfono</option><option>Referido</option><option>Redes sociales</option></select></div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setModal(false)} className="flex-1 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl text-sm">Cancelar</button>
            <button onClick={save} disabled={!form.nombre.trim()} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl text-sm disabled:opacity-40">{modal === "new" ? "Guardar lead" : "Guardar cambios"}</button>
          </div>
        </div>
      </div>
    )}
  </div>);
}
