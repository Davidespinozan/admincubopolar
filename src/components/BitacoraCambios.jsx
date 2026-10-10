// BitacoraCambios — "Cambios sensibles" (GER-1, mig 120). Pestaña de Auditoría
// que solo ve el Dueño: cada cambio hecho directo desde la app en precios,
// salarios, cuentas por pagar, clientes, ventas o usuarios, con antes →
// después y quién. La escribe la base de datos (nadie la edita ni la borra) y
// la protege RLS (dueno_read), no esta pantalla.
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Card, Chips, Guia } from './ui/Components';
import { EmptyState, ViewSkeleton } from './ui/Skeleton';
import { describirCambio } from '../data/usuariosLogic';
import { ZONA_NEGOCIO } from '../utils/fechas';

const fecha = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-MX', { timeZone: ZONA_NEGOCIO, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

export default function BitacoraCambios({ actions }) {
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

  const modulos = useMemo(() => [...new Set((filas || []).map(x => x.modulo))].sort(), [filas]);
  const visibles = useMemo(() => (filas || []).filter(x =>
    filtro === 'todos' ? true : filtro === 'importantes' ? x.importante : x.modulo === filtro), [filas, filtro]);

  return (
    <div data-testid="bitacora-cambios">
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
    </div>
  );
}
