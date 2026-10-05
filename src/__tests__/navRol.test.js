// navRol.test.js — Fase B: una sola fuente de navegación por rol.
// Prueba el modelo puro y la matriz de alcance por rol (qué módulos recibe
// cada rol). Admin / Facturación / Sin asignar conservan sus 25 módulos.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NAV_ROLES, AREAS_ADMIN, MODULOS_VENTAS, MODULOS_PRODUCCION, MODULO_BOLSAS, MODULO_CHOFER,
  navParaRol, idsModulos, itemsModulos, areaDeModulo, tabDesdeModulo, moduloDesdeTab, areasExpandidasInicial,
} from '../data/navRolLogic';
import { ROLES_VALIDOS } from '../data/adminUserLogic';
import { viewDesdeHash } from '../data/navegacionShellLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const ADMIN_25 = [
  'dashboard', 'bandeja', 'produccion', 'inventario', 'mermas', 'comodatos', 'rutas', 'bolsas',
  'ordenes', 'clientes', 'leads', 'precios', 'productos',
  'contabilidad', 'cobros', 'proveedores', 'devoluciones', 'costos', 'facturacion', 'conciliacion', 'nomina',
  'empleados', 'kardex', 'auditoria', 'configuracion',
];

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
  it('Admin, Facturación y Sin asignar: los mismos 25 módulos de siempre (alcance sin cambio)', () => {
    for (const rol of ['Admin', 'Facturación', 'Sin asignar']) {
      const nav = navParaRol(rol);
      expect(nav.modo).toBe('completo');
      expect(nav.areas).toBe(AREAS_ADMIN);
      expect([...idsModulos(nav)]).toEqual(ADMIN_25);
      expect(nav.inicio).toBe('dashboard');
      expect(nav.chrome.busqueda && nav.chrome.alertas && nav.chrome.notificaciones && nav.chrome.firmas).toBe(true);
    }
    expect(navParaRol('Admin').chrome.verComo).toBe(true);
    expect(navParaRol('Facturación').chrome.verComo).toBe(false);
    expect(navParaRol('Sin asignar').chrome.verComo).toBe(false);
    expect(AREAS_ADMIN.map(a => a.id)).toEqual(['operacion', 'comercial', 'finanzas', 'equipo']);
  });
  it('Ventas: sus tres pestañas como módulos; Producción: sus cuatro; Bolsas: uno; Chofer: enfoque', () => {
    expect([...idsModulos(navParaRol('Ventas'))]).toEqual(['ventas-cobrar', 'ventas-hoy', 'ventas-todas']);
    expect(navParaRol('Ventas').inicio).toBe('ventas-cobrar');       // = pestaña "ventas" (Por cobrar), la de siempre
    expect([...idsModulos(navParaRol('Producción'))]).toEqual(['prod-producir', 'prod-cuartos', 'prod-mermas', 'prod-trans']);
    expect(navParaRol('Producción').inicio).toBe('prod-producir');   // = pestaña "producir", la de siempre
    expect(navParaRol('Producción').chrome.firmas).toBe(true);
    expect([...idsModulos(navParaRol('Almacén Bolsas'))]).toEqual([MODULO_BOLSAS.id]);
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
    for (const n of [...MODULOS_VENTAS, ...MODULOS_PRODUCCION, MODULO_BOLSAS, MODULO_CHOFER]) expect(admin.has(n.id), n.id).toBe(false);
    for (const nav of Object.values(NAV_ROLES)) expect(new Set([...idsModulos(nav)]).size).toBe(idsModulos(nav).size);
    expect(todos.length).toBeGreaterThan(0);
  });
  it('pestaña ↔ módulo es biyectiva y los labels de Ventas son los de siempre', () => {
    for (const m of MODULOS_VENTAS) expect(moduloDesdeTab('Ventas', tabDesdeModulo(m.id))).toBe(m.id);
    for (const m of MODULOS_PRODUCCION) expect(moduloDesdeTab('Producción', tabDesdeModulo(m.id))).toBe(m.id);
    expect(MODULOS_VENTAS.map(m => [m.tab, m.label])).toEqual([['ventas', 'Por cobrar'], ['hoy', 'Hoy'], ['todas', 'Todas']]);
    expect(MODULOS_PRODUCCION.map(m => m.tab)).toEqual(['producir', 'cuartos', 'mermas', 'trans']);
    expect(tabDesdeModulo('dashboard')).toBeNull();
    expect(moduloDesdeTab('Admin', 'hoy')).toBeNull();
  });
  it('helpers: área de un módulo, items planos, áreas expandidas, deep link por rol', () => {
    expect(areaDeModulo(navParaRol('Admin'), 'cobros').id).toBe('finanzas');
    expect(areaDeModulo(navParaRol('Ventas'), 'ventas-hoy').id).toBe('ventas');
    expect(areaDeModulo(navParaRol('Ventas'), 'cobros')).toBeNull();
    expect(itemsModulos(navParaRol('Producción')).map(i => i.id)).toEqual(['prod-producir', 'prod-cuartos', 'prod-mermas', 'prod-trans']);
    expect(areasExpandidasInicial(navParaRol('Admin'))).toEqual({ operacion: true, comercial: true, finanzas: false, equipo: false });
    expect(areasExpandidasInicial(navParaRol('Ventas'))).toEqual({ ventas: true });
    // Un hash de Admin no abre nada en el menú de Ventas (cae al inicio del rol).
    expect(viewDesdeHash('#/cobros', idsModulos(navParaRol('Ventas')))).toBeNull();
    expect(viewDesdeHash('#/ventas-hoy', idsModulos(navParaRol('Ventas')))).toBe('ventas-hoy');
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
    expect(app).toMatch(/if \(user\?\.rol === 'Ventas'\) \{/);
    // "Ver como": sigue siendo preview con autorización de Admin (handleLogout vuelve a Admin).
    expect(app).toMatch(/if \(isAdmin && adminViewAs\) \{\s*setAdminViewAs\(null\)\s*return\s*\}/);
  });
  it('el shell deriva menú, inicio, chrome y modo de navRolLogic; AREAS ya no viven en el shell', () => {
    expect(shell).toMatch(/const nav = useMemo\(\(\) => navParaRol\(rol\), \[rol\]\);/);
    expect(shell).not.toMatch(/\bconst AREAS = \[/);
    expect(shell).toMatch(/\{nav\.areas\.map\(area => \{/);
    expect(shell).toMatch(/\{nav\.areas\.map\(area => \(/);
    expect(shell).toMatch(/onViewAs && nav\.chrome\.verComo &&/);
    expect(shell).toMatch(/nav\.chrome\.busqueda && <BusquedaGlobal/);
    expect(shell).toMatch(/nav\.chrome\.firmas && <BotonFirmasPendientes/);
    expect(shell).toMatch(/if \(nav\.modo === 'enfoque'\) \{/);
    expect(shell).toMatch(/<ChoferView user=\{usuarioRol \|\| user\} data=\{data\} actions=\{actions\} onLogout=\{onLogout\} \/>/);
    expect(shell).toMatch(/<VentasStandaloneView embedded tab=\{tabDesdeModulo\(view\)\} onTab=\{t => go\(moduloDesdeTab\('Ventas', t\)\)\} user=\{usuarioRol \|\| user\} data=\{data\} actions=\{actions\} onLogout=\{onLogout\} \/>/);
    expect(shell).toMatch(/<ProduccionStandaloneView embedded tab=\{tabDesdeModulo\(view\)\} onTab=\{t => go\(moduloDesdeTab\('Producción', t\)\)\} user=\{usuarioRol \|\| user\} data=\{data\} actions=\{actions\} onLogout=\{onLogout\} \/>/);
    expect(shell).toMatch(/<BolsasView embedded user=\{usuarioRol \|\| user\} data=\{data\} actions=\{actions\} onLogout=\{onLogout\} \/>/);
    expect(shell).toMatch(/viewDesdeHash\(window\.location\.hash, IDS_MODULOS\) \|\| nav\.inicio/);
    expect(shell).toMatch(/data-testid="dashboard-shell"/);
  });
  it('los 25 módulos de Admin siguen renderizando las mismas vistas', () => {
    for (const id of ADMIN_25) expect(shell, id).toMatch(new RegExp(`case '${id}': return <`));
  });
  it('las vistas por rol aceptan el modo embebido y conservan su testid de smoke', () => {
    expect(src('../components/VentasStandaloneView.jsx')).toMatch(/embedded = false, tab: tabProp, onTab/);
    expect(src('../components/ProduccionStandaloneView.jsx')).toMatch(/embedded = false, tab: tabProp, onTab/);
    expect(src('../components/BolsasView.jsx')).toMatch(/embedded = false/);
    expect(src('../components/VentasStandaloneView.jsx')).toMatch(/data-testid="ventas-shell"/);
    expect(src('../components/ChoferView.jsx')).toMatch(/data-testid="chofer-shell"/);
  });
});
