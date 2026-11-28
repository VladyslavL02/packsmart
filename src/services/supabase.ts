import { createClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to .env.local (see README).',
  );
}

// There is no auth, so the client keeps no session in localStorage.
export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: false },
});
