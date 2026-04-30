import { useState, Modal, FormInput, FormSelect, FormBtn, useConfirm, EmptyState, s, useToast, supabase } from './viewsCommon';

export function ConfiguracionView({ data, actions }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [modal, setModal] = useState(null);
  const empty = { nombre: "", email: "", rol: "Ventas", password: "" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const openNew = () => { setForm(empty); setErrors({}); setModal("new"); };
  const openEdit = (u) => { setForm({ nombre: s(u.nombre), email: s(u.email), rol: s(u.rol), password: "" }); setErrors({}); setModal(u); };

  const save = async () => {
    if (saving) return;
    const e = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.email.trim()) e.email = "Requerido";
    if (modal === "new" && !form.password) e.password = "Requerido para nuevo usuario";
    if (modal === "new" && form.password && form.password.length < 6) e.password = "Mínimo 6 caracteres";
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true);
    try {
      if (modal === "new") {
        // Create user via secure Edge Function (validates rol server-side)
        const { data: fnData, error: fnError } = await supabase.functions.invoke('hyper-endpoint', {
          body: {
            email: form.email.trim().toLowerCase(),
            password: form.password,
            nombre: form.nombre.trim(),
            rol: form.rol,
          }
        });

        if (fnError) {
          setErrors({ email: fnError.message || 'Error al crear usuario' });
          return;
        }

        if (fnData?.error) {
          setErrors({ email: fnData.error });
          return;
        }

        // Create profile in usuarios table with auth_id from Edge Function
        const authId = fnData?.user?.id;
        if (!authId) {
          setErrors({ email: 'No se obtuvo ID del usuario creado' });
          return;
        }

        const insertError = await actions.addUsuario({
          nombre: form.nombre.trim(),
          email: form.email.trim().toLowerCase(),
          rol: form.rol,
          auth_id: authId,
          estatus: "Activo"
        });

        if (insertError) {
          setErrors({ email: `Error al guardar en base de datos: ${insertError.message}` });
          return;
        }

        toast?.success("Usuario creado — ya puede iniciar sesión");
      } else {
        // Edit — only update profile (nombre, rol), not auth
        await actions.updateUsuario(modal.id, { nombre: form.nombre, rol: form.rol });
        toast?.success("Usuario actualizado");
      }
      setModal(null);
    } finally {
      setSaving(false);
    }
  };

  const usuarios = data.usuarios || [];

  return (<div className="space-y-4">
    {ConfirmEl}
    <div className="flex items-center justify-between">
      <div><h2 className="text-lg font-bold text-slate-800">Usuarios del sistema</h2><p className="text-xs text-slate-400">{usuarios.length} usuarios · Cada usuario entra con su correo y contraseña</p></div>
      <button onClick={openNew} className="px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl min-h-[44px]">+ Nuevo usuario</button>
    </div>
    {usuarios.length === 0 && (
      <EmptyState
        message="Aún no hay usuarios"
        hint="Da de alta empleados con el botón + Nuevo usuario"
      />
    )}
    <div className="space-y-2">
      {usuarios.map(u => (
        <div key={u.id} onClick={() => openEdit(u)} className="bg-white rounded-xl p-4 border border-slate-100 flex items-center justify-between cursor-pointer hover:border-blue-300 transition-all">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600 flex-shrink-0">{s(u.nombre)[0] || "?"}</div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{s(u.nombre)}</p>
              <p className="text-xs text-slate-400 truncate">{s(u.email)}</p>
            </div>
          </div>
          <span className={`text-xs font-bold px-3 py-1 rounded-full flex-shrink-0 ${
            s(u.rol) === "Admin" ? "bg-purple-100 text-purple-700" :
            s(u.rol) === "Chofer" ? "bg-blue-100 text-blue-700" :
            s(u.rol) === "Ventas" ? "bg-emerald-100 text-emerald-700" :
            s(u.rol) === "Producción" ? "bg-amber-100 text-amber-700" :
            s(u.rol) === "Almacén Bolsas" ? "bg-orange-100 text-orange-700" :
            s(u.rol) === "Sin asignar" ? "bg-red-100 text-red-600" :
            "bg-slate-100 text-slate-600"
          }`}>{s(u.rol)}</span>
        </div>
      ))}
    </div>
    <Modal open={!!modal} onClose={() => setModal(null)} title={modal === "new" ? "Nuevo Usuario" : "Editar Usuario"}>
      <div className="space-y-3">
        <FormInput label="Nombre completo *" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} error={errors.nombre} />
        {modal === "new" ? (
          <>
            <FormInput label="Correo electrónico *" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} error={errors.email} placeholder="empleado@correo.com" />
            <FormInput label="Contraseña *" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} error={errors.password} placeholder="Mínimo 6 caracteres" />
            <p className="text-[10px] text-slate-400">Esta contraseña la usará el empleado para entrar al sistema</p>
          </>
        ) : (
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-500">{s(form.email)}</p>
            <p className="text-[10px] text-slate-400 mt-1">El correo y contraseña se manejan en Supabase Auth</p>
          </div>
        )}
        <FormSelect label="Rol — define qué módulo ve al entrar" options={["Admin", "Ventas", "Chofer", "Producción", "Almacén Bolsas", "Facturación", "Sin asignar"]} value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })} />
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs text-slate-500 font-semibold mb-1">¿Qué ve cada rol?</p>
          <p className="text-[10px] text-slate-400">Admin → Todo el sistema</p>
          <p className="text-[10px] text-slate-400">Ventas → Captura de pedidos y clientes</p>
          <p className="text-[10px] text-slate-400">Chofer → Carga, entregas y cierre de ruta</p>
          <p className="text-[10px] text-slate-400">Producción → Registro de lotes y congeladores</p>
          <p className="text-[10px] text-slate-400">Almacén Bolsas → Entrada de bolsas</p>
          <p className="text-[10px] text-slate-400">Facturación → Timbrado CFDI</p>
        </div>
      </div>
      <div className="flex justify-between mt-5">
        {modal !== "new" && modal?.id && <button onClick={()=> askConfirm('Eliminar usuario','¿Eliminar ' + s(modal.nombre) + '?', async()=>{await actions.deleteUsuario(modal.id); toast?.success('Usuario eliminado'); setModal(null);}, true)} className="text-xs text-red-500 font-semibold py-2 px-3 hover:bg-red-50 rounded-lg">Eliminar</button>}
        <div className="flex gap-2 ml-auto"><FormBtn onClick={() => setModal(null)}>Cancelar</FormBtn><FormBtn primary onClick={save} loading={saving}>{modal === "new" ? "Crear usuario" : "Guardar"}</FormBtn></div>
      </div>
    </Modal>
  </div>);
}
