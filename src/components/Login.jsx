import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Icons } from './ui/Icons';
import { BtnSpinner } from './ui/Skeleton';

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [verPass, setVerPass] = useState(false);

  const handle = async (event) => {
    event?.preventDefault();
    if (!email || !pass) { setErr("Ingresa correo y contraseña"); return; }
    setLoading(true);
    setErr("");

    try {
      if (!supabase) { setErr("Sin conexión a base de datos"); setLoading(false); return; }

      // Authenticate with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pass });
      
      if (authError || !authData?.user) {
        setErr(authError?.message === "Invalid login credentials" ? "Correo o contraseña incorrectos" : (authError?.message || "Error de autenticación"));
        setLoading(false);
        return;
      }

      // Auth OK — perfil (nombre + rol) por identidad canónica: auth_id =
      // uid de Auth (R5/083). El email ya no selecciona el perfil.
      const { data: perfiles } = await supabase.from('usuarios').select('*').eq('auth_id', authData.user.id);

      if (perfiles && perfiles.length > 0) {
        onLogin({
          ...perfiles[0],
          auth_id: perfiles[0]?.auth_id || authData.user.id,
          authUserId: authData.user.id,
        });
      } else {
        // Sin perfil → cuenta no autorizada. Cerramos la sesión Supabase
        // para que el JWT no quede activo en localStorage.
        await supabase.auth.signOut();
        setErr("Cuenta no autorizada. Contacta al administrador.");
        setLoading(false);
        return;
      }

    } catch (e) {
      console.error("Login error:", e);
      setErr("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-dvh overflow-y-auto bg-gradient-to-b from-[#0b1f3a] via-[#0f172a] to-[#0b1220] px-4 text-white"
      style={{
        paddingTop: 'max(env(safe-area-inset-top, 0px), 1.5rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 1.5rem)',
        paddingLeft: 'max(env(safe-area-inset-left, 0px), 1.25rem)',
        paddingRight: 'max(env(safe-area-inset-right, 0px), 1.25rem)',
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute left-1/2 top-[-18%] h-[26rem] w-[26rem] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      </div>
      <div className="relative mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-sm flex-col justify-center">
        <div className="mb-8 text-center animate-view-in">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[26px] border border-white/10 bg-white/[0.06] shadow-pop">
            <img src="/icon-512.png" alt="CuboPolar" className="block h-12 w-12 object-contain" />
          </div>
          <p className="erp-kicker text-cyan-200/70">CUBOPOLAR</p>
          <h1 className="font-display mt-2 text-[1.9rem] font-bold text-white">Bienvenido</h1>
          <p className="mt-1.5 text-[15px] text-slate-300">Entra con tu cuenta para empezar el día.</p>
        </div>

        <form className="space-y-4 animate-view-in" onSubmit={handle} noValidate>
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-[13px] font-medium text-slate-300">Correo</label>
            <input id="login-email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" type="email" autoComplete="email" inputMode="email" autoCapitalize="none"
              data-testid="login-email"
              className="min-h-[52px] w-full rounded-[16px] border border-white/10 bg-white/[0.07] px-4 py-3 text-[16px] text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/20" />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-[13px] font-medium text-slate-300">Contraseña</label>
            <div className="relative">
              <input id="login-password" value={pass} onChange={e => setPass(e.target.value)} type={verPass ? "text" : "password"} placeholder="••••••••" autoComplete="current-password"
                data-testid="login-password"
                className="min-h-[52px] w-full rounded-[16px] border border-white/10 bg-white/[0.07] px-4 py-3 pr-14 text-[16px] text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/20" />
              <button type="button" onClick={() => setVerPass(v => !v)} aria-label={verPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white">
                <Icons.Eye />
              </button>
            </div>
          </div>
          {err && (
            <p className="flex items-start gap-2 rounded-[14px] border border-red-400/20 bg-red-500/10 px-3.5 py-3 text-[13px] font-medium text-red-200" role="alert" aria-live="polite">
              <span className="mt-0.5 flex-shrink-0"><Icons.AlertTriangle /></span>{err}
            </p>
          )}
          <button type="submit" disabled={loading}
            data-testid="login-submit"
            className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[16px] bg-cyan-300 text-[15px] font-bold text-[#0b1f3a] shadow-[0_14px_32px_-10px_rgba(103,232,249,0.6)] transition-all hover:bg-cyan-200 disabled:opacity-60">
            {loading ? <><BtnSpinner /> Verificando…</> : "Iniciar sesión"}
          </button>
        </form>
        <p className="mt-8 text-center text-[12px] text-slate-500">Sistema operativo de Cubo Polar · Durango</p>
      </div>
    </div>
  );
}
