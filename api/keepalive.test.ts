import { describe, expect, it, vi } from 'vitest';
import { pingSupabase } from './keepalive.js';

const URL = 'https://example.supabase.co';
const KEY = 'anon-test-key';

const respond = (body: string, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status }));

describe('pingSupabase', () => {
  it('reads one trip id with the anon key and reports ok', async () => {
    const fetchImpl = respond('[{"id":"abc"}]');

    expect(await pingSupabase(URL, KEY, fetchImpl)).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledWith(
      `${URL}/rest/v1/trips?select=id&limit=1`,
      expect.objectContaining({ headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }),
    );
  });

  it('reports ok for an empty table', async () => {
    expect(await pingSupabase(URL, KEY, respond('[]'))).toBe('ok');
  });

  it.each([
    ['a non-200 response', respond('[]', 503)],
    ['a body that is not JSON', respond('<html>')],
    ['a body with the wrong shape', respond('{"message":"nope"}')],
    ['a network error', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))],
  ])('reports fail on %s', async (_name, fetchImpl) => {
    expect(await pingSupabase(URL, KEY, fetchImpl)).toBe('fail');
  });

  it.each([
    [undefined, KEY],
    [URL, undefined],
  ])('reports fail without calling fetch when env is missing', async (url, key) => {
    const fetchImpl = respond('[]');

    expect(await pingSupabase(url, key, fetchImpl)).toBe('fail');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
