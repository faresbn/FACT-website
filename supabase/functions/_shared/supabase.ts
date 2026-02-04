import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

export function createUserClient(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: { persistSession: false },
  });
}

export function createAdminClient() {
  if (!supabaseServiceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}
