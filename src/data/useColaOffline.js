// useColaOffline.js — hook de la cola offline del chofer (Tanda 22).
//
// Envuelve la lógica pura de colaOfflineLogic.js con los efectos:
// persistencia en localStorage por ruta, detección online/offline,
// sincronización FIFO contra los ejecutores (acciones de supaStore) y
// reintento automático (evento 'online' + intervalo de 30s).
//
// Fuente de verdad: colaRef (síncrona). El estado de React es solo un
// espejo para renderizar — así una mutación agregada A MITAD de una
// sincronización async no se pierde por updaters batcheados.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_INTENTOS,
  claveColaRuta,
  encolar,
  marcarIntento,
  mutacionesPendientes,
  parseCola,
  quitar,
  siguientePendiente,
} from './colaOfflineLogic';

export function useColaOffline({ rutaId, ejecutores, avisar }) {
  const [cola, setCola] = useState([]);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [sincronizando, setSincronizando] = useState(false);

  const colaRef = useRef([]);
  const sincronizandoRef = useRef(false);
  const ejecutoresRef = useRef(ejecutores);
  ejecutoresRef.current = ejecutores;
  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;

  // Toda escritura pasa por aquí: ref (verdad síncrona) + estado
  // (render) + localStorage (sobrevivir reload/crash del navegador).
  const escribir = useCallback(
    (nueva) => {
      colaRef.current = nueva;
      setCola(nueva);
      if (!rutaId) return;
      try {
        localStorage.setItem(claveColaRuta(rutaId), JSON.stringify(nueva));
      } catch (e) {
        // QuotaExceeded (fotos base64 grandes). La mutación sigue viva
        // en memoria; solo se pierde si el chofer recarga la app.
        console.error('[colaOffline] no se pudo persistir:', e?.message);
        avisarRef.current?.('Memoria llena — la operación quedó pendiente pero no sobrevive si cierras la app');
      }
    },
    [rutaId]
  );

  // Cargar la cola persistida al cambiar de ruta.
  useEffect(() => {
    if (!rutaId) {
      colaRef.current = [];
      setCola([]);
      return;
    }
    const guardada = parseCola(localStorage.getItem(claveColaRuta(rutaId)));
    colaRef.current = guardada;
    setCola(guardada);
  }, [rutaId]);

  const agregar = useCallback(
    (tipo, payload) => {
      escribir(encolar(colaRef.current, tipo, payload));
    },
    [escribir]
  );

  // Una pasada FIFO: éxito → sale de la cola; fallo → intento+1 y la
  // pasada se detiene (probable red intermitente), salvo que la
  // mutación agote MAX_INTENTOS — entonces se salta (fallida) y se
  // continúa con la siguiente para no bloquear la fila.
  const sincronizar = useCallback(async () => {
    if (sincronizandoRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    sincronizandoRef.current = true;
    setSincronizando(true);
    try {
      let exitosas = 0;
      let cursor = null;
      for (;;) {
        const m = siguientePendiente(colaRef.current);
        if (!m || m.id === cursor) break; // cursor: no re-atacar la misma en esta pasada
        let err = null;
        try {
          const fn = ejecutoresRef.current?.[m.tipo];
          err = fn ? await fn(m.payload) : { error: `Sin ejecutor para ${m.tipo}` };
        } catch (e) {
          err = { error: e?.message || 'Error inesperado' };
        }
        if (err) {
          escribir(marcarIntento(colaRef.current, m.id));
          const actualizada = colaRef.current.find((x) => x.id === m.id);
          if (actualizada && actualizada.intentos >= MAX_INTENTOS) {
            avisarRef.current?.('Una operación no se pudo sincronizar — repórtala al admin');
            continue; // fallida definitiva: no bloquear a las demás
          }
          cursor = m.id; // reintentable: parar la pasada aquí
          continue;
        }
        escribir(quitar(colaRef.current, m.id));
        exitosas += 1;
      }
      if (exitosas > 0) {
        avisarRef.current?.(
          exitosas === 1 ? 'Se sincronizó 1 operación pendiente' : `Se sincronizaron ${exitosas} operaciones pendientes`
        );
      }
    } finally {
      sincronizandoRef.current = false;
      setSincronizando(false);
    }
  }, [escribir]);

  // Lectura síncrona post-sincronizar (el estado `cola` del closure
  // queda stale tras un await; cerrarRuta necesita el valor real).
  const pendientesActuales = useCallback(() => mutacionesPendientes(colaRef.current), []);

  const limpiar = useCallback(() => {
    colaRef.current = [];
    setCola([]);
    if (rutaId) localStorage.removeItem(claveColaRuta(rutaId));
  }, [rutaId]);

  // Reconexión → sincronizar de inmediato.
  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      sincronizar();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [sincronizar]);

  // Respaldo: reintento cada 30s mientras haya pendientes con conexión
  // (navigator.onLine a veces reporta true con señal inservible; el
  // evento 'online' no basta).
  useEffect(() => {
    if (!online || mutacionesPendientes(cola).length === 0) return;
    const iv = setInterval(sincronizar, 30000);
    return () => clearInterval(iv);
  }, [online, cola, sincronizar]);

  return { cola, online, sincronizando, agregar, sincronizar, pendientesActuales, limpiar };
}
