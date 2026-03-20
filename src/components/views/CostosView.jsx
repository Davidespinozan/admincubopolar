import { useState, useMemo, PageHeader, EmptyState, Modal, FormInput, FormSelect, FormBtn, useConfirm, s, n, fmtDate, useToast, today, PAGE_SIZE, Paginator } from './viewsCommon';

const CATEGORIAS_COSTO = ['Nómina', 'Renta', 'Servicios', 'Gasolina', 'Mantenimiento', 'Empaque', 'Materia Prima', 'Administrativo', 'Otro'];
const FRECUENCIAS = ['Mensual', 'Quincenal', 'Semanal', 'Único'];

export function CostosView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [tab, setTab] = useState('fijos');
  const [modal, setModal] = useState(null);
  const [aplicarModal, setAplicarModal] = useState(null);
  const [gastoModal, setGastoModal] = useState(false); // Para gastos directos
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState({});
  const [filterCat, setFilterCat] = useState('');

  const empty = { nombre: '', categoria: 'Servicios', monto: '', frecuencia: 'Mensual', diaCargo: '1', proveedor: '', activo: true };
  const [form, setForm] = useState(empty);
  const [aplicarForm, setAplicarForm] = useState({ fecha: today(), referencia: '' });
  const emptyGasto = { concepto: '', categoria: 'Gasolina', monto: '', fecha: today(), referencia: '' };
  const [gastoForm, setGastoForm] = useState(emptyGasto);

  const costosFijos = useMemo(() => (data.costosFijos || []), [data.costosFijos]);
  const costosHistorial = useMemo(() => (data.costosHistorial || []).sort((a, b) => new Date(b.fecha || b.createdAt) - new Date(a.fecha || a.createdAt)), [data.costosHistorial]);

  // Map costo_fijo_id to nombre
  const costosFijosMap = useMemo(() => {
    const m = {};
    costosFijos.forEach(c => { m[c.id] = c; });
    return m;
  }, [costosFijos]);

  const filteredFijos = useMemo(() => {
    return costosFijos.filter(c => !filterCat || c.categoria === filterCat);
  }, [costosFijos, filterCat]);

  const filteredHistorial = useMemo(() => {
    return costosHistorial.filter(c => !filterCat || c.categoria === filterCat);
  }, [costosHistorial, filterCat]);

  const paginatedFijos = useMemo(() => filteredFijos.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredFijos, page]);
  const paginatedHistorial = useMemo(() => filteredHistorial.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredHistorial, page]);

  const openNew = () => { setForm(empty); setErrors({}); setModal('new'); };
  const openEdit = (c) => {
    setForm({
      nombre: s(c.nombre),
      categoria: s(c.categoria) || 'Servicios',
      monto: String(n(c.monto)),
      frecuencia: s(c.frecuencia) || 'Mensual',
      diaCargo: String(c.diaCargo || 1),
      proveedor: s(c.proveedor),
      activo: c.activo !== false
    });
    setErrors({});
    setModal(c);
  };

  const save = async () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = 'Requerido';
    if (!form.monto || Number(form.monto) <= 0) e.monto = 'Monto inválido';
    if (Object.keys(e).length) { setErrors(e); return; }

    const payload = {
      nombre: form.nombre.trim(),
      categoria: form.categoria,
      monto: Number(form.monto),
      frecuencia: form.frecuencia,
      diaCargo: Number(form.diaCargo) || 1,
      proveedor: form.proveedor.trim() || null,
      activo: form.activo
    };

    if (modal === 'new') {
      await actions.addCostoFijo(payload);
      toast?.success('Costo fijo creado');
    } else {
      await actions.updateCostoFijo(modal.id, payload);
      toast?.success('Costo actualizado');
    }
    setModal(null);
  };

  const openAplicar = (c) => {
    setAplicarForm({ fecha: today(), referencia: '' });
    setAplicarModal(c);
  };

  const aplicar = async () => {
    if (!aplicarModal) return;
    await actions.aplicarCostoFijo(aplicarModal.id, aplicarForm.fecha, aplicarForm.referencia);
    toast?.success('Costo aplicado y registrado como egreso');
    setAplicarModal(null);
  };

  // Registrar gasto directo/variable
  const openGasto = () => { setGastoForm(emptyGasto); setErrors({}); setGastoModal(true); };
  const guardarGasto = async () => {
    const e = {};
    if (!gastoForm.concepto.trim()) e.concepto = 'Requerido';
    if (!gastoForm.monto || Number(gastoForm.monto) <= 0) e.monto = 'Monto inválido';
    if (Object.keys(e).length) { setErrors(e); return; }

    await actions.registrarCostoVariable(
      gastoForm.categoria,
      gastoForm.concepto.trim(),
      Number(gastoForm.monto),
      gastoForm.referencia.trim() || null,
      gastoForm.fecha
    );
    toast?.success('Gasto registrado y egreso generado');
    setGastoModal(false);
  };

  // Calculate totals by category
  const totalesPorCategoria = useMemo(() => {
    const t = {};
    costosHistorial.forEach(c => {
      const cat = s(c.categoria) || 'Otro';
      t[cat] = (t[cat] || 0) + n(c.monto);
    });
    return t;
  }, [costosHistorial]);

  const totalMes = useMemo(() => {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();
    return costosHistorial.filter(c => {
      const f = new Date(c.fecha || c.createdAt);
      return f.getMonth() === mesActual && f.getFullYear() === anioActual;
    }).reduce((sum, c) => sum + n(c.monto), 0);
  }, [costosHistorial]);

  return (<div>
    {ConfirmEl}
    <PageHeader title="Costos y Gastos" subtitle="Gestión de costos fijos y variables" />

    {/* Summary Cards */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <p className="text-xs text-slate-400 uppercase">Total mes actual</p>
        <p className="text-xl font-bold text-slate-800">${totalMes.toLocaleString()}</p>
      </div>
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <p className="text-xs text-slate-400 uppercase">Costos fijos</p>
        <p className="text-xl font-bold text-slate-800">{costosFijos.filter(c => c.activo).length}</p>
      </div>
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <p className="text-xs text-slate-400 uppercase">Registros historial</p>
        <p className="text-xl font-bold text-slate-800">{costosHistorial.length}</p>
      </div>
      <div className="bg-white border border-slate-100 rounded-xl p-4">
        <p className="text-xs text-slate-400 uppercase">Mayor gasto</p>
        <p className="text-sm font-semibold text-red-600">
          {Object.entries(totalesPorCategoria).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'}
        </p>
      </div>
    </div>

    {/* Tabs */}
    <div className="flex gap-2 mb-4">
      <button onClick={() => { setTab('fijos'); setPage(0); }} className={`px-4 py-2 text-sm font-semibold rounded-lg min-h-[44px] ${tab === 'fijos' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Costos Fijos</button>
      <button onClick={() => { setTab('historial'); setPage(0); }} className={`px-4 py-2 text-sm font-semibold rounded-lg min-h-[44px] ${tab === 'historial' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Historial</button>
    </div>

    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
      {/* Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 mb-4">
        <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(0); }} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-600 focus:outline-none focus:border-blue-400 min-h-[44px]">
          <option value="">Todas las categorías</option>
          {CATEGORIAS_COSTO.map(c => <option key={c}>{c}</option>)}
        </select>
        <div className="flex gap-2 ml-auto">
          {tab === 'fijos' && (
            <button onClick={openNew} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 min-h-[44px]">+ Nuevo costo fijo</button>
          )}
          {tab === 'historial' && (
            <button onClick={openGasto} className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 min-h-[44px]">+ Registrar gasto</button>
          )}
        </div>
      </div>

      {tab === 'fijos' && (
        <>
          {paginatedFijos.length === 0 && <EmptyState icon="Calculator" message="Sin costos fijos registrados" hint="Agrega costos recurrentes como renta, luz, etc." />}
          <div className="space-y-2">
            {paginatedFijos.map(c => (
              <div key={c.id} className={`rounded-lg p-3.5 border ${c.activo ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{s(c.nombre)}</p>
                    <p className="text-xs text-slate-400 truncate">{s(c.categoria)} • {s(c.frecuencia)} • Día {c.diaCargo || 1}</p>
                    {c.proveedor && <p className="text-xs text-slate-400 truncate">Proveedor: {s(c.proveedor)}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-red-600">${n(c.monto).toLocaleString()}</p>
                    {!c.activo && <span className="text-xs text-slate-400">Inactivo</span>}
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
                  <button onClick={() => openEdit(c)} className="px-3 py-1.5 text-xs bg-slate-100 rounded-lg hover:bg-slate-200">Editar</button>
                  {c.activo && (
                    <button onClick={() => openAplicar(c)} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Aplicar</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Paginator page={page} total={filteredFijos.length} onPage={setPage} />
        </>
      )}

      {tab === 'historial' && (
        <>
          {paginatedHistorial.length === 0 && <EmptyState icon="List" message="Sin registros de costos" hint="Los costos aplicados aparecerán aquí" />}
          <div className="space-y-1.5">
            {paginatedHistorial.map(c => {
              const costoFijo = costosFijosMap[c.costoFijoId];
              return (
                <div key={c.id} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{s(c.concepto) || s(costoFijo?.nombre) || 'Costo'}</p>
                      <p className="text-xs text-slate-400 truncate">{s(c.categoria)} • {s(c.tipo) || 'Fijo'}</p>
                      {c.referencia && <p className="text-xs text-slate-400 truncate">Ref: {s(c.referencia)}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-600">-${n(c.monto).toLocaleString()}</p>
                      <p className="text-xs text-slate-400">{fmtDate(c.fecha || c.createdAt)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <Paginator page={page} total={filteredHistorial.length} onPage={setPage} />
        </>
      )}
    </div>

    {/* Modal Nuevo/Editar Costo Fijo */}
    <Modal open={!!modal && modal !== null} onClose={() => setModal(null)} title={modal === 'new' ? 'Nuevo Costo Fijo' : 'Editar Costo Fijo'}>
      <div className="space-y-3">
        <FormInput label="Nombre *" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} error={errors.nombre} placeholder="Ej: Renta local" />
        <FormSelect label="Categoría" options={CATEGORIAS_COSTO} value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} />
        <FormInput label="Monto *" type="number" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} error={errors.monto} placeholder="0.00" />
        <FormSelect label="Frecuencia" options={FRECUENCIAS} value={form.frecuencia} onChange={e => setForm({ ...form, frecuencia: e.target.value })} />
        <FormInput label="Día de cargo" type="number" value={form.diaCargo} onChange={e => setForm({ ...form, diaCargo: e.target.value })} min="1" max="31" />
        <FormInput label="Proveedor (opcional)" value={form.proveedor} onChange={e => setForm({ ...form, proveedor: e.target.value })} placeholder="Nombre del proveedor" />
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          <span className="text-sm text-slate-600">Activo</span>
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-200">
        {modal !== 'new' && (
          <button onClick={() => askConfirm('Eliminar costo', '¿Eliminar este costo fijo?', async () => {
            await actions.deleteCostoFijo(modal.id);
            toast?.success('Costo eliminado');
            setModal(null);
          })} className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg mr-auto">Eliminar</button>
        )}
        <FormBtn onClick={() => setModal(null)}>Cancelar</FormBtn>
        <FormBtn primary onClick={save}>Guardar</FormBtn>
      </div>
    </Modal>

    {/* Modal Aplicar Costo */}
    <Modal open={!!aplicarModal} onClose={() => setAplicarModal(null)} title="Aplicar Costo">
      {aplicarModal && (
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-sm font-semibold">{s(aplicarModal.nombre)}</p>
            <p className="text-xs text-slate-500">{s(aplicarModal.categoria)}</p>
            <p className="text-lg font-bold text-red-600 mt-1">${n(aplicarModal.monto).toLocaleString()}</p>
          </div>
          <FormInput label="Fecha" type="date" value={aplicarForm.fecha} onChange={e => setAplicarForm({ ...aplicarForm, fecha: e.target.value })} />
          <FormInput label="Referencia / Notas" value={aplicarForm.referencia} onChange={e => setAplicarForm({ ...aplicarForm, referencia: e.target.value })} placeholder="Número de factura, recibo, etc." />
          <p className="text-xs text-slate-400">Al aplicar, se registrará automáticamente como egreso en movimientos contables.</p>
          <div className="flex justify-end gap-2">
            <FormBtn onClick={() => setAplicarModal(null)}>Cancelar</FormBtn>
            <FormBtn primary onClick={aplicar}>Aplicar y registrar egreso</FormBtn>
          </div>
        </div>
      )}
    </Modal>

    {/* Modal Registrar Gasto Directo */}
    <Modal open={gastoModal} onClose={() => setGastoModal(false)} title="Registrar Gasto">
      <div className="space-y-3">
        <FormInput label="Concepto *" value={gastoForm.concepto} onChange={e => setGastoForm({ ...gastoForm, concepto: e.target.value })} error={errors.concepto} placeholder="Ej: Gasolina ruta norte, Reparación compresor" />
        <FormSelect label="Categoría" options={CATEGORIAS_COSTO} value={gastoForm.categoria} onChange={e => setGastoForm({ ...gastoForm, categoria: e.target.value })} />
        <FormInput label="Monto *" type="number" value={gastoForm.monto} onChange={e => setGastoForm({ ...gastoForm, monto: e.target.value })} error={errors.monto} placeholder="0.00" />
        <FormInput label="Fecha" type="date" value={gastoForm.fecha} onChange={e => setGastoForm({ ...gastoForm, fecha: e.target.value })} />
        <FormInput label="Referencia (opcional)" value={gastoForm.referencia} onChange={e => setGastoForm({ ...gastoForm, referencia: e.target.value })} placeholder="# Factura, ticket, voucher" />
        <p className="text-xs text-slate-400">Este gasto se registrará como egreso en contabilidad automáticamente.</p>
      </div>
      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-200">
        <FormBtn onClick={() => setGastoModal(false)}>Cancelar</FormBtn>
        <FormBtn primary onClick={guardarGasto}>Registrar gasto</FormBtn>
      </div>
    </Modal>
  </div>);
}
