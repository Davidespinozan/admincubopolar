import { useState, useMemo, Icons, StatusBadge, DataTable, PageHeader, Modal, FormBtn, EmptyState, s, n, fmtDate, fmtMoney, useToast, PAGE_SIZE, Paginator } from './viewsCommon';

export function MermasView({ data, actions }) {
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [confirmando, setConfirmando] = useState(false);
  const [borrarModal, setBorrarModal] = useState(null);
  const [fotoModal, setFotoModal] = useState(null);

  // Filtros (default: últimos 30 días)
  const hace30 = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);
  const hoy = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [fechaInicio, setFechaInicio] = useState(hace30);
  const [fechaFin, setFechaFin] = useState(hoy);
  const [filtroRuta, setFiltroRuta] = useState('');
  const [filtroSku, setFiltroSku] = useState('');
  const [filtroOrigen, setFiltroOrigen] = useState('');

  const productosBySku = useMemo(() => {
    const map = {};
    (data?.productos || []).forEach(p => {
      if (p?.sku) map[s(p.sku)] = { nombre: s(p.nombre), costo: n(p.costoUnitario || p.costo_unitario) };
    });
    return map;
  }, [data?.productos]);

  const rutaById = useMemo(() => {
    const map = {};
    (data?.rutas || []).forEach(r => { if (r?.id) map[String(r.id)] = r; });
    return map;
  }, [data?.rutas]);

  // Mermas filtradas
  const mermasFiltradas = useMemo(() => {
    return (data?.mermas || []).filter(m => {
      if (!m) return false;
      const f = s(m.fecha);
      if (fechaInicio && f < fechaInicio) return false;
      if (fechaFin && f > fechaFin) return false;
      if (filtroRuta) {
        const rid = String(m.rutaId || m.ruta_id || '');
        if (rid !== String(filtroRuta)) return false;
      }
      if (filtroSku && s(m.sku) !== filtroSku) return false;
      if (filtroOrigen && s(m.origen) !== filtroOrigen) return false;
      return true;
    }).sort((a, b) => {
      const fa = s(a.fecha);
      const fb = s(b.fecha);
      if (fa !== fb) return fb.localeCompare(fa);
      return n(b.id) - n(a.id);
    });
  }, [data?.mermas, fechaInicio, fechaFin, filtroRuta, filtroSku, filtroOrigen]);

  // KPI: total $ y cuenta de mermas en período
  const kpi = useMemo(() => {
    let total = 0;
    for (const m of mermasFiltradas) {
      const costo = productosBySku[s(m.sku)]?.costo || 0;
      total += n(m.cantidad) * costo;
    }
    return { total, count: mermasFiltradas.length };
  }, [mermasFiltradas, productosBySku]);

  // Opciones para filtros
  const rutaOptions = useMemo(() => {
    const set = new Set();
    (data?.mermas || []).forEach(m => {
      const rid = String(m?.rutaId || m?.ruta_id || '');
      if (rid) set.add(rid);
    });
    return [...set].map(rid => {
      const r = rutaById[rid];
      return { value: rid, label: r ? `${s(r.folio) || s(r.nombre)} — ${s(r.choferNombre || r.chofer)}` : `Ruta ${rid}` };
    });
  }, [data?.mermas, rutaById]);

  const skuOptions = useMemo(() => {
    const set = new Set();
    (data?.mermas || []).forEach(m => { if (m?.sku) set.add(s(m.sku)); });
    return [...set].map(sku => ({
      value: sku,
      label: productosBySku[sku] ? `${productosBySku[sku].nombre} (${sku})` : sku,
    }));
  }, [data?.mermas, productosBySku]);

  const origenOptions = useMemo(() => {
    const set = new Set();
    (data?.mermas || []).forEach(m => { if (m?.origen) set.add(s(m.origen)); });
    return [...set].map(o => ({ value: o, label: o }));
  }, [data?.mermas]);

  const paginated = useMemo(() => mermasFiltradas.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [mermasFiltradas, page]);

  const ejecutarBorrado = async () => {
    if (!borrarModal || confirmando) return;
    setConfirmando(true);
    try {
      const result = await actions.borrarMermaConReverso?.(borrarModal.id);
      if (result?.error) {
        if (result.partial) {
          toast?.warning?.(result.error) || toast?.error?.(result.error);
          setBorrarModal(null);
          return;
        }
        toast?.error?.(result.error);
        return;
      }
      toast?.success?.('Merma borrada y stock regresado');
      setBorrarModal(null);
    } finally {
      setConfirmando(false);
    }
  };

  const limpiarFiltros = () => {
    setFechaInicio(hace30);
    setFechaFin(hoy);
    setFiltroRuta('');
    setFiltroSku('');
    setFiltroOrigen('');
    setPage(0);
  };

  return (<div>
    <PageHeader title="Mermas" subtitle="Historial de mermas registradas en rutas y producción" />

    {/* KPI */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <p className="text-[10px] text-amber-500 uppercase font-bold">Total en período</p>
        <p className="text-2xl font-extrabold text-amber-700">{fmtMoney(kpi.total)}</p>
        <p className="text-xs text-amber-500 mt-0.5">{kpi.count} {kpi.count === 1 ? 'merma' : 'mermas'}</p>
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-slate-500 uppercase font-bold">Período</p>
          <p className="text-sm font-bold text-slate-700">{fmtDate(fechaInicio)} → {fmtDate(fechaFin)}</p>
        </div>
        <button onClick={limpiarFiltros} className="text-xs text-blue-600 font-bold hover:underline">Resetear filtros</button>
      </div>
    </div>

    {/* Filtros */}
    <div className="bg-white border border-slate-100 rounded-2xl p-4 mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Desde</label>
          <input type="date" value={fechaInicio} onChange={e => { setFechaInicio(e.target.value); setPage(0); }}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white min-h-[44px]" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Hasta</label>
          <input type="date" value={fechaFin} onChange={e => { setFechaFin(e.target.value); setPage(0); }}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white min-h-[44px]" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ruta</label>
          <select value={filtroRuta} onChange={e => { setFiltroRuta(e.target.value); setPage(0); }}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white min-h-[44px]">
            <option value="">Todas</option>
            {rutaOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">SKU</label>
          <select value={filtroSku} onChange={e => { setFiltroSku(e.target.value); setPage(0); }}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white min-h-[44px]">
            <option value="">Todos</option>
            {skuOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="lg:col-span-4">
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Origen / Usuario</label>
          <select value={filtroOrigen} onChange={e => { setFiltroOrigen(e.target.value); setPage(0); }}
            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white min-h-[44px]">
            <option value="">Todos</option>
            {origenOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
    </div>

    {/* Tabla */}
    <div className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5">
      {mermasFiltradas.length === 0 ? (
        <EmptyState
          message="Sin mermas en el período"
          hint="Las mermas se registran desde la app de chofer al cerrar ruta. Ajusta los filtros si esperabas ver alguna."
        />
      ) : (
        <>
          <DataTable
            columns={[
              { key: 'fecha', label: 'Fecha', render: v => fmtDate(v) },
              { key: 'sku', label: 'Producto', bold: true, primary: true, render: v => {
                const info = productosBySku[s(v)];
                return (
                  <div>
                    <div className="font-semibold text-slate-800">{info?.nombre || s(v)}</div>
                    {info?.nombre && <div className="font-mono text-[11px] text-slate-400 mt-0.5">{s(v)}</div>}
                  </div>
                );
              }},
              { key: 'cantidad', label: 'Cant.', render: v => <span className="font-mono font-semibold text-amber-700">{n(v).toLocaleString()}</span> },
              { key: 'causa', label: 'Causa', badge: true, render: v => <StatusBadge status={s(v)} /> },
              { key: 'origen', label: 'Origen', hideOnMobile: true },
              { key: 'rutaId', label: 'Ruta', hideOnMobile: true, render: (v, r) => {
                const rid = String(v || r.ruta_id || '');
                if (!rid) return <span className="text-xs text-slate-400">—</span>;
                const ruta = rutaById[rid];
                return <span className="text-xs text-slate-600">{ruta ? (s(ruta.folio) || s(ruta.nombre)) : `Ruta ${rid}`}</span>;
              }},
              { key: 'fotoUrl', label: 'Foto', hideOnMobile: true, render: (v) => {
                if (!v) return <span className="text-xs text-slate-400">—</span>;
                return (
                  <button onClick={(e) => { e.stopPropagation(); setFotoModal(v); }} className="block">
                    <img src={v} alt="Evidencia" className="w-12 h-12 object-cover rounded-lg border border-slate-200 hover:border-blue-400" />
                  </button>
                );
              }},
              { key: 'costo', label: 'Costo $', render: (_, r) => {
                const costo = productosBySku[s(r.sku)]?.costo || 0;
                const totalLinea = n(r.cantidad) * costo;
                return <span className="font-bold text-slate-800">{fmtMoney(totalLinea)}</span>;
              }},
              { key: 'acciones', label: '', render: (_, row) => (
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setBorrarModal(row)}
                    aria-label="Borrar merma con reverso"
                    title="Borrar y regresar stock"
                    className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <span className="text-base leading-none">🗑</span>
                  </button>
                </div>
              )},
            ]}
            data={paginated}
            cardTitle={r => {
              const info = productosBySku[s(r.sku)];
              return (
                <div>
                  <div>{n(r.cantidad)}× {info?.nombre || s(r.sku)}</div>
                  {info?.nombre && <div className="font-mono text-[11px] text-slate-400 mt-0.5">{s(r.sku)}</div>}
                </div>
              );
            }}
            cardSubtitle={r => {
              const costo = productosBySku[s(r.sku)]?.costo || 0;
              return (
                <div className="text-xs text-slate-500">
                  <div>{fmtDate(r.fecha)} · {s(r.causa)} · {s(r.origen)}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-bold text-amber-700">{fmtMoney(n(r.cantidad) * costo)}</span>
                    <button onClick={(e) => { e.stopPropagation(); setBorrarModal(r); }} className="text-xs text-red-600 font-bold">🗑 Borrar</button>
                  </div>
                </div>
              );
            }}
          />
          <Paginator page={page} total={mermasFiltradas.length} onPage={setPage} />
        </>
      )}
    </div>

    {/* Modal de confirmación al borrar */}
    <Modal open={!!borrarModal} onClose={() => { if (!confirmando) setBorrarModal(null); }} title="Borrar merma con reverso de inventario">
      {borrarModal && (() => {
        const info = productosBySku[s(borrarModal.sku)];
        const costo = info?.costo || 0;
        const total = n(borrarModal.cantidad) * costo;
        const fechaMerma = new Date(s(borrarModal.fecha));
        const dias = Math.floor((Date.now() - fechaMerma.getTime()) / (1000 * 60 * 60 * 24));
        const esVieja = Number.isFinite(dias) && dias > 30;
        return (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900 space-y-2">
              <p className="font-bold">¿Borrar esta merma?</p>
              <p className="text-xs">
                Se regresarán <span className="font-bold">{n(borrarModal.cantidad)}×</span> <span className="font-bold">{info?.nombre || s(borrarModal.sku)}</span> al inventario (primer cuarto frío activo).
              </p>
              <p className="text-xs">
                Causa: <span className="font-semibold">{s(borrarModal.causa)}</span> · Fecha: <span className="font-semibold">{fmtDate(borrarModal.fecha)}</span> · Costo recuperado: <span className="font-semibold">{fmtMoney(total)}</span>
              </p>
              <p className="text-xs">El egreso contable asociado y la foto en evidencia también serán eliminados.</p>
            </div>
            {esVieja && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                ⚠️ Esta merma es de hace {dias} días. Borrarla afectará el inventario actual. Asegúrate de que es lo correcto.
              </div>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <FormBtn onClick={() => { if (!confirmando) setBorrarModal(null); }}>Cancelar</FormBtn>
              <button
                onClick={ejecutarBorrado}
                disabled={confirmando}
                className="px-4 py-2.5 text-sm font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {confirmando ? 'Borrando…' : 'Borrar y regresar stock'}
              </button>
            </div>
          </div>
        );
      })()}
    </Modal>

    {/* Modal de foto en grande */}
    {fotoModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setFotoModal(null)}>
        <img src={fotoModal} alt="Evidencia merma" className="max-w-full max-h-[90vh] rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
        <button
          onClick={() => setFotoModal(null)}
          className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full w-10 h-10 flex items-center justify-center"
          aria-label="Cerrar"
        >
          <Icons.X />
        </button>
      </div>
    )}
  </div>);
}

export default MermasView;
