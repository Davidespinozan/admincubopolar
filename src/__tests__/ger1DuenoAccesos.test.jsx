// ger1DuenoAccesos.test.jsx — GER-1 (mig 120/121): Dueño, accesos adicionales
// por persona, contraseña temporal con cambio obligatorio, usuarios por
// contrato y bitácora. La autoridad vive en la base (suites 120 y 121); aquí
// se prueba la lógica pura, el menú por persona, las Netlify Functions y que
// el frontend ya no escribe `usuarios` por REST.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ACCESOS_EXTRA, ROLES_OPERATIVOS, esDueno, accesosDe, rolesDe, tieneRol, etiquetaRol, normalizarAccesos, puedeCrearRol,
  permisosSobreUsuario, validarCambioPassword, validarPasswordTemporal, correoSugerido, buildGuardarUsuarioArgs,
  mensajeErrorUsuario, describirCambio, debeCambiarPassword,
} from '../data/usuariosLogic';
import { navParaUsuario, navParaRol, idsModulos, idsVistas, bottomNavParaRol, normalizarVista, MODULO_USUARIOS, MODULO_MI_CUENTA } from '../data/navRolLogic';
import { createHandler as crearUsuario } from '../../netlify/functions/admin-create-user/index.js';
import { createHandler as restablecer } from '../../netlify/functions/admin-reset-password/index.js';
import { canAccessOrden } from '../../netlify/functions/_lib/auth.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';
import { PantallaCambioObligatorio, MiCuentaView } from '../components/CambiarPassword';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const DUENO = { id: 45, nombre: 'Santiago Mier', rol: 'Admin', es_dueno: true, accesos_extra: [] };
const ADMIN = { id: 2, nombre: 'Jessica Muñoz Gurrola', rol: 'Admin', es_dueno: false, accesos_extra: [] };
const ADMIN2 = { id: 3, nombre: 'Daniela Guadalupe Candia González', rol: 'Admin', accesos_extra: [] };
const MARIA = { id: 5, nombre: 'María de Jesús Ibarra Fernández', rol: 'Almacén Bolsas', accesos_extra: ['Ventas'], auth_id: 'a5' };
const VENTAS = { id: 6, nombre: 'Laura', rol: 'Ventas', accesos_extra: [], auth_id: 'a6' };

describe('roles, accesos y etiquetas', () => {
  it('el Dueño es Admin con bandera; los accesos se suman al rol principal', () => {
    expect(esDueno(DUENO) && !esDueno(ADMIN)).toBe(true);
    expect(rolesDe(MARIA)).toEqual(['Almacén Bolsas', 'Ventas']);
    expect(tieneRol(MARIA, 'Ventas') && tieneRol(MARIA, 'Almacén Bolsas') && !tieneRol(MARIA, 'Admin')).toBe(true);
    expect(accesosDe({ accesosExtra: ['Ventas'] })).toEqual(['Ventas']);
    expect(etiquetaRol(DUENO)).toBe('Dueño');
    expect(etiquetaRol(MARIA)).toBe('Almacén Bolsas + Ventas');
    expect(etiquetaRol(VENTAS)).toBe('Ventas');
  });
  it('solo Ventas y Almacén Bolsas como acceso; nunca el propio rol; Admin no lleva', () => {
    expect([...ACCESOS_EXTRA]).toEqual(['Ventas', 'Almacén Bolsas']);
    expect(normalizarAccesos('Almacén Bolsas', ['Ventas', 'Almacén Bolsas', 'Producción', 'Admin'])).toEqual(['Ventas']);
    expect(normalizarAccesos('Admin', ['Ventas'])).toEqual([]);
    expect(ROLES_OPERATIVOS).not.toContain('Admin');
  });
});

describe('quién puede qué (espejo de guardar_usuario)', () => {
  it('alta: el rol Admin solo lo crea el Dueño', () => {
    expect(puedeCrearRol(ADMIN, 'Ventas') && puedeCrearRol(ADMIN, 'Empleado')).toBe(true);
    expect(puedeCrearRol(ADMIN, 'Admin')).toBe(false);
    expect(puedeCrearRol(DUENO, 'Admin')).toBe(true);
    expect(puedeCrearRol(VENTAS, 'Ventas')).toBe(false);
  });
  it('Admin: operativos sí; otro Admin, el Dueño, sus accesos y él mismo, no', () => {
    expect(permisosSobreUsuario(ADMIN, VENTAS)).toMatchObject({ editar: true, rol: true, estatus: true, accesos: false, password: true });
    expect(permisosSobreUsuario(ADMIN, VENTAS).roles).not.toContain('Admin');
    expect(permisosSobreUsuario(ADMIN, ADMIN2)).toMatchObject({ rol: false, estatus: false, accesos: false, password: false });
    expect(permisosSobreUsuario(ADMIN, DUENO)).toMatchObject({ editar: false, password: false });
    expect(permisosSobreUsuario(ADMIN, ADMIN)).toMatchObject({ editar: true, rol: false, estatus: false, password: false });
    expect(permisosSobreUsuario(VENTAS, MARIA).editar).toBe(false);
  });
  it('Dueño: todo sobre los demás; no se quita el rol ni se desactiva', () => {
    expect(permisosSobreUsuario(DUENO, ADMIN)).toMatchObject({ rol: true, estatus: true, accesos: true, password: true });
    expect(permisosSobreUsuario(DUENO, ADMIN).roles).toContain('Admin');
    expect(permisosSobreUsuario(DUENO, DUENO)).toMatchObject({ editar: true, rol: false, estatus: false, password: false });
  });
  it('argumentos del contrato: los accesos solo viajan cuando los manda el Dueño', () => {
    expect(buildGuardarUsuarioArgs({ id: '5', nombre: ' María ', rol: 'Almacén Bolsas', estatus: 'Activo', accesosExtra: ['Ventas'] }))
      .toEqual({ p_usuario_id: 5, p_nombre: 'María', p_rol: 'Almacén Bolsas', p_estatus: 'Activo', p_accesos_extra: null });
    expect(buildGuardarUsuarioArgs({ id: 5, nombre: 'María', rol: 'Almacén Bolsas', estatus: 'Inactivo', accesosExtra: ['Ventas', 'Producción'] }, { incluirAccesos: true }))
      .toMatchObject({ p_estatus: 'Inactivo', p_accesos_extra: ['Ventas'] });
  });
});

describe('contraseñas', () => {
  it('cambio propio: actual, mínimo 8, distinta, confirmada y no obvia', () => {
    expect(validarCambioPassword({ actual: '', nueva: 'x', confirmar: 'x' }).error).toMatch(/actual/);
    expect(validarCambioPassword({ actual: '12345678', nueva: 'corta', confirmar: 'corta' }).error).toMatch(/al menos 8/);
    expect(validarCambioPassword({ actual: 'Hielo2026!', nueva: 'Hielo2026!', confirmar: 'Hielo2026!' }).error).toMatch(/distinta/);
    expect(validarCambioPassword({ actual: '12345678', nueva: 'Hielo2026!', confirmar: 'Hielo2026?' }).error).toMatch(/no coincide/);
    expect(validarCambioPassword({ actual: 'Hielo2026!', nueva: '12345678', confirmar: '12345678' }).error).toMatch(/menos obvia/);
    expect(validarCambioPassword({ actual: '12345678', nueva: 'Hielo2026!', confirmar: 'Hielo2026!' })).toEqual({ ok: true });
  });
  it('temporal: mínimo 8 (12345678 se acepta porque obliga a cambiarla)', () => {
    expect(validarPasswordTemporal('1234567').error).toMatch(/al menos 8/);
    expect(validarPasswordTemporal('12345678')).toEqual({ ok: true });
    expect(debeCambiarPassword({ debe_cambiar_password: true })).toBe(true);
  });
  it('correo sugerido: nombre.apellido.rol@cubopolar.com, sin acentos', () => {
    expect(correoSugerido('Jessica Muñoz Gurrola', 'Admin')).toBe('jessica.munoz.admin@cubopolar.com');
    expect(correoSugerido('Daniela Guadalupe Candia González', 'Admin')).toBe('daniela.candia.admin@cubopolar.com');
    expect(correoSugerido('María de Jesús Ibarra Fernández', 'Almacén Bolsas')).toBe('maria.ibarra.almacen@cubopolar.com');
    expect(correoSugerido('Pedro', 'Chofer')).toBe('pedro.chofer@cubopolar.com');
    expect(correoSugerido('', 'Ventas')).toBe('');
  });
  it('errores del servidor en lenguaje de la persona', () => {
    expect(mensajeErrorUsuario({ message: 'guardar_usuario: solo el Dueño asigna el rol Admin' })).toBe('Solo el Dueño asigna el rol Admin.');
    expect(mensajeErrorUsuario({ message: 'confirmar_cambio_password: la contraseña sigue siendo la temporal' })).toMatch(/temporal/);
    expect(mensajeErrorUsuario({ message: 'Invalid login credentials' })).toMatch(/actual no es correcta/);
    expect(mensajeErrorUsuario({ message: 'New password should be different from the old password.' })).toMatch(/distinta/);
  });
  it('pantalla obligatoria y "Mi cuenta" se renderizan', () => {
    const h = renderToStaticMarkup(<PantallaCambioObligatorio user={{ nombre: 'María de Jesús' }} actions={{}} onListo={() => {}} onLogout={() => {}} />);
    expect(h).toMatch(/data-testid="cambio-obligatorio"/);
    expect(h).toMatch(/María, entraste/);
    expect(h).toMatch(/Guardar y entrar/);
    expect(renderToStaticMarkup(<MiCuentaView user={MARIA} actions={{}} />)).toMatch(/Almacén Bolsas \+ Ventas/);
  });
});

describe('menú por persona', () => {
  it('María (Almacén + Ventas): los dos espacios juntos, con barra inferior y los filtros de Ventas', () => {
    const nav = navParaUsuario(MARIA);
    expect([...idsModulos(nav)]).toEqual(['dashboard', 'bandeja', 'bolsas-almacen', 'ventas']);
    expect(nav.inicio).toBe('dashboard');   // su Resumen, con las cifras de los dos espacios
    expect(bottomNavParaRol(nav).items.map(i => i.id)).toEqual(['dashboard', 'bandeja', 'bolsas-almacen', 'ventas']);
    expect(bottomNavParaRol(nav).mas).toBe(false);
    expect(normalizarVista(nav, 'ventas-hoy')).toBe('ventas-hoy');
    expect(normalizarVista(nav, 'ventas-cobrar')).toBe('ventas');
    expect(normalizarVista(nav, 'cobros')).toBeNull();           // nada de back office
    expect(idsVistas(nav).has(MODULO_MI_CUENTA.id)).toBe(true);
  });
  it('sin accesos, el menú es el de su rol; un acceso que no existe no agrega nada', () => {
    expect(navParaUsuario(VENTAS)).toBe(navParaRol('Ventas'));
    expect(navParaUsuario({ rol: 'Almacén Bolsas', accesos_extra: ['Admin', 'Inventado'] })).toBe(navParaRol('Almacén Bolsas'));
    expect(navParaUsuario(ADMIN)).toBe(navParaRol('Admin'));
  });
  it('Dueño: el mismo menú de Admin (sin panel aparte); lo suyo vive en Usuarios y en Auditoría', () => {
    expect(navParaUsuario(DUENO)).toBe(navParaRol('Admin'));
    expect(idsModulos(navParaUsuario(DUENO)).has('dueno')).toBe(false);
    expect(normalizarVista(navParaUsuario(DUENO), 'dueno')).toBe('auditoria');     // el enlace viejo abre Auditoría
    expect(MODULO_USUARIOS).toEqual({ id: 'usuarios', label: 'Usuarios', icon: 'Users' });
    expect(idsModulos(navParaRol('Admin')).has('usuarios')).toBe(true);
    for (const rol of ['Facturación', 'Sin asignar', 'Ventas']) expect(idsModulos(navParaRol(rol)).has('usuarios'), rol).toBe(false);
    // La bitácora es una pestaña de Auditoría que solo ve el Dueño (RLS dueno_read la protege de verdad).
    const aud = src('../components/views/AuditoriaView.jsx');
    expect(aud).toMatch(/const dueno = esDueno\(user\);/);
    expect(aud).toMatch(/\{dueno && tab === 'cambios' \? <BitacoraCambios actions=\{actions\} \/> : \(/);
  });
  it('el shell usa el menú de la persona y ofrece "Mi cuenta" a todos (también al Chofer)', () => {
    const shell = src('../components/CuboPolarERP.jsx');
    // App SIEMPRE manda rolVista (el propio o el de "Ver como"): solo si difiere del propio se usa el menú puro del rol.
    expect(shell).toMatch(/const viendoComo = !!rolVista && rolVista !== user\?\.rol;/);
    expect(src('../App.jsx')).toMatch(/rolVista=\{effectiveRole\}/);
    expect(shell).toMatch(/case MODULO_USUARIOS\.id: return <UsuariosView \{\.\.\.vp\} \/>;/);
    expect(shell).not.toMatch(/DuenoView|MODULO_DUENO/);
    expect(shell).toMatch(/case MODULO_MI_CUENTA\.id: return <MiCuentaView user=\{user\} actions=\{actions\} \/>;/);
    expect(shell).toMatch(/MODULO_MI_CUENTA,\s*\]\.filter\(Boolean\)/);
    expect(src('../components/ChoferView.jsx')).toMatch(/data-testid="chofer-mi-cuenta"/);
  });
  it('App: cambio obligatorio antes de cargar datos', () => {
    const app = src('../App.jsx');
    expect(app).toMatch(/useSupaStore\(bloqueadoPorPassword \? undefined : user\?\.id/);
    expect(app).toMatch(/if \(bloqueadoPorPassword\) \{/);
    expect(app.indexOf('if (bloqueadoPorPassword) {')).toBeLessThan(app.indexOf('if (loading) return'));
  });
});

describe('Netlify: alta, restablecer y alcance de órdenes', () => {
  const evento = (b) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(b) });
  const como = (profile) => async () => ({ profile });
  const alta = { email: 'jessica.munoz.admin@cubopolar.com', password: '12345678', nombre: 'Jessica Muñoz Gurrola', rol: 'Admin' };

  it('Admin no crea otro Admin; el Dueño sí; con forzarCambio queda con contraseña temporal', async () => {
    const fake = makeFakeSupabase({}, { authId: 'uuid-j' });
    const r1 = await crearUsuario({ getProfile: como(ADMIN), getSupabase: () => fake })(evento(alta));
    expect(r1.statusCode).toBe(403);
    expect(fake.authCalls.createUser).toHaveLength(0);
    const r2 = await crearUsuario({ getProfile: como(DUENO), getSupabase: () => fake })(evento({ ...alta, forzarCambio: true }));
    expect(r2.statusCode).toBe(200);
    expect(JSON.parse(r2.body).temporal).toBe(true);
    expect(fake.rpcs).toEqual([{ name: 'fijar_password_temporal', args: { p_usuario_id: fake.db.usuarios[0].id, p_por: 'Santiago Mier' } }]);
  });
  it('si no se pudo fijar la temporal, el alta no se revierte y se avisa', async () => {
    const fake = makeFakeSupabase({}, { authId: 'uuid-v', rpcImpl: { fijar_password_temporal: () => ({ data: null, error: { message: 'boom' } }) } });
    const r = await crearUsuario({ getProfile: como(ADMIN), getSupabase: () => fake })(evento({ ...alta, rol: 'Ventas', forzarCambio: true }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).temporal).toBe(false);
    expect(fake.authCalls.deleteUser).toHaveLength(0);
  });
  it('restablecer: Admin a un operativo (Auth + huella); no a otro Admin, ni al Dueño, ni a sí mismo', async () => {
    const db = { usuarios: [{ ...VENTAS }, { ...ADMIN2, auth_id: 'a3' }, { ...DUENO, auth_id: 'a45' }, { ...ADMIN, auth_id: 'a2' }] };
    const fake = makeFakeSupabase(db);
    const h = restablecer({ getProfile: como(ADMIN), getSupabase: () => fake });
    const ok = await h(evento({ usuarioId: 6, password: '12345678', forzarCambio: true }));
    expect(ok.statusCode).toBe(200);
    expect(fake.authCalls.updateUserById).toEqual([{ id: 'a6', attrs: { password: '12345678' } }]);
    expect(fake.rpcs.at(-1)).toEqual({ name: 'fijar_password_temporal', args: { p_usuario_id: 6, p_por: 'Jessica Muñoz Gurrola' } });
    for (const id of [3, 45, 2]) expect((await h(evento({ usuarioId: id, password: '12345678' }))).statusCode, `usuario ${id}`).toBe(403);
    expect(fake.authCalls.updateUserById).toHaveLength(1);
    expect((await h(evento({ usuarioId: 6, password: '123' }))).statusCode).toBe(400);
    expect((await restablecer({ getProfile: como(VENTAS), getSupabase: () => fake })(evento({ usuarioId: 6, password: '12345678' }))).statusCode).toBe(403);
    expect((await restablecer({ getProfile: como(DUENO), getSupabase: () => fake })(evento({ usuarioId: 3, password: '12345678' }))).statusCode).toBe(200);
  });
  it('restablecer: si la huella no se fija, 500 TEMPORAL_NO_FIJADA (reintentar lo corrige)', async () => {
    const fake = makeFakeSupabase({ usuarios: [{ ...VENTAS }] }, { rpcImpl: { fijar_password_temporal: () => ({ data: null, error: { message: 'x' } }) } });
    const r = await restablecer({ getProfile: como(ADMIN), getSupabase: () => fake })(evento({ usuarioId: 6, password: '12345678', forzarCambio: true }));
    expect(r.statusCode).toBe(500);
    expect(JSON.parse(r.body).code).toBe('TEMPORAL_NO_FIJADA');
  });
  it('cambio obligatorio OPCIONAL (decisión del dueño): sin forzarCambio la contraseña queda como definitiva', async () => {
    const fake = makeFakeSupabase({}, { authId: 'uuid-m' });
    const r = await crearUsuario({ getProfile: como(DUENO), getSupabase: () => fake })(evento({ ...alta, rol: 'Ventas' }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ temporal: false, forzarCambio: false });
    expect(fake.rpcs).toHaveLength(0);                                   // no se fija huella ni cambio obligatorio
    const fake2 = makeFakeSupabase({ usuarios: [{ ...VENTAS, debe_cambiar_password: true }] });
    const r2 = await restablecer({ getProfile: como(ADMIN), getSupabase: () => fake2 })(evento({ usuarioId: 6, password: '12345678' }));
    expect(r2.statusCode).toBe(200);
    expect(JSON.parse(r2.body).temporal).toBe(false);
    expect(fake2.rpcs).toHaveLength(0);
    expect(fake2.db.usuarios[0].debe_cambiar_password).toBe(false);      // y la cuenta queda liberada
    const panel = src('../components/UsuariosPanel.jsx');
    expect(panel).toMatch(/data-testid="casilla-forzar-cambio"/);
    expect(panel).toMatch(/password: PASSWORD_INICIAL, accesos: \[\], forzar: false \}/);   // nace apagada
  });
  it('el acceso adicional de Ventas ve sus órdenes como un vendedor; Almacén solo, no', async () => {
    const supabase = makeFakeSupabase();
    expect(await canAccessOrden({ profile: MARIA, orden: { vendedor_id: 5 }, supabase })).toBe(true);
    expect(await canAccessOrden({ profile: MARIA, orden: { vendedor_id: 6 }, supabase })).toBe(false);
    expect(await canAccessOrden({ profile: { id: 7, rol: 'Almacén Bolsas', accesos_extra: [] }, orden: { vendedor_id: 7 }, supabase })).toBe(false);
  });
  it('con contraseña temporal no hay perfil para las funciones (igual que en la base)', () => {
    const auth = src('../../netlify/functions/_lib/auth.js');
    expect(auth).toMatch(/if \(profile\.debe_cambiar_password\) return \{ errorResponse: unauthorized\('Password change required'\) \};/);
    expect(auth).toMatch(/\.select\('\*'\)/);   // tolera el esquema anterior a 120
  });
});

describe('bitácora y contención', () => {
  it('describe un cambio de precio y marca lo sensible', () => {
    const c = describirCambio({ id: 1, tabla: 'productos', accion: 'UPDATE', actor: 'Jessica', cambios: ['precio'], antes: { sku: 'HPC-5K', nombre: 'Hielo 5 kg', precio: 31 }, despues: { sku: 'HPC-5K', nombre: 'Hielo 5 kg', precio: 25 } });
    expect(c).toMatchObject({ modulo: 'Catálogo', titulo: 'Jessica cambió Hielo 5 kg', importante: true });
    expect(c.cambios).toEqual([{ campo: 'precio', antes: '31', despues: '25' }]);
    expect(describirCambio({ tabla: 'usuarios', accion: 'CONTRATO', detalle: 'guardar_usuario', actor: 'Santiago', antes: { rol: 'Almacén Bolsas', accesos_extra: [] }, despues: { nombre: 'María', rol: 'Almacén Bolsas', accesos_extra: ['Ventas'] }, cambios: ['accesos_extra'] }))
      .toMatchObject({ modulo: 'Usuarios', importante: true, cambios: [{ campo: 'accesos', antes: 'ninguno', despues: 'Ventas' }] });
    expect(describirCambio({ tabla: 'clientes', accion: 'UPDATE', cambios: ['telefono'], antes: {}, despues: {} }).importante).toBe(false);
    expect(describirCambio({ tabla: 'ordenes', accion: 'DELETE', antes: { folio: 'OV-1' } })).toMatchObject({ importante: true, titulo: 'Sistema borró OV-1' });
  });
  it('el frontend ya no escribe usuarios por REST', () => {
    const store = src('../data/supaStore.js');
    expect(store).not.toMatch(/from\('usuarios'\)\.(insert|update|delete)\(/);
    expect(store).toMatch(/supabase\.rpc\('guardar_usuario', buildGuardarUsuarioArgs\(u, \{ incluirAccesos \}\)\)/);
    expect(store).toMatch(/backendPost\('admin-reset-password'/);
    // 2026-10-09: Usuarios es su propio módulo (Sistema → Usuarios); Ajustes queda para los datos de la empresa.
    expect(src('../components/views/UsuariosView.jsx')).toMatch(/<UsuariosPanel data=\{data\} actions=\{actions\} user=\{user\} \/>/);
    expect(src('../components/views/ConfiguracionView.jsx')).not.toMatch(/UsuariosPanel/);
    expect(src('../components/views/ConfiguracionView.jsx')).not.toMatch(/deleteUsuario|updateUsuario/);
  });
  it('las migraciones: 120 aditiva y 121 solo quita la escritura REST de usuarios', () => {
    const m120 = src('../../supabase/120_ger1_dueno_accesos.sql');
    expect(m120).toMatch(/CHECK \(accesos_extra <@ ARRAY\['Ventas', 'Almacén Bolsas'\]::TEXT\[\]/);
    expect(m120).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS usuarios_un_dueno/);
    expect(m120).toMatch(/AND NOT u\.debe_cambiar_password/);
    expect(m120).toMatch(/WITH CHECK \(pg_trigger_depth\(\) > 0\)/);
    expect(m120).not.toMatch(/DROP POLICY IF EXISTS admin_all|REVOKE INSERT, UPDATE, DELETE ON public\.usuarios/);
    const m121 = src('../../supabase/121_ger1_contencion_usuarios.sql').replace(/--.*$/gm, '');
    expect(m121.replace(/\s+/g, ' ').trim()).toBe('BEGIN; DROP POLICY IF EXISTS admin_all ON public.usuarios; REVOKE INSERT, UPDATE, DELETE ON public.usuarios FROM authenticated; REVOKE ALL ON SEQUENCE public.usuarios_id_seq FROM authenticated; COMMIT;');
  });
});
