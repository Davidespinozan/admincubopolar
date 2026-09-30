import { useState, useMemo, StatusBadge, PageHeader, Modal, FormBtn, EmptyState, s, n, eqId, fmtDate, fmtMoney } from './viewsCommon';
import { useEffect } from 'react';
import { calcularEsperadoPorRuta, formatDiferencia } from '../../data/cierreCajaLogic';
import { diaNegocio } from '../../utils/fechas';
import CierreCajaModal from '../CierreCajaModal';

export function ConciliacionView({ data, actions }) {
  const [tab, setTab] = useState('pendientes'); // pendientes | historico
  const [cierreRuta, setCierreRuta] = useState(null); // ruta en modal de cierre
  const [detalleCierre, setDetalleCierre] = useState(null);

  // Filtros histórico
  // 096: "hoy" es el día de negocio (America/Mazatlan), no el del navegador.
  const hoyStr = useMemo(() => diaNegocio(), []);
  const hace30 = useMemo(() => {
    const [y, m, d] = hoyStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d - 30));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  }, [hoyStr]);
  const [fechaInicio, setFechaInicio] = useState(hace30);
  const [fechaFin, setFechaFin] = useState(hoyStr);
  const [filtroChofer, setFiltroChofer] = useState('');

  const choferNombrePorId = useMemo(() => {
    const map = {};
    (data?.usuarios || []).forEach(u => { if (u?.id) map[String(u.id)] = s(u.nombre); });
    return map;
  }, [data?.usuarios]);

  const cierres = data?.cierresDiarios || [];

  // 096: rutas pendientes de caja según el servidor (la ruta tiene o no su
  // caja). No se deriva ninguna fecha en el navegador para decidirlo.
  const [pendientesSrv, setPendientesSrv] = useState({ filas: [], error: null });
  const refrescoCaja = `${cierres.length}|${cierres[0]?.id || 0}|${(data?.rutas || []).map(r => `${r.id}:${s(r.estatus)}`).join(',')}`;
  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await actions?.obtenerRutasPendientesCaja?.();
      if (!vivo) return;
      if (!r || r.error) setPendientesSrv({ filas: [], error: r?.error || 'No disponible' });
      else setPendientesSrv({ filas: r.data, error: null });
    })();
    return () => { vivo = false; };
  }, [actions, refrescoCaja]);
  const rutasPendientes = useMemo(() => (pendientesSrv.filas || []).map(r => ({
    ...r,
    choferId: r.chofer_id,
    choferNombre: r.chofer_nombre,
    fechaCierre: r.fecha_fin || null,  // DATE de negocio tal cual (el servidor fija la caja con este dato)
  })), [pendientesSrv.filas]);

  // Pagos pre-indexados por ruta para mostrar el esperado en cada card
  const pagosPorRuta = useMemo(() => {
    const ordenesPorRuta = {};
    for (const o of (data?.ordenes || [])) {
      const rid = String(o.rutaId || o.ruta_id || '');
      if (!rid) continue;
      if (!ordenesPorRuta[rid]) ordenesPorRuta[rid] = new Set();
      ordenesPorRuta[rid].add(String(o.id));
    }
    const out = {};
    for (const p of (data?.pagos || [])) {
      const oid = String(p.ordenId || p.orden_id || '');
      if (!oid) continue;
      for (const [rid, set] of Object.entries(ordenesPorRuta)) {
        if (set.has(oid)) {
          (out[rid] = out[rid] || []).push(p);
          break;
        }
      }
    }
    return out;
  }, [data?.ordenes, data?.pagos]);

  const cierresFiltrados = useMemo(() => {
    return cierres.filter(c => {
      const f = s(c.fecha).slice(0, 10);
      if (fechaInicio && f < fechaInicio) return false;
      if (fechaFin && f > fechaFin) return false;
      if (filtroChofer && String(c.choferId || c.chofer_id) !== String(filtroChofer)) return false;
      return true;
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [cierres, fechaInicio, fechaFin, filtroChofer]);

  // Stats del histórico filtrado
  const stats = useMemo(() => {
    const hoy = hoyStr;
    const cierresHoy = cierres.filter(c => s(c.fecha).slice(0, 10) === hoy);
    const totalContadoHoy = cierresHoy.reduce((s, c) => s + n(c.contadoTotal), 0);
    const sumaDiferencias = cierresFiltrados.reduce((s, c) => s + n(c.diferencia), 0);
    return {
      cierresHoy: cierresHoy.length,
      totalContadoHoy,
      sumaDiferencias,
    };
  }, [cierres, cierresFiltrados, hoyStr]);

  const handleSuccess = () => setCierreRuta(null);

  // Cierra modal con Esc cuando hay detalle abierto (consistente con otros modales)
  useEffect(() => {
    if (!detalleCierre) return;
    const onKey = (e) => { if (e.key === 'Escape') setDetalleCierre(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detalleCierre]);

  return (
    <div>
      <PageHeader title="Cortes de Caja" subtitle="Conciliación de rutas con captura de contado físico" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Cierres hoy</p>
          <p className="text-xl sm:text-3xl font-extrabold text-slate-800">{stats.cierresHoy}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Contado hoy</p>
          <p className="text-xl sm:text-3xl font-extrabold text-emerald-700">{fmtMoney(stats.totalContadoHoy)}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Diferencia acumulada (período)</p>
          <p className={`text-xl sm:text-3xl font-extrabold ${stats.sumaDiferencias === 0 ? 'text-slate-700' : stats.sumaDiferencias > 0 ? 'text-blue-700' : 'text-red-700'}`}>
            {stats.sumaDiferencias > 0 ? '+' : ''}{fmtMoney(stats.sumaDiferencias)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 mb-4">
        <button onClick={() => setTab('pendientes')} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-[2px] ${tab === 'pendientes' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>
          Pendientes de cerrar ({rutasPendientes.length})
        </button>
        <button onClick={() => setTab('historico')} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-[2px] ${tab === 'historico' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>
          Histórico ({cierresFiltrados.length})
        </button>
      </div>

      {/* TAB: PENDIENTES */}
      {tab === 'pendientes' && pendientesSrv.error && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 mb-3">No se pudieron cargar las rutas pendientes: {pendientesSrv.error}</p>
      )}
      {tab === 'pendientes' && (
        rutasPendientes.length === 0 ? (
          <EmptyState
            message="Sin rutas pendientes de cerrar"
            hint="Las rutas aparecen aquí cuando alcanzan estatus Completada o Cerrada y no tienen cierre todavía."
          />
        ) : (
          <div className="space-y-3">
            {rutasPendientes.map(r => {
              const pagos = pagosPorRuta[String(r.id)] || [];
              const esperado = calcularEsperadoPorRuta(pagos);
              const choferNombre = s(r.choferNombre || r.chofer) || choferNombrePorId[String(r.choferId || r.chofer_id)] || '—';
              return (
                <div key={r.id} className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5">
                  <div className="flex items-start justify-between mb-3 gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-800">{s(r.nombre) || s(r.folio)}</h3>
                        <span className="font-mono text-xs text-blue-600">{s(r.folio)}</span>
                        <StatusBadge status={r.estatus} />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{choferNombre} · {r.fechaCierre ? `Cierre de ruta ${fmtDate(r.fechaCierre)}` : 'Sin fecha de cierre registrada (no se puede cerrar caja)'}</p>
                    </div>
                    <button onClick={() => setCierreRuta(r)}
                      className="flex-shrink-0 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition-colors min-h-[40px]">
                      Cerrar caja
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-50 rounded-xl p-2.5">
                      <p className="text-[10px] text-slate-400 uppercase">Efectivo</p>
                      <p className="text-sm font-bold text-slate-800">{fmtMoney(esperado.efectivo)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-2.5">
                      <p className="text-[10px] text-slate-400 uppercase">Transferencia</p>
                      <p className="text-sm font-bold text-slate-800">{fmtMoney(esperado.transferencia)}</p>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-2.5">
                      <p className="text-[10px] text-amber-500 uppercase">Crédito</p>
                      <p className="text-sm font-bold text-amber-700">{fmtMoney(esperado.credito)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* TAB: HISTÓRICO */}
      {tab === 'historico' && (
        <>
          {/* Filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white" />
            <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white" />
            <select value={filtroChofer} onChange={e => setFiltroChofer(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white">
              <option value="">Todos los choferes</option>
              {/* Tanda 10: oculta cuentas E2E del filtro */}
              {(data?.usuarios || []).filter(u => s(u.rol).toLowerCase().includes('chofer') && !u.is_test_account).map(u => (
                <option key={u.id} value={u.id}>{s(u.nombre)}</option>
              ))}
            </select>
          </div>

          {cierresFiltrados.length === 0 ? (
            <EmptyState message="Sin cierres en el período" hint="Cambia las fechas o filtros para ver más cortes." />
          ) : (
            <div className="space-y-2">
              {cierresFiltrados.map(c => {
                const dif = formatDiferencia(c.diferencia);
                const ruta = (data?.rutas || []).find(r => eqId(r.id, c.rutaId || c.ruta_id));
                const choferNombre = choferNombrePorId[String(c.choferId || c.chofer_id)] || s(c.cerradoPor || c.cerrado_por) || '—';
                const colorBg = dif.color === 'verde' ? 'bg-emerald-50 border-emerald-200'
                              : dif.color === 'azul' ? 'bg-blue-50 border-blue-200'
                              : 'bg-red-50 border-red-200';
                const colorText = dif.color === 'verde' ? 'text-emerald-700'
                                : dif.color === 'azul' ? 'text-blue-700'
                                : 'text-red-700';
                return (
                  <button key={c.id} onClick={() => setDetalleCierre(c)} className={`w-full text-left bg-white border rounded-xl p-3 sm:p-4 hover:bg-slate-50 transition-colors ${colorBg}`}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">{s(ruta?.folio) || `Ruta #${c.rutaId || c.ruta_id || '—'}`} · {choferNombre}</p>
                        <p className="text-[11px] text-slate-500">{fmtDate(c.fecha)} · cerrado por {s(c.cerradoPor || c.cerrado_por)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`text-sm font-extrabold ${colorText}`}>{dif.label}</p>
                        <p className="text-[11px] text-slate-500">Contado: {fmtMoney(c.contadoTotal)}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Modal de cierre */}
      <CierreCajaModal
        open={!!cierreRuta}
        ruta={cierreRuta}
        data={data}
        actions={actions}
        onClose={() => setCierreRuta(null)}
        onSuccess={handleSuccess}
      />

      {/* Modal de detalle de cierre histórico */}
      <Modal open={!!detalleCierre} onClose={() => setDetalleCierre(null)} title="Detalle de cierre">
        {detalleCierre && (() => {
          const ruta = (data?.rutas || []).find(r => eqId(r.id, detalleCierre.rutaId || detalleCierre.ruta_id));
          const dif = formatDiferencia(detalleCierre.diferencia);
          const snapshot = Array.isArray(detalleCierre.pagosSnapshot || detalleCierre.pagos_snapshot)
            ? (detalleCierre.pagosSnapshot || detalleCierre.pagos_snapshot)
            : [];
          const colorBadge = dif.color === 'verde' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : dif.color === 'azul' ? 'bg-blue-100 text-blue-800 border-blue-200'
                          : 'bg-red-100 text-red-800 border-red-200';
          return (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-sm font-semibold text-slate-800">{s(ruta?.nombre) || s(ruta?.folio) || `Ruta #${detalleCierre.rutaId || detalleCierre.ruta_id}`}</p>
                <p className="text-xs text-slate-500">{fmtDate(detalleCierre.fecha)} · Cerrado por {s(detalleCierre.cerradoPor || detalleCierre.cerrado_por)} · {fmtDate(detalleCierre.cerradoAt || detalleCierre.cerrado_at)}</p>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Esperado</p>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase">Efectivo</p><p className="font-bold">{fmtMoney(detalleCierre.esperadoEfectivo)}</p></div>
                  <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase">Transfer.</p><p className="font-bold">{fmtMoney(detalleCierre.esperadoTransferencia)}</p></div>
                  <div className="bg-amber-50 rounded-lg p-2"><p className="text-[10px] text-amber-500 uppercase">Crédito</p><p className="font-bold text-amber-700">{fmtMoney(detalleCierre.esperadoCredito)}</p></div>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Contado</p>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase">Efectivo</p><p className="font-bold">{fmtMoney(detalleCierre.contadoEfectivo)}</p></div>
                  <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase">Transfer.</p><p className="font-bold">{fmtMoney(detalleCierre.contadoTransferencia)}</p></div>
                  <div className="bg-emerald-50 rounded-lg p-2"><p className="text-[10px] text-emerald-500 uppercase">Total</p><p className="font-bold text-emerald-700">{fmtMoney(detalleCierre.contadoTotal)}</p></div>
                </div>
              </div>

              <div className={`rounded-xl border px-3 py-3 flex justify-between items-center ${colorBadge}`}>
                <div>
                  <p className="text-[10px] font-bold uppercase opacity-70">Diferencia</p>
                  <p className="text-lg font-extrabold">{dif.label}</p>
                </div>
              </div>

              {s(detalleCierre.motivoDiferencia || detalleCierre.motivo_diferencia) && (
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase mb-1">Motivo</p>
                  <p className="text-sm text-slate-700">{s(detalleCierre.motivoDiferencia || detalleCierre.motivo_diferencia)}</p>
                </div>
              )}

              {s(detalleCierre.notas) && (
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase mb-1">Notas</p>
                  <p className="text-sm text-slate-600">{s(detalleCierre.notas)}</p>
                </div>
              )}

              {snapshot.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700">
                    Ver snapshot de {snapshot.length} {snapshot.length === 1 ? 'pago' : 'pagos'} considerados
                  </summary>
                  <div className="mt-2 space-y-1 max-h-48 overflow-auto">
                    {snapshot.map((p, i) => (
                      <div key={i} className="flex justify-between bg-slate-50 rounded px-2 py-1.5 text-xs">
                        <span className="font-mono text-slate-500">{s(p.orden_folio) || `#${p.orden_id}`}</span>
                        <span className="text-slate-600">{s(p.metodo)}</span>
                        <span className="font-semibold">{fmtMoney(p.monto)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="flex justify-end pt-2">
                <FormBtn onClick={() => setDetalleCierre(null)}>Cerrar</FormBtn>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
