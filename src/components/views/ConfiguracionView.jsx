import { useState, Modal, FormInput, FormSelect, FormBtn, useConfirm, EmptyState, s, useToast, supabase } from './viewsCommon';

export function ConfiguracionView({ data, actions, user }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [modal, setModal] = useState(null);
  const empty = { nombre: "", email: "", rol: "Ventas", password: "" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isAdmin = s(user?.rol) === 'Admin';
  const [resetModal, setResetModal] = useState(false);
  const [resetConfirmacion, setResetConfirmacion] = useState('');
  const [resetMotivo, setResetMotivo] = useState('');
  const [reseting, setReseting] = useState(false);

  const cerrarReset = () => {
    setResetModal(false);
    setResetConfirmacion('');
    setResetMotivo('');
  };

  const ejecutarReset = async () => {
    if (reseting) return;
    if (resetConfirmacion !== 'RESETEAR') return;
    setReseting(true);
    try {
      const result = await actions.resetSistema?.({
        confirmacion: resetConfirmacion,
        motivo: resetMotivo,
      });
      if (result?.error) {
        toast?.error(result.partial ? `Reset parcial: ${result.error}` : result.error);
        return;
      }
      toast?.success('Sistema reseteado correctamente');
      cerrarReset();
    } catch (ex) {
      toast?.error('Error: ' + (ex?.message || 'No se pudo resetear'));
    } finally {
      setReseting(false);
    }
  };

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
    {isAdmin && (
      <div className="mt-12 border-2 border-red-300 rounded-2xl p-5 bg-red-50">
        <h3 className="text-lg font-bold text-red-900 mb-2">⚠️ Zona de peligro</h3>
        <p className="text-sm text-red-800 mb-4">
          Esta sección contiene acciones destructivas e irreversibles. Úsala solo durante pruebas o cuando estés seguro de lo que haces.
        </p>
        <div className="bg-white rounded-xl p-4 border border-red-200">
          <h4 className="font-bold text-slate-900 mb-1">Reset masivo del sistema</h4>
          <p className="text-xs text-slate-600 mb-3">
            Borra TODAS las ventas, pagos, mermas, producciones, rutas y movimientos de inventario. Resetea el stock de productos y cuartos fríos a 0. NO borra catálogos (productos, clientes, empleados) ni configuración.
          </p>
          <button
            onClick={() => setResetModal(true)}
            className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 min-h-[44px]"
          >
            Resetear sistema
          </button>
        </div>
      </div>
    )}

    <Modal open={resetModal} onClose={cerrarReset} title="⚠️ Confirmar reset del sistema">
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-bold text-red-900 mb-2">Esta acción borrará:</p>
          <ul className="text-xs text-red-800 space-y-1 list-disc list-inside">
            <li>Todas las órdenes de venta y sus líneas</li>
            <li>Todos los pagos y cuentas por cobrar</li>
            <li>Todos los movimientos contables, cuentas por pagar y pagos a proveedores</li>
            <li>Todas las mermas, producciones y transformaciones</li>
            <li>Todos los movimientos de inventario y tracking GPS</li>
            <li>Todas las rutas (incluso completadas)</li>
            <li>Nóminas (períodos y recibos), histórico de costos, notificaciones, log de errores</li>
            <li>Stock de productos y cuartos fríos (vuelven a 0)</li>
            <li>Auditoría previa (queda solo el registro de este reset)</li>
          </ul>
          <p className="text-sm font-bold text-red-900 mt-3">
            NO se borrarán: catálogos de productos, clientes, empleados, cuartos fríos (estructura), camiones, leads, comodatos, ni configuración.
          </p>
        </div>

        <FormInput
          label="Motivo (opcional)"
          value={resetMotivo}
          onChange={(e) => setResetMotivo(e.target.value)}
          placeholder="Ej: Limpieza pre-producción"
        />

        <FormInput
          label='Para confirmar, escribe "RESETEAR" (en mayúsculas)'
          value={resetConfirmacion}
          onChange={(e) => setResetConfirmacion(e.target.value)}
          placeholder="RESETEAR"
        />

        <div className="flex justify-end gap-2 mt-4">
          <FormBtn onClick={cerrarReset}>Cancelar</FormBtn>
          <button
            onClick={ejecutarReset}
            disabled={reseting || resetConfirmacion !== 'RESETEAR'}
            className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
          >
            {reseting ? 'Reseteando…' : 'Resetear ahora'}
          </button>
        </div>
      </div>
    </Modal>

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
