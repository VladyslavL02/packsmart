import { handleSchedule } from '@vercel/schedules';
import { z } from 'zod';

const TIMEOUT_MS = 10_000;

const RowsSchema = z.array(z.object({ id: z.string() }));

/** One cheap read so the free-tier Supabase project isn't paused for inactivity. Never throws. */
export async function pingSupabase(
  url: string | undefined,
  anonKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<'ok' | 'fail'> {
  if (!url || !anonKey) {return 'fail';}
  try {
    const response = await fetchImpl(`${url}/rest/v1/trips?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {return 'fail';}

    return RowsSchema.safeParse(await response.json()).success ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}

export const POST = handleSchedule(async (metadata) => {
  const startedAt = Date.now();
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey } = process.env;
  const outcome = await pingSupabase(url, anonKey);
  console.log(`[keepalive] ${outcome} ms=${Date.now() - startedAt} run=${metadata.executionId}`);
});
