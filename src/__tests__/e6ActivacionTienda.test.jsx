// e6ActivacionTienda.test.jsx — Tiendas E6: configuración y activación controlada de una tienda de fábrica.
// Reglas de la pantalla (permisos separados y explícitos, lista de verificación del servidor,
// retiro con confirmación) y garantías del código: solo contratos, nada por REST, y el
// interruptor general fuera de la aplicación.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { permisosPorRol, usuariosAsignables, construirAsignacion, resumenVerificacion, normalizarClave, clasificarErrorPos } from '../data/posLogic';
import { TiendaConfigPanel } from '../components/views/TiendaConfigPanel';
import { TiendasAdminView } from '../components/views/TiendasAdminView';

const ruta = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const src = (rel) => readFileSync(ruta(rel), 'utf8');
const sinComentarios = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

describe('E6: permisos de inventario — dos, separados y nunca implícitos', () => {
  it('cada rol admite a lo más UNO de los dos permisos', () => {
    expect(permisosPorRol('Ventas')).toEqual({ asignable: true, vende: true, traspasa: false });
    expect(permisosPorRol('Producción')).toEqual({ asignable: true, vende: false, traspasa: true });
    expect(permisosPorRol('Admin')).toEqual({ asignable: true, vende: false, traspasa: true });
    for (const r of ['Chofer', 'Empleado', 'Almacén Bolsas', 'Facturación', 'Sin asignar', 'Ventas Tienda', undefined]) {
      expect(permisosPorRol(r)).toEqual({ asignable: false, vende: false, traspasa: false });
    }
    for (const r of ['Ventas', 'Producción', 'Admin']) { const p = permisosPorRol(r); expect(p.vende && p.traspasa).toBe(false); }
  });
  it('los dos permisos viajan SIEMPRE como sí o no; sin decirlo no se manda nada', () => {
    const cajero = { id: 6, rol: 'Ventas' };
    expect(construirAsignacion({ establecimientoId: 7, usuario: cajero, vendeDesdeCedis: true, traspasaConCedis: false }).args)
      .toEqual({ p_establecimiento_id: 7, p_usuario_id: 6, p_vende_desde_cedis: true, p_traspasa_con_cedis: false });
    for (const [v, t] of [[undefined, false], [true, undefined], [null, null], ['si', false]]) {
      expect(construirAsignacion({ establecimientoId: 7, usuario: cajero, vendeDesdeCedis: v, traspasaConCedis: t }).error).toMatch(/sí o no/);
    }
  });
  it('un permiso que no corresponde al rol se rechaza antes de llamar al servidor', () => {
    expect(construirAsignacion({ establecimientoId: 7, usuario: { id: 6, rol: 'Ventas' }, vendeDesdeCedis: false, traspasaConCedis: true }).error).toMatch(/Producción o Administración/);
    expect(construirAsignacion({ establecimientoId: 7, usuario: { id: 3, rol: 'Producción' }, vendeDesdeCedis: true, traspasaConCedis: false }).error).toMatch(/cajero/);
    expect(construirAsignacion({ establecimientoId: 7, usuario: { id: 1, rol: 'Admin' }, vendeDesdeCedis: true, traspasaConCedis: false }).error).toMatch(/cajero/);
    expect(construirAsignacion({ establecimientoId: 7, usuario: { id: 1, rol: 'Admin' }, vendeDesdeCedis: false, traspasaConCedis: false }).args.p_traspasa_con_cedis).toBe(false);
    expect(construirAsignacion({ establecimientoId: 7, usuario: { id: 9, rol: 'Chofer' }, vendeDesdeCedis: false, traspasaConCedis: false }).error).toMatch(/cajeros/);
    expect(construirAsignacion({ establecimientoId: null, usuario: { id: 6, rol: 'Ventas' }, vendeDesdeCedis: false, traspasaConCedis: false }).error).toMatch(/tienda/);
  });
  it('la pantalla nunca trae un permiso marcado: el formulario empieza en "no" y se reinicia al cambiar de persona', () => {
    const t = sinComentarios(src('../components/views/TiendaConfigPanel.jsx'));
    expect(t).toMatch(/usuarioId: '', vende: false, traspasa: false/);
    expect(t).toMatch(/usuarioId: e\.target\.value, vende: false, traspasa: false/);
    expect(t).not.toMatch(/vende: true|traspasa: true|defaultChecked/);
    // Y lo que no corresponde al rol se manda en "no", marque lo que marque el formulario.
    expect(t).toMatch(/vendeDesdeCedis: permisos\.vende \? !!f\.vende : false, traspasaConCedis: permisos\.traspasa \? !!f\.traspasa : false/);
  });
  it('se pueden asignar personas activas de un rol asignable que aún no están en la tienda', () => {
    const usuarios = [{ id: 1, nombre: 'Zoe', rol: 'Admin', estatus: 'Activo' }, { id: 2, nombre: 'Ana', rol: 'Ventas', estatus: 'Activo' }, { id: 3, nombre: 'Beto', rol: 'Ventas', estatus: 'Inactivo' },
      { id: 4, nombre: 'Caro', rol: 'Chofer', estatus: 'Activo' }, { id: 5, nombre: 'Dan', rol: 'Producción', estatus: 'Activo' }];
    expect(usuariosAsignables(usuarios, [{ usuario_id: 5 }]).map(u => u.nombre)).toEqual(['Ana', 'Zoe']);
    expect(usuariosAsignables(null, null)).toEqual([]);
  });
});

describe('E6: activación — la lista de verificación es del servidor', () => {
  const V = [{ clave: 'cuarto', obligatorio: true, ok: true }, { clave: 'caja', obligatorio: true, ok: false, texto: 'Tiene al menos una caja activa' },
    { clave: 'clientes', obligatorio: false, ok: false, texto: 'Sin clientes elegibles' }];
  it('solo está lista si no falta nada obligatorio; los avisos no bloquean', () => {
    expect(resumenVerificacion(V)).toMatchObject({ lista: false });
    expect(resumenVerificacion(V).faltan.map(x => x.clave)).toEqual(['caja']);
    expect(resumenVerificacion(V).avisos.map(x => x.clave)).toEqual(['clientes']);
    expect(resumenVerificacion(V.map(x => ({ ...x, ok: x.obligatorio ? true : x.ok }))).lista).toBe(true);
  });
  it('sin verificación del servidor NUNCA está lista', () => {
    for (const v of [null, undefined, [], 'x']) expect(resumenVerificacion(v).lista).toBe(false);
  });
  it('el botón de activar depende de esa lista y lleva un operacion_id estable', () => {
    const t = sinComentarios(src('../components/views/TiendaConfigPanel.jsx'));
    expect(t).toMatch(/onClick=\{\(\) => activar\(true\)\} disabled=\{ocupado \|\| !ver\.lista\}/);
    expect(t).toMatch(/p_operacion_id: opActivar\.current\.id, p_establecimiento_id: sel, p_activar: encender/);
    expect(t).toMatch(/Crear \(nace inactiva\)/);
  });
  it('el rechazo por tienda incompleta dice qué falta, en palabras', () => {
    const r = clasificarErrorPos({ code: '22023', message: 'activar_tienda: interno', details: JSON.stringify({ codigo: 'TIENDA_INCOMPLETA', faltan: ['caja', 'personal'] }) });
    expect(r).toMatchObject({ incierto: false, codigo: 'TIENDA_INCOMPLETA' });
    expect(r.mensaje).toBe('Para activar la tienda falta: una caja activa; un cajero asignado.');
    expect(clasificarErrorPos({ code: '22023', details: JSON.stringify({ codigo: 'TIENDA_INCOMPLETA' }) }).mensaje).toMatch(/falta configuración/);
  });
  it('los códigos nuevos tienen texto propio y ninguno muestra el mensaje interno', () => {
    for (const c of ['TURNOS_ABIERTOS', 'QUEDARIA_VENTAS_CENTRAL', 'PERMISOS_EXPLICITOS', 'ROL_NO_ASIGNABLE', 'PERMISO_NO_CORRESPONDE', 'USUARIO_NO_VALIDO', 'CLAVE_INVALIDA', 'CLAVE_REPETIDA',
      'CUARTO_CON_EXISTENCIA', 'CUARTO_DE_OTRA_TIENDA', 'MODO_INVALIDO', 'CLIENTE_NO_VALIDO', 'TRASPASO_NO_AUTORIZADO']) {
      const r = clasificarErrorPos({ code: '22023', message: 'contrato: detalle interno', details: JSON.stringify({ codigo: c }) });
      expect(r.codigo).toBe(c);
      expect(r.mensaje).not.toMatch(/detalle interno|No se pudo completar/);
    }
  });
  it('clave de tienda: mayúsculas, sin acentos, espacios ni signos', () => {
    expect(normalizarClave(' tienda fábrica-1 ')).toBe('TIENDAFABRICA-1');
    expect(normalizarClave('a'.repeat(40))).toHaveLength(20);
    expect(normalizarClave(null)).toBe('');
  });
});

describe('E6: garantías del código', () => {
  const store = src('../data/supaStore.js');
  it('el store llama a los 8 contratos de 147, todos detrás de requireAdmin', () => {
    for (const r of ['estado_tienda', 'guardar_establecimiento', 'asignar_cuarto_tienda', 'agregar_caja_tienda', 'asignar_usuario_tienda', 'retirar_usuario_tienda', 'configurar_clientes_tienda', 'activar_tienda']) {
      expect(store).toMatch(new RegExp(`'${r}'`));
    }
    for (const a of ['tiendaEstado', 'guardarEstablecimiento', 'asignarCuartoTienda', 'agregarCajaTienda', 'asignarUsuarioTienda', 'retirarUsuarioTienda', 'configurarClientesTienda', 'activarTienda']) {
      expect(store).toMatch(new RegExp(`${a}: async \\([^)]*\\) => \\{ const guard = requireAdmin\\(\\); if \\(guard\\) return guard;`));
    }
  });
  it('NADA en la aplicación ni en Netlify escribe la configuración de tiendas por REST ni toca el interruptor general', () => {
    const archivos = [];
    const andar = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) { if (!/__tests__|node_modules/.test(p)) andar(p); } else if (/\.(js|jsx|ts|tsx)$/.test(n)) archivos.push(p); } };
    andar(ruta('../')); andar(ruta('../../netlify/functions/'));
    expect(archivos.length).toBeGreaterThan(100);
    for (const f of archivos) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/from\(['"](establecimientos|usuario_establecimientos|establecimiento_clientes|tiendas_activacion|establecimiento_eventos)['"]\)/);
      expect(t, f).not.toMatch(/tiendas_activacion/);
    }
  });
  it('retirar a un cajero que quedaría como Ventas central pide confirmación explícita', () => {
    const t = sinComentarios(src('../components/views/TiendaConfigPanel.jsx'));
    expect(t).toMatch(/if \(r\?\.codigo === 'QUEDARIA_VENTAS_CENTRAL'\) setConfirmarRetiro\(p\)/);
    expect(t).toMatch(/retirar\(confirmarRetiro, true\)/);
    expect(t).toMatch(/const retirar = async \(p, confirmar = false\)/);
  });
  it('la pantalla de configuración no ofrece descuentos, crédito ni datos sensibles de clientes', () => {
    const t = sinComentarios(src('../components/views/TiendaConfigPanel.jsx'));
    expect(t).not.toMatch(/descuento|limite_credito|limiteCredito|credito_autorizado|\.rfc|\.saldo|\.correo|\.direccion/i);
  });
  it('sin habilitar las tiendas, la pantalla lo dice y no ofrece ningún botón para habilitarlas', () => {
    const html = renderToStaticMarkup(<TiendaConfigPanel data={{}} actions={{}} tiendas={[]} tiendasHabilitadas={false} />);
    expect(html).toMatch(/todavía no están habilitadas/);
    expect(html).not.toMatch(/<button/);
  });
  it('habilitadas: lista de tiendas con su estado y alta de una tienda nueva (que nace inactiva)', () => {
    const tiendas = [{ id: 7, clave: 'TF1', nombre: 'Fábrica', activo: false, lista_para_activar: true }, { id: 8, clave: 'TF2', nombre: 'Otra', activo: true }];
    const html = renderToStaticMarkup(<TiendaConfigPanel data={{}} actions={{ tiendaEstado: async () => ({ data: null }) }} tiendas={tiendas} tiendasHabilitadas />);
    expect(html).toMatch(/Lista para activar/);
    expect(html).toMatch(/Activa/);
    expect(html).toMatch(/Crear \(nace inactiva\)/);
    expect(renderToStaticMarkup(<TiendasAdminView data={{}} actions={new Proxy({}, { get: () => async () => ({ data: null }) })} />)).toMatch(/data-testid="tiendas-admin"/);
  });
});
