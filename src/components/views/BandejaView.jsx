// BandejaView — "Mi bandeja": centro de pendientes del admin (Tanda 24).
// Agrega los pendientes reales del negocio y cada tarjeta enruta al
// módulo donde se resuelven. La lógica vive en data/bandejaLogic.js.
import { useMemo } from 'react';
import { construirBandeja } from '../../data/bandejaLogic';
import { todayLocalISO, s } from '../../utils/safe';

export function BandejaView({ data, user, onNavigate }) {
  const tareas = useMemo(() => construirBandeja(data, todayLocalISO()), [data]);
  const urgentes = tareas.filter(t => t.prioridad === 'alta');
  const normales = tareas.filter(t => t.prioridad === 'media');

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="text-xl font-extrabold text-slate-900">Mi bandeja</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {tareas.length === 0
            ? `Todo al día, ${s(user?.nombre) || 'Admin'} — no tienes pendientes.`
            : `${tareas.length === 1 ? '1 pendiente' : `${tareas.length} pendientes`}${urgentes.length > 0 ? ` · ${urgentes.length === 1 ? '1 urgente' : `${urgentes.length} urgentes`}` : ''}. Toca uno para ir a resolverlo.`}
        </p>
      </div>

      {tareas.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center">
          <p className="text-4xl mb-2">✅</p>
          <p className="text-base font-bold text-emerald-700">Nada que atender</p>
          <p className="text-sm text-emerald-600 mt-1">Sin firmas pendientes, sin cartera vencida, sin rutas abiertas de ayer.</p>
        </div>
      )}

      {urgentes.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-bold text-red-500 uppercase tracking-wider mb-2">Atiende ahora</h3>
          <div className="space-y-2">
            {urgentes.map(t => <TarjetaTarea key={t.id} tarea={t} onNavigate={onNavigate} urgente />)}
          </div>
        </div>
      )}

      {normales.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Cuando puedas</h3>
          <div className="space-y-2">
            {normales.map(t => <TarjetaTarea key={t.id} tarea={t} onNavigate={onNavigate} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TarjetaTarea({ tarea, onNavigate, urgente = false }) {
  return (
    <button
      onClick={() => onNavigate?.(tarea.modulo)}
      className={`w-full text-left rounded-2xl border p-4 transition-all active:scale-[0.99] flex items-center gap-3 ${
        urgente
          ? 'bg-red-50/70 border-red-200 hover:bg-red-50'
          : 'bg-white border-slate-200 hover:bg-slate-50'
      }`}
    >
      <span className="text-2xl flex-shrink-0" aria-hidden="true">{tarea.icono}</span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-bold ${urgente ? 'text-red-900' : 'text-slate-800'}`}>{tarea.titulo}</span>
        <span className={`block text-xs mt-0.5 ${urgente ? 'text-red-700' : 'text-slate-500'}`}>{tarea.detalle}</span>
      </span>
      <span className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded-full ${urgente ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
        Ir →
      </span>
    </button>
  );
}
