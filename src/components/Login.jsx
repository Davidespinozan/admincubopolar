import { useState } from 'react';
import { supabase } from '../lib/supabase';

const SnowIcon = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" opacity=".5"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07" opacity=".5"/></svg>;

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
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
        onLogin(perfiles[0]);
      } else {
        // First login or no profile yet — check if first user ever
        const { data: allUsers } = await supabase.from('usuarios').select('id').limit(1);
        const isFirst = !allUsers || allUsers.length === 0;
        
        // Auto-create profile
        const profile = {
          nombre: email.split('@')[0],
          email: email.trim().toLowerCase(),
          rol: isFirst ? 'Admin' : 'Sin asignar',
          estatus: 'Activo',
        };
        
        const { data: created, error: createErr } = await supabase.from('usuarios').insert(profile).select().single();
        
        if (created) {
          onLogin(created);
        } else {
          // Table might not exist — still let them in
          console.warn("Could not create profile:", createErr?.message);
          onLogin({ id: authData.user.id, ...profile });
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4 py-8 overflow-y-auto">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-6 sm:mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/30">
            <SnowIcon />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">CUBOPOLAR</h1>
          <p className="text-sm text-blue-300/60 mt-1">Sistema ERP</p>
        </div>
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-blue-200/60 uppercase tracking-wider mb-1.5">Correo</label>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" type="email" autoComplete="email"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-blue-200/60 uppercase tracking-wider mb-1.5">Contraseña</label>
              <input value={pass} onChange={e => setPass(e.target.value)} type="password" placeholder="••••••" autoComplete="current-password"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
                onKeyDown={e => e.key === "Enter" && handle()} />
            </div>
            {err && <p className="text-xs text-red-400 font-medium">{err}</p>}
            <button onClick={handle} disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-600/30 text-sm disabled:opacity-50">
              {loading ? "Verificando..." : "Iniciar sesión"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
