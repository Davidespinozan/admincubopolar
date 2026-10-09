// UsuariosPanel — GER-1 (mig 120/121): usuarios del sistema, sus roles y sus
// accesos adicionales. Lo usan Ajustes (Admin) y el Panel del dueño.
// La pantalla solo ofrece lo que el servidor permite (permisosSobreUsuario
// refleja guardar_usuario): Admin da de alta y cambia operativos; el rol
// Admin, los accesos adicionales y las cuentas de otros Admin son del Dueño.
import { useMemo, useState } from 'react';
import Modal, { FormInput, FormSelect, FormBtn } from './ui/Modal';
import { Card, ListRow, ChoiceButton, SectionLabel, Guia } from './ui/Components';
import { EmptyState } from './ui/Skeleton';
import { Icons } from './ui/Icons';
import { useToast } from './ui/Toast';
import { backendPost } from '../lib/backend';
import { captureError } from '../lib/sentry';
import { s } from '../utils/safe';
import {
  ACCESOS_EXTRA, ROLES_OPERATIVOS, accesosDe, esDueno, debeCambiarPassword, etiquetaRol, permisosSobreUsuario,
  puedeCrearRol, validarPasswordTemporal, correoSugerido, normalizarAccesos,
} from '../data/usuariosLogic';

const QUE_VE = {
  Admin: 'Todo el sistema',
  Ventas: 'Sus ventas y cobros',
  Chofer: 'Carga, entregas y cierre de su ruta',
  'Producción': 'Producción, congeladores y mermas',
  'Almacén Bolsas': 'Entradas y entregas de bolsas',
  'Facturación': 'Back office y timbrado',
  Empleado: 'Solo su asistencia y sus actividades',
  'Sin asignar': 'Back office sin funciones propias',
};
const PASSWORD_INICIAL = '12345678';

// Decisión del dueño (2026-10-09): el cambio obligatorio es opcional y nace apagado.
function CasillaForzar({ checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-field bg-slate-50 px-3 py-3" data-testid="casilla-forzar-cambio">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 rounded border-slate-300" />
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">Obligar a cambiarla al entrar</span>
        <span className="block text-[12px] text-slate-500">
          {checked ? 'No podrá usar ningún módulo hasta elegir una contraseña propia.' : 'Sin marcar, esta contraseña sirve hasta que alguien la cambie: quien la conozca puede entrar a la cuenta.'}
        </span>
      </span>
    </label>
  );
}

export default function UsuariosPanel({ data, actions, user }) {
  const toast = useToast();
  const dueno = esDueno(user);
  const usuarios = useMemo(() => (data?.usuarios || []).filter(u => !u.is_test_account), [data?.usuarios]);
  const [modal, setModal] = useState(null);      // 'nuevo' | usuario
  const [form, setForm] = useState(null);
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [reset, setReset] = useState(null);       // { usuario, password }

  const rolesAlta = useMemo(() => [...(dueno ? ['Admin'] : []), ...ROLES_OPERATIVOS].filter(r => puedeCrearRol(user, r)), [user, dueno]);
  const empleadosSinUsuario = useMemo(
    () => (data?.empleados || []).filter(e => (e.estatus || 'Activo') === 'Activo' && !(e.usuarioId ?? e.usuario_id)),
    [data?.empleados]
  );

  const abrirNuevo = () => {
    setErrores({});
    setForm({ empleadoId: '', nombre: '', rol: rolesAlta.includes('Ventas') ? 'Ventas' : rolesAlta[0], email: '', emailTocado: false, password: PASSWORD_INICIAL, accesos: [], forzar: false });
    setModal('nuevo');
  };
  const abrirEditar = (u) => {
    setErrores({});
    setForm({ nombre: s(u.nombre), rol: s(u.rol), estatus: s(u.estatus) || 'Activo', accesos: accesosDe(u) });
    setModal(u);
  };
  const cerrar = () => { if (!guardando) { setModal(null); setForm(null); } };

  // Alta: nombre y rol sugieren el correo (nombre.apellido.rol@cubopolar.com) hasta que se edite a mano.
  const setAlta = (cambio) => setForm(f => {
    const sig = { ...f, ...cambio };
    if (!sig.emailTocado) sig.email = correoSugerido(sig.nombre, sig.rol);
    if (sig.rol === 'Admin') sig.accesos = [];
    return sig;
  });

  const crear = async () => {
    const e = {};
    if (!form.nombre.trim()) e.nombre = 'Requerido';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Correo inválido';
    const vp = validarPasswordTemporal(form.password);
    if (vp.error) e.password = vp.error;
    if (Object.keys(e).length) { setErrores(e); return; }
    setGuardando(true);
    try {
      let res;
      try {
        res = await backendPost('admin-create-user', { email: form.email.trim().toLowerCase(), password: form.password, nombre: form.nombre.trim(), rol: form.rol, forzarCambio: !!form.forzar });
      } catch (err) {
        captureError(err, { fn: 'admin-create-user', status: err?.status });
        setErrores({ email: err?.message || 'No se pudo crear el usuario' });
        return;
      }
      const nuevo = res?.usuario;
      if (!nuevo?.id) { setErrores({ email: 'No se obtuvo el usuario creado' }); return; }
      const accesos = normalizarAccesos(form.rol, form.accesos);
      if (dueno && accesos.length > 0) {
        await actions.guardarUsuario({ id: nuevo.id, nombre: nuevo.nombre, rol: nuevo.rol, estatus: 'Activo', accesosExtra: accesos }, { incluirAccesos: true });
      }
      if (form.empleadoId) await actions.vincularEmpleadoUsuario?.(form.empleadoId, nuevo.id);
      await actions.recargarDatos?.();
      toast?.success(!form.forzar ? 'Usuario creado. Ya puede entrar con esa contraseña.'
        : res.temporal === false ? 'Usuario creado. No quedó marcada como temporal: restablece su contraseña.'
        : 'Usuario creado. Al entrar deberá elegir su propia contraseña.');
      setModal(null); setForm(null);
    } finally {
      setGuardando(false);
    }
  };

  const guardar = async () => {
    if (!form.nombre.trim()) { setErrores({ nombre: 'Requerido' }); return; }
    const permisos = permisosSobreUsuario(user, modal);
    setGuardando(true);
    try {
      const r = await actions.guardarUsuario(
        { id: modal.id, nombre: form.nombre, rol: permisos.rol ? form.rol : modal.rol, estatus: permisos.estatus ? form.estatus : modal.estatus, accesosExtra: form.accesos },
        { incluirAccesos: permisos.accesos }
      );
      if (r?.error) return;
      toast?.success('Usuario actualizado');
      setModal(null); setForm(null);
    } finally {
      setGuardando(false);
    }
  };

  const restablecer = async () => {
    const vp = validarPasswordTemporal(reset.password);
    if (vp.error) { setReset(r => ({ ...r, error: vp.error })); return; }
    setGuardando(true);
    try {
      const r = await actions.restablecerPassword(reset.usuario.id, reset.password, { forzarCambio: !!reset.forzar });
      if (r?.error) { setReset(x => ({ ...x, error: r.error })); return; }
      toast?.success(reset.forzar ? `Contraseña temporal lista para ${s(reset.usuario.nombre)}. Le pedirá cambiarla al entrar.` : `Contraseña de ${s(reset.usuario.nombre)} actualizada.`);
      setReset(null);
    } finally {
      setGuardando(false);
    }
  };

  const editando = modal && modal !== 'nuevo' ? modal : null;
  const permisos = editando ? permisosSobreUsuario(user, editando) : null;

  return (
    <div className="space-y-3" data-testid="usuarios-panel">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>Usuarios del sistema</SectionLabel>
          <p className="text-[13px] text-slate-500">{usuarios.length} cuentas · cada quien entra con su correo y su contraseña</p>
        </div>
        <FormBtn primary className="flex-shrink-0 whitespace-nowrap" onClick={abrirNuevo}><Icons.Plus /> Nuevo usuario</FormBtn>
      </div>

      {!dueno && (
        <Guia testid="guia-usuarios" titulo="Qué puedes hacer aquí">
          Das de alta y actualizas a los usuarios operativos. Crear un Admin, cambiar a otro Admin y dar accesos adicionales
          (por ejemplo Almacén + Ventas) lo hace el Dueño.
        </Guia>
      )}

      {usuarios.length === 0 ? (
        <Card><EmptyState icon="Users" message="Aún no hay usuarios" hint="Da de alta a tu equipo con “Nuevo usuario”." /></Card>
      ) : (
        <Card padding="p-0" className="overflow-hidden divide-y divide-line">
          {usuarios.map(u => (
            <ListRow key={u.id} onClick={() => abrirEditar(u)} chevron
              avatar={s(u.nombre)[0] || '?'}
              title={s(u.nombre)}
              subtitle={s(u.email)}
              badge={
                <span className="flex flex-wrap justify-end gap-1">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${esDueno(u) ? 'bg-ink text-white' : s(u.rol) === 'Admin' ? 'bg-violet-50 text-violet-800' : 'bg-slate-100 text-slate-700'}`}>{etiquetaRol(u)}</span>
                  {s(u.estatus) !== 'Activo' && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">Inactivo</span>}
                  {debeCambiarPassword(u) && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Contraseña temporal</span>}
                </span>
              } />
          ))}
        </Card>
      )}

      {/* ── Alta ── */}
      <Modal open={modal === 'nuevo'} onClose={cerrar} kicker="Usuarios" title="Nuevo usuario" closeOnEscape={!guardando}
        footer={<>
          <FormBtn size="lg" className="flex-1" onClick={cerrar}>Cancelar</FormBtn>
          <FormBtn primary size="lg" className="flex-[2]" onClick={crear} loading={guardando}>Crear usuario</FormBtn>
        </>}>
        {form && modal === 'nuevo' && (
          <div className="space-y-3">
            {empleadosSinUsuario.length > 0 && (
              <FormSelect label="Empleado (opcional: liga su asistencia)" value={form.empleadoId}
                onChange={e => { const emp = empleadosSinUsuario.find(x => String(x.id) === e.target.value); setAlta({ empleadoId: e.target.value, ...(emp ? { nombre: s(emp.nombre) } : {}) }); }}
                options={[{ value: '', label: 'No está en Empleados' }, ...empleadosSinUsuario.map(e => ({ value: String(e.id), label: `${s(e.nombre)}${e.puesto ? ` — ${s(e.puesto)}` : ''}` }))]} />
            )}
            <FormInput label="Nombre completo *" value={form.nombre} onChange={e => setAlta({ nombre: e.target.value })} error={errores.nombre} />
            <FormSelect label="Rol principal" value={form.rol} onChange={e => setAlta({ rol: e.target.value })} options={rolesAlta} />
            <p className="-mt-1 text-[12px] text-slate-500">{form.rol} → {QUE_VE[form.rol]}</p>
            {dueno && form.rol !== 'Admin' && (
              <div>
                <p className="mb-1.5 block text-[13px] font-medium text-slate-700">Accesos adicionales</p>
                <div className="grid grid-cols-2 gap-2">
                  {ACCESOS_EXTRA.filter(a => a !== form.rol).map(a => (
                    <ChoiceButton key={a} active={form.accesos.includes(a)} onClick={() => setForm(f => ({ ...f, accesos: f.accesos.includes(a) ? f.accesos.filter(x => x !== a) : [...f.accesos, a] }))}>{a}</ChoiceButton>
                  ))}
                </div>
              </div>
            )}
            <FormInput label="Correo para entrar *" type="email" value={form.email} error={errores.email} autoCapitalize="none" autoCorrect="off"
              onChange={e => setForm(f => ({ ...f, email: e.target.value, emailTocado: true }))} hint="Se sugiere con nombre, apellido y rol. Puedes cambiarlo." />
            <FormInput label="Contraseña *" value={form.password} error={errores.password} autoCapitalize="none" autoCorrect="off"
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} hint="La puede cambiar después en “Mi cuenta”." />
            <CasillaForzar checked={form.forzar} onChange={v => setForm(f => ({ ...f, forzar: v }))} />
          </div>
        )}
      </Modal>

      {/* ── Edición ── */}
      <Modal open={!!editando} onClose={cerrar} kicker={editando ? etiquetaRol(editando) : ''} title={editando ? s(editando.nombre) : ''} closeOnEscape={!guardando}
        footer={permisos?.editar ? <>
          <FormBtn size="lg" className="flex-1" onClick={cerrar}>Cancelar</FormBtn>
          <FormBtn primary size="lg" className="flex-[2]" onClick={guardar} loading={guardando}>Guardar</FormBtn>
        </> : <FormBtn size="lg" className="w-full" onClick={cerrar}>Cerrar</FormBtn>}>
        {form && editando && permisos && (
          <div className="space-y-3">
            <p className="text-[13px] text-slate-500">{s(editando.email)}</p>
            {permisos.motivo && (
              <p className="flex items-start gap-2 rounded-field bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600"><span className="mt-0.5 flex-shrink-0"><Icons.Lock /></span>{permisos.motivo}.</p>
            )}
            <FormInput label="Nombre completo" value={form.nombre} disabled={!permisos.editar} error={errores.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
            <FormSelect label="Rol principal" value={form.rol} disabled={!permisos.rol}
              onChange={e => setForm(f => ({ ...f, rol: e.target.value, accesos: normalizarAccesos(e.target.value, f.accesos) }))}
              options={permisos.rol ? permisos.roles : [form.rol]} />
            <p className="-mt-1 text-[12px] text-slate-500">{form.rol} → {QUE_VE[form.rol]}</p>
            {form.rol !== 'Admin' && (
              <div>
                <p className="mb-1.5 block text-[13px] font-medium text-slate-700">Accesos adicionales{!permisos.accesos ? ' (los asigna el Dueño)' : ''}</p>
                <div className="grid grid-cols-2 gap-2">
                  {ACCESOS_EXTRA.filter(a => a !== form.rol).map(a => (
                    <ChoiceButton key={a} disabled={!permisos.accesos} active={form.accesos.includes(a)}
                      onClick={() => setForm(f => ({ ...f, accesos: f.accesos.includes(a) ? f.accesos.filter(x => x !== a) : [...f.accesos, a] }))}>{a}</ChoiceButton>
                  ))}
                </div>
              </div>
            )}
            {permisos.estatus && (
              <div>
                <p className="mb-1.5 block text-[13px] font-medium text-slate-700">Estatus</p>
                <div className="grid grid-cols-2 gap-2">
                  <ChoiceButton tone="emerald" active={form.estatus === 'Activo'} onClick={() => setForm(f => ({ ...f, estatus: 'Activo' }))}>Activo</ChoiceButton>
                  <ChoiceButton tone="red" active={form.estatus === 'Inactivo'} onClick={() => setForm(f => ({ ...f, estatus: 'Inactivo' }))}>Inactivo</ChoiceButton>
                </div>
                <p className="mt-1 text-[12px] text-slate-500">Inactivo: ya no puede entrar. Su historia se conserva (no se borran usuarios).</p>
              </div>
            )}
            {permisos.password && (editando.auth_id || editando.authId) && (
              <button type="button" onClick={() => setReset({ usuario: editando, password: PASSWORD_INICIAL, forzar: false })}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-field border border-line bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50" data-testid="usuario-restablecer">
                <Icons.Lock /> Restablecer contraseña
              </button>
            )}
          </div>
        )}
      </Modal>

      {/* ── Restablecer contraseña ── */}
      <Modal open={!!reset} onClose={() => !guardando && setReset(null)} kicker="Restablecer contraseña" title={reset ? s(reset.usuario.nombre) : ''} closeOnEscape={!guardando}
        footer={<>
          <FormBtn size="lg" className="flex-1" onClick={() => setReset(null)} disabled={guardando}>Cancelar</FormBtn>
          <FormBtn primary size="lg" className="flex-[2]" onClick={restablecer} loading={guardando}>Restablecer</FormBtn>
        </>}>
        {reset && (
          <div className="space-y-3">
            <p className="text-[14px] text-slate-600">Su contraseña actual deja de servir y entrará con esta.</p>
            <FormInput label="Contraseña nueva" value={reset.password} error={reset.error} autoCapitalize="none" autoCorrect="off"
              onChange={e => setReset(r => ({ ...r, password: e.target.value, error: null }))} />
            <CasillaForzar checked={!!reset.forzar} onChange={v => setReset(r => ({ ...r, forzar: v }))} />
          </div>
        )}
      </Modal>
    </div>
  );
}
