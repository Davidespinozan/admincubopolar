import { useState, useMemo, DataTable, PageHeader, Modal, FormBtn, EmptyState, s, n, fmtDate, fmtMoney, PAGE_SIZE, Paginator } from './viewsCommon';

export function DevolucionesView({ data }) {
  const [page, setPage] = useState(0);
  const [detalleModal, setDetalleModal] = useState(null);

  // Filtros default: últimos 30 días
  const hace30 = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);
  const hoy = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [fechaInicio, setFechaInicio] = useState(hace30);
  const [fechaFin, setFechaFin] = useState(hoy);
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroNotaCredito, setFiltroNotaCredito] = useState(''); // '', 'pendiente', 'sin_nota'

  const clienteById = useMemo(() => {
    const map = {};
    (data?.clientes || []).forEach(c => { if (c?.id) map[String(c.id)] = s(c.nombre); });
    return map;
  }, [data?.clientes]);

  const ordenById = useMemo(() => {
    const map = {};
    (data?.ordenes || []).forEach(o => { if (o?.id) map[String(o.id)] = o; });
    return map;
  }, [data?.ordenes]);

  const devoluciones = useMemo(() => {
    return (data?.devoluciones || []).filter(d => {
      if (!d) return false;
      const fecha = s(d.fecha).slice(0, 10);
      if (fechaInicio && fecha < fechaInicio) return false;
      if (fechaFin && fecha > fechaFin) return false;
      if (filtroCliente && String(d.clienteId || d.cliente_id || '') !== String(filtroCliente)) return false;
      if (filtroTipo && s(d.tipoReembolso || d.tipo_reembolso) !== filtroTipo) return false;
      if (filtroNotaCredito === 'pendiente' && !(d.requiereNotaCredito || d.requiere_nota_credito) && !(d.cfdiNotaCreditoUuid || d.cfdi_nota_credito_uuid)) return false;
      if (filtroNotaCredito === 'pendiente' && (d.cfdiNotaCreditoUuid || d.cfdi_nota_credito_uuid)) return false;
      if (filtroNotaCredito === 'sin_nota' && (d.requiereNotaCredito || d.requiere_nota_credito)) return false;
      return true;
    });
  }, [data?.devoluciones, fechaInicio, fechaFin, filtroCliente, filtroTipo, filtroNotaCredito]);

  const stats = useMemo(() => {
    const total = devoluciones.reduce((s, d) => s + n(d.total), 0);
    const pendientes = devoluciones.filter(d => (d.requiereNotaCredito || d.requiere_nota_credito) && !(d.cfdiNotaCreditoUuid || d.cfdi_nota_credito_uuid)).length;
    return { count: devoluciones.length, total, pendientes };
  }, [devoluciones]);

  const paginadas = useMemo(() => devoluciones.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [devoluciones, page]);

  const itemsResumen = (items) => {
    if (!Array.isArray(items)) return '';
    return items.map(it => `${n(it.cantidad)}×${s(it.sku)}`).join(', ');
  };

  return (
    <div>
      <PageHeader title="Devoluciones" subtitle="Reembolsos y reposiciones post-entrega" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Devoluciones</p>
          <p className="text-xl sm:text-3xl font-extrabold text-slate-800">{stats.count}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Total reembolsado</p>
          <p className="text-xl sm:text-3xl font-extrabold text-red-600">{fmtMoney(stats.total)}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5">
          <p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase mb-1">Notas crédito pendientes</p>
          <p className="text-xl sm:text-3xl font-extrabold text-amber-600">{stats.pendientes}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <input type="date" value={fechaInicio} onChange={e => { setFechaInicio(e.target.value); setPage(0); }} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white" />
        <input type="date" value={fechaFin} onChange={e => { setFechaFin(e.target.value); setPage(0); }} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white" />
        <select value={filtroCliente} onChange={e => { setFiltroCliente(e.target.value); setPage(0); }} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white">
          <option value="">Todos los clientes</option>
          {(data?.clientes || []).map(c => <option key={c.id} value={c.id}>{s(c.nombre)}</option>)}
        </select>
        <select value={filtroTipo} onChange={e => { setFiltroTipo(e.target.value); setPage(0); }} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white">
          <option value="">Todos los tipos</option>
          <option value="Efectivo">Efectivo</option>
          <option value="Nota credito">Nota crédito</option>
          <option value="Reposicion">Reposición</option>
        </select>
        <select value={filtroNotaCredito} onChange={e => { setFiltroNotaCredito(e.target.value); setPage(0); }} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white">
          <option value="">Todas (CFDI)</option>
          <option value="pendiente">Nota crédito pendiente</option>
          <option value="sin_nota">Sin nota crédito</option>
        </select>
      </div>

      {/* Tabla */}
      {devoluciones.length === 0 ? (
        <EmptyState message="Sin devoluciones en el período" hint="Cambia el rango de fechas o los filtros para ver más." />
      ) : (
        <>
          <DataTable
            rows={paginadas}
            onRowClick={(row) => setDetalleModal(row)}
            cols={[
              { key: 'fecha', label: 'Fecha', render: v => fmtDate(v) },
              { key: 'orden_id', label: 'Orden', render: (_, r) => {
                const o = ordenById[String(r.ordenId || r.orden_id)] || {};
                return <span className="font-mono text-xs text-blue-600">{s(o.folio) || `#${r.ordenId || r.orden_id}`}</span>;
              }},
              { key: 'cliente', label: 'Cliente', render: (_, r) => clienteById[String(r.clienteId || r.cliente_id)] || '—' },
              { key: 'motivo', label: 'Motivo', render: v => <span className="text-xs text-slate-600 truncate">{s(v)}</span> },
              { key: 'items', label: 'Productos', hideOnMobile: true, render: v => <span className="text-xs text-slate-500">{itemsResumen(v)}</span> },
              { key: 'tipo_reembolso', label: 'Tipo', render: (_, r) => {
                const t = s(r.tipoReembolso || r.tipo_reembolso);
                const display = t === 'Nota credito' ? 'Nota crédito' : t === 'Reposicion' ? 'Reposición' : t;
                const cls = t === 'Reposicion' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : t === 'Nota credito' ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-slate-50 text-slate-700 border-slate-200';
                return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{display}</span>;
              }},
              { key: 'total', label: 'Total', bold: true, render: v => fmtMoney(v) },
              { key: 'cfdi', label: 'CFDI', hideOnMobile: true, render: (_, r) => {
                const req = r.requiereNotaCredito || r.requiere_nota_credito;
                const uuid = r.cfdiNotaCreditoUuid || r.cfdi_nota_credito_uuid;
                if (!req) return <span className="text-[10px] text-slate-400">—</span>;
                if (uuid) return <span className="text-[10px] font-bold text-emerald-600">✓ Timbrada</span>;
                return <span className="text-[10px] font-bold text-amber-600">⏳ Pendiente</span>;
              }},
              { key: 'usuario', label: 'Por', hideOnMobile: true, render: v => <span className="text-xs text-slate-500">{s(v)}</span> },
            ]}
          />
          {devoluciones.length > PAGE_SIZE && (
            <Paginator total={devoluciones.length} page={page} onChange={setPage} />
          )}
        </>
      )}

      {/* Modal detalle */}
      <Modal open={!!detalleModal} onClose={() => setDetalleModal(null)} title="Detalle de devolución">
        {detalleModal && (() => {
          const o = ordenById[String(detalleModal.ordenId || detalleModal.orden_id)] || {};
          const items = Array.isArray(detalleModal.items) ? detalleModal.items : [];
          return (
            <div className="space-y-3">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-500">Orden <span className="font-mono font-bold text-blue-600">{s(o.folio) || `#${detalleModal.ordenId || detalleModal.orden_id}`}</span> · Cliente: {clienteById[String(detalleModal.clienteId || detalleModal.cliente_id)] || '—'}</p>
                <p className="text-xs text-slate-500">{fmtDate(detalleModal.fecha)} · Por {s(detalleModal.usuario)}</p>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Items devueltos</p>
                <div className="space-y-1">
                  {items.map((it, i) => (
                    <div key={i} className="flex justify-between bg-white border border-slate-100 rounded-lg px-3 py-2 text-sm">
                      <span className="text-slate-700"><span className="font-mono text-xs text-slate-500">{s(it.sku)}</span> · {n(it.cantidad)} × {fmtMoney(it.precio_unitario, { decimals: 2 })}</span>
                      <span className="font-semibold">{fmtMoney(it.subtotal || (n(it.cantidad) * n(it.precio_unitario)), { decimals: 2 })}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400 uppercase">Tipo reembolso</p>
                  <p className="font-semibold">{s(detalleModal.tipoReembolso || detalleModal.tipo_reembolso)}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3">
                  <p className="text-[10px] text-emerald-500 uppercase">Total</p>
                  <p className="font-bold text-emerald-700">{fmtMoney(detalleModal.total, { decimals: 2 })}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Motivo</p>
                <p className="text-sm text-slate-700">{s(detalleModal.motivo)}</p>
              </div>

              {s(detalleModal.notas) && (
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase mb-1">Notas</p>
                  <p className="text-sm text-slate-600">{s(detalleModal.notas)}</p>
                </div>
              )}

              {(detalleModal.requiereNotaCredito || detalleModal.requiere_nota_credito) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                  <strong>Nota de crédito CFDI tipo E pendiente.</strong> {detalleModal.cfdiNotaCreditoUuid || detalleModal.cfdi_nota_credito_uuid ? `Timbrada (UUID ${s(detalleModal.cfdiNotaCreditoUuid || detalleModal.cfdi_nota_credito_uuid)}).` : 'Aún no se ha emitido.'}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <FormBtn onClick={() => setDetalleModal(null)}>Cerrar</FormBtn>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
