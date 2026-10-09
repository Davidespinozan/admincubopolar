// MiAsistenciaView — PD-01 (mig 116): reloj checador del empleado.
// Móvil primero. La ubicación se pide UNA vez y solo al tocar el botón (sin
// rastreo continuo). Persona, hora, turno, geocerca y retardo los decide el
// servidor; sin conexión no se marca (no hay cola offline: la hora es la del servidor).
import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, SectionLabel, Guia } from './ui/Components';
import {
  GEO_OPCIONES, mensajeErrorGeo, mensajeRegistro, pantallaMiAsistencia, horaNegocio, fechaHoraNegocio, textoTurno,
} from '../data/asistenciaLogic';

const TONOS = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  aviso: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  neutro: 'border-slate-200 bg-slate-50 text-slate-800',
};

function leerUbicacion() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject('no_soportado'); return; }
    navigator.geolocation.getCurrentPosition(p => resolve(p.coords), reject, GEO_OPCIONES);
  });
}

export default function MiAsistenciaView({ actions, onVolver }) {
  const [mi, setMi] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [fase, setFase] = useState(null);            // null | 'ubicando' | 'enviando'
  const [aviso, setAviso] = useState(null);          // { tono, texto }
  // Operación pendiente tras un error de red: el reintento reusa la misma (idempotente).
  const pendiente = useRef(null);

  const cargar = useCallback(async () => {
    const r = await actions.miAsistencia();
    if (r?.error) { setErrorCarga(r.error); return; }
    setErrorCarga(null);
    setMi(r.data);
  }, [actions]);

  useEffect(() => { cargar(); }, [cargar]);

  const marcar = async (tipo) => {
    if (fase) return;
    setAviso(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setAviso({ tono: 'error', texto: 'Sin conexión. La asistencia necesita internet en el momento de marcar (no se guarda para después).' });
      return;
    }
    setFase('ubicando');
    let coords;
    try {
      coords = await leerUbicacion();
    } catch (e) {
      setFase(null);
      setAviso({ tono: 'error', texto: mensajeErrorGeo(e) });
      return;
    }
    setFase('enviando');
    const op = pendiente.current?.tipo === tipo ? pendiente.current.operacionId : undefined;
    const r = await actions.registrarAsistencia(tipo, coords, op);
    setFase(null);
    if (r?.error) {
      pendiente.current = r.red ? { tipo, operacionId: r.operacionId } : null;
      setAviso({ tono: 'error', texto: r.error });
      return;
    }
    pendiente.current = null;
    setAviso(mensajeRegistro(tipo, r.data));
    cargar();
  };

  const p = pantallaMiAsistencia(mi);
  const turno = mi?.turno_hoy;
  const a = mi?.asistencia;
  const olvido = mi?.salida_olvidada;

  return (
    <div className="mx-auto w-full max-w-lg space-y-3" data-testid="mi-asistencia">
      {onVolver && (
        <button type="button" onClick={onVolver} className="inline-flex min-h-[44px] items-center rounded-[14px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700">
          ← Volver a mi ruta
        </button>
      )}

      <Card>
        <SectionLabel>Mi asistencia</SectionLabel>
        <p className="mt-1 font-display text-lg font-bold tracking-[-0.03em] text-slate-900">{mi?.empleado?.nombre || '—'}</p>
        <p className="text-sm text-slate-500">{mi?.hoy || ''}{mi?.empleado?.puesto ? ` · ${mi.empleado.puesto}` : ''}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-[14px] bg-slate-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Turno</p>
            <p className="mt-1 font-semibold text-slate-900">{turno ? textoTurno(turno) : 'Sin turno'}</p>
            {turno?.centro && <p className="text-xs text-slate-500">{turno.centro}{turno.tolerancia_min ? ` · tolerancia ${turno.tolerancia_min} min` : ''}</p>}
          </div>
          <div className="rounded-[14px] bg-slate-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Estado</p>
            <p className="mt-1 font-semibold text-slate-900" data-testid="mi-asistencia-estado">{p.titulo}</p>
          </div>
          <div className="rounded-[14px] bg-slate-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Entrada</p>
            <p className="mt-1 font-semibold text-slate-900">{horaNegocio(a?.entrada_at)}</p>
            {a?.entrada_estado === 'retardo' && <p className="text-xs text-amber-700">Retardo {a.minutos_retardo} min</p>}
          </div>
          <div className="rounded-[14px] bg-slate-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Salida</p>
            <p className="mt-1 font-semibold text-slate-900">{horaNegocio(a?.salida_at)}</p>
            {a?.salida_at && a?.salida_dentro === false && <p className="text-xs text-amber-700">Fuera del centro</p>}
          </div>
        </div>
        {p.detalle && <p className="mt-3 text-sm text-slate-600">{p.detalle}</p>}
      </Card>

      {olvido && (
        <div className={`rounded-[18px] border p-3 text-sm ${TONOS.aviso}`} role="status">
          Tienes una salida sin registrar (entrada {fechaHoraNegocio(olvido.entrada_at)}). Avisa a Admin para corregirla.
        </div>
      )}

      {errorCarga && (
        <div className={`rounded-[18px] border p-3 text-sm ${TONOS.error}`} role="alert">
          {errorCarga}
          <button type="button" onClick={cargar} className="ml-2 font-semibold underline">Reintentar</button>
        </div>
      )}

      {aviso && <div className={`rounded-[18px] border p-3 text-sm ${TONOS[aviso.tono] || TONOS.neutro}`} role="status" data-testid="mi-asistencia-aviso">{aviso.texto}</div>}

      {p.boton && (
        <button type="button" onClick={() => marcar(p.boton.accion)} disabled={!!fase} data-testid="mi-asistencia-boton"
          className={`flex min-h-[72px] w-full items-center justify-center rounded-[24px] px-6 text-lg font-bold text-white shadow-[0_18px_34px_rgba(8,20,27,0.18)] transition-all active:scale-[0.98] disabled:opacity-60 ${
            p.boton.accion === 'entrada' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-slate-800'}`}>
          {fase === 'ubicando' ? 'Obteniendo ubicación…' : fase === 'enviando' ? 'Registrando…' : p.boton.label}
        </button>
      )}

      <Guia testid="guia-mi-asistencia" titulo={turno ? '¿Cómo funciona?' : 'Aún no tienes turno'}>
        {turno
          ? 'Al llegar al centro de trabajo toca “Marcar entrada”; al irte, “Marcar salida”. Administración ve tu asistencia y solo puede corregirla con un motivo que queda registrado.'
          : 'Administración configura en Asistencia el centro de trabajo, tu turno y liga tu usuario. En cuanto lo haga, aquí aparecerá el botón para marcar tu entrada.'}
      </Guia>

      <p className="px-1 text-xs text-slate-400">
        Tu ubicación se lee una sola vez, solo al tocar el botón. La entrada se marca dentro del centro de trabajo; la salida se puede marcar fuera y queda señalada.
      </p>
    </div>
  );
}
