import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { SuggestRequestSchema } from '../engine/types';
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

const UNAVAILABLE = { items: [], status: 'unavailable' };

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
        status: 'ok',
      }),
    );

    const result = await fetchAiSuggestions(trip, weather, [draft()]);

    expect(result).toEqual({
      items: [
        { title: 'Travel pillow', category: 'misc', scope: 'shared', quantity: 1, reason: null },
      ],
      status: 'ok',
    });
  });

  it.each(['empty', 'unavailable'] as const)('passes through the server status %s', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], status }));

    expect(await fetchAiSuggestions(trip, weather, [])).toEqual({ items: [], status });
  });

  it('POSTs trip, weather and deduped existing items, with no existingTitles', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], status: 'ok' }));

    await fetchAiSuggestions(trip, weather, [
      draft({ reason: 'Rainy days' }),
      draft({ memberId: 'a2', reason: 'other', category: 'misc' }),
      draft({ title: 'Socks' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/suggest');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      trip,
      weather,
      existingItems: [
        { title: 'Rain jacket', category: 'clothing', reason: 'Rainy days' },
        { title: 'Socks', category: 'clothing', reason: null },
      ],
    });
    expect(body).not.toHaveProperty('existingTitles');
  });

  it('collapses rows whose titles match after normalizing case and spacing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], status: 'ok' }));

    await fetchAiSuggestions(trip, weather, [
      draft({ title: 'Rain jacket', reason: 'first' }),
      draft({ title: '  RAIN   jacket ', memberId: 'a2', reason: 'second' }),
    ]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { existingItems: { reason: string | null }[] };
    expect(body.existingItems).toHaveLength(1);
    expect(body.existingItems[0].reason).toBe('first');
  });

  it('is unavailable for a non-JSON 200 body', async () => {
    fetchMock.mockResolvedValue(new Response('<!doctype html>', { status: 200 }));

    expect(await fetchAiSuggestions(trip, null, [])).toEqual(UNAVAILABLE);
  });

  it('is unavailable on HTTP 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], status: 'ok' }, 500));

    expect(await fetchAiSuggestions(trip, weather, [])).toEqual(UNAVAILABLE);
  });

  it('is unavailable when an item has an invalid shape', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [{ title: 'Thing', category: 'nope', scope: 'shared', reason: null }],
        status: 'ok',
      }),
    );

    expect(await fetchAiSuggestions(trip, weather, [])).toEqual(UNAVAILABLE);
  });

  it('is unavailable when the server body has no status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    expect(await fetchAiSuggestions(trip, weather, [])).toEqual(UNAVAILABLE);
  });

  it('is unavailable when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await fetchAiSuggestions(trip, weather, [])).toEqual(UNAVAILABLE);
  });

  it('is unavailable without fetching when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    expect(await fetchAiSuggestions(trip, weather, [], controller.signal)).toEqual(UNAVAILABLE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps existing items at 150 so the server never rejects the request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], status: 'ok' }));
    const many = Array.from({ length: 200 }, (_, i) => draft({ title: `Item ${i}` }));

    await fetchAiSuggestions(trip, weather, many);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { existingItems: { title: string }[] };
    expect(body.existingItems).toHaveLength(150);
    expect(body.existingItems[0].title).toBe('Item 0');
  });

  // Retry sends the current rows, including user-typed ones with no length limit.
  it('cuts long titles and reasons to the contract so the server never rejects them', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], status: 'ok' }));

    await fetchAiSuggestions(trip, weather, [
      draft({ key: null, source: 'user', title: `  ${'t'.repeat(200)}`, reason: 'r'.repeat(300) }),
      draft({ key: null, source: 'user', title: '   ' }),
    ]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = SuggestRequestSchema.safeParse(JSON.parse(init.body as string));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.existingItems).toEqual([
      { title: 't'.repeat(60), category: 'clothing', reason: 'r'.repeat(140) },
    ]);
  });

  // iOS Safari before 17.4.
  it('still sends the request when AbortSignal.any is missing', async () => {
    const original = AbortSignal.any;
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true });
    onTestFinished(() => {
      Object.defineProperty(AbortSignal, 'any', { value: original, configurable: true, writable: true });
    });
    fetchMock.mockResolvedValue(jsonResponse({ items: [], status: 'ok' }));

    const result = await fetchAiSuggestions(trip, weather, [], new AbortController().signal);

    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
  it('gives up after the 10 s client timeout and is unavailable', async () => {
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

    expect(await pending).toEqual(UNAVAILABLE);
    expect(init.signal?.aborted).toBe(true);
  });

  it('cancels the in-flight request when the caller aborts, and stays quiet', async () => {
    const caller = new AbortController();
    hangingFetch();

    const pending = fetchAiSuggestions(trip, weather, [], caller.signal);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(false);

    caller.abort();

    expect(await pending).toEqual(UNAVAILABLE);
    expect(init.signal?.aborted).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warns when the client timeout fires, since the caller did not abort', async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    hangingFetch();

    const pending = fetchAiSuggestions(trip, weather, [], new AbortController().signal);
    timeoutController.abort(new DOMException('timed out', 'TimeoutError'));

    expect(await pending).toEqual(UNAVAILABLE);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
