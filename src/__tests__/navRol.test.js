// navRol.test.js — Fase B: una sola fuente de navegación por rol.
// Prueba el modelo puro y la matriz de alcance por rol (qué módulos recibe
// cada rol). Admin / Facturación / Sin asignar conservan sus 25 módulos.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NAV_ROLES, AREAS_ADMIN, AREAS_BACKOFFICE, MODULO_ASISTENCIA, MODULO_MI_ASISTENCIA, MODULO_CALENDARIO, MODULO_MIS_ACTIVIDADES, MODULO_VENTAS, FILTROS_VENTAS, ALIAS_VISTAS_VENTAS, MODULOS_PRODUCCION, MODULO_BOLSAS, MODULO_CHOFER,
  navParaRol, idsModulos, itemsModulos, areaDeModulo, tabDesdeModulo, moduloDesdeTab, areasExpandidasInicial,
  idsVistas, normalizarVista, moduloDeVista, filtroVentasDesdeVista, vistaDesdeFiltroVentas,
} from '../data/navRolLogic';
import { ROLES_VALIDOS } from '../data/adminUserLogic';
import { viewDesdeHash } from '../data/navegacionShellLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// MENÚ 2026-10-09: "Inicio" (Resumen + Mi bandeja) es de todos los roles; cada módulo vive en el
// área de su tema y "Sistema" reúne Usuarios, Auditoría y Ajustes. Los ids no cambiaron.
const ADMIN_28 = [
  'dashboard', 'bandeja',
  'produccion', 'inventario', 'bolsas', 'mermas', 'rutas', 'kardex',
  'ordenes', 'clientes', 'precios', 'productos', 'leads', 'comodatos',
  'cobros', 'proveedores', 'contabilidad', 'costos', 'conciliacion', 'devoluciones', 'facturacion',
  'empleados', 'asistencia', 'nomina', 'calendario',
  'usuarios', 'auditoria', 'configuracion',
];
// Facturación y Sin asignar: lo mismo sin Asistencia, Calendario ni Usuarios (solo de Admin).
const SOLO_ADMIN = ['asistencia', 'calendario', 'usuarios'];
const ADMIN_25 = ADMIN_28.filter(id => !SOLO_ADMIN.includes(id));
const INICIO = ['dashboard', 'bandeja'];
const modulosAdmin = (rol) => (rol === 'Admin' ? ADMIN_28 : ADMIN_25);

describe('matriz de navegación por rol', () => {
  it('todo rol válido tiene navegación y un módulo inicial dentro de su menú', () => {
    for (const rol of ROLES_VALIDOS) {
      const nav = navParaRol(rol);
      expect(nav, rol).toBeTruthy();
      expect(idsModulos(nav).has(nav.inicio), `${rol}: inicio ${nav.inicio}`).toBe(true);
      expect(['completo', 'enfoque']).toContain(nav.modo);
    }
    expect(navParaRol('Rol inexistente')).toBe(NAV_ROLES['Sin asignar']);
  });
  it('Admin, Facturación y Sin asignar: sus 25 módulos de siempre; Admin además Asistencia, Calendario y Usuarios', () => {
    expect(ADMIN_25).toHaveLength(25);
    for (const rol of ['Admin', 'Facturación', 'Sin asignar']) {
      const nav = navParaRol(rol);
      expect(nav.modo).toBe('completo');
      expect(nav.areas).toBe(rol === 'Admin' ? AREAS_ADMIN : AREAS_BACKOFFICE);
      expect([...idsModulos(nav)]).toEqual(modulosAdmin(rol));
      expect(nav.inicio).toBe('dashboard');
      expect(nav.chrome.busqueda && nav.chrome.alertas && nav.chrome.notificaciones && nav.chrome.firmas).toBe(true);
    }
    expect(navParaRol('Admin').chrome.verComo).toBe(true);
    expect(navParaRol('Facturación').chrome.verComo).toBe(false);
    expect(navParaRol('Sin asignar').chrome.verComo).toBe(false);
    expect(AREAS_ADMIN.map(a => a.id)).toEqual(['inicio', 'operacion', 'comercial', 'finanzas', 'equipo', 'sistema']);
    expect(AREAS_BACKOFFICE.map(a => a.id)).toEqual(['inicio', 'operacion', 'comercial', 'finanzas', 'equipo', 'sistema']);
    // Cada módulo en el área de su tema.
    const area = (id) => areaDeModulo(navParaRol('Admin'), id).id;
    expect(area(MODULO_ASISTENCIA.id)).toBe('equipo');
    expect(area(MODULO_CALENDARIO.id)).toBe('equipo');
    expect(area('nomina')).toBe('equipo');
    expect(area('kardex')).toBe('operacion');
    expect(area('comodatos')).toBe('comercial');
    expect(['usuarios', 'auditoria', 'configuracion'].map(area)).toEqual(['sistema', 'sistema', 'sistema']);
    // El "Panel del dueño" ya no existe: su hash abre Auditoría (donde vive la bitácora del Dueño).
    expect(idsModulos(navParaRol('Admin')).has('dueno')).toBe(false);
    expect(normalizarVista(navParaRol('Admin'), 'dueno')).toBe('auditoria');
  });
  it('WF-0 + PD-02: Empleado = Inicio + "Mi asistencia" y "Mis actividades"; nunca cae al back office de respaldo', () => {
    const nav = navParaRol('Empleado');
    expect(nav).toBe(NAV_ROLES.Empleado);
    expect(nav).not.toBe(NAV_ROLES['Sin asignar']);
    expect(nav.modo).toBe('completo');
    expect([...idsModulos(nav)]).toEqual([...INICIO, MODULO_MI_ASISTENCIA.id, MODULO_MIS_ACTIVIDADES.id]);
    // GER-1 (120): además, la vista "Mi cuenta" (cambiar su propia contraseña).
    expect([...idsVistas(nav)]).toEqual([...INICIO, MODULO_MI_ASISTENCIA.id, MODULO_MIS_ACTIVIDADES.id, 'mi-cuenta']);
    expect(nav.inicio).toBe('dashboard');   // su Resumen (asistencia y actividades), no el Dashboard de Admin
    expect(Object.values(nav.chrome).some(Boolean)).toBe(false);   // sin búsqueda, alertas, notificaciones, firmas, Ver como
    for (const id of [...ADMIN_28.filter(x => !INICIO.includes(x)), 'ventas', 'prod-producir', 'bolsas-almacen', 'chofer-ruta']) {
      expect(normalizarVista(nav, id), id).toBeNull();
    }
  });
  it('PD-01: "Mi asistencia" es vista (sin entrada de menú) para los demás roles; "Asistencia" solo en el menú de Admin', () => {
    for (const rol of ['Admin', 'Facturación', 'Sin asignar', 'Ventas', 'Producción', 'Almacén Bolsas', 'Chofer']) {
      const nav = navParaRol(rol);
      expect(normalizarVista(nav, 'mi-asistencia'), rol).toBe('mi-asistencia');
      expect(idsModulos(nav).has('mi-asistencia'), rol).toBe(false);
      expect(nav.chrome.miAsistencia, rol).toBe(true);
      expect(idsModulos(nav).has('asistencia'), rol).toBe(rol === 'Admin');
      // PD-02: "Mis actividades" igual que "Mi asistencia"; el calendario completo, solo Admin.
      expect(normalizarVista(nav, 'mis-actividades'), rol).toBe('mis-actividades');
      expect(idsModulos(nav).has('mis-actividades'), rol).toBe(false);
      expect(nav.chrome.misActividades, rol).toBe(true);
      expect(idsModulos(nav).has('calendario'), rol).toBe(rol === 'Admin');
    }
  });
  it('Inicio (Resumen + Mi bandeja) en todos; Ventas: UN módulo (B3.6); Producción: sus cuatro; Bolsas: uno; Chofer: enfoque', () => {
    expect([...idsModulos(navParaRol('Ventas'))]).toEqual([...INICIO, 'ventas']);
    expect(itemsModulos(navParaRol('Ventas')).filter(i => !INICIO.includes(i.id))).toEqual([MODULO_VENTAS]);
    expect(MODULO_VENTAS).toEqual({ id: 'ventas', label: 'Ventas', icon: 'ShoppingCart' });
    expect([...idsModulos(navParaRol('Producción'))]).toEqual([...INICIO, 'prod-producir', 'prod-cuartos', 'prod-mermas', 'prod-preparar']);
    expect(navParaRol('Producción').chrome.firmas).toBe(true);
    expect([...idsModulos(navParaRol('Almacén Bolsas'))]).toEqual([...INICIO, MODULO_BOLSAS.id]);
    // Todos los roles con menú empiezan en su Resumen y tienen Mi bandeja.
    for (const rol of ['Admin', 'Facturación', 'Sin asignar', 'Ventas', 'Producción', 'Almacén Bolsas', 'Empleado']) {
      const nav = navParaRol(rol);
      expect(nav.inicio, rol).toBe('dashboard');
      expect(nav.areas[0].id, rol).toBe('inicio');
      expect(nav.areas[0].items.map(i => [i.id, i.label]), rol).toEqual([['dashboard', 'Resumen'], ['bandeja', 'Mi bandeja']]);
    }
    expect(navParaRol('Chofer').modo).toBe('enfoque');
    expect([...idsModulos(navParaRol('Chofer'))]).toEqual([MODULO_CHOFER.id]);
    for (const rol of ['Ventas', 'Producción', 'Almacén Bolsas', 'Chofer']) {
      const c = navParaRol(rol).chrome;
      expect(c.busqueda || c.alertas || c.notificaciones || c.verComo, rol).toBe(false);
    }
  });
  it('ids únicos en todo el sistema; ningún módulo de rol choca con los de Admin', () => {
    const todos = Object.values(NAV_ROLES).flatMap(n => [...idsModulos(n)]);
    const admin = new Set(ADMIN_25);
    for (const n of [MODULO_VENTAS, ...MODULOS_PRODUCCION, MODULO_BOLSAS, MODULO_CHOFER]) expect(admin.has(n.id), n.id).toBe(false);
    for (const id of [...idsVistas(navParaRol('Ventas'))].filter(x => !INICIO.includes(x))) expect(admin.has(id), id).toBe(false);
    for (const nav of Object.values(NAV_ROLES)) expect(new Set([...idsModulos(nav)]).size).toBe(idsModulos(nav).size);
    expect(todos.length).toBeGreaterThan(0);
  });
  it('Producción: pestaña ↔ módulo biyectiva (sin cambio); Ventas ya no usa pestañas como módulos', () => {
    for (const m of MODULOS_PRODUCCION) expect(moduloDesdeTab('Producción', tabDesdeModulo(m.id))).toBe(m.id);
    expect(MODULOS_PRODUCCION.map(m => m.tab)).toEqual(['producir', 'cuartos', 'mermas', 'preparar']);
    expect(tabDesdeModulo('dashboard')).toBeNull();
    expect(tabDesdeModulo('ventas-hoy')).toBeNull();
    expect(moduloDesdeTab('Ventas', 'hoy')).toBeNull();
    expect(moduloDesdeTab('Admin', 'hoy')).toBeNull();
  });
  it('B3.6: filtros internos de Ventas y su hash (Pendientes / Hoy / Todas)', () => {
    expect(FILTROS_VENTAS.map(f => [f.id, f.label, f.vista])).toEqual([['pendientes', 'Pendientes', 'ventas'], ['hoy', 'Hoy', 'ventas-hoy'], ['todas', 'Todas', 'ventas-todas']]);
    for (const f of FILTROS_VENTAS) expect(filtroVentasDesdeVista(vistaDesdeFiltroVentas(f.id))).toBe(f.id);
    expect(vistaDesdeFiltroVentas('nada')).toBeNull();
    expect(filtroVentasDesdeVista('cobros')).toBeNull();
  });
  it('B3.6: hashes heredados como alias → mismo espacio de trabajo y filtro equivalente', () => {
    const v = navParaRol('Ventas');
    expect(ALIAS_VISTAS_VENTAS).toEqual({ 'ventas-cobrar': 'ventas' });
    const abre = (hash) => { const vista = normalizarVista(v, viewDesdeHash(hash, idsVistas(v))); return [vista, moduloDeVista(v, vista), filtroVentasDesdeVista(vista)]; };
    expect(abre('#/ventas-cobrar')).toEqual(['ventas', 'ventas', 'pendientes']);    // B3.4 "Por cobrar" → Pendientes
    expect(abre('#/ventas-hoy')).toEqual(['ventas-hoy', 'ventas', 'hoy']);
    expect(abre('#/ventas-todas')).toEqual(['ventas-todas', 'ventas', 'todas']);
    expect(abre('#/ventas')).toEqual(['ventas', 'ventas', 'pendientes']);
    expect(abre('#/cobros')).toEqual([null, null, null]);                          // un hash de Admin no abre nada en Ventas
    expect([...idsVistas(v)].sort()).toEqual(['bandeja', 'dashboard', 'mi-asistencia', 'mi-cuenta', 'mis-actividades', 'ventas', 'ventas-cobrar', 'ventas-hoy', 'ventas-todas']);
  });
  it('B3.6: los demás roles no tienen vistas ni alias extra (mismo ruteo de siempre)', () => {
    for (const rol of ['Admin', 'Facturación', 'Sin asignar', 'Producción', 'Almacén Bolsas', 'Chofer']) {
      const nav = navParaRol(rol);
      // OP-01D: Producción conserva el hash heredado '#/prod-trans' como alias de "Preparar barra".
      // PD-01: todos suman la vista "mi-asistencia" (botón de la cabecera, sin entrada de menú).
      // GER-1: y la vista "mi-cuenta" (contraseña propia).
      // 2026-10-09: Admin conserva '#/dueno' como alias de Auditoría.
      const extra = ['mi-asistencia', 'mis-actividades', 'mi-cuenta', ...(rol === 'Producción' ? ['prod-trans'] : []), ...(rol === 'Admin' ? ['dueno'] : [])];
      expect([...idsVistas(nav)], rol).toEqual([...idsModulos(nav), ...extra]);
      for (const id of idsModulos(nav)) { expect(normalizarVista(nav, id)).toBe(id); expect(moduloDeVista(nav, id)).toBe(id); }
      expect(normalizarVista(nav, 'ventas-hoy'), rol).toBeNull();
    }
    expect(normalizarVista(navParaRol('Producción'), 'prod-trans')).toBe('prod-preparar');
    expect(normalizarVista(navParaRol('Admin'), 'prod-trans')).toBeNull();
  });
  it('helpers: área de un módulo, items planos, áreas expandidas, deep link por rol', () => {
    expect(areaDeModulo(navParaRol('Admin'), 'cobros').id).toBe('finanzas');
    expect(areaDeModulo(navParaRol('Ventas'), moduloDeVista(navParaRol('Ventas'), 'ventas-hoy')).id).toBe('ventas');
    expect(areaDeModulo(navParaRol('Ventas'), 'cobros')).toBeNull();
    expect(itemsModulos(navParaRol('Producción')).map(i => i.id)).toEqual([...INICIO, 'prod-producir', 'prod-cuartos', 'prod-mermas', 'prod-preparar']);
    expect(areasExpandidasInicial(navParaRol('Admin'))).toEqual({ inicio: true, operacion: true, comercial: true, finanzas: false, equipo: false, sistema: false });
    expect(areasExpandidasInicial(navParaRol('Ventas'))).toEqual({ inicio: true, ventas: true });
    // Un hash de Admin no abre nada en el menú de Ventas (cae al inicio del rol).
    expect(viewDesdeHash('#/cobros', idsModulos(navParaRol('Ventas')))).toBeNull();
    expect(viewDesdeHash('#/ventas-hoy', idsVistas(navParaRol('Ventas')))).toBe('ventas-hoy');
  });
});

describe('B: shell compartido y ruteo', () => {
  const shell = src('../components/CuboPolarERP.jsx');
  const app = src('../App.jsx');
  it('App.jsx manda todos los roles al shell con el mismo alcance de datos y el mismo usuario que antes', () => {
    expect(app).not.toMatch(/import\('\.\/components\/(ChoferView|BolsasView|ProduccionStandaloneView|VentasStandaloneView)'\)/);
    expect(app).not.toMatch(/if \(effectiveRole === '/);
    expect(app).toMatch(/<CuboPolarERP\s+user=\{user\}\s+usuarioRol=\{roleUser\}\s+rolVista=\{effectiveRole\}\s+data=\{scopedData\}\s+actions=\{actions\}\s+onLogout=\{handleLogout\}\s+onViewAs=\{isAdmin \? setAdminViewAs : null\}/);
    expect(app).toMatch(/const roleUser = \{ \.\.\.user, id: usuarioActualId \|\| user\?\.id, auth_id: authUserId \|\| user\?\.auth_id \}/);
    expect(app).toMatch(/const effectiveRole = adminViewAs \|\| user\.rol/);
    // scopedData sin cambio: Admin / vista previa → data; Chofer y Ventas → su alcance; el resto → data.
    expect(app).toMatch(/if \(user\?\.rol === 'Admin' \|\| adminViewAs\) return data/);
    expect(app).toMatch(/if \(user\?\.rol === 'Chofer'\) \{/);
    expect(app).toMatch(/const actuaComoVentas = tieneRol\(user, 'Ventas'\)/);   // GER-1: rol Ventas o acceso adicional
    expect(app).toMatch(/if \(actuaComoVentas\) \{/);
    // "Ver como": sigue siendo preview con autorización de Admin (handleLogout vuelve a Admin).
    expect(app).toMatch(/if \(isAdmin && adminViewAs\) \{\s*setAdminViewAs\(null\)\s*return\s*\}/);
  });
  it('el shell deriva menú, inicio, chrome y modo de navRolLogic; AREAS ya no viven en el shell', () => {
    // GER-1: el menú es de la persona (rol + accesos + dueño); en "Ver como", el del rol elegido.
    expect(shell).toMatch(/const viendoComo = !!rolVista && rolVista !== user\?\.rol;/);
    expect(shell).toMatch(/const nav = useMemo\(\(\) => \(viendoComo \? navParaRol\(rolVista\) : navParaUsuario\(user\)\), \[viendoComo, rolVista, user\]\);/);
    expect(shell).not.toMatch(/\bconst AREAS = \[/);
    expect(shell).toMatch(/\{\[\.\.\.nav\.areas, .*\]\.map\(area => \{/);
    // Mobile-first (2026-10-09): el drawer recorre las áreas del rol + "Mi espacio".
    expect(shell).toMatch(/\{\[\.\.\.nav\.areas, \.\.\.\(miEspacio\.length \? \[\{ id: 'mi-espacio', label: 'Mi espacio', items: miEspacio \}\] : \[\]\)\]\.map\(area => \(/);
    expect(shell).toMatch(/onViewAs && nav\.chrome\.verComo &&/);
    expect(shell).toMatch(/nav\.chrome\.busqueda && <BusquedaGlobal/);
    expect(shell).toMatch(/nav\.chrome\.firmas && <BotonFirmasPendientes/);
    expect(shell).toMatch(/if \(nav\.modo === 'enfoque'\) \{/);
    expect(shell).toMatch(/<ChoferView user=\{usuarioRol \|\| user\} data=\{data\} actions=\{actions\} onLogout=\{onLogout\} onMiAsistencia=\{\(\) => go\(MODULO_MI_ASISTENCIA\.id\)\} onMisActividades=\{\(\) => go\(MODULO_MIS_ACTIVIDADES\.id\)\} onMiCuenta=\{\(\) => go\(MODULO_MI_CUENTA\.id\)\} \/>/);
    expect(shell).toMatch(/view === MODULO_MIS_ACTIVIDADES\.id\s*\? <div className="mx-auto max-w-2xl px-4 py-4"><CalendarioView \{\.\.\.vp\} personal onVolver=\{\(\) => go\(MODULO_CHOFER\.id\)\} \/><\/div>/);
    expect(shell).toMatch(/case MODULO_CALENDARIO\.id: return <CalendarioView \{\.\.\.vp\} \/>;\s*case MODULO_MIS_ACTIVIDADES\.id: return <CalendarioView \{\.\.\.vp\} personal \/>;/);
    expect(shell).toMatch(/view === MODULO_MI_ASISTENCIA\.id\s*\? <div className="mx-auto max-w-lg px-4 py-4"><MiAsistenciaView actions=\{actions\} onVolver=\{\(\) => go\(MODULO_CHOFER\.id\)\} \/><\/div>/);
    // Mobile-first (2026-10-09): "Mi asistencia" / "Mis actividades" van en el menú
    // ("Mi espacio"), no en la cabecera; la cabecera tiene UNA campana "Avisos".
    expect(shell).toMatch(/nav\.chrome\.miAsistencia && MODULO_MI_ASISTENCIA,\s*nav\.chrome\.misActividades && MODULO_MIS_ACTIVIDADES,/);
    expect(shell).not.toMatch(/data-testid="boton-mi-asistencia"|data-testid="boton-mis-actividades"/);
    expect((shell.match(/<Icons\.Bell \/>/g) || []).length).toBe(2);   // botón Avisos + ícono de cada notificación
    expect(shell).toMatch(/data-testid="boton-avisos"/);
    expect(shell).not.toMatch(/ModoPruebaBanner/);
    // 2026-10-09: el inicio de TODOS es 'dashboard': back office → su Dashboard; los demás → el Resumen de su rol (con su saludo).
    expect(shell).toMatch(/const esBackOffice = IDS_MODULOS\.has\('ordenes'\);/);
    expect(shell).toMatch(/case 'dashboard': return esBackOffice\s*\? <DashboardView data=\{data\} user=\{user\} actions=\{actions\} onNavigate=\{go\} \/>\s*: <ResumenRolView data=\{data\} user=\{usuarioVista\} actions=\{actions\} nav=\{nav\} onNavigate=\{go\} \/>;/);
    expect(shell).toMatch(/case 'bandeja': return <BandejaView data=\{data\} user=\{usuarioVista\} actions=\{actions\} onNavigate=\{go\} \/>;/);
    expect(src('../components/views/ResumenRolView.jsx')).toMatch(/data-testid="saludo-rol"/);
    expect(shell).toMatch(/case 'ventas': case 'ventas-hoy': case 'ventas-todas':\s*return <VentasStandaloneView embedded filtro=\{filtroVentasDesdeVista\(view\)\} onFiltro=\{f => go\(vistaDesdeFiltroVentas\(f\)\)\} user=\{usuarioRol \|\| user\} data=\{data\} actions=\{actions\} onLogout=\{onLogout\} \/>/);
    expect(shell).toMatch(/<ProduccionStandaloneView embedded tab=\{tabDesdeModulo\(view\)\} onTab=\{t => go\(moduloDesdeTab\('Producción', t\)\)\} user=\{usuarioRol \|\| user\} data=\{data\} actions=\{actions\} onLogout=\{onLogout\} \/>/);
    expect(shell).toMatch(/<BolsasView embedded user=\{usuarioRol \|\| user\} data=\{data\} actions=\{actions\} onLogout=\{onLogout\} \/>/);
    expect(shell).toMatch(/const vistaDeHash = useCallback\(\(hash\) => normalizarVista\(nav, viewDesdeHash\(hash, IDS_VISTAS\)\), \[nav, IDS_VISTAS\]\);/);
    expect(shell).toMatch(/useState\(\(\) => vistaDeHash\(window\.location\.hash\) \|\| nav\.inicio\)/);
    // B3.6: título, área y entrada activa del menú salen del módulo dueño de la vista.
    expect(shell).toMatch(/const modulo = moduloDeVista\(nav, view\) \|\| view;\s*const current = ALL_ITEMS\.find\(n => n\.id === modulo\) \|\| \[MODULO_MI_ASISTENCIA, MODULO_MIS_ACTIVIDADES, MODULO_MI_CUENTA\]\.find\(n => n\.id === modulo\);/);
    expect(shell).toMatch(/const active = \(area\.id === 'mi-espacio' \? view : modulo\) === item\.id;/);
    // alias y primer sync sin paso extra en el historial
    expect(shell).toMatch(/if \(!window\.location\.hash \|\| vistaDeHash\(window\.location\.hash\) === view\) \{\s*window\.history\.replaceState/);
    expect(shell).toMatch(/data-testid="dashboard-shell"/);
  });
  it('los 25 módulos de Admin siguen renderizando las mismas vistas', () => {
    for (const id of ADMIN_25) expect(shell, id).toMatch(new RegExp(`case '${id}': return (esBackOffice\\s*\\? )?<`));
    expect(shell).toMatch(/case MODULO_USUARIOS\.id: return <UsuariosView \{\.\.\.vp\} \/>;/);
  });
  it('las vistas por rol aceptan el modo embebido y conservan su testid de smoke', () => {
    expect(src('../components/VentasStandaloneView.jsx')).toMatch(/embedded = false, filtro: filtroProp, onFiltro/);
    expect(src('../components/ProduccionStandaloneView.jsx')).toMatch(/embedded = false, tab: tabProp, onTab/);
    expect(src('../components/BolsasView.jsx')).toMatch(/embedded = false/);
    expect(src('../components/VentasStandaloneView.jsx')).toMatch(/data-testid="ventas-shell"/);
    expect(src('../components/ChoferView.jsx')).toMatch(/data-testid="chofer-shell"/);
  });
});

describe('B3: navegación inferior móvil derivada del mismo modelo', async () => {
  const { bottomNavParaRol, PRINCIPALES_MOVIL_ADMIN, MAX_DESTINOS_MOVIL } = await import('../data/navRolLogic');
  it('Ventas y Almacén: Resumen, Mi bandeja y su módulo en la barra (sin "Más"); Producción: 4 primeros + "Más"', () => {
    const v = bottomNavParaRol(navParaRol('Ventas'));
    expect(v.mas).toBe(false);
    expect(v.items.map(i => i.id)).toEqual(['dashboard', 'bandeja', 'ventas']);
    const a = bottomNavParaRol(navParaRol('Almacén Bolsas'));
    expect(a.mas).toBe(false);
    expect(a.items.map(i => i.id)).toEqual(['dashboard', 'bandeja', 'bolsas-almacen']);
    const p = bottomNavParaRol(navParaRol('Producción'));   // 6 módulos: caben 4 + "Más" (Mermas y Preparar quedan en el menú)
    expect(p.mas).toBe(true);
    expect(p.items.map(i => i.id)).toEqual(['dashboard', 'bandeja', 'prod-producir', 'prod-cuartos']);
    expect(p.items.map(i => i.label)).toEqual(['Resumen', 'Mi bandeja', 'Producción', 'Congeladores']);
    expect(p.items.every(i => i.icon)).toBe(true);
    const e = bottomNavParaRol(navParaRol('Empleado'));
    expect(e.items.map(i => i.id)).toEqual(['dashboard', 'bandeja', 'mi-asistencia', 'mis-actividades']);
  });
  it('modo enfoque (Chofer): sin barra inferior', () => {
    expect(bottomNavParaRol(navParaRol('Chofer'))).toBeNull();
    expect(bottomNavParaRol(null)).toBeNull();
  });
  it('Admin / Facturación / Sin asignar: 4 destinos de uso diario + "Más"; el menú completo sigue con los 25 módulos', () => {
    for (const rol of ['Admin', 'Facturación', 'Sin asignar']) {
      const b = bottomNavParaRol(navParaRol(rol));
      expect(b.mas, rol).toBe(true);
      expect(b.items.map(i => i.id), rol).toEqual(PRINCIPALES_MOVIL_ADMIN);
      expect(b.items.length + 1, rol).toBeLessThanOrEqual(MAX_DESTINOS_MOVIL);
      expect([...idsModulos(navParaRol(rol))], rol).toEqual(modulosAdmin(rol));   // alcance intacto (+ Asistencia en Admin)
    }
    expect(PRINCIPALES_MOVIL_ADMIN).toEqual(['dashboard', 'bandeja', 'ordenes', 'cobros']);
    // Inicio (resumen, bandeja), Comercial (ventas) y Finanzas (por cobrar)
    expect(PRINCIPALES_MOVIL_ADMIN.map(id => areaDeModulo(navParaRol('Admin'), id).id)).toEqual(['inicio', 'inicio', 'comercial', 'finanzas']);
  });
  it('los ids de la barra son siempre ids válidos del menú del rol (mismo mecanismo de navegación)', () => {
    for (const rol of ROLES_VALIDOS) {
      const nav = navParaRol(rol); const b = bottomNavParaRol(nav);
      if (!b) continue;
      for (const i of b.items) expect(idsModulos(nav).has(i.id), `${rol}:${i.id}`).toBe(true);
      expect(idsModulos(nav).has(nav.inicio)).toBe(true);
    }
  });
});

describe('B3: shell y vistas', () => {
  const shell = src('../components/CuboPolarERP.jsx');
  it('el shell deriva la barra del modelo y navega con `go`; "Más" abre el drawer; el contenido deja espacio', () => {
    expect(shell).toMatch(/const bottomNav = useMemo\(\(\) => bottomNavParaRol\(nav\), \[nav\]\);/);
    expect(shell).toMatch(/<BottomNav items=\{bottomNav\.items\} value=\{modulo\} onChange=\{go\} mas=\{bottomNav\.mas\}/);
    expect(shell).toMatch(/onMas=\{\(\) => setMobileDrawerOpen\(true\)\}/);
    expect(shell).toMatch(/pb-\[calc\(env\(safe-area-inset-bottom,0px\)\+88px\)\]/);
    expect(shell).not.toMatch(/rol === ['"]Ventas['"]|rol === ['"]Producción['"]/);   // sin ramas por rol
    // Chofer (enfoque) devuelve antes de llegar a la barra: solo su barra operativa.
    expect(shell.indexOf("if (nav.modo === 'enfoque')")).toBeLessThan(shell.indexOf('{bottomNav && ('));
  });
  it('Producción no duplica pestañas dentro del shell; Ventas (B3.6) muestra sus filtros internos (no hay otro control)', () => {
    expect(src('../components/VentasStandaloneView.jsx')).toMatch(/<SegmentedTabs items=\{FILTROS\} value=\{filtro\} onChange=\{setFiltro\}/);
    expect(src('../components/VentasStandaloneView.jsx')).not.toMatch(/!embedded && <SegmentedTabs/);
    expect(src('../components/ProduccionStandaloneView.jsx')).toMatch(/\{!embedded && <SegmentedTabs items=\{TABS\}/);
    expect(src('../components/ChoferView.jsx')).not.toMatch(/BottomNav/);
    expect(src('../components/ChoferView.jsx')).toMatch(/fixed bottom-0 left-1\/2 z-40/);   // barra operativa intacta
  });
});
