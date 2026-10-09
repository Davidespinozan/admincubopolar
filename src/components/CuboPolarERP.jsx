import { useState, useCallback, useMemo, useEffect, lazy, Suspense, Component } from 'react';
import { diaNegocio } from '../utils/fechas';
import { Icons } from './ui/Icons';
import { useConfirm, useBodyScrollLock } from './ui/Modal';
import { useToast } from './ui/Toast';
import DashboardView from './views/DashboardView';
import BotonFirmasPendientes from './BotonFirmasPendientes';
import BusquedaGlobal from './ui/BusquedaGlobal';
import AvisosPush from './ui/AvisosPush';
import { logErrorToDb } from '../utils/errorLog';
import { traducirError } from '../utils/errorMessages';
import { textoSaludo, subtituloRol } from '../data/saludoLogic';
import { construirBandeja, contarUrgentes } from '../data/bandejaLogic';
import { viewDesdeHash, hashDesdeView, moduloParaNotificacion } from '../data/navegacionShellLogic';
import { navParaRol, idsModulos, itemsModulos, areaDeModulo, tabDesdeModulo, moduloDesdeTab, areasExpandidasInicial, bottomNavParaRol, MODULO_BOLSAS, MODULO_CHOFER,
  MODULO_ASISTENCIA, MODULO_MI_ASISTENCIA, MODULO_CALENDARIO, MODULO_MIS_ACTIVIDADES, idsVistas, normalizarVista, moduloDeVista, filtroVentasDesdeVista, vistaDesdeFiltroVentas } from '../data/navRolLogic';
import { BottomNav } from './ui/Components';

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
const BandejaView         = lazy(() => import('./views/BandejaView.jsx').then(m => ({ default: m.BandejaView })));
const AsistenciaView      = lazy(() => import('./views/AsistenciaView.jsx').then(m => ({ default: m.AsistenciaView })));
const MiAsistenciaView    = lazy(() => import('./MiAsistenciaView'));
const CalendarioView      = lazy(() => import('./views/CalendarioView.jsx').then(m => ({ default: m.CalendarioView })));
// Fase B: las vistas por rol son contenido del shell compartido (lazy, como antes en App.jsx).
const ChoferView                = lazy(() => import('./ChoferView'));
const BolsasView                = lazy(() => import('./BolsasView'));
const ProduccionStandaloneView  = lazy(() => import('./ProduccionStandaloneView'));
const VentasStandaloneView      = lazy(() => import('./VentasStandaloneView'));

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
  Fase B: la navegación por rol vive en src/data/navRolLogic.js (una sola
  fuente). Admin/Facturación/Sin asignar: 4 áreas, 25 módulos (sin cambio).
  Ventas / Producción / Almacén Bolsas: sus módulos dentro del mismo shell.
  Chofer: modo enfoque (sin sidebar ni cabecera del shell).
  Mobile: drawer lateral. Desktop: sidebar agrupado por área.
*/

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
  // Áreas de los roles de campo (Fase B)
  ventas:  { tagline: 'Ventas del día', subtitle: 'cobros y órdenes', chip: 'border-emerald-200/80 bg-emerald-100/80 text-emerald-900', glow: 'from-emerald-300/40 via-teal-200/30 to-transparent' },
  planta:  { tagline: 'Producción', subtitle: 'planta y congeladores', chip: 'border-cyan-200/80 bg-cyan-100/80 text-cyan-900', glow: 'from-cyan-300/50 via-sky-200/40 to-transparent' },
  almacen: { tagline: 'Almacén', subtitle: 'empaque', chip: 'border-amber-200/80 bg-amber-100/80 text-amber-900', glow: 'from-amber-200/50 via-orange-200/30 to-transparent' },
  ruta:    { tagline: 'Ruta', subtitle: 'entregas', chip: 'border-cyan-200/80 bg-cyan-100/80 text-cyan-900', glow: 'from-cyan-300/50 via-sky-200/40 to-transparent' },
  personal: { tagline: 'Mi asistencia', subtitle: 'entrada y salida', chip: 'border-violet-200/80 bg-violet-100/80 text-violet-900', glow: 'from-violet-200/40 via-slate-200/30 to-transparent' },
};

// Fase B: `rolVista` es el rol cuya experiencia se pinta (el propio, o el de
// "Ver como" para Admin); `usuarioRol` es el usuario con id/auth_id resueltos
// que reciben las vistas por rol (igual que antes en App.jsx). La
// autorización no cambia: `actions` sigue corriendo con el rol real.
// `offsetSuperior` (px): alto de las barras fijas de App (vista previa / sin
// conexión) para que el aside fijo, la cabecera pegajosa y el drawer no queden tapados.
export default function CuboPolarERP({ user, usuarioRol, rolVista, data, actions, onLogout, onViewAs, offsetSuperior = 0 }) {
  const topFijo = { top: offsetSuperior ? `${offsetSuperior}px` : 0 };
  const rol = rolVista || user?.rol;
  const nav = useMemo(() => navParaRol(rol), [rol]);
  const IDS_MODULOS = useMemo(() => idsModulos(nav), [nav]);
  const ALL_ITEMS = useMemo(() => itemsModulos(nav), [nav]);
  // B3: navegación inferior en móvil, derivada del mismo modelo que el sidebar.
  const bottomNav = useMemo(() => bottomNavParaRol(nav), [nav]);
  // Tanda 25: la vista vive también en la URL (#/rutas) — deep links
  // compartibles y botón atrás del navegador. Hash inválido → módulo inicial del rol.
  // B3.6: además de los módulos del menú, un rol puede tener vistas internas
  // con hash propio (filtros de Ventas) y alias heredados (#/ventas-cobrar).
  const IDS_VISTAS = useMemo(() => idsVistas(nav), [nav]);
  const vistaDeHash = useCallback((hash) => normalizarVista(nav, viewDesdeHash(hash, IDS_VISTAS)), [nav, IDS_VISTAS]);
  const [view, setView] = useState(() => vistaDeHash(window.location.hash) || nav.inicio);
  // Al cambiar el rol pintado ("Ver como"), el hash anterior puede no existir en el menú nuevo.
  useEffect(() => {
    setView(v => normalizarVista(nav, v) || vistaDeHash(window.location.hash) || nav.inicio);
  }, [nav, vistaDeHash]);

  // vista → hash. El primer sync (sin hash previo) y la normalización de un
  // alias (#/ventas-cobrar → #/ventas) usan replaceState: no agregan un paso
  // extra al historial.
  useEffect(() => {
    const destino = hashDesdeView(view);
    if (window.location.hash === destino) return;
    if (!window.location.hash || vistaDeHash(window.location.hash) === view) {
      window.history.replaceState(null, '', destino);
    } else {
      window.location.hash = destino;
    }
  }, [view, vistaDeHash]);

  // hash → vista (botón atrás/adelante, o alguien pega un link).
  useEffect(() => {
    const onHashChange = () => {
      setView(vistaDeHash(window.location.hash) || nav.inicio);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [vistaDeHash, nav.inicio]);

  // Estado de áreas expandidas/colapsadas en sidebar (con persistencia para
  // el shell de Admin; los roles de campo ven su única área abierta).
  const leerAreasGuardadas = (navActual) => {
    if (navActual.persistirAreas) {
      try {
        const saved = localStorage.getItem('cubopolar_sidebar_areas');
        if (saved) return JSON.parse(saved);
      } catch { /* noop */ }
    }
    // Default: Operación y Comercial abiertas, Finanzas y Equipo cerradas
    return areasExpandidasInicial(navActual);
  };
  const [areasExpandidas, setAreasExpandidas] = useState(() => leerAreasGuardadas(nav));
  useEffect(() => { setAreasExpandidas(leerAreasGuardadas(nav)); }, [nav]);

  // Persistir cambios en localStorage
  useEffect(() => {
    if (!nav.persistirAreas) return;
    try {
      localStorage.setItem('cubopolar_sidebar_areas', JSON.stringify(areasExpandidas));
    } catch { /* noop */ }
  }, [areasExpandidas, nav.persistirAreas]);

  // Si el usuario navega a un módulo dentro de un área cerrada, abrirla.
  // Solo depende de `view`: si incluyera `areasExpandidas`, contraer
  // manualmente el área del view actual la reabriría inmediatamente.
  useEffect(() => {
    const currentArea = areaDeModulo(nav, moduloDeVista(nav, view));
    if (!currentArea) return;
    setAreasExpandidas(prev => prev[currentArea.id] ? prev : { ...prev, [currentArea.id]: true });
  }, [view, nav]);

  const toggleArea = (areaId) => {
    setAreasExpandidas(prev => ({ ...prev, [areaId]: !prev[areaId] }));
  };
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Mobile-first: "Mi asistencia" y "Mis actividades" viven en el menú (sección
  // "Mi espacio"), no en la cabecera. El rol Empleado ya los tiene como módulos.
  const miEspacio = useMemo(() => [
    nav.chrome.miAsistencia && MODULO_MI_ASISTENCIA,
    nav.chrome.misActividades && MODULO_MIS_ACTIVIDADES,
  ].filter(Boolean), [nav]);
  const [avisosOpen, setAvisosOpen] = useState(false);
  const notifNoLeidas = useMemo(() => (data.notificaciones || []).filter(n => !n.leida), [data.notificaciones]);
  const notifRecientes = useMemo(() => (data.notificaciones || []).slice(0, 30), [data.notificaciones]);

  const vp = useMemo(() => ({ data, actions, user }), [data, actions, user]);

  // Tanda 24: badge de "Mi bandeja" en el menú — solo cuenta urgentes
  // (prioridad alta) para que el número signifique "atiende ahora".
  const urgentesBandeja = useMemo(
    () => contarUrgentes(construirBandeja(data, diaNegocio())),
    [data]
  );
  const alertasActivas = useMemo(() => {
    return (data.alertas || []).filter(a => {
      const msg = (a?.msg || a?.mensaje || a?.detalle || a?.titulo || '').toString().trim();
      const est = (a?.estatus || '').toString().toLowerCase();
      return !!msg && est !== 'resuelta' && est !== 'cerrada';
    });
  }, [data.alertas]);

  useEffect(() => {
    if (!avisosOpen && !mobileDrawerOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setAvisosOpen(false);
        setMobileDrawerOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [avisosOpen, mobileDrawerOpen]);

  const renderView = () => {
    switch (view) {
      case 'dashboard': return <DashboardView data={data} user={user} actions={actions} onNavigate={go} />;
      case 'bandeja': return <BandejaView data={data} user={user} onNavigate={go} />;
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
      case 'conciliacion': return <ConciliacionView {...vp} />;
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
      case MODULO_ASISTENCIA.id: return <AsistenciaView {...vp} />;
      case MODULO_MI_ASISTENCIA.id: return <MiAsistenciaView actions={actions} />;
      case MODULO_CALENDARIO.id: return <CalendarioView {...vp} />;
      case MODULO_MIS_ACTIVIDADES.id: return <CalendarioView {...vp} personal />;
      // Fase B: vistas por rol como contenido del shell (misma lógica, misma autorización).
      // B3.6: un solo módulo Ventas; el filtro interno sale del hash (ventas / ventas-hoy / ventas-todas).
      case 'ventas': case 'ventas-hoy': case 'ventas-todas':
        return <VentasStandaloneView embedded filtro={filtroVentasDesdeVista(view)} onFiltro={f => go(vistaDesdeFiltroVentas(f))} user={usuarioRol || user} data={data} actions={actions} onLogout={onLogout} />;
      case 'prod-producir': case 'prod-cuartos': case 'prod-mermas': case 'prod-preparar':
        return <ProduccionStandaloneView embedded tab={tabDesdeModulo(view)} onTab={t => go(moduloDesdeTab('Producción', t))} user={usuarioRol || user} data={data} actions={actions} onLogout={onLogout} />;
      case MODULO_BOLSAS.id:
        return <BolsasView embedded user={usuarioRol || user} data={data} actions={actions} onLogout={onLogout} />;
      default: return IDS_MODULOS.has('dashboard') ? <DashboardView data={data} actions={actions} /> : null;
    }
  };

  const go = useCallback((id) => { const v = normalizarVista(nav, id); if (v) setView(v); setMobileDrawerOpen(false); }, [nav]);
  // B3.6: el módulo del menú dueño de la vista (filtro interno → su módulo).
  const modulo = moduloDeVista(nav, view) || view;
  const current = ALL_ITEMS.find(n => n.id === modulo) || [MODULO_MI_ASISTENCIA, MODULO_MIS_ACTIVIDADES].find(n => n.id === modulo);
  const currentArea = areaDeModulo(nav, modulo) || nav.areas[0];
  const currentMeta = AREA_META[currentArea?.id] || AREA_META.operacion;

  // Modo enfoque (Chofer): sin sidebar ni cabecera del shell; la vista trae
  // su propio chrome mínimo y la identidad del producto (RoleHeader).
  if (nav.modo === 'enfoque') {
    return (
      <div className="min-h-dvh text-slate-900" data-testid="dashboard-shell" data-rol={user?.rol || ''} data-modo="enfoque">
        <ChunkErrorBoundary viewName={MODULO_CHOFER.id}>
          <Suspense fallback={<div className="flex h-48 items-center justify-center text-sm text-slate-400">Cargando...</div>}>
            {view === MODULO_MI_ASISTENCIA.id
              ? <div className="mx-auto max-w-lg px-4 py-4"><MiAsistenciaView actions={actions} onVolver={() => go(MODULO_CHOFER.id)} /></div>
              : view === MODULO_MIS_ACTIVIDADES.id
              ? <div className="mx-auto max-w-2xl px-4 py-4"><CalendarioView {...vp} personal onVolver={() => go(MODULO_CHOFER.id)} /></div>
              : <ChoferView user={usuarioRol || user} data={data} actions={actions} onLogout={onLogout} onMiAsistencia={() => go(MODULO_MI_ASISTENCIA.id)} onMisActividades={() => go(MODULO_MIS_ACTIVIDADES.id)} />}
          </Suspense>
        </ChunkErrorBoundary>
      </div>
    );
  }

  return (
    <div className="min-h-dvh text-slate-900" data-testid="dashboard-shell" data-rol={user?.rol || ''} data-rol-vista={rol || ''}>
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className={`absolute left-[-10%] top-[-8%] h-[24rem] w-[24rem] rounded-full bg-gradient-to-br ${currentMeta.glow} blur-3xl`} />
        <div className="absolute bottom-[-10%] right-[-6%] h-[22rem] w-[22rem] rounded-full bg-gradient-to-br from-slate-200/60 via-white/20 to-transparent blur-3xl" />
      </div>

      {/* ═══ SIDEBAR — desktop ═══ */}
      <aside className="fixed left-0 top-0 z-40 hidden w-[300px] flex-col overflow-hidden border-r border-blue-200/60 bg-gradient-to-b from-blue-950 via-slate-900 to-slate-900 text-slate-100 shadow-[0_20px_50px_rgba(8,20,27,0.18)] lg:flex xl:w-[320px]" style={{ ...topFijo, height: offsetSuperior ? `calc(100% - ${offsetSuperior}px)` : "100%" }}>
        <div className="flex-shrink-0 border-b border-white/10 px-6 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/10 bg-white/10 shadow-[0_18px_32px_rgba(2,10,15,0.28)]">
              <img src="/icon-192.png" alt="CuboPolar" className="h-8 w-8" />
            </div>
            <div>
              <span className="font-display text-lg font-bold tracking-[-0.05em] text-white">CUBOPOLAR</span>
              <span className="block text-[11px] uppercase tracking-[0.22em] text-slate-400">ERP operativo</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-4">
          {nav.areas.map(area => {
            const expandida = areasExpandidas[area.id];
            return (
              <div key={area.id} className="mb-3">
                <button
                  onClick={() => toggleArea(area.id)}
                  className="mb-2 flex w-full items-center gap-2 rounded-[12px] px-3 py-1.5 transition-colors hover:bg-white/5 group"
                >
                  <span className={`h-2 w-2 rounded-full transition-colors ${expandida ? 'bg-cyan-300' : 'bg-white/30'}`} />
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
                      const active = modulo === item.id;
                      return (
                        <button key={item.id} onClick={() => go(item.id)}
                          className={`w-full rounded-[18px] px-3 py-2.5 text-left text-sm transition-all ${active ? 'bg-blue-50 text-blue-900 shadow-[0_16px_28px_rgba(2,10,15,0.16)]' : 'text-slate-300/80 hover:bg-white/5 hover:text-white'}`}>
                          <span className="flex items-center gap-3">
                            <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[14px] ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-300'}`}><Ic /></span>
                          <span className="truncate flex-1">{item.label}</span>
                          {item.id === 'bandeja' && urgentesBandeja > 0 && (
                            <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">{urgentesBandeja}</span>
                          )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {miEspacio.length > 0 && (
            <div className="mb-3">
              <p className="mb-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Mi espacio</p>
              <div className="space-y-1">
                {miEspacio.map(item => {
                  const Ic = Icons[item.icon] || Icons.Package;
                  const active = view === item.id;
                  return (
                    <button key={item.id} onClick={() => go(item.id)}
                      className={`w-full rounded-[18px] px-3 py-2.5 text-left text-sm transition-all ${active ? 'bg-blue-50 text-blue-900 shadow-[0_16px_28px_rgba(2,10,15,0.16)]' : 'text-slate-300/80 hover:bg-white/5 hover:text-white'}`}>
                      <span className="flex items-center gap-3">
                        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[14px] ${active ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-300'}`}><Ic /></span>
                        <span className="truncate flex-1">{item.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        {onViewAs && nav.chrome.verComo && (
          <div className="flex-shrink-0 border-t border-white/10 px-4 py-4">
            <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Ver como...</p>
            <div className="grid grid-cols-2 gap-1">
              {["Chofer","Ventas","Producción","Almacén Bolsas"].map(r => (
                <button key={r} onClick={()=>onViewAs(r)} className="rounded-[14px] border border-white/10 bg-white/5 px-2 py-2 text-[11px] font-semibold text-white transition-all hover:bg-white/10">{r}</button>
              ))}
            </div>
          </div>
        )}
        <div className="flex h-[76px] flex-shrink-0 items-center justify-between border-t border-white/10 px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-cyan-200 text-sm font-bold text-slate-950">{user?.nombre?.[0] || "A"}</div>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{user?.nombre || "Admin"}</p><p className="truncate text-xs text-slate-400" data-testid="role-badge">{user?.rol}</p></div>
          </div>
          {onLogout && <button onClick={onLogout} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white" title="Cerrar sesión" aria-label="Cerrar sesión"><Icons.X /></button>}
        </div>
      </aside>

      {/* ═══ TOPBAR ═══
          Mobile-first (2026-10-09): menú, título completo y, a la derecha, solo
          búsqueda (back office), firmas cuando hay pendientes y UNA campana
          "Avisos" que junta alertas y notificaciones. */}
      <header className={`sticky px-3 pt-2 lg:ml-[300px] lg:px-6 lg:pt-4 xl:ml-[320px] ${avisosOpen ? 'z-[80]' : 'z-30'}`} style={{ ...topFijo, paddingTop: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}>
        <div className="erp-panel erp-shell-blur flex items-center justify-between gap-2 rounded-[22px] px-3 py-2 lg:rounded-[28px] lg:px-5 lg:py-3.5" data-testid="topbar">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
              aria-label="Abrir menú"
            >
              <Icons.Menu />
            </button>
            <p className="font-display min-w-0 flex-1 truncate text-[1.05rem] font-bold tracking-[-0.03em] text-slate-900 lg:text-[1.55rem]" data-testid="topbar-titulo">{current?.label || "Resumen"}</p>
          </div>
          <div className="relative flex flex-shrink-0 items-center gap-1.5">
            {nav.chrome.busqueda && <BusquedaGlobal data={data} onNavigate={go} />}
            {nav.chrome.firmas && <BotonFirmasPendientes user={usuarioRol || user} data={data} actions={actions} />}
            {(nav.chrome.alertas || nav.chrome.notificaciones) && (
              <button onClick={() => setAvisosOpen(v => !v)}
                className="relative flex h-10 w-10 items-center justify-center rounded-[14px] border border-slate-200 bg-white text-slate-600 transition-colors hover:text-slate-900 lg:h-11 lg:w-11 lg:rounded-[16px]"
                title="Avisos" aria-label="Avisos" aria-haspopup="dialog" aria-expanded={avisosOpen} data-testid="boton-avisos">
                <Icons.Bell />
                {(alertasActivas.length + notifNoLeidas.length) > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {(alertasActivas.length + notifNoLeidas.length) > 9 ? '9+' : alertasActivas.length + notifNoLeidas.length}
                  </span>
                )}
              </button>
            )}
            {avisosOpen && (
              <>
                <div className="fixed inset-0 z-[60] bg-slate-950/20" onClick={() => setAvisosOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-12 z-[70] max-h-[75vh] w-[calc(100vw-24px)] overflow-y-auto rounded-[22px] border border-slate-200 bg-white shadow-[0_24px_60px_rgba(3,14,19,0.22)] sm:w-96" role="dialog" aria-modal="false" aria-label="Avisos" data-testid="panel-avisos">
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
                    <p className="text-sm font-bold text-slate-900">Avisos</p>
                    {nav.chrome.notificaciones && notifNoLeidas.length > 0 && <button onClick={() => actions.marcarTodasLeidas()} className="text-xs font-semibold text-blue-600">Marcar leídas</button>}
                  </div>
                  {nav.chrome.alertas && alertasActivas.length > 0 && (
                    <div className="border-b border-slate-100 p-3">
                      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Alertas</p>
                      <div className="space-y-2">
                        {alertasActivas.map((a, i) => (
                          <div key={i} className="flex gap-3 rounded-[16px] bg-amber-50 px-3 py-2.5 text-amber-900">
                            <span className="mt-0.5 flex-shrink-0"><Icons.AlertTriangle /></span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{a.titulo || 'Alerta'}</p>
                              <p className="text-xs leading-5 opacity-80">{a.msg || a.mensaje || a.detalle}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {nav.chrome.notificaciones && (
                    <>
                      <AvisosPush />
                      {notifRecientes.length === 0 ? (
                        <div className="p-5 text-center text-sm text-slate-400">Sin notificaciones</div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {notifRecientes.map(nt => (
                            <button key={nt.id} type="button" className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${!nt.leida ? 'bg-blue-50/60' : ''}`} onClick={() => {
                              // Tanda 25: la notificación navega al módulo donde se atiende.
                              if (!nt.leida) actions.marcarNotifLeida(nt.id);
                              const destino = moduloParaNotificacion(nt);
                              if (destino) { go(destino); setAvisosOpen(false); }
                            }}>
                              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Icons.Bell /></span>
                              <span className="min-w-0 flex-1">
                                <span className={`block text-sm ${!nt.leida ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{nt.titulo}</span>
                                <span className="mt-0.5 block text-xs text-slate-500 line-clamp-2">{nt.mensaje}</span>
                                <span className="mt-1 block text-[10px] text-slate-400">{nt.createdAt ? new Date(nt.createdAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                              </span>
                              {!nt.leida && <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
            <div className="hidden lg:flex items-center gap-2 ml-2 pl-3 border-l border-slate-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-cyan-200">{user?.nombre?.[0] || "A"}</div>
              <span className="text-sm font-semibold text-slate-700">{user?.nombre || "Admin"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ═══ DRAWER LATERAL — mobile ═══
          Mobile-first (2026-10-09): mismo fondo oscuro que la barra inferior y
          el sidebar de escritorio, con íconos y la sección "Mi espacio". */}
      {mobileDrawerOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-slate-950/50 z-40 animate-fadeIn"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside
            // Tanda 16 P0: overscroll-contain previene que el scroll
            // del drawer se propague al body en iOS Safari.
            className="lg:hidden fixed left-0 bottom-0 w-[86%] max-w-[330px] bg-gradient-to-b from-blue-950 via-slate-900 to-slate-900 text-slate-100 z-50 shadow-2xl overflow-y-auto overscroll-contain animate-slideInLeft flex flex-col" style={topFijo}
            role="dialog"
            aria-modal="true"
            aria-label="Menú principal"
            data-testid="drawer-movil"
          >
            <div
              className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-blue-950/95 px-4 pb-3 backdrop-blur"
              style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)" }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-10 w-10 flex-shrink-0 rounded-[14px] border border-white/10 bg-white/10 flex items-center justify-center">
                  <img src="/icon-192.png" alt="CuboPolar" className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-base font-bold leading-tight tracking-[-0.04em] text-white">CUBOPOLAR</p>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">ERP operativo</p>
                </div>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="h-10 w-10 flex-shrink-0 rounded-xl text-slate-300 hover:bg-white/10 flex items-center justify-center"
                aria-label="Cerrar menú"
              >
                <Icons.X />
              </button>
            </div>

            <nav className="flex-1 px-3 py-3">
              {[...nav.areas, ...(miEspacio.length ? [{ id: 'mi-espacio', label: 'Mi espacio', items: miEspacio }] : [])].map(area => (
                <div key={area.id} className="mb-4">
                  <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    {area.label}
                  </p>
                  <div className="space-y-1">
                    {area.items.map(item => {
                      const Ic = Icons[item.icon] || Icons.Package;
                      const activo = (area.id === 'mi-espacio' ? view : modulo) === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => go(item.id)}
                          className={`w-full rounded-[16px] px-2.5 py-2 text-left text-[15px] font-semibold transition-colors ${
                            activo ? 'bg-blue-50 text-blue-900' : 'text-slate-200 hover:bg-white/5 active:bg-white/10'
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px] ${activo ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-300'}`}><Ic /></span>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.id === 'bandeja' && urgentesBandeja > 0 && (
                              <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">{urgentesBandeja}</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            <div
              className="sticky bottom-0 border-t border-white/10 bg-slate-900/95 px-3 pt-3 backdrop-blur"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.75rem)" }}
            >
              {user && (
                <div className="flex items-center gap-3 px-2 py-2 mb-2">
                  <div className="h-10 w-10 flex-shrink-0 rounded-full bg-cyan-200 text-slate-950 flex items-center justify-center text-sm font-extrabold">
                    {(user.nombre || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{user.nombre || 'Usuario'}</p>
                    <p className="text-xs text-slate-400 truncate">{user.rol || ''}</p>
                  </div>
                </div>
              )}
              {onViewAs && nav.chrome.verComo && (
                <div className="mb-2 px-1">
                  <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Ver como…</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {["Chofer","Ventas","Producción","Almacén Bolsas"].map(r => (
                      <button
                        key={r}
                        onClick={() => { onViewAs(r); setMobileDrawerOpen(false); }}
                        className="rounded-[12px] border border-white/10 bg-white/5 px-2 py-2 text-xs font-semibold text-white active:bg-white/10"
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
                  className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-sm font-semibold text-red-300 hover:bg-white/5"
                >
                  <Icons.LogOut /> Cerrar sesión
                </button>
              )}
            </div>
          </aside>
        </>
      )}

      {/* ═══ MAIN ═══ */}
      <main className={`px-3 pt-4 sm:px-4 lg:ml-[300px] lg:px-6 lg:pb-6 lg:pt-6 xl:ml-[320px] ${bottomNav ? "pb-[calc(env(safe-area-inset-bottom,0px)+88px)]" : ""}`} data-bottom-nav={bottomNav ? 'si' : 'no'}>
        <div className="relative">
          <div className={`pointer-events-none absolute inset-x-8 top-0 h-16 rounded-[32px] bg-gradient-to-r ${currentMeta.glow} opacity-45 blur-3xl`} />
          {/* Bienvenida en la pantalla de inicio de cada rol (el Resumen de Admin trae la suya). */}
          {view === nav.inicio && view !== 'dashboard' && (
            <div className="relative mb-3 px-1" data-testid="saludo-rol">
              <p className="font-display text-[1.45rem] font-bold leading-tight tracking-[-0.03em] text-slate-900">{textoSaludo((usuarioRol || user)?.nombre)}</p>
              <p className="mt-0.5 text-sm text-slate-500">{subtituloRol(rol)}</p>
            </div>
          )}
          <div className="relative"><ChunkErrorBoundary><Suspense fallback={<div className="flex h-48 items-center justify-center text-sm text-slate-400">Cargando...</div>}>{renderView()}</Suspense></ChunkErrorBoundary></div>
        </div>
      </main>

      {/* B3: navegación inferior (móvil); en lg+ la oculta el CSS y manda el sidebar. */}
      {bottomNav && (
        <BottomNav items={bottomNav.items} value={modulo} onChange={go} mas={bottomNav.mas}
          masActivo={bottomNav.mas && !bottomNav.items.some(i => i.id === modulo)} onMas={() => setMobileDrawerOpen(true)} />
      )}
    </div>
  );
}

// ═══ PLACEHOLDER VIEWS for new modules ═══

function ComodatosView({ data, actions }) {
  const [askConfirm, ConfirmEl] = useConfirm();
  const [modal, setModal] = useState(null);
  // Tanda 17 P1: body scroll lock cuando modal de comodato está abierto.
  useBodyScrollLock(modal !== null);
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
          <button onClick={() => openEdit(c)} className="inline-flex min-h-[40px] items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-700 text-xs font-bold rounded-xl border border-blue-200"><Icons.Edit /> Editar</button>
          <button onClick={() => askConfirm(
            c.estatus === 'Activo' ? 'Desactivar comodato' : 'Activar comodato',
            c.estatus === 'Activo'
              ? `¿Marcar comodato "${c.negocio}" como inactivo? Podrás reactivarlo después.`
              : `¿Reactivar comodato "${c.negocio}"?`,
            async () => { await actions.updateComodato(c.id, { estatus: c.estatus === 'Activo' ? 'Inactivo' : 'Activo' }); },
            c.estatus === 'Activo'
          )} className="inline-flex min-h-[40px] items-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-200">
            {c.estatus === 'Activo' ? <><Icons.Ban /> Desactivar</> : <><Icons.CheckCircle /> Activar</>}
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
              )} className="flex w-full items-center justify-center gap-1.5 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl border border-red-200"><Icons.Ban /> Desactivar comodato</button>
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
  // Tanda 17 P1: body scroll lock cuando modal de lead está abierto.
  useBodyScrollLock(!!modal);
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
            <button onClick={() => openEdit(l)} title="Editar" aria-label="Editar lead" className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition-colors"><Icons.Edit /></button>
            <button onClick={() => eliminarLead(l)} title="Eliminar" aria-label="Eliminar lead" className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-colors"><Icons.Trash /></button>
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
