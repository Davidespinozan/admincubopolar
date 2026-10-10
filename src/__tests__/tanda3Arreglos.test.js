// Tanda 3 de la revisión del 2026-10-10: receptor de la factura, datos fiscales
// del cliente, usuario dado de baja, captura manual de asistencia y rastro del servidor.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  tipoRfc, fiscalesPorOmision, regimenCompatible, faltantesFiscales, receptorDeFactura, etiquetaRegimen, USOS_CFDI, CODIGOS_OFRECER_PUBLICO,
} from '../data/receptorFiscalLogic';
import { decidirReceptor, periodoGlobal, regimenReconocido } from '../../netlify/functions/_lib/invoiceLogic.js';
import { registrarRastro } from '../../netlify/functions/_lib/rastro.js';
import { buildUserFromSessionAndProfile, perfilInactivo } from '../lib/sessionUser';
import { buildAsistenciaManualArgs } from '../data/asistenciaLogic';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

describe('datos fiscales del cliente', () => {
  it('tipo de persona por RFC', () => {
    expect(tipoRfc('FPH260120AB3')).toBe('moral');
    expect(tipoRfc('GOMJ800101AB1')).toBe('fisica');
    expect(tipoRfc('xaxx010101000')).toBe('generico');
    expect(tipoRfc('')).toBeNull();
    expect(tipoRfc('ABC')).toBeNull();
  });
  it('por omisión: moral 601, física 612, sin RFC 616 + S01 (ya no 616 + G03 para todos)', () => {
    expect(fiscalesPorOmision('FPH260120AB3')).toEqual({ regimen: '601', usoCfdi: 'G03' });
    expect(fiscalesPorOmision('GOMJ800101AB1')).toEqual({ regimen: '612', usoCfdi: 'G03' });
    expect(fiscalesPorOmision('XAXX010101000')).toEqual({ regimen: '616', usoCfdi: 'S01' });
    expect(fiscalesPorOmision('')).toEqual({ regimen: '616', usoCfdi: 'S01' });
  });
  it('el uso "P01" ya no se ofrece (no existe en CFDI 4.0)', () => {
    expect(USOS_CFDI.map(u => u.value)).toEqual(['G01', 'G03', 'S01']);
    expect(leer('../components/views/ClientesView.jsx')).not.toMatch(/"P01"/);
  });
  it('régimen compatible con el tipo de persona', () => {
    expect(regimenCompatible('FPH260120AB3', '601')).toBe(true);
    expect(regimenCompatible('FPH260120AB3', '612')).toBe(false);
    expect(regimenCompatible('GOMJ800101AB1', '626')).toBe(true);
    expect(regimenCompatible('GOMJ800101AB1', '')).toBe(false);
  });
  it('lo que le falta a un cliente con RFC propio', () => {
    expect(faltantesFiscales({ rfc: 'FPH260120AB3', regimen: '601', cp: '34186', usoCfdi: 'G03' })).toEqual([]);
    expect(faltantesFiscales({ rfc: 'XAXX010101000' })).toEqual([]);
    const f = faltantesFiscales({ rfc: 'FPH260120AB3', regimen: '616', cp: '', usoCfdi: 'P01' });
    expect(f).toHaveLength(3);
    expect(f.join(' ')).toMatch(/616/);
    expect(f.join(' ')).toMatch(/código postal fiscal/);
    expect(f.join(' ')).toMatch(/P01/);
    expect(faltantesFiscales({ rfc: 'FPH260120AB3', regimen: '612', cp: '34186' })[0]).toMatch(/persona moral/);
  });
  it('vista previa: muestra el receptor REAL (público en general si no hay RFC propio)', () => {
    expect(receptorDeFactura(null, { cpEmisor: '34186' })).toMatchObject({ publicoGeneral: true, rfc: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL', cp: '34186', usoCfdi: 'S01' });
    expect(receptorDeFactura({ nombre: 'Tienda', rfc: 'XAXX010101000', cp: '99999' }, { cpEmisor: '34186' }).cp).toBe('34186');
    const r = receptorDeFactura({ nombre: 'LEVIN SA', rfc: 'fph260120ab3', regimen: '601', uso_cfdi: 'G01', cp: '34000' });
    expect(r).toMatchObject({ publicoGeneral: false, nombre: 'LEVIN SA', rfc: 'FPH260120AB3', regimen: '601', usoCfdi: 'G01', cp: '34000', faltan: [] });
    expect(etiquetaRegimen('601')).toBe('601 — General de Ley Personas Morales');
  });
  it('alta rápida de cliente: sin CP inventado ("34000") ni régimen 616 para quien pide factura', () => {
    const src = leer('../components/NuevaVentaModal.jsx');
    expect(src).not.toMatch(/'34000'/);
    expect(src).toMatch(/Código postal fiscal \*/);
    expect(src).toMatch(/fiscalesPorOmision\(cliForm\.rfc\)\.regimen/);
  });
  it('Clientes: CP fiscal separado del de entrega y guardado de ambos', () => {
    const vista = leer('../components/views/ClientesView.jsx');
    expect(vista).toMatch(/CP fiscal/);
    expect(vista).not.toMatch(/cp: form\.codigo_postal \|\| form\.cp/);
    const store = leer('../data/supaStore.js');
    expect(store).toMatch(/codigo_postal: c\.codigo_postal \|\| c\.codigoPostal \|\| null/);
    expect(store).toMatch(/update\.codigo_postal = c\.codigo_postal \|\| null/);
  });
});

describe('a quién se timbra (servidor)', () => {
  const completo = { nombre: 'C SA', rfc: 'AAA010101AAA', regimen: '601', uso_cfdi: 'G03', cp: '34000' };
  it('cliente completo → a su nombre', () => {
    expect(decidirReceptor(completo)).toEqual({ ok: true, cliente: completo, publicoGeneral: false });
  });
  it('sin cliente, sin RFC o RFC genérico → público en general (no hay otro receptor posible)', () => {
    for (const c of [null, { nombre: 'X', rfc: '' }, { nombre: 'X', rfc: 'XAXX010101000' }]) {
      expect(decidirReceptor(c)).toEqual({ ok: true, cliente: null, publicoGeneral: true });
    }
  });
  it('decisión explícita del operador → público en general aunque el cliente tenga RFC', () => {
    expect(decidirReceptor(completo, { publicoGeneral: true })).toEqual({ ok: true, cliente: null, publicoGeneral: true });
  });
  it('RFC propio con datos incompletos → rechazo que dice qué falta (antes: 616 inventado o público en general)', () => {
    const r = decidirReceptor({ ...completo, regimen: '', cp: '3400', uso_cfdi: 'P01' });
    expect(r).toMatchObject({ ok: false, status: 422, code: 'DATOS_FISCALES_INCOMPLETOS' });
    expect(r.error).toMatch(/régimen fiscal/);
    expect(r.error).toMatch(/código postal fiscal/);
    expect(r.error).toMatch(/P01/);
    expect(decidirReceptor({ ...completo, rfc: 'MALO' }).error).toMatch(/RFC con formato válido/);
    expect(decidirReceptor({ ...completo, regimen: '616' }).ok).toBe(false);
  });
  it('régimen reconocido: código SAT o texto heredado; nunca inventa 616', () => {
    expect(regimenReconocido('601')).toBe('601');
    expect(regimenReconocido('Incorporación Fiscal')).toBe('621');
    expect(regimenReconocido('')).toBeNull();
    expect(regimenReconocido('999')).toBeNull();
  });
  it('factura global: mes y año del NEGOCIO (a las 03:00 UTC del día 1 en Durango sigue siendo el mes anterior)', () => {
    expect(periodoGlobal(new Date('2026-11-01T03:00:00Z'))).toEqual({ Months: '10', Year: '2026' });
    expect(periodoGlobal(new Date('2027-01-01T05:59:00Z'))).toEqual({ Months: '12', Year: '2026' });
    expect(periodoGlobal(new Date('2027-01-01T06:01:00Z'))).toEqual({ Months: '01', Year: '2027' });
  });
  it('el servidor ya no reintenta solo a público en general ni timbra si no pudo leer al cliente', () => {
    const src = leer('../../netlify/functions/billing-create-invoice/index.js');
    expect(src).not.toMatch(/cliente: null, lineas, issuerZip/);
    expect(src).toMatch(/No se pudo leer el cliente de la orden/);
    expect(src).toMatch(/RFC_RECHAZADO/);
  });
  it('la pantalla pregunta antes de facturar a público en general', () => {
    expect([...CODIGOS_OFRECER_PUBLICO].sort()).toEqual(['DATOS_FISCALES_INCOMPLETOS', 'RFC_RECHAZADO']);
    const vista = leer('../components/views/FacturacionView.jsx');
    expect(vista).toMatch(/Facturar a público en general/);
    expect(vista).toMatch(/publicoGeneral: true/);
    expect(vista).not.toMatch(/Cubo Polar S\.A\. de C\.V\./);
    expect(vista).not.toMatch(/Uso CFDI: G03 — Gastos en general/);
    expect(leer('../lib/backend.js')).toMatch(/error\.code = data\?\.code/);
  });
  it('Admin también puede marcar "Facturar" en una venta', () => {
    const src = leer('../components/NuevaVentaModal.jsx');
    const admin = src.slice(src.indexOf('const DEFAULTS_ADMIN'), src.indexOf('const DEFAULTS_STANDALONE'));
    expect(admin).toMatch(/toggleFactura: true/);
  });
});

describe('usuario dado de baja', () => {
  const session = { user: { id: 'uid-1' } };
  it('no entra aunque su sesión siga guardada', () => {
    expect(perfilInactivo({ estatus: 'Inactivo' })).toBe(true);
    expect(perfilInactivo({ estatus: 'Activo' })).toBe(false);
    expect(perfilInactivo({})).toBe(false);
    expect(buildUserFromSessionAndProfile(session, { id: 1, estatus: 'Inactivo' })).toBeNull();
    expect(buildUserFromSessionAndProfile(session, { id: 1, estatus: 'Activo' })).toMatchObject({ id: 1, authUserId: 'uid-1' });
  });
  it('el ingreso lo rechaza con un mensaje claro y cierra la sesión', () => {
    const src = leer('../components/Login.jsx');
    expect(src).toMatch(/perfilInactivo\(perfiles\[0\]\)/);
    expect(src).toMatch(/Tu usuario está dado de baja/);
  });
});

describe('avisos en un teléfono compartido', () => {
  it('al salir se suelta la liga del aparato; al entrar se liga a quien entró', () => {
    const app = leer('../App.jsx');
    expect(app.match(/await soltarPushAlSalir\(\)/g)).toHaveLength(2);
    expect(app).toMatch(/if \(user\?\.id\) religarPush\(\)/);
    const push = leer('../lib/push.js');
    expect(push).toMatch(/accion: 'unsubscribe'/);
    expect(push).toMatch(/Notification\.permission !== 'granted'/);
  });
});

describe('captura manual de asistencia', () => {
  const base = { operacionId: 'op-1', empleadoId: 7, fecha: '2026-10-09', entrada: '08:20', salida: '16:05', motivo: 'Sin señal en el teléfono' };
  it('arma las horas en la zona del negocio', () => {
    expect(buildAsistenciaManualArgs(base).args).toEqual({
      p_operacion_id: 'op-1', p_empleado_id: 7, p_fecha: '2026-10-09',
      p_entrada: '2026-10-09T08:20:00-06:00', p_salida: '2026-10-09T16:05:00-06:00', p_motivo: 'Sin señal en el teléfono',
    });
  });
  it('turno nocturno: la salida es del día siguiente; la salida es opcional', () => {
    expect(buildAsistenciaManualArgs({ ...base, entrada: '22:00', salida: '06:00' }).args.p_salida).toBe('2026-10-10T06:00:00-06:00');
    expect(buildAsistenciaManualArgs({ ...base, fecha: '2026-12-31', entrada: '22:00', salida: '06:00' }).args.p_salida).toBe('2027-01-01T06:00:00-06:00');
    expect(buildAsistenciaManualArgs({ ...base, salida: '' }).args.p_salida).toBeNull();
  });
  it('exige persona, día, hora de entrada y motivo', () => {
    expect(buildAsistenciaManualArgs({ ...base, empleadoId: null }).error).toMatch(/Persona/);
    expect(buildAsistenciaManualArgs({ ...base, fecha: '9/10' }).error).toMatch(/Día/);
    expect(buildAsistenciaManualArgs({ ...base, entrada: '' }).error).toMatch(/entrada/);
    expect(buildAsistenciaManualArgs({ ...base, salida: '4pm' }).error).toMatch(/salida/);
    expect(buildAsistenciaManualArgs({ ...base, motivo: 'x' }).error).toMatch(/motivo/);
  });
  it('la pantalla lo ofrece solo cuando no hay registro y sí hay turno', () => {
    const vista = leer('../components/views/AsistenciaView.jsx');
    expect(vista).toMatch(/\{!a && !manual && fila\.turno && \(/);
    expect(vista).toMatch(/actions\.registrarAsistenciaManual/);
    expect(leer('../data/supaStore.js')).toMatch(/rpc\('registrar_asistencia_manual'/);
  });
});

describe('rastro de lo que hace el servidor con la llave de servicio', () => {
  it('registra quién, qué y sobre quién; nunca lanza', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const ok = await registrarRastro({ from: () => ({ insert }) }, { actor: { id: 45, nombre: 'Santiago' }, accion: 'Restablecer contraseña', modulo: 'Usuarios', detalle: 'Jessica (Admin)' });
    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledWith({ usuario: 'Santiago', usuario_id: 45, accion: 'Restablecer contraseña', modulo: 'Usuarios', detalle: 'Jessica (Admin)' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await registrarRastro({ from: () => ({ insert: async () => ({ error: { message: 'x' } }) }) }, { accion: 'a', modulo: 'm', detalle: 'd' })).toBe(false);
    expect(await registrarRastro({ from: () => { throw new Error('caído'); } }, { accion: 'a', modulo: 'm', detalle: 'd' })).toBe(false);
    err.mockRestore();
  });
  it('crear usuario y restablecer contraseña lo usan (y nunca guardan la contraseña)', () => {
    const crear = leer('../../netlify/functions/admin-create-user/index.js');
    const reset = leer('../../netlify/functions/admin-reset-password/index.js');
    expect(crear).toMatch(/registrarRastro\(supabase, \{[\s\S]*?accion: 'Crear usuario'/);
    expect(reset).toMatch(/registrarRastro\(supabase, \{[\s\S]*?accion: 'Restablecer contraseña'/);
    for (const src of [crear, reset]) {
      const llamada = src.slice(src.indexOf('registrarRastro(supabase'), src.indexOf('});', src.indexOf('registrarRastro(supabase')));
      expect(llamada).not.toMatch(/password/i);
    }
  });
});
