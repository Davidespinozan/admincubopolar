// CambiarPassword — GER-1 (mig 120): la contraseña propia.
//   · <FormCambiarPassword>: el formulario (actual, nueva, confirmar).
//   · <PantallaCambioObligatorio>: pantalla completa al entrar con una
//     contraseña temporal; la cuenta no tiene autoridad en el servidor hasta
//     cambiarla (erp_actor la excluye), así que no hay nada más que mostrar.
//   · <MiCuentaView>: "Mi cuenta" del menú, para cualquier rol.
import { useState } from 'react';
import { FormInput, FormBtn } from './ui/Modal';
import { Card, SectionLabel } from './ui/Components';
import { Icons } from './ui/Icons';
import { validarCambioPassword, etiquetaRol, PASSWORD_MIN } from '../data/usuariosLogic';

export function FormCambiarPassword({ actions, onListo, oscuro = false, textoBoton = 'Cambiar contraseña' }) {
  const [f, setF] = useState({ actual: '', nueva: '', confirmar: '' });
  const [ver, setVer] = useState(false);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);

  const enviar = async (e) => {
    e?.preventDefault();
    if (enviando) return;
    const v = validarCambioPassword(f);
    if (v.error) { setError(v.error); return; }
    setEnviando(true); setError(null);
    try {
      const r = await actions.cambiarMiPassword({ actual: f.actual, nueva: f.nueva });
      if (r?.error) { setError(r.error); return; }
      setHecho(true);
      setF({ actual: '', nueva: '', confirmar: '' });
      onListo?.();
    } finally {
      setEnviando(false);
    }
  };

  const campo = oscuro
    ? '!border-white/10 !bg-white/5 !text-white placeholder:!text-slate-500 focus:!border-cyan-300/60 focus:!bg-white/10'
    : '';
  const tipo = ver ? 'text' : 'password';
  return (
    <form onSubmit={enviar} className={`space-y-3 ${oscuro ? '[&_label]:!text-slate-200' : ''}`} data-testid="form-cambiar-password">
      <FormInput label="Contraseña actual" type={tipo} autoComplete="current-password" value={f.actual} inputClassName={campo}
        onChange={e => setF(x => ({ ...x, actual: e.target.value }))} />
      <FormInput label="Nueva contraseña" type={tipo} autoComplete="new-password" value={f.nueva} inputClassName={campo}
        onChange={e => setF(x => ({ ...x, nueva: e.target.value }))} hint={oscuro ? undefined : `Mínimo ${PASSWORD_MIN} caracteres.`} />
      <FormInput label="Repite la nueva contraseña" type={tipo} autoComplete="new-password" value={f.confirmar} inputClassName={campo}
        onChange={e => setF(x => ({ ...x, confirmar: e.target.value }))} />
      <label className={`flex min-h-[40px] items-center gap-2 text-[13px] ${oscuro ? 'text-slate-300' : 'text-slate-600'}`}>
        <input type="checkbox" checked={ver} onChange={e => setVer(e.target.checked)} className="h-4 w-4 rounded border-slate-300" /> Mostrar contraseñas
      </label>
      {error && <p className={`rounded-field px-3 py-2.5 text-[13px] font-medium ${oscuro ? 'bg-red-500/15 text-red-200' : 'bg-red-50 text-red-700'}`} role="alert">{error}</p>}
      {hecho && !error && <p className="flex items-center gap-2 rounded-field bg-emerald-50 px-3 py-2.5 text-[13px] font-medium text-emerald-800" role="status"><Icons.CheckCircle /> Contraseña actualizada.</p>}
      <FormBtn type="submit" primary={!oscuro} size="lg" loading={enviando}
        className={`w-full ${oscuro ? '!bg-cyan-300 !text-slate-950 hover:!bg-cyan-200' : ''}`}>{textoBoton}</FormBtn>
    </form>
  );
}

export function PantallaCambioObligatorio({ user, actions, onListo, onLogout }) {
  return (
    <div className="relative min-h-dvh overflow-y-auto bg-gradient-to-b from-[#0b1f3a] via-[#0f172a] to-[#0b1220] px-5 text-white"
      style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 1.5rem)', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 1.5rem)' }}
      data-testid="cambio-obligatorio">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-sm flex-col justify-center py-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-white/10 bg-white/10 text-cyan-200"><Icons.Lock /></div>
        <p className="erp-kicker mt-5 text-center text-cyan-200/80">Primer ingreso</p>
        <h1 className="font-display mt-1 text-center text-[1.6rem] font-bold leading-tight">Elige tu contraseña</h1>
        <p className="mt-2 text-center text-[15px] text-slate-300">
          {user?.nombre ? `${String(user.nombre).split(' ')[0]}, entraste` : 'Entraste'} con una contraseña temporal. Antes de continuar, cámbiala por una que solo tú conozcas.
        </p>
        <div className="mt-6">
          <FormCambiarPassword actions={actions} onListo={onListo} oscuro textoBoton="Guardar y entrar" />
        </div>
        <button type="button" onClick={onLogout} className="mx-auto mt-5 min-h-[44px] px-4 text-[13px] font-semibold text-slate-400 hover:text-white">Cerrar sesión</button>
      </div>
    </div>
  );
}

export function MiCuentaView({ user, actions, onVolver }) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-3" data-testid="mi-cuenta">
      {onVolver && (
        <button type="button" onClick={onVolver} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-field border border-line bg-white px-4 text-sm font-semibold text-slate-700">
          <Icons.ChevronLeft /> Volver a mi ruta
        </button>
      )}
      <Card>
        <SectionLabel>Mi cuenta</SectionLabel>
        <p className="mt-1 font-display text-lg font-bold text-ink">{user?.nombre || '—'}</p>
        <p className="text-[13px] text-slate-500">{user?.email || ''}</p>
        <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{etiquetaRol(user)}</span>
      </Card>
      <Card>
        <SectionLabel className="mb-3">Cambiar contraseña</SectionLabel>
        <FormCambiarPassword actions={actions} />
      </Card>
    </div>
  );
}
