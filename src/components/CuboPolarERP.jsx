import { useState, useCallback, useMemo, useEffect, lazy, Suspense, Component } from 'react';
import { diaNegocio } from '../utils/fechas';
import { alertasVisibles, claveAlerta, destinoAlerta, tituloAlerta, leerOcultas, guardarOcultas } from '../data/avisosLogic';
import { Icons } from './ui/Icons';
import Modal, { useConfirm, FormInput, FormSelect, FormTextarea, FormBtn } from './ui/Modal';
import { useToast } from './ui/Toast';
import DashboardView from './views/DashboardView';
import BotonFirmasPendientes from './BotonFirmasPendientes';
import BusquedaGlobal from './ui/BusquedaGlobal';
import AvisosPush from './ui/AvisosPush';
import { logErrorToDb } from '../utils/errorLog';
import { traducirError } from '../utils/errorMessages';
import { etiquetaRol } from '../data/usuariosLogic';
import RecordatorioAsistencia from './RecordatorioAsistencia';
import { construirBandejaUsuario, contarUrgentes } from '../data/bandejaLogic';
import { viewDesdeHash, hashDesdeView, moduloParaNotificacion } from '../data/navegacionShellLogic';
import { navParaRol, navParaUsuario, MODULO_MI_CUENTA, MODULO_USUARIOS, idsModulos, itemsModulos, areaDeModulo, tabDesdeModulo, moduloDesdeTab, areasExpandidasInicial, bottomNavParaRol, MODULO_BOLSAS, MODULO_CHOFER,
  MODULO_ASISTENCIA, MODULO_MI_ASISTENCIA, MODULO_CALENDARIO, MODULO_MIS_ACTIVIDADES, idsVistas, normalizarVista, moduloDeVista, filtroVentasDesdeVista, vistaDesdeFiltroVentas } from '../data/navRolLogic';
import { BottomNav, PageHeader, Card, ListRow, IconButton, StatusBadge, Chips } from './ui/Components';
import { ViewSkeleton, EmptyState } from './ui/Skeleton';

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
// GER-1 (mig 120): panel del dueño y "Mi cuenta" (contraseña propia).
const UsuariosView        = lazy(() => import('./views/UsuariosView.jsx').then(m => ({ default: m.UsuariosView })));
// Resumen de los roles de campo (el back office conserva su Dashboard).
const ResumenRolView      = lazy(() => import('./views/ResumenRolView.jsx').then(m => ({ default: m.ResumenRolView })));
const MiCuentaView        = lazy(() => import('./CambiarPassword.jsx').then(m => ({ default: m.MiCuentaView })));
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


// Fase B: `rolVista` es el rol cuya experiencia se pinta (el propio, o el de
// "Ver como" para Admin); `usuarioRol` es el usuario con id/auth_id resueltos
// que reciben las vistas por rol (igual que antes en App.jsx). La
// autorización no cambia: `actions` sigue corriendo con el rol real.
// `offsetSuperior` (px): alto de las barras fijas de App (vista previa / sin
// conexión) para que el aside fijo, la cabecera pegajosa y el drawer no queden tapados.
export default function CuboPolarERP({ user, usuarioRol, rolVista, data, actions, onLogout, onViewAs, offsetSuperior = 0 }) {
  const topFijo = { top: offsetSuperior ? `${offsetSuperior}px` : 0 };
  const rol = rolVista || user?.rol;
  // GER-1: el menú es de la PERSONA (rol principal + accesos adicionales + panel
  // del dueño). En "Ver como" (rolVista distinto del rol propio) se muestra el
  // menú puro de ese rol. App siempre manda rolVista (el propio o el elegido).
  const viendoComo = !!rolVista && rolVista !== user?.rol;
  const nav = useMemo(() => (viendoComo ? navParaRol(rolVista) : navParaUsuario(user)), [viendoComo, rolVista, user]);
  const IDS_MODULOS = useMemo(() => idsModulos(nav), [nav]);
  // Back office = el menú incluye las Ventas de Admin (Admin, Facturación, Sin asignar).
  const esBackOffice = IDS_MODULOS.has('ordenes');
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
    MODULO_MI_CUENTA,
  ].filter(Boolean), [nav]);
  const [avisosOpen, setAvisosOpen] = useState(false);
  const notifNoLeidas = useMemo(() => (data.notificaciones || []).filter(n => !n.leida), [data.notificaciones]);
  const notifRecientes = useMemo(() => (data.notificaciones || []).slice(0, 30), [data.notificaciones]);

  const vp = useMemo(() => ({ data, actions, user }), [data, actions, user]);
  // Persona para Resumen y Mi bandeja: en "Ver como" se muestra lo del rol elegido (sin accesos ni dueño).
  const usuarioVista = useMemo(() => (viendoComo
    ? { ...(usuarioRol || user), rol: rolVista, accesos_extra: [], es_dueno: false }
    : (usuarioRol || user)), [viendoComo, usuarioRol, user, rolVista]);

  // Tanda 24: badge de "Mi bandeja" en el menú — solo cuenta urgentes
  // (prioridad alta) para que el número signifique "atiende ahora".
  const urgentesBandeja = useMemo(
    () => contarUrgentes(construirBandejaUsuario(usuarioVista, data, diaNegocio())),
    [data, usuarioVista]
  );
  // Alertas = condiciones en vivo (no se "leen"); se pueden ocultar por hoy.
  const [alertasOcultas, setAlertasOcultas] = useState(() => leerOcultas(diaNegocio()));
  const alertasActivas = useMemo(() => {
    const vivas = (data.alertas || []).filter(a => {
      const msg = (a?.msg || a?.mensaje || a?.detalle || a?.titulo || '').toString().trim();
      const est = (a?.estatus || '').toString().toLowerCase();
      return !!msg && est !== 'resuelta' && est !== 'cerrada';
    });
    return alertasVisibles(vivas, alertasOcultas);
  }, [data.alertas, alertasOcultas]);
  const ocultarAlertaHoy = useCallback((a) => {
    setAlertasOcultas(prev => {
      const sig = [...prev, claveAlerta(a)];
      guardarOcultas(diaNegocio(), sig);
      return sig;
    });
  }, []);

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
      // Inicio de TODOS los roles: el back office (tiene el módulo de Ventas de Admin) ve su Dashboard; los demás, el Resumen de su rol.
      case 'dashboard': return esBackOffice
        ? <DashboardView data={data} user={user} actions={actions} onNavigate={go} />
        : <ResumenRolView data={data} user={usuarioVista} actions={actions} nav={nav} onNavigate={go} />;
      case 'bandeja': return <BandejaView data={data} user={usuarioVista} actions={actions} onNavigate={go} />;
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
      case 'auditoria': return <AuditoriaView {...vp} />;
      case MODULO_USUARIOS.id: return <UsuariosView {...vp} />;
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
      case MODULO_MI_CUENTA.id: return <MiCuentaView user={user} actions={actions} />;
      // Fase B: vistas por rol como contenido del shell (misma lógica, misma autorización).
      // B3.6: un solo módulo Ventas; el filtro interno sale del hash (ventas / ventas-hoy / ventas-todas).
      case 'ventas': case 'ventas-hoy': case 'ventas-todas':
        return <VentasStandaloneView embedded filtro={filtroVentasDesdeVista(view)} onFiltro={f => go(vistaDesdeFiltroVentas(f))} user={usuarioRol || user} data={data} actions={actions} onLogout={onLogout} />;
      case 'prod-producir': case 'prod-cuartos': case 'prod-mermas': case 'prod-preparar':
        return <ProduccionStandaloneView embedded tab={tabDesdeModulo(view)} onTab={t => go(moduloDesdeTab('Producción', t))} user={usuarioRol || user} data={data} actions={actions} onLogout={onLogout} />;
      case MODULO_BOLSAS.id:
        return <BolsasView embedded user={usuarioRol || user} data={data} actions={actions} onLogout={onLogout} />;
      default: return null;
    }
  };

  const go = useCallback((id) => { const v = normalizarVista(nav, id); if (v) setView(v); setMobileDrawerOpen(false); }, [nav]);
  // B3.6: el módulo del menú dueño de la vista (filtro interno → su módulo).
  const modulo = moduloDeVista(nav, view) || view;
  const current = ALL_ITEMS.find(n => n.id === modulo) || [MODULO_MI_ASISTENCIA, MODULO_MIS_ACTIVIDADES, MODULO_MI_CUENTA].find(n => n.id === modulo);

  // Modo enfoque (Chofer): sin sidebar ni cabecera del shell; la vista trae
  // su propio chrome mínimo y la identidad del producto (RoleHeader).
  if (nav.modo === 'enfoque') {
    return (
      <div className="min-h-dvh text-slate-900" data-testid="dashboard-shell" data-rol={user?.rol || ''} data-modo="enfoque">
        <ChunkErrorBoundary viewName={MODULO_CHOFER.id}>
          {/* Recordatorio de asistencia también en modo enfoque (solo en la ruta; aparece si hay algo que marcar). */}
          {view === MODULO_CHOFER.id && !viendoComo && (
            <RecordatorioAsistencia actions={actions} onIr={() => go(MODULO_MI_ASISTENCIA.id)}
              envoltura="bg-blue-950 px-4 pb-2 pt-[max(env(safe-area-inset-top,0px),0.75rem)]" />
          )}
          <Suspense fallback={<div className="p-4"><ViewSkeleton /></div>}>
            {view === MODULO_MI_ASISTENCIA.id
              ? <div className="mx-auto max-w-lg px-4 py-4"><MiAsistenciaView actions={actions} onVolver={() => go(MODULO_CHOFER.id)} /></div>
              : view === MODULO_MIS_ACTIVIDADES.id
              ? <div className="mx-auto max-w-2xl px-4 py-4"><CalendarioView {...vp} personal onVolver={() => go(MODULO_CHOFER.id)} /></div>
              : view === MODULO_MI_CUENTA.id
              ? <div className="mx-auto max-w-lg px-4 py-4"><MiCuentaView user={user} actions={actions} onVolver={() => go(MODULO_CHOFER.id)} /></div>
              : <ChoferView user={usuarioRol || user} data={data} actions={actions} onLogout={onLogout} onMiAsistencia={() => go(MODULO_MI_ASISTENCIA.id)} onMisActividades={() => go(MODULO_MIS_ACTIVIDADES.id)} onMiCuenta={() => go(MODULO_MI_CUENTA.id)} />}
          </Suspense>
        </ChunkErrorBoundary>
      </div>
    );
  }

  return (
    <div className="min-h-dvh text-slate-900" data-testid="dashboard-shell" data-rol={user?.rol || ''} data-rol-vista={rol || ''}>

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
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{user?.nombre || "Admin"}</p><p className="truncate text-xs text-slate-400" data-testid="role-badge">{etiquetaRol(user)}</p></div>
          </div>
          {onLogout && <button onClick={onLogout} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white" title="Cerrar sesión" aria-label="Cerrar sesión"><Icons.X /></button>}
        </div>
      </aside>

      {/* ═══ TOPBAR ═══
          Mobile-first (2026-10-09): menú, título completo y, a la derecha, solo
          búsqueda (back office), firmas cuando hay pendientes y UNA campana
          "Avisos" que junta alertas y notificaciones. */}
      <header className={`sticky border-b border-line bg-canvas/90 backdrop-blur-xl lg:ml-[300px] xl:ml-[320px] ${avisosOpen ? 'z-[80]' : 'z-30'}`} style={{ ...topFijo, paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="flex h-14 items-center justify-between gap-2 px-2 lg:h-16 lg:px-6" data-testid="topbar">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="lg:hidden flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
              aria-label="Abrir menú"
            >
              <Icons.Menu />
            </button>
            <p className="font-display min-w-0 flex-1 truncate text-[17px] font-semibold text-ink lg:text-[1.35rem]" data-testid="topbar-titulo">{current?.label || "Resumen"}</p>
          </div>
          <div className="relative flex flex-shrink-0 items-center gap-1.5">
            {nav.chrome.busqueda && <BusquedaGlobal data={data} onNavigate={go} />}
            {nav.chrome.firmas && <BotonFirmasPendientes user={usuarioRol || user} data={data} actions={actions} />}
            {(nav.chrome.alertas || nav.chrome.notificaciones) && (
              <button onClick={() => setAvisosOpen(v => !v)}
                className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-100 lg:h-11 lg:w-11"
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
                <div className="fixed inset-0 z-[60] bg-ink/20 animate-fadeIn" onClick={() => setAvisosOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-12 z-[70] max-h-[75vh] w-[calc(100vw-16px)] overflow-y-auto rounded-card border border-line bg-white shadow-pop animate-pop-in sm:w-96" role="dialog" aria-modal="false" aria-label="Avisos" data-testid="panel-avisos">
                  <div className="sticky top-0 z-10 border-b border-line bg-white px-4 py-3">
                    <p className="text-[15px] font-bold text-ink">Avisos</p>
                  </div>
                  {nav.chrome.alertas && (
                    <section className="border-b border-line p-3" data-testid="avisos-alertas">
                      <div className="mb-2 px-1">
                        <p className="erp-kicker text-slate-500">Por resolver{alertasActivas.length > 0 ? ` · ${alertasActivas.length}` : ''}</p>
                        <p className="text-[12px] text-slate-400">Se quitan solas cuando se resuelven. Toca una para ir a resolverla.</p>
                      </div>
                      {alertasActivas.length === 0 ? (
                        <p className="px-1 py-2 text-[13px] text-slate-500">Nada por resolver.</p>
                      ) : (
                        <div className="space-y-2">
                          {alertasActivas.map(a => (
                            <div key={claveAlerta(a)} className={`flex items-stretch overflow-hidden rounded-field ${a.tipo === 'critica' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>
                              <button type="button" onClick={() => { go(destinoAlerta(a)); setAvisosOpen(false); }}
                                className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left">
                                <span className="mt-0.5 flex-shrink-0"><Icons.AlertTriangle /></span>
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold">{tituloAlerta(a)}</span>
                                  <span className="block text-xs leading-5 opacity-80">{a.msg || a.mensaje || a.detalle}</span>
                                </span>
                              </button>
                              <button type="button" onClick={() => ocultarAlertaHoy(a)} title="Ocultar hoy" aria-label="Ocultar hoy"
                                className="flex w-11 flex-shrink-0 items-center justify-center opacity-60 transition-opacity hover:opacity-100">
                                <Icons.X />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  {nav.chrome.notificaciones && (
                    <section data-testid="avisos-notificaciones">
                      <div className="flex items-center justify-between px-4 pb-1 pt-3">
                        <p className="erp-kicker text-slate-500">Notificaciones{notifNoLeidas.length > 0 ? ` · ${notifNoLeidas.length} sin leer` : ''}</p>
                        {notifNoLeidas.length > 0 && <button onClick={() => actions.marcarTodasLeidas()} className="min-h-[36px] rounded-full px-2 text-xs font-semibold text-accent hover:bg-accent-soft">Marcar leídas</button>}
                      </div>
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
                    </section>
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
                    <p className="text-xs text-slate-400 truncate">{etiquetaRol(user)}</p>
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
      <main className={`px-4 pt-4 lg:ml-[300px] lg:px-6 lg:pb-6 lg:pt-6 xl:ml-[320px] ${bottomNav ? "pb-[calc(env(safe-area-inset-bottom,0px)+88px)]" : "pb-8"}`} data-bottom-nav={bottomNav ? 'si' : 'no'}>
        <div className="relative">
          {/* Recordatorio de asistencia en la pantalla de inicio de TODOS los roles (si hay algo que marcar). */}
          {view === nav.inicio && view !== MODULO_MI_ASISTENCIA.id && !viendoComo && (
            <RecordatorioAsistencia className="mb-4" actions={actions} onIr={() => go(MODULO_MI_ASISTENCIA.id)} />
          )}
          <div key={view} className="relative animate-view-in"><ChunkErrorBoundary><Suspense fallback={<ViewSkeleton />}>{renderView()}</Suspense></ChunkErrorBoundary></div>
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
  const nombreCliente = (c) => (data.clientes || []).find(cli => String(cli.id) === String(c.clienteId || c.cliente_id))?.nombre || 'Sin cliente';

  return (<div className="space-y-3">
    {ConfirmEl}
    <PageHeader title="Comodatos" subtitle="Congeladores en negocios. El chofer repone y cobra." action={() => { setForm(empty); setModal('new'); }} actionLabel="Nuevo comodato" />
    {comodatos.length > 0 ? (
      <Card padding="p-0" className="divide-y divide-line">
        {comodatos.map(c => (
          <ListRow key={c.id} icon="Thermometer" title={c.negocio} subtitle={`${nombreCliente(c)} · ${c.frecuencia || ''}${c.congeladorModelo ? ` · ${c.congeladorModelo}` : ''}`}
            value={`${c.stockActual || 0}/${c.capacidad}`} valueHint="stock / capacidad" badge={<StatusBadge status={c.estatus} />}
            onClick={() => openEdit(c)} chevron />
        ))}
      </Card>
    ) : (
      <Card padding="p-0"><EmptyState icon="Thermometer" message="Sin comodatos" hint="Registra los congeladores que prestas a negocios." cta="Nuevo comodato" onCta={() => { setForm(empty); setModal('new'); }} /></Card>
    )}
    <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'new' ? 'Nuevo comodato' : 'Editar comodato'} kicker="Comodatos"
      footer={<>
        <FormBtn className="flex-1" onClick={() => setModal(null)}>Cancelar</FormBtn>
        <FormBtn primary className="flex-1" onClick={save} disabled={!form.clienteId || !form.negocio.trim()}>Guardar</FormBtn>
      </>}>
      <div className="space-y-3">
        <FormSelect label="Cliente *" value={form.clienteId} onChange={e => setForm({...form, clienteId: e.target.value})}
          options={[{ value: '', label: 'Seleccionar cliente activo…' }, ...clientesActivos.map(cli => ({ value: String(cli.id), label: cli.nombre }))]} />
        <FormInput label="Negocio *" value={form.negocio} onChange={e => setForm({...form, negocio: e.target.value})} placeholder="OXXO Centro" />
        <FormInput label="Dirección" value={form.direccion} onChange={e => setForm({...form, direccion: e.target.value})} />
        <FormInput label="Teléfono de contacto" type="tel" value={form.contacto} onChange={e => setForm({...form, contacto: e.target.value})} />
        <FormInput label="Modelo del congelador" value={form.congeladorModelo} onChange={e => setForm({...form, congeladorModelo: e.target.value})} placeholder="Imbera VR-17" />
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Capacidad" type="number" min="0" inputMode="numeric" value={form.capacidad} onChange={e => setForm({...form, capacidad: e.target.value})} />
          <FormInput label="Stock máximo" type="number" min="0" inputMode="numeric" value={form.stockMaximo} onChange={e => setForm({...form, stockMaximo: e.target.value})} />
        </div>
        <FormSelect label="Frecuencia" value={form.frecuencia} onChange={e => setForm({...form, frecuencia: e.target.value})} options={["Diario", "Cada 2 días", "Cada 3 días", "Semanal"]} />
        {modal && modal !== 'new' && (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <FormBtn onClick={() => askConfirm(
              modal.estatus === 'Activo' ? 'Desactivar comodato' : 'Activar comodato',
              modal.estatus === 'Activo' ? `¿Marcar comodato "${form.negocio}" como inactivo? Podrás reactivarlo después.` : `¿Reactivar comodato "${form.negocio}"?`,
              async () => { await actions.updateComodato(modal.id, { estatus: modal.estatus === 'Activo' ? 'Inactivo' : 'Activo' }); setModal(null); },
              modal.estatus === 'Activo'
            )}>{modal.estatus === 'Activo' ? <><Icons.Ban /> Desactivar</> : <><Icons.CheckCircle /> Activar</>}</FormBtn>
            <FormBtn danger onClick={() => askConfirm(
              'Eliminar comodato',
              `¿Eliminar comodato "${form.negocio}"? Esta acción no se puede deshacer.`,
              async () => { await actions.deleteComodato(modal.id); setModal(null); },
              true
            )}><Icons.Trash /> Eliminar</FormBtn>
          </div>
        )}
      </div>
    </Modal>
  </div>);
}

const ESTATUS_LEAD = ["Nuevo", "Contactado", "Convertido", "Descartado"];
function LeadsView({ data, actions }) {
  const [askConfirm, ConfirmEl] = useConfirm();
  const toast = useToast();
  const [modal, setModal] = useState(false); // false | "new" | <lead obj>
  const empty = { nombre: "", telefono: "", correo: "", mensaje: "", origen: "Landing page" };
  const [form, setForm] = useState(empty);
  const [filtro, setFiltro] = useState('Nuevo');
  const leads = data.leads || [];
  const visibles = filtro === 'Todos' ? leads : leads.filter(l => (l.estatus || 'Nuevo') === filtro);

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

  return (<div className="space-y-3">
    {ConfirmEl}
    <PageHeader title="Leads" subtitle="Contactos de landing page y otros canales" action={openNew} actionLabel="Nuevo lead" />
    <Chips value={filtro} onChange={setFiltro} items={[...ESTATUS_LEAD.map(e => ({ k: e, l: e, n: leads.filter(l => (l.estatus || 'Nuevo') === e).length })), { k: 'Todos', l: 'Todos' }]} />
    {visibles.length > 0 ? (
      <Card padding="p-0" className="divide-y divide-line">
        {visibles.map(l => (
          <div key={l.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-600"><Icons.Phone /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-ink">{l.nombre}</p>
                <p className="truncate text-[13px] text-slate-500">{l.telefono}{l.correo ? ` · ${l.correo}` : ""}</p>
                {l.mensaje && <p className="mt-1.5 rounded-[10px] bg-slate-50 px-2.5 py-2 text-[13px] text-slate-600">{l.mensaje}</p>}
                <p className="mt-1 text-[11px] text-slate-500">{l.origen}{l.fecha ? ` · ${l.fecha}` : ''}</p>
              </div>
              <div className="flex flex-shrink-0 items-center">
                <IconButton icon="Edit" label="Editar lead" onClick={() => openEdit(l)} />
                <IconButton icon="Trash" label="Eliminar lead" tone="danger" onClick={() => eliminarLead(l)} />
              </div>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {ESTATUS_LEAD.map(e => (
                <button key={e} type="button" onClick={() => cambiarEstatus(l.id, e)} aria-pressed={(l.estatus || 'Nuevo') === e}
                  className={`min-h-[36px] rounded-full text-[12px] font-semibold transition-colors ${(l.estatus || 'Nuevo') === e
                    ? (e === 'Convertido' ? 'bg-emerald-600 text-white' : e === 'Descartado' ? 'bg-slate-700 text-white' : e === 'Contactado' ? 'bg-amber-500 text-white' : 'bg-ink text-white')
                    : 'bg-slate-100 text-slate-600'}`}>{e}</button>
              ))}
            </div>
          </div>
        ))}
      </Card>
    ) : (
      <Card padding="p-0"><EmptyState icon="Phone" message={filtro === 'Todos' ? 'Sin leads' : `Sin leads en "${filtro}"`} hint="Los contactos de la landing aparecen aquí; también puedes registrarlos a mano." cta="Nuevo lead" onCta={openNew} /></Card>
    )}
    <Modal open={!!modal} onClose={() => setModal(false)} title={modal === "new" ? "Nuevo lead" : `Editar lead`} kicker={modal && modal !== "new" ? modal.nombre : "Leads"}
      footer={<>
        <FormBtn className="flex-1" onClick={() => setModal(false)}>Cancelar</FormBtn>
        <FormBtn primary className="flex-1" onClick={save} disabled={!form.nombre.trim()}>{modal === "new" ? "Guardar lead" : "Guardar cambios"}</FormBtn>
      </>}>
      <div className="space-y-3">
        <FormInput label="Nombre *" value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} />
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Teléfono" type="tel" value={form.telefono} onChange={e => setForm({...form, telefono: e.target.value})} />
          <FormInput label="Correo" type="email" value={form.correo} onChange={e => setForm({...form, correo: e.target.value})} />
        </div>
        <FormTextarea label="Mensaje" value={form.mensaje} onChange={e => setForm({...form, mensaje: e.target.value})} rows={2} />
        <FormSelect label="Origen" value={form.origen} onChange={e => setForm({...form, origen: e.target.value})} options={["Landing page", "WhatsApp", "Teléfono", "Referido", "Redes sociales"]} />
      </div>
    </Modal>
  </div>);
}
