import { useState, useMemo, Icons, StatusBadge, DataTable, s, n, fmtDateTime, PAGE_SIZE, Paginator } from './viewsCommon';

export function KardexView({ data }) {
  const [pageKardex, setPageKardex] = useState(0);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("");

  const filtered = useMemo(() => {
    const q = s(search).toLowerCase();
    return (data.inventarioMov || []).filter(m => {
      const ms = !q || s(m.producto).toLowerCase().includes(q) || s(m.origen).toLowerCase().includes(q) || s(m.usuario).toLowerCase().includes(q);
      const mt = !filterTipo || s(m.tipo) === filterTipo;
      return ms && mt;
    });
  }, [data.inventarioMov, search, filterTipo]);

  const paginated = useMemo(() => filtered.slice(pageKardex * PAGE_SIZE, (pageKardex + 1) * PAGE_SIZE), [filtered, pageKardex]);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-800">Historial de Inventario</h2>
        <p className="text-xs text-slate-400">Todos los movimientos de productos: entradas, salidas, traspasos, mermas y devoluciones</p>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPageKardex(0); }}
            placeholder="Buscar producto, referencia o usuario..."
            className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-slate-400 min-h-[44px]"
          />
        </div>
        <select
          value={filterTipo}
          onChange={e => { setFilterTipo(e.target.value); setPageKardex(0); }}
          className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-slate-400 min-h-[44px]"
        >
          <option value="">Todos los tipos</option>
          {["Entrada", "Salida", "Traspaso", "Devolución", "Merma"].map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
        <DataTable
          columns={[
            { key: "fecha", label: "Fecha", render: v => fmtDateTime(v) },
            { key: "tipo", label: "Tipo", badge: true, render: v => <StatusBadge status={v} /> },
            { key: "producto", label: "Producto", bold: true },
            { key: "cantidad", label: "Cantidad", render: v => {
              const num = n(v, -999999);
              return <span className={`font-mono font-semibold ${num > 0 ? "text-emerald-600" : num < 0 ? "text-red-500" : "text-slate-600"}`}>{num > 0 ? `+${num}` : num}</span>;
            }},
            { key: "origen", label: "Referencia", hideOnMobile: true },
            { key: "usuario", label: "Usuario", hideOnMobile: true },
          ]}
          data={paginated}
        />
        <Paginator page={pageKardex} total={filtered.length} onPage={setPageKardex} />
      </div>
    </div>
  );
}
