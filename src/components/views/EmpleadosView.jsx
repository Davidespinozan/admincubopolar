import { useState, Modal, FormInput, FormSelect, FormBtn, useConfirm, s, n, useToast, today } from './viewsCommon';

export function EmpleadosView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const empty = { nombre: "", rfc: "", curp: "", nss: "", puesto: "", depto: "Ventas y Distribución", salarioDiario: "", fechaIngreso: today(), jornada: "Diurna" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const emps = data.empleados || [];

  const openNew = () => { setForm(empty); setErrors({}); setModal("new"); };
  const openEdit = (e) => {
    setForm({ nombre: s(e.nombre), rfc: s(e.rfc), curp: s(e.curp), nss: s(e.nss), puesto: s(e.puesto), depto: s(e.depto), salarioDiario: String(n(e.salarioDiario)), fechaIngreso: s(e.fechaIngreso), jornada: s(e.jornada) || "Diurna" });
    setErrors({}); setModal(e);
  };

  const save = async () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.puesto.trim()) e.puesto = "Requerido";
    if (!form.salarioDiario) e.salarioDiario = "Requerido";
    if (Object.keys(e).length) { setErrors(e); return; }
    try {
      const payload = { ...form, salarioDiario: parseFloat(form.salarioDiario) };
      if (modal === "new") await actions.addEmpleado(payload);
      else await actions.updateEmpleado(modal.id, payload);
      toast?.success(modal === "new" ? "Empleado registrado" : "Empleado actualizado");
      setModal(null);
    } catch(ex) { toast?.error('Error: ' + (ex?.message || 'No se pudo guardar')); }
  };

  const filtered = emps.filter(e => {
    const q = search.toLowerCase();
    return !q || s(e.nombre).toLowerCase().includes(q) || s(e.puesto).toLowerCase().includes(q) || s(e.depto).toLowerCase().includes(q);
  });
  const deptos = [...new Set(emps.map(e => s(e.depto)))];

  return (<div className="space-y-4">
    {ConfirmEl}
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Empleados ({emps.length})</h2></div>
      <button onClick={openNew} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl min-h-[44px]">+ Nuevo empleado</button>
    </div>
    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, puesto o departamento..." className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm min-h-[44px]" />

    {deptos.map(d => {
      const dEmps = filtered.filter(e => s(e.depto) === d);
      if (dEmps.length === 0) return null;
      return (<div key={d}>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-2">{d} ({dEmps.length})</h3>
        <div className="space-y-2">
          {dEmps.map(e => (
            <div key={e.id} onClick={() => openEdit(e)}
              className="bg-white rounded-xl p-4 border border-slate-100 cursor-pointer hover:border-blue-300 transition-all">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{s(e.nombre)}</p>
                  <p className="text-xs text-slate-500 truncate">{s(e.puesto)} · ${n(e.salarioDiario).toFixed(2)}/día</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${s(e.estatus) === "Activo" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{s(e.estatus)}</span>
              </div>
              <div className="mt-2 flex gap-2 flex-wrap">
                {e.rfc && <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">RFC: {s(e.rfc)}</span>}
                {e.nss && <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">NSS: {s(e.nss)}</span>}
                {e.fechaIngreso && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Ingreso: {s(e.fechaIngreso)}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>);
    })}

    <Modal open={!!modal} onClose={() => setModal(null)} title={modal === "new" ? "Nuevo Empleado" : "Editar Empleado"} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormInput label="Nombre completo *" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} error={errors.nombre} />
        <FormInput label="RFC" value={form.rfc} onChange={e => setForm({ ...form, rfc: e.target.value.toUpperCase() })} maxLength={13} />
        <FormInput label="CURP" value={form.curp} onChange={e => setForm({ ...form, curp: e.target.value.toUpperCase() })} maxLength={18} />
        <FormInput label="NSS" value={form.nss} onChange={e => setForm({ ...form, nss: e.target.value })} />
        <FormInput label="Puesto *" value={form.puesto} onChange={e => setForm({ ...form, puesto: e.target.value })} error={errors.puesto} />
        <FormSelect label="Departamento" options={["Ventas y Distribución", "Producción", "Administración", "Staff"]} value={form.depto} onChange={e => setForm({ ...form, depto: e.target.value })} />
        <FormInput label="Salario diario *" type="number" value={form.salarioDiario} onChange={e => setForm({ ...form, salarioDiario: e.target.value })} error={errors.salarioDiario} />
        <FormInput label="Fecha ingreso" type="date" value={form.fechaIngreso} onChange={e => setForm({ ...form, fechaIngreso: e.target.value })} />
        <FormSelect label="Jornada" options={["Diurna", "Nocturna", "Mixta"]} value={form.jornada} onChange={e => setForm({ ...form, jornada: e.target.value })} />
      </div>
      <div className="space-y-3 border-t border-slate-200 pt-4 mt-5">
        {modal !== "new" && (
          <button onClick={() => askConfirm('Desactivar empleado', `¿Desactivar "${s(modal.nombre)}"?`, async()=>{
              await actions.updateEmpleado(modal.id, { estatus: "Inactivo" });
              toast?.success("Empleado desactivado");
              setModal(null);
            }, true)} className="w-full px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-bold rounded-xl border border-red-200 transition-colors">
            🗑 Desactivar empleado
          </button>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5"><FormBtn onClick={() => setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save}>Guardar</FormBtn></div>
    </Modal>
  </div>);
}
