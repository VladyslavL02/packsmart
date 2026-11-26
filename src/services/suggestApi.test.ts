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
});
