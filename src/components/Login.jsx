import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

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

      // Auth OK — get user profile (nombre + rol) from usuarios table
      const { data: perfiles } = await supabase.from('usuarios').select('*').eq('email', email.trim().toLowerCase());
      
      if (perfiles && perfiles.length > 0) {
        // Has profile with rol assigned
        onLogin({
          ...perfiles[0],
          auth_id: perfiles[0]?.auth_id || authData.user.id,
          authUserId: authData.user.id,
        });
      } else {
        // Auto-create profile
        const profile = {
          nombre: email.split('@')[0],
          email: email.trim().toLowerCase(),
          auth_id: authData.user.id,
          rol: 'Sin asignar',
          estatus: 'Activo',
        };
        
        const { data: created, error: createErr } = await supabase.from('usuarios').insert(profile).select().single();
        
        if (created) {
          onLogin({
            ...created,
            auth_id: created?.auth_id || authData.user.id,
            authUserId: authData.user.id,
          });
        } else {
          // Table might not exist — still let them in
          console.warn("Could not create profile:", createErr?.message);
          onLogin({ id: authData.user.id, ...profile, auth_id: authData.user.id, authUserId: authData.user.id });
        }
      }

    } catch (e) {
      console.error("Login error:", e);
      setErr("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen overflow-y-auto bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-4 py-6 text-white sm:px-6 sm:py-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-10%] top-[-8%] h-[24rem] w-[24rem] rounded-full bg-cyan-300/14 blur-3xl" />
        <div className="absolute bottom-[-6%] right-[-8%] h-[22rem] w-[22rem] rounded-full bg-amber-200/12 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>
      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md items-center justify-center md:max-w-lg">
        <div className="relative w-full">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/12 bg-white/8 shadow-[0_18px_36px_rgba(3,14,19,0.36)]">
              <img src="/icon-512.png" alt="CuboPolar" className="block h-11 w-11 object-contain" />
            </div>
            <p className="erp-kicker text-cyan-200/70">CuboPolar ERP</p>
            <h1 className="font-display mt-3 text-3xl font-bold tracking-[-0.04em] text-white">Acceso al sistema</h1>
            <p className="mt-2 text-sm text-slate-300">Ingresa con tu cuenta para continuar.</p>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-white/[0.08] p-6 shadow-[0_26px_60px_rgba(2,10,15,0.42)] backdrop-blur-2xl sm:p-7">
            <form className="space-y-4" onSubmit={handle}>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100/60 sm:tracking-[0.18em]">Correo</label>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" type="email" autoComplete="email"
                  className="w-full rounded-[18px] border border-white/10 bg-slate-800 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-cyan-300/60 focus:outline-none focus:ring-2 focus:ring-cyan-200/10" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100/60 sm:tracking-[0.18em]">Contrasena</label>
                <input value={pass} onChange={e => setPass(e.target.value)} type="password" placeholder="••••••" autoComplete="current-password"
                  className="w-full rounded-[18px] border border-white/10 bg-slate-800 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-cyan-300/60 focus:outline-none focus:ring-2 focus:ring-cyan-200/10" />
              </div>
              {err && <p className="rounded-2xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs font-medium text-red-200" role="alert" aria-live="polite">{err}</p>}
              <button type="submit" disabled={loading}
                className="w-full rounded-[18px] bg-gradient-to-r from-[#0c708d] to-[#0f8fb2] py-3 text-sm font-bold text-white shadow-[0_20px_32px_rgba(12,112,141,0.28)] transition-all hover:translate-y-[-1px] hover:from-[#0f7d9d] hover:to-[#11a0c9] disabled:opacity-50">
                {loading ? "Verificando..." : "Iniciar sesion"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
