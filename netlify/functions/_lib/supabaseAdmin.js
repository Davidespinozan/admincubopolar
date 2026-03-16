import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';

let adminClient;

const getSupabaseAdmin = () => {
  if (!adminClient) {
    adminClient = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );
  }

  return adminClient;
};

export { getSupabaseAdmin };