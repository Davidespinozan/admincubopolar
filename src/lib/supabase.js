import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[CuboPolar] Variables de entorno VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY son requeridas. Revisa tu archivo .env');
}

// Tanda 19: opciones de auth explícitas. Supabase v2 ya tiene
// persistSession y autoRefreshToken en true por default, pero los
// fijamos para no depender del default si la versión cambia. Plus,
// `storage` explícito a localStorage para que funcione en PWA mode
// (algunos contextos en iOS Safari ITP).
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    })
  : null;
