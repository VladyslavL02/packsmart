import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuggestRequest } from '../src/engine/types.js';
import { POST } from './suggest.js';

const URL = 'http://localhost/api/suggest';

const validBody: SuggestRequest = {
  trip: {
    city: 'London',
    country: 'United Kingdom',
    latitude: 51.5,
    longitude: -0.12,
    startDate: '2026-12-01',
    endDate: '2026-12-03',
    tripType: 'city',
    luggage: [{ type: 'checked', count: 2 }],
    members: [
      { id: 'm1', name: 'Alice', kind: 'adult' },
      { id: 'm2', name: 'Bob', kind: 'adult' },
      { id: 'm3', name: 'Cleo', kind: 'child' },
    ],
    notes: 'client dinner on Friday',
  },
  weather: {
    minTemp: 2,
    maxTemp: 9,
    maxPrecipProbability: 70,
    rainDays: 2,
    isSeasonalEstimate: false,
    source: 'forecast',
  },
  existingTitles: ['Passport', 'Toothbrush'],
};

const item = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  category: 'misc',
  scope: 'shared',
  quantity: 1,
  reason: 'because',
  ...extra,
});

const envelope = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const envelopeOf = (items: unknown) => envelope(JSON.stringify(items));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makeRequest = (body: string, signal?: AbortSignal) =>
  new Request(URL, { method: 'POST', body, signal });

describe('POST /api/suggest', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns 200 with the items and no-store when Gemini returns valid items', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(envelopeOf([item('Umbrella'), item('Adapter')])));
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest(JSON.stringify(validBody)));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const json = (await res.json()) as { items: { title: string }[] };
    expect(json.items).toHaveLength(2);
    expect(json.items.map((i) => i.title)).toEqual(['Umbrella', 'Adapter']);
  });

  it('returns 400 with empty items and no fetch for a schema-invalid body', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalid: Partial<typeof validBody> = { ...validBody };
    delete invalid.existingTitles;

    const res = await POST(makeRequest(JSON.stringify(invalid)));

    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 with empty items for a non-JSON body', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest('not json'));

    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 200 with empty items when Gemini responds with HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)));

    const res = await POST(makeRequest(JSON.stringify(validBody)));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ items: [] });
  });

  it('returns 200 with empty items and no fetch when the API key is missing', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeRequest(JSON.stringify(validBody)));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 200 with empty items and no fetch when the request signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    const res = await POST(makeRequest(JSON.stringify(validBody), controller.signal));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
