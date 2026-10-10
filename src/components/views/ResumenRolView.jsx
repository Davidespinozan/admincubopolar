// ResumenRolView — "Resumen" de los roles de campo (Ventas, Producción, Almacén
// de Bolsas, Empleado y combinaciones por acceso adicional), 2026-10-09. El
// back office conserva su Dashboard. Solo lectura: saludo, cifras del día, lo
// más urgente de "Mi bandeja" y accesos a sus módulos.
import { useMemo } from 'react';
import { diaNegocio } from '../../utils/fechas';
import { textoSaludo, subtituloRol } from '../../data/saludoLogic';
import { rolesDe } from '../../data/usuariosLogic';
import { cifrasResumen, accesosDeTrabajo } from '../../data/resumenRolLogic';
import { construirBandejaUsuario } from '../../data/bandejaLogic';
import usePendientesPersonales from '../usePendientesPersonales';
import { Card, KpiTile, ListRow, SectionLabel } from '../ui/Components';
import { Icons } from '../ui/Icons';
import { TarjetaTarea } from './BandejaView';

export function ResumenRolView({ data, user, actions, nav, onNavigate }) {
  const hoy = diaNegocio();
  const roles = useMemo(() => rolesDe(user), [user]);
  const personales = usePendientesPersonales(actions);
  const cifras = useMemo(() => cifrasResumen(roles, data, hoy), [roles, data, hoy]);
  const tareas = useMemo(() => construirBandejaUsuario(user, data, hoy, personales), [user, data, hoy, personales]);
  const accesos = useMemo(() => accesosDeTrabajo(nav), [nav]);
  const urgentes = tareas.filter(t => t.prioridad === 'alta');
  // La asistencia ya se ve arriba (RecordatorioAsistencia del shell): aquí no se repite.
  const visibles = tareas.filter(t => t.modulo !== 'mi-asistencia');
  const primeras = visibles.slice(0, 3);

  return (
    <div className="space-y-5" data-testid="resumen-rol">
      <div data-testid="saludo-rol">
        <p className="font-display text-[1.65rem] font-bold leading-tight text-ink">{textoSaludo(user?.nombre)}</p>
        <p className="mt-0.5 text-[15px] text-slate-500">{subtituloRol(user?.rol)}</p>
      </div>

      {cifras.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cifras.map(c => (
            <button key={c.label} type="button" onClick={() => c.modulo && onNavigate?.(c.modulo)} className="text-left">
              <KpiTile label={c.label} value={c.value} hint={c.hint} tone={c.tone} />
            </button>
          ))}
        </div>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Mi bandeja{visibles.length > 0 ? ` · ${visibles.length}` : ''}</SectionLabel>
          {visibles.length > primeras.length && (
            <button type="button" onClick={() => onNavigate?.('bandeja')} className="min-h-[36px] rounded-full px-2 text-[13px] font-semibold text-accent hover:bg-accent-soft">Ver todo</button>
          )}
        </div>
        {primeras.length === 0 ? (
          <Card className="flex items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Icons.CheckCircle /></span>
            <div><p className="text-[15px] font-semibold text-ink">Todo al día</p><p className="text-[13px] text-slate-500">No tienes pendientes por ahora.</p></div>
          </Card>
        ) : (
          <div className="space-y-2">
            {primeras.map(t => <TarjetaTarea key={t.id} tarea={t} onNavigate={onNavigate} urgente={urgentes.includes(t)} />)}
          </div>
        )}
      </section>

      {accesos.length > 0 && (
        <section>
          <SectionLabel className="mb-2">Ir a</SectionLabel>
          <Card padding="p-0" className="divide-y divide-line overflow-hidden">
            {accesos.map(m => <ListRow key={m.id} icon={m.icon} title={m.label} onClick={() => onNavigate?.(m.id)} chevron />)}
          </Card>
        </section>
      )}
    </div>
  );
}
