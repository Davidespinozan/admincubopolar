import { useState, useMemo, Icons, DataTable, PageHeader, s, fmtDateTime, useDebounce, PAGE_SIZE, Paginator } from './viewsCommon';

export function AuditoriaView({ data }) {
  const [filterUsr, setFilterUsr] = useState("");
  const [filterMod, setFilterMod] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const dSearch = useDebounce(search);

  const users = useMemo(() => [...new Set(data.auditoria.map(a => s(a.usuario)).filter(Boolean))], [data.auditoria]);
  const modulos = useMemo(() => [...new Set(data.auditoria.map(a => s(a.modulo)).filter(Boolean))], [data.auditoria]);

  const filtered = useMemo(() => {
    const q = dSearch?.toLowerCase() || "";
    return data.auditoria.filter(a => {
      const mu = !filterUsr || s(a.usuario) === filterUsr;
      const mm = !filterMod || s(a.modulo) === filterMod;
      const ms = !q || s(a.accion).toLowerCase().includes(q) || s(a.modulo).toLowerCase().includes(q) || s(a.detalle).toLowerCase().includes(q);
      return mu && mm && ms;
    });
  }, [data.auditoria, filterUsr, filterMod, dSearch]);
  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  // Estadísticas rápidas
  const stats = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10);
    const accionesHoy = data.auditoria.filter(a => s(a.fecha).startsWith(hoy)).length;
    const usuariosActivos = new Set(data.auditoria.filter(a => s(a.fecha).startsWith(hoy)).map(a => s(a.usuario))).size;
    return { accionesHoy, usuariosActivos, total: data.auditoria.length };
  }, [data.auditoria]);

  return (<div>
    <PageHeader title="Auditoría" subtitle="Historial de acciones" />

    {/* Estadísticas */}
    <div className="grid grid-cols-3 gap-3 mb-4">
      <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-100">
        <p className="text-2xl font-bold text-blue-600">{stats.accionesHoy}</p>
        <p className="text-xs text-blue-500">Acciones hoy</p>
      </div>
      <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100">
        <p className="text-2xl font-bold text-emerald-600">{stats.usuariosActivos}</p>
        <p className="text-xs text-emerald-500">Usuarios activos</p>
      </div>
      <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
        <p className="text-2xl font-bold text-slate-600">{stats.total}</p>
        <p className="text-xs text-slate-500">Total registros</p>
      </div>
    </div>

    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
      <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Buscar acción o detalle..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
      <select value={filterUsr} onChange={e=>{setFilterUsr(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos los usuarios</option>{users.map(u=><option key={u}>{u}</option>)}</select>
      <select value={filterMod} onChange={e=>{setFilterMod(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos los módulos</option>{modulos.map(m=><option key={m}>{m}</option>)}</select>
    </div>
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
      <DataTable columns={[
        {key:"fecha",label:"Fecha",render:v=>fmtDateTime(v)},{key:"usuario",label:"Usuario",bold:true},
        {key:"accion",label:"Acción"},{key:"modulo",label:"Módulo"},{key:"detalle",label:"Detalle"},
      ]} data={paginated} />
      <Paginator page={page} total={filtered.length} onPage={setPage} />
    </div>
  </div>);
}
