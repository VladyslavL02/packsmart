import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackingItemDraft, TripInput, WeatherSummary } from '../engine/types';
import { fetchAiSuggestions } from './suggestApi';

const trip: TripInput = {
  city: 'Lisbon',
  latitude: 38.72,
  longitude: -9.14,
  startDate: '2026-06-01',
  endDate: '2026-06-07',
  tripType: 'city',
  luggage: [{ type: 'carryOn', count: 1 }],
  members: [{ id: 'a1', name: 'Adult a1', kind: 'adult' }],
};

const weather: WeatherSummary = {
  minTemp: 15,
  maxTemp: 22,
  maxPrecipProbability: 10,
  rainDays: 0,
  isSeasonalEstimate: false,
  source: 'forecast',
};

const draft = (overrides: Partial<PackingItemDraft> = {}): PackingItemDraft => ({
  key: 'rain-jacket',
  title: 'Rain jacket',
  category: 'clothing',
  scope: 'adult',
  memberId: 'a1',
  quantity: 1,
  source: 'rules',
  reason: null,
  ...overrides,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchAiSuggestions', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns valid items and applies the default quantity', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [{ title: 'Travel pillow', category: 'misc', scope: 'shared', reason: null }],
      }),
    );

    const result = await fetchAiSuggestions(trip, weather, [draft()]);

    expect(result).toEqual([
      { title: 'Travel pillow', category: 'misc', scope: 'shared', quantity: 1, reason: null },
    ]);
  });

  it('POSTs trip, weather and deduped existing titles', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    await fetchAiSuggestions(trip, weather, [
      draft(),
      draft({ memberId: 'a2' }),
      draft({ title: 'Socks' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/suggest');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      trip,
      weather,
      existingTitles: ['Rain jacket', 'Socks'],
    });
  });

  it('returns [] for a non-JSON 200 body', async () => {
    fetchMock.mockResolvedValue(new Response('<!doctype html>', { status: 200 }));

    expect(await fetchAiSuggestions(trip, null, [])).toEqual([]);
  });

  it('returns [] on HTTP 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }, 500));

    expect(await fetchAiSuggestions(trip, weather, [])).toEqual([]);
  });

  it('returns [] when an item has an invalid shape', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [{ title: 'Thing', category: 'nope', scope: 'shared', reason: null }],
      }),
    );

    expect(await fetchAiSuggestions(trip, weather, [])).toEqual([]);
  });

  it('returns [] when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await fetchAiSuggestions(trip, weather, [])).toEqual([]);
  });

  it('returns [] without fetching when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    expect(await fetchAiSuggestions(trip, weather, [], controller.signal)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps existing titles at 150 so the server never rejects the request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));
    const many = Array.from({ length: 200 }, (_, i) => draft({ title: `Item ${i}` }));

    await fetchAiSuggestions(trip, weather, many);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { existingTitles: string[] };
    expect(body.existingTitles).toHaveLength(150);
    expect(body.existingTitles[0]).toBe('Item 0');
  });

  // A fetch that never answers, and rejects like the real one when its signal fires.
  function hangingFetch(): void {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
  }

  // Fake timers do not drive AbortSignal.timeout (Node owns that timer), so the timeout signal
  // is swapped for one the test fires itself, while still checking the requested duration.
  it('gives up after the 10 s client timeout and returns []', async () => {
    const timeoutController = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeoutController.signal);
    hangingFetch();

    const pending = fetchAiSuggestions(trip, weather, []);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(init.signal?.aborted).toBe(false);

    timeoutController.abort(new DOMException('timed out', 'TimeoutError'));

    expect(await pending).toEqual([]);
    expect(init.signal?.aborted).toBe(true);
  });

  it('cancels the in-flight request when the caller aborts, and stays quiet', async () => {
    const caller = new AbortController();
    hangingFetch();

    const pending = fetchAiSuggestions(trip, weather, [], caller.signal);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(false);

    caller.abort();

    expect(await pending).toEqual([]);
    expect(init.signal?.aborted).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warns when the client timeout fires, since the caller did not abort', async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    hangingFetch();

    const pending = fetchAiSuggestions(trip, weather, [], new AbortController().signal);
    timeoutController.abort(new DOMException('timed out', 'TimeoutError'));

    expect(await pending).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
