// BandejaView — "Mi bandeja" de TODOS los roles (2026-10-09; nació en la Tanda
// 24 solo para Admin). Reúne lo que la persona tiene que atender: lo de su rol
// (y sus accesos) más lo personal (asistencia y actividades asignadas). Cada
// tarjeta lleva al módulo donde se resuelve. Lógica: data/bandejaLogic.
import { useMemo } from 'react';
import { diaNegocio } from '../../utils/fechas';
import { construirBandejaUsuario } from '../../data/bandejaLogic';
import usePendientesPersonales from '../usePendientesPersonales';
import { primerNombre } from '../../data/saludoLogic';
import { SectionLabel } from '../ui/Components';
import { Icons } from '../ui/Icons';

export function BandejaView({ data, user, actions, onNavigate }) {
  const personales = usePendientesPersonales(actions);
  const tareas = useMemo(() => construirBandejaUsuario(user, data, diaNegocio(), personales), [user, data, personales]);
  const urgentes = tareas.filter(t => t.prioridad === 'alta');
  const normales = tareas.filter(t => t.prioridad === 'media');
  const nombre = primerNombre(user?.nombre);

  return (
    <div className="max-w-3xl" data-testid="mi-bandeja">
      <p className="mb-4 text-sm text-slate-500">
        {tareas.length === 0
          ? `Todo al día${nombre ? `, ${nombre}` : ''}: no tienes pendientes.`
          : `${tareas.length === 1 ? '1 pendiente' : `${tareas.length} pendientes`}${urgentes.length > 0 ? ` · ${urgentes.length === 1 ? '1 urgente' : `${urgentes.length} urgentes`}` : ''}. Toca uno para ir a resolverlo.`}
      </p>

      {tareas.length === 0 && (
        <div className="rounded-card border border-emerald-200 bg-emerald-50 p-8 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Icons.CheckCircle /></div>
          <p className="text-base font-bold text-emerald-700">Nada que atender</p>
          <p className="mt-1 text-sm text-emerald-600">Cuando haya algo que te toque, aparece aquí.</p>
        </div>
      )}

      {urgentes.length > 0 && (
        <div className="mb-6">
          <SectionLabel className="mb-2 !text-red-600">Atiende ahora</SectionLabel>
          <div className="space-y-2">
            {urgentes.map(t => <TarjetaTarea key={t.id} tarea={t} onNavigate={onNavigate} urgente />)}
          </div>
        </div>
      )}

      {normales.length > 0 && (
        <div>
          <SectionLabel className="mb-2">Cuando puedas</SectionLabel>
          <div className="space-y-2">
            {normales.map(t => <TarjetaTarea key={t.id} tarea={t} onNavigate={onNavigate} />)}
          </div>
        </div>
      )}
    </div>
  );
}

export function TarjetaTarea({ tarea, onNavigate, urgente = false }) {
  const Ic = Icons[tarea.icono] || Icons.Package;
  return (
    <button
      type="button"
      onClick={() => onNavigate?.(tarea.modulo)}
      className={`flex w-full items-center gap-3 rounded-card border p-4 text-left transition-all active:scale-[0.99] ${
        urgente ? 'border-red-200 bg-red-50/70 hover:bg-red-50' : 'border-line bg-white hover:bg-slate-50'
      }`}
    >
      <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${urgente ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'}`} aria-hidden="true"><Ic /></span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] font-semibold ${urgente ? 'text-red-900' : 'text-ink'}`}>{tarea.titulo}</span>
        <span className={`mt-0.5 block text-[13px] ${urgente ? 'text-red-700' : 'text-slate-500'}`}>{tarea.detalle}</span>
      </span>
      <span className={`flex-shrink-0 ${urgente ? 'text-red-600' : 'text-slate-400'}`}><Icons.ChevronRight /></span>
    </button>
  );
}
