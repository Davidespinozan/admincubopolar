// DuenoView — "Panel del dueño" (GER-1, mig 120/121). Solo el Dueño (Admin +
// es_dueno) lo ve; la bitácora la protege RLS (dueno_read), no esta pantalla.
//   · Para revisar: cambios sensibles hechos directo por la app (precios,
//     salarios, cuentas por pagar, clientes, usuarios…) con antes → después y
//     quién. La escribe la base de datos; nadie la puede editar ni borrar.
//   · Usuarios y accesos: roles, accesos adicionales y contraseñas temporales.
// No es una pantalla de operación: el dueño revisa, no captura.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Card, SegmentedTabs, Chips, Guia, KpiTile } from '../ui/Components';
import { EmptyState, ViewSkeleton } from '../ui/Skeleton';
import UsuariosPanel from '../UsuariosPanel';
import { describirCambio, esDueno, debeCambiarPassword } from '../../data/usuariosLogic';
import { diaNegocio } from '../../utils/fechas';

const fecha = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mazatlan', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};
const diaDe = (iso) => {
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Mazatlan' }); } catch { return ''; }
};

export function DuenoView({ data, actions, user }) {
  const [tab, setTab] = useState('revisar');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('importantes');

  const cargar = useCallback(async () => {
    const r = await actions.cargarBitacora?.(300);
    if (r?.error) { setError(r.error); setFilas([]); return; }
    setError(null);
    setFilas((r?.data || []).map(describirCambio));
  }, [actions]);
  useEffect(() => { cargar(); }, [cargar]);

  const hoy = diaNegocio();
  const resumen = useMemo(() => {
    const f = filas || [];
    const usuarios = (data?.usuarios || []).filter(u => !u.is_test_account);
    return {
      hoy: f.filter(x => diaDe(x.at) === hoy).length,
      importantesHoy: f.filter(x => x.importante && diaDe(x.at) === hoy).length,
      activos: usuarios.filter(u => u.estatus === 'Activo').length,
      temporales: usuarios.filter(debeCambiarPassword).length,
    };
  }, [filas, data?.usuarios, hoy]);

  const modulos = useMemo(() => [...new Set((filas || []).map(x => x.modulo))].sort(), [filas]);
  const visibles = useMemo(() => (filas || []).filter(x =>
    filtro === 'todos' ? true : filtro === 'importantes' ? x.importante : x.modulo === filtro), [filas, filtro]);

  if (!esDueno(user)) {
    return <Card><EmptyState icon="Lock" message="Solo para el Dueño" hint="Este panel no está disponible para tu usuario." /></Card>;
  }

  return (
    <div className="space-y-4" data-testid="panel-dueno">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Cambios sensibles hoy" value={resumen.importantesHoy} hint={`${resumen.hoy} cambios en total`} tone={resumen.importantesHoy > 0 ? 'warning' : undefined} />
        <KpiTile label="Usuarios activos" value={resumen.activos} hint={resumen.temporales > 0 ? `${resumen.temporales} con contraseña temporal` : 'todos con contraseña propia'} />
      </div>

      <SegmentedTabs value={tab} onChange={setTab} items={[{ k: 'revisar', l: 'Para revisar' }, { k: 'usuarios', l: 'Usuarios y accesos' }]} />

      {tab === 'revisar' && (
        <div className="space-y-3">
          <Guia testid="guia-dueno" titulo="Qué es esto">
            Cada cambio de precio, salario, cuenta por pagar, cliente, venta o usuario que alguien hace desde la app queda aquí con el
            valor anterior y el nuevo. Lo registra el servidor: nadie puede editarlo ni borrarlo, y solo tú lo ves.
          </Guia>
          <Chips value={filtro} onChange={setFiltro}
            items={[{ k: 'importantes', l: 'Importantes' }, { k: 'todos', l: 'Todos' }, ...modulos.map(m => ({ k: m, l: m }))]} />
          {error && <p className="rounded-field bg-red-50 px-3 py-2.5 text-[13px] font-medium text-red-700" role="alert">{error}</p>}
          {filas === null ? <ViewSkeleton /> : visibles.length === 0 ? (
            <Card><EmptyState icon="Shield" message={filtro === 'importantes' ? 'Sin cambios importantes' : 'Sin cambios registrados'}
              hint="Cuando alguien cambie un precio, un salario, una cuenta por pagar o un usuario, aparecerá aquí." /></Card>
          ) : (
            <Card padding="p-0" className="overflow-hidden divide-y divide-line">
              {visibles.map(c => (
                <div key={c.id} className="px-4 py-3" data-testid="bitacora-fila">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-[15px] font-semibold text-ink">{c.titulo}</p>
                    <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${c.importante ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{c.modulo}</span>
                  </div>
                  {c.detalle && <p className="mt-0.5 text-[13px] text-slate-600">{c.detalle}</p>}
                  {c.cambios.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {c.cambios.map(k => (
                        <li key={k.campo} className="text-[13px] text-slate-600">
                          <span className="capitalize text-slate-500">{k.campo}:</span>{' '}
                          <span className="tnum line-through decoration-slate-300">{k.antes}</span>{' → '}
                          <span className="tnum font-semibold text-ink">{k.despues}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-[12px] text-slate-400">{fecha(c.at)}</p>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {tab === 'usuarios' && <UsuariosPanel data={data} actions={actions} user={user} />}
    </div>
  );
}
