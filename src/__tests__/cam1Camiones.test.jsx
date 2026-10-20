// cam1Camiones.test.jsx — CAM-1 (mig 154): ficha de camiones. La autoridad es el contrato guardar_camion (suite SQL 154);
// aquí: validación igual a la del servidor, parámetros del contrato, etiqueta, panel y que el cliente ya no escribe por REST.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  normalizarPlacas, esVinValido, formDesdeCamion, validarCamion, buildGuardarCamionArgs, etiquetaCamion, choferesAsignables,
  mensajeErrorCamion, ESTATUS_CAMION,
} from '../data/camionesLogic';
import CamionesPanel from '../components/CamionesPanel';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// La flotilla real (2026-10-20), como llega del store (camelCase).
const FLOTA = [
  { id: 1, nombre: '0001', numeroEconomico: 'CP01', marca: 'Isuzu', modelo: '2010', vin: 'JAANMR853A7500023', placas: 'FW6216B', estatus: 'Activo' },
  { id: 2, nombre: '0002', numeroEconomico: 'CP02', marca: 'Freightliner', modelo: '2000', vin: '3AL3EFAC4YDH44124', placas: 'FW6214B', estatus: 'Activo' },
  { id: 3, nombre: '0003', numeroEconomico: 'CP03', marca: 'International', modelo: '2015', vin: '3HAMMMMN1FL554917', placas: 'FU-3165D', estatus: 'En taller', kilometraje: 154321, choferId: 7 },
  { id: 4, nombre: '0004', numeroEconomico: 'CP04', marca: 'JAC', modelo: '2026', vin: '3JA1SCB24TK007262', placas: 'FV5856D', estatus: 'Activo' },
];
const USUARIOS = [{ id: 7, nombre: 'Daniel Chofer', rol: 'Chofer', estatus: 'Activo' }, { id: 8, nombre: 'Chofer baja', rol: 'Chofer', estatus: 'Inactivo' }, { id: 9, nombre: 'Ventas', rol: 'Ventas', estatus: 'Activo' }];

describe('CAM-1 validación (igual que guardar_camion)', () => {
  it('los 4 VIN reales son válidos; 16 caracteres o con I/O/Q no', () => {
    for (const c of FLOTA) expect(esVinValido(c.vin)).toBe(true);
    expect(esVinValido('')).toBe(true);
    expect(esVinValido('3AL3EFAC4YDH4412')).toBe(false);
    expect(esVinValido('3AL3EFAC4YDH4412O')).toBe(false);
    expect(esVinValido('3al3efac4ydh44124')).toBe(true);
  });
  it('placas comparables sin guiones ni espacios', () => {
    expect(normalizarPlacas('FU-3165D')).toBe('FU3165D');
    expect(normalizarPlacas(' fu 3165d ')).toBe('FU3165D');
  });
  it('alta válida: normaliza mayúsculas y manda solo lo del contrato', () => {
    const v = validarCamion({ nombre: '0005', numero_economico: 'cp05', marca: 'Ford', modelo: '2020', vin: '1ftfw1et5dfc10312', placas: 'abc123', estatus: 'Activo', kilometraje: '12,500', chofer_id: '7', observaciones: ' ok ' }, { camiones: FLOTA });
    expect(v.datos).toEqual({ nombre: '0005', numero_economico: 'CP05', marca: 'Ford', modelo: '2020', vin: '1FTFW1ET5DFC10312', placas: 'ABC123', estatus: 'Activo', kilometraje: '12500', chofer_id: '7', observaciones: 'ok' });
  });
  it('rechaza unidad vacía, VIN inválido, kilometraje no entero y repetidos (económico, VIN, placas)', () => {
    expect(validarCamion({ nombre: '' }).errores.nombre).toBeTruthy();
    expect(validarCamion({ nombre: 'X', vin: 'ABC' }).errores.vin).toBeTruthy();
    expect(validarCamion({ nombre: 'X', kilometraje: '-3' }).errores.kilometraje).toBeTruthy();
    expect(validarCamion({ nombre: 'X', kilometraje: '1.5' }).errores.kilometraje).toBeTruthy();
    expect(validarCamion({ nombre: 'X', numero_economico: 'cp02' }, { camiones: FLOTA }).errores.numero_economico).toBeTruthy();
    expect(validarCamion({ nombre: 'X', vin: '3hammmmn1fl554917' }, { camiones: FLOTA }).errores.vin).toBeTruthy();
    expect(validarCamion({ nombre: 'X', placas: 'FU 3165D' }, { camiones: FLOTA }).errores.placas).toBeTruthy();
  });
  it('al editar, sus propios datos no cuentan como repetidos', () => {
    expect(validarCamion(formDesdeCamion(FLOTA[2]), { camiones: FLOTA, id: 3 }).datos.numero_economico).toBe('CP03');
  });
  it('estatus del servidor', () => {
    expect(ESTATUS_CAMION).toEqual(['Activo', 'En taller', 'Inactivo']);
    expect(validarCamion({ nombre: 'X', estatus: 'Activa' }).errores.estatus).toBeTruthy();
  });
});

describe('CAM-1 contrato, etiqueta y errores', () => {
  it('parámetros exactos de guardar_camion(p_id, p_datos)', () => {
    expect(buildGuardarCamionArgs({ datos: { nombre: 'X' } })).toEqual({ p_id: null, p_datos: { nombre: 'X' } });
    expect(buildGuardarCamionArgs({ id: '3', datos: { estatus: 'Activo' } })).toEqual({ p_id: 3, p_datos: { estatus: 'Activo' } });
    // Firma de 154 (aplicada en producción el 2026-10-20). La rama publicada no lleva los SQL; si el archivo está, se comprueba.
    const ruta154 = fileURLToPath(new URL('../../supabase/154_camiones_ficha.sql', import.meta.url));
    if (existsSync(ruta154)) expect(readFileSync(ruta154, 'utf8')).toContain('FUNCTION public.guardar_camion(p_id BIGINT, p_datos JSONB)');
    expect(Object.keys(buildGuardarCamionArgs({}))).toEqual(['p_id', 'p_datos']);
  });
  it('etiqueta "CP01 · Isuzu · FW6216B" (o la unidad si no hay número económico)', () => {
    expect(etiquetaCamion(FLOTA[0])).toBe('CP01 · Isuzu · FW6216B');
    expect(etiquetaCamion({ nombre: '0009', placas: 'X1' })).toBe('0009 · X1');
    expect(etiquetaCamion({ nombre: '0001', numero_economico: 'CP01', marca: '', placas: '' })).toBe('CP01');
  });
  it('choferes asignables: activos con rol Chofer', () => {
    expect(choferesAsignables(USUARIOS).map(u => u.id)).toEqual([7]);
  });
  it('errores por código, sin SQL', () => {
    expect(mensajeErrorCamion({ code: '23505', details: '{"codigo":"CAMION_DUPLICADO"}', message: 'guardar_camion: ...' })).toMatch(/Ya existe otro camión/);
    expect(mensajeErrorCamion({ code: '22023', details: '{"codigo":"VIN_INVALIDO"}' })).toMatch(/17 caracteres/);
    expect(mensajeErrorCamion({ code: '42501' })).toMatch(/Solo Administración/);
    expect(mensajeErrorCamion(new TypeError('Failed to fetch'))).not.toMatch(/fetch|guardar_camion/);
  });
});

describe('CAM-1 panel y store', () => {
  it('el panel muestra la ficha completa de la flotilla', () => {
    const h = renderToStaticMarkup(<CamionesPanel data={{ camiones: FLOTA, usuarios: USUARIOS }} actions={{}} />);
    for (const t of ['Unidad', 'No. económico', 'Marca', 'Modelo', 'No. de serie / VIN', 'Placas', 'Estatus', 'Kilometraje', 'Chofer asignado', 'Observaciones']) expect(h).toContain(`>${t}</th>`);
    for (const c of FLOTA) { expect(h).toContain(c.vin); expect(h).toContain(c.numeroEconomico); }
    expect(h).toContain('154,321');
    expect(h).toContain('Daniel Chofer');
    expect(h).toContain('>Nuevo camión</button>');
    expect((h.match(/>Editar<\/button>/g) || []).length).toBe(4);
  });
  it('sin permiso de edición no ofrece alta ni edición', () => {
    const h = renderToStaticMarkup(<CamionesPanel data={{ camiones: FLOTA, usuarios: USUARIOS }} actions={{}} puedeEditar={false} />);
    expect(h).not.toContain('>Nuevo camión</button>');
    expect(h).not.toContain('>Editar</button>');
  });
  it('el cliente ya no escribe camiones por REST: todo va por guardar_camion', () => {
    const store = src('../data/supaStore.js');
    expect(store).not.toMatch(/from\('camiones'\)\.(insert|update|upsert|delete)/);
    expect(store).toContain("supabase.rpc('guardar_camion', buildGuardarCamionArgs({ id, datos }))");
    expect(store).toContain('addCamion: async (c) => guardarCamionContrato(');
    expect(store).toContain('updateCamion: async (id, c) => guardarCamionContrato({ id, datos: c })');
  });
  it('Entregas: botón Camiones y el selector de la ruta usa la etiqueta nueva; el alta rápida ya no dice éxito si falló', () => {
    const v = src('../components/views/RutasView.jsx');
    expect(v).toContain('<Icons.Truck /> Camiones</button>');
    expect(v).toContain('label: etiquetaCamion(c) || s(c.nombre)');
    const i = v.indexOf('const r = await actions.addCamion(camionForm);');
    expect(i).toBeGreaterThan(0);
    expect(v.indexOf('if (r?.error) return;', i)).toBeLessThan(v.indexOf("toast?.success('Camión registrado')", i));
  });
});
