// movilFirst.test.jsx — revisión mobile-first (2026-10-09).
// Bienvenida por rol (hora de Mazatlán), cabecera con una sola campana,
// menú móvil oscuro con "Mi espacio", sin banner global de modo prueba,
// sin emojis en la interfaz y el ciclo infinito de entregas del Chofer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { horaNegocio, saludoPorHora, primerNombre, textoSaludo, subtituloRol, SUBTITULO_ROL } from '../data/saludoLogic';
import { mismasEntregas } from '../components/ChoferView';
import { ROLES_VALIDOS } from '../data/adminUserLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('bienvenida por rol', () => {
  it('saludo según la hora del negocio', () => {
    expect(saludoPorHora(5)).toBe('Buenos días');
    expect(saludoPorHora(11)).toBe('Buenos días');
    expect(saludoPorHora(12)).toBe('Buenas tardes');
    expect(saludoPorHora(18)).toBe('Buenas tardes');
    expect(saludoPorHora(19)).toBe('Buenas noches');
    expect(saludoPorHora(2)).toBe('Buenas noches');
  });
  it('la hora es la de Mazatlán (UTC-7), no la del navegador', () => {
    expect(horaNegocio(new Date('2026-10-09T19:30:00Z'))).toBe(12);
    expect(horaNegocio(new Date('2026-10-09T06:59:00Z'))).toBe(23);
    expect(textoSaludo('Santiago Mier', new Date('2026-10-09T19:30:00Z'))).toBe('Buenas tardes, Santiago');
  });
  it('primer nombre solo si parece nombre de persona', () => {
    expect(primerNombre('santiago mier')).toBe('Santiago');
    expect(primerNombre('santy_mier_21')).toBe('');
    expect(primerNombre('daen97')).toBe('');
    expect(primerNombre('')).toBe('');
    expect(textoSaludo('daen97', new Date('2026-10-09T15:00:00Z'))).toBe('Buenos días');
  });
  it('todo rol válido tiene subtítulo propio', () => {
    for (const rol of ROLES_VALIDOS) expect(SUBTITULO_ROL[rol], rol).toBeTruthy();
    expect(subtituloRol('Desconocido')).toBe('Bienvenido a CUBOPOLAR');
  });
});

describe('Chofer: sincronizar entregas no entra en ciclo', () => {
  const db = [{ ordenId: 93, folio: 'OV-0093', total: 1200, pago: 'Efectivo', items: [{ sku: 'HIB-50K', cant: 10 }] }];
  it('misma lista (aunque sean objetos nuevos) → igual; cambios reales → distinta', () => {
    const local = { id: 'x1', cliente: 'Venta exprés', total: 50 };
    expect(mismasEntregas([...db, local], [{ ...db[0], items: [{ sku: 'HIB-50K', cant: 10 }] }, local])).toBe(true);
    expect(mismasEntregas(db, [{ ...db[0], total: 1300 }])).toBe(false);
    expect(mismasEntregas(db, [...db, local])).toBe(false);
    expect(mismasEntregas([local], [{ ...local }])).toBe(false);   // locales: por identidad
  });
  it('el efecto devuelve el estado anterior si no cambió', () => {
    expect(src('../components/ChoferView.jsx')).toMatch(/if \(mismasEntregas\(prev, merged\)\) return prev;\s*return merged;/);
  });
});

describe('shell móvil', () => {
  const shell = src('../components/CuboPolarERP.jsx');
  it('sin banner global de modo prueba; el aviso vive solo en Facturación', () => {
    expect(fs.existsSync(fileURLToPath(new URL('../components/ui/ModoPruebaBanner.jsx', import.meta.url)))).toBe(false);
    expect(src('../components/views/FacturacionView.jsx')).toMatch(/data-testid="facturacion-modo-prueba-aviso"/);
  });
  it('cabecera: título sin competir con botones; una sola campana "Avisos" con panel opaco', () => {
    expect(shell).toMatch(/data-testid="topbar-titulo"/);
    expect(shell).toMatch(/aria-label="Avisos"/);
    expect(shell).toMatch(/data-testid="panel-avisos"[^>]*|className="[^"]*bg-white[^"]*"[^>]*data-testid="panel-avisos"/);
    expect(shell).not.toMatch(/aria-label="Ver alertas"|aria-label="Notificaciones"/);
  });
  it('menú móvil con el mismo fondo oscuro que la barra inferior, con íconos', () => {
    const drawer = shell.slice(shell.indexOf('DRAWER LATERAL — mobile'), shell.indexOf('═══ MAIN ═══'));
    expect(drawer).toMatch(/bg-gradient-to-b from-blue-950 via-slate-900 to-slate-900/);
    expect(drawer).toMatch(/const Ic = Icons\[item\.icon\] \|\| Icons\.Package;/);
    expect(src('../components/ui/Components.jsx')).toMatch(/from-blue-950 via-slate-900 to-slate-900/);
  });
  it('firmas: el botón de la cabecera solo aparece con firmas pendientes', () => {
    expect(src('../components/BotonFirmasPendientes.jsx')).toMatch(/\{!mostrarBannerUrgente && rutasPendientes\.length > 0 && \(/);
  });
});

describe('sin emojis en la interfaz', () => {
  it('ningún archivo de la interfaz pinta emojis pictográficos (fuera de comentarios)', () => {
    const emo = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}\u{23E9}-\u{23FA}\u{21A9}\u{21AA}]/u;
    const raiz = fileURLToPath(new URL('../components', import.meta.url));
    const malos = [];
    const recorrer = (d) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) { recorrer(p); continue; }
        if (!/\.(jsx|js|tsx|ts)$/.test(f)) continue;
        fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
          const t = l.trim();
          if (/^(\/\/|\*|\/\*|\{\/\*)/.test(t)) return;
          if (emo.test(l)) malos.push(`${path.relative(raiz, p)}:${i + 1}`);
        });
      }
    };
    recorrer(raiz);
    // Única excepción deliberada: la palomita dentro del checkbox de 16px de Rutas.
    expect(malos.filter(m => !/^views\/RutasView\.jsx:\d+$/.test(m) || !src('../components/views/RutasView.jsx').split('\n')[Number(m.split(':')[1]) - 1].includes("'✓'"))).toEqual([]);
  });
});
