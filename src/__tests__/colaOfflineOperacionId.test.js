// colaOfflineOperacionId.test.js — R2 fase 2A: la cola offline conserva un
// operacion_id estable por evento encolado, sobrevive al round-trip por
// localStorage (JSON) y cada replay del mismo evento entrega el mismo UUID.
import { describe, it, expect } from 'vitest';
import { TIPOS_MUTACION, encolar, parseCola, marcarIntento, siguientePendiente, uuidOperacion } from '../data/colaOfflineLogic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('operacion_id en la cola offline', () => {
  it('encolar asigna operacion_id si el payload no lo trae y respeta el que trae', () => {
    const cola = encolar([], TIPOS_MUTACION.NO_ENTREGA, { ordenId: 90, motivo: 'Local cerrado', reagendar: true }, 1000);
    expect(cola[0].payload.operacionId).toMatch(UUID_RE);
    const cola2 = encolar(cola, TIPOS_MUTACION.NO_ENTREGA, { ordenId: 91, motivo: 'x', reagendar: false, operacionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, 1001);
    expect(cola2[1].payload.operacionId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(cola2[0].payload.operacionId).toBe(cola[0].payload.operacionId);
  });

  it('el UUID sobrevive al JSON de localStorage y a un reinicio (parseCola)', () => {
    const cola = encolar([], TIPOS_MUTACION.NO_ENTREGA, { ordenId: 90, motivo: 'Local cerrado', reagendar: true }, 1000);
    const restaurada = parseCola(JSON.stringify(cola));
    expect(restaurada[0].payload.operacionId).toBe(cola[0].payload.operacionId);
  });

  it('replay tras respuesta perdida: el ejecutor recibe el mismo operacion_id en cada intento', async () => {
    const recibidos = [];
    const ejecutor = async (p) => { recibidos.push(p.operacionId); return { error: 'Failed to fetch' }; };
    let cola = encolar([], TIPOS_MUTACION.NO_ENTREGA, { ordenId: 90, motivo: 'Local cerrado', reagendar: true }, 1000);
    for (let i = 0; i < 3; i++) {
      const m = siguientePendiente(cola);
      await ejecutor(m.payload);
      cola = marcarIntento(cola, m.id);
      cola = parseCola(JSON.stringify(cola)); // "reinicio" entre intentos
    }
    expect(new Set(recibidos).size).toBe(1);
    expect(recibidos[0]).toMatch(UUID_RE);
  });

  it('dos eventos distintos nunca comparten operacion_id', () => {
    let cola = encolar([], TIPOS_MUTACION.NO_ENTREGA, { ordenId: 90, motivo: 'a' }, 1000);
    cola = encolar(cola, TIPOS_MUTACION.NO_ENTREGA, { ordenId: 90, motivo: 'a' }, 1001);
    expect(cola[0].payload.operacionId).not.toBe(cola[1].payload.operacionId);
    expect(uuidOperacion()).not.toBe(uuidOperacion());
  });
});
