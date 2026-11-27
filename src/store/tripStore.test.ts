import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { generateBasePackingList } from '../engine/generator';
import type { AiSuggestion, SuggestResponse, TripInput, WeatherSummary } from '../engine/types';
import { fetchAiSuggestions } from '../services/suggestApi';
import { createTripStore } from './tripStore';

vi.mock('../services/suggestApi', () => ({ fetchAiSuggestions: vi.fn() }));

const NOW = '2026-05-20T10:00:00.000Z';

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

const familyTrip: TripInput = {
  ...trip,
  members: [
    { id: 'a1', name: 'Adult a1', kind: 'adult' },
    { id: 'a2', name: 'Adult a2', kind: 'adult' },
    { id: 'c1', name: 'Child c1', kind: 'child' },
  ],
};

const weather: WeatherSummary = {
  minTemp: 15,
  maxTemp: 22,
  maxPrecipProbability: 10,
  rainDays: 0,
  isSeasonalEstimate: false,
  source: 'forecast',
};

const suggestion = (overrides: Partial<AiSuggestion> = {}): AiSuggestion => ({
  title: 'Phrasebook',
  category: 'misc',
  scope: 'shared',
  quantity: 1,
  reason: 'Handy in Lisbon',
  ...overrides,
});

type SavedState = {
  trips: Record<string, object>;
  items: Record<string, object[]>;
};

function memoryStorage() {
  const map = new Map<string, string>();
  const storage: StateStorage = {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value);
    },
    removeItem: (name) => {
      map.delete(name);
    },
  };

  return { map, storage };
}

function setup(input: TripInput = familyTrip) {
  const mem = memoryStorage();
  const store = createTripStore(() => mem.storage);
  const tripId = store.getState().createTrip(input, weather);
  const rows = () => store.getState().items[tripId];

  return { mem, store, tripId, rows };
}

function deferredResponse() {
  let resolve!: (value: SuggestResponse) => void;
  const promise = new Promise<SuggestResponse>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

const fetchMock = vi.mocked(fetchAiSuggestions);

describe('tripStore', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a trip with unpacked rules rows and no AI request', () => {
    const { store, tripId, rows } = setup();

    expect(tripId).toEqual(expect.any(String));
    expect(rows()).toHaveLength(generateBasePackingList(familyTrip, weather).length);
    expect(rows().length).toBeGreaterThan(0);
    expect(new Set(rows().map((row) => row.id)).size).toBe(rows().length);
    for (const row of rows()) {
      expect(row).toMatchObject({ tripId, isPacked: false, source: 'rules' });
    }
    expect(store.getState().trips[tripId]).toMatchObject({
      id: tripId,
      city: 'Lisbon',
      createdAt: NOW,
      lastOpenedAt: NOW,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [0, 1],
    [-3, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [4, 4],
    [99, 99],
    [100, 99],
    [1e20, 99],
  ])('stores quantity %s as %s and keeps the source', (input, expected) => {
    const { store, tripId, rows } = setup();
    const { id } = rows()[0];
    store.getState().setQuantity(tripId, id, 7);

    store.getState().setQuantity(tripId, id, input);

    expect(rows()[0]).toMatchObject({ id, quantity: expected, source: 'rules' });
  });

  it('rejects a trip with no members and saves nothing', () => {
    const { mem, store } = setup();
    const saved = mem.map.get('packsmart');

    expect(() => store.getState().createTrip({ ...trip, members: [] }, weather)).toThrow();

    expect(Object.keys(store.getState().trips)).toHaveLength(1);
    expect(mem.map.get('packsmart')).toBe(saved);
  });

  it('sets and overwrites the current member for one trip only', () => {
    const { store, tripId } = setup();
    const otherId = store.getState().createTrip(familyTrip, weather);
    store.getState().setCurrentMember(otherId, 'a2');

    store.getState().setCurrentMember(tripId, 'a1');
    store.getState().setCurrentMember(tripId, 'c1');

    expect(store.getState().currentMember).toEqual({ [tripId]: 'c1', [otherId]: 'a2' });
  });

  it('updates lastOpenedAt on touch and ignores an unknown trip', () => {
    const { store, tripId } = setup();
    const before = store.getState().trips[tripId];
    const later = '2026-05-21T08:00:00.000Z';
    vi.setSystemTime(new Date(later));

    store.getState().touchTrip(tripId);
    store.getState().touchTrip('no-trip');

    expect(store.getState().trips).toEqual({ [tripId]: { ...before, lastOpenedAt: later } });
  });

  it('deletes exactly one row and leaves the others unchanged', () => {
    const { store, tripId, rows } = setup();
    const before = rows();

    store.getState().deleteItem(tripId, before[1].id);

    expect(rows()).toEqual(before.filter((_, index) => index !== 1));
  });

  it('toggles one row to packed and back', () => {
    const { store, tripId, rows } = setup();
    const before = rows();

    store.getState().togglePacked(tripId, before[0].id);
    expect(rows()).toEqual([{ ...before[0], isPacked: true }, ...before.slice(1)]);

    store.getState().togglePacked(tripId, before[0].id);
    expect(rows()).toEqual(before);
  });

  it.each([
    ['a1', 'adult'],
    ['c1', 'child'],
    [null, 'shared'],
  ])('adds a user row for member %s with scope %s', (memberId, scope) => {
    const { store, tripId, rows } = setup();
    const count = rows().length;

    const added = store.getState().addUserItem(tripId, 'Lucky charm', memberId);

    expect(added).toBe(true);
    expect(rows()).toHaveLength(count + 1);
    expect(rows()[count]).toMatchObject({
      id: expect.any(String),
      tripId,
      title: 'Lucky charm',
      source: 'user',
      category: 'misc',
      key: null,
      scope,
      memberId,
      isPacked: false,
    });
  });

  it('rejects a user item the same member already has, ignoring case and spacing', () => {
    const { store, tripId, rows } = setup();
    store.getState().addUserItem(tripId, 'Lucky charm', 'a1');
    const before = rows();

    const added = store.getState().addUserItem(tripId, '  LUCKY   Charm ', 'a1');

    expect(added).toBe(false);
    expect(rows()).toEqual(before);
  });

  it('accepts the same user title for another member and as shared', () => {
    const { store, tripId, rows } = setup();
    store.getState().addUserItem(tripId, 'Lucky charm', 'a1');
    const count = rows().length;

    expect(store.getState().addUserItem(tripId, 'Lucky charm', 'a2')).toBe(true);
    expect(store.getState().addUserItem(tripId, 'Lucky charm', null)).toBe(true);
    expect(rows()).toHaveLength(count + 2);
  });

  it('returns false for an empty title, unknown member or unknown trip', () => {
    const { store, tripId } = setup();
    const before = store.getState().items;

    expect(store.getState().addUserItem(tripId, '   ', 'a1')).toBe(false);
    expect(store.getState().addUserItem(tripId, 'Lucky charm', 'nobody')).toBe(false);
    expect(store.getState().addUserItem('no-trip', 'Lucky charm', null)).toBe(false);
    expect(store.getState().items).toEqual(before);
  });

  it('marks only the rows of the given category as packed', () => {
    const { store, tripId, rows } = setup();

    store.getState().markCategoryPacked(tripId, 'clothing');

    expect(rows().some((row) => row.category === 'clothing')).toBe(true);
    expect(rows().some((row) => row.category !== 'clothing')).toBe(true);
    for (const row of rows()) {
      expect(row.isPacked).toBe(row.category === 'clothing');
    }
  });

  it('marks only the listed rows of the category when itemIds is given', () => {
    const { store, tripId, rows } = setup();
    const clothing = rows().filter((row) => row.category === 'clothing');
    const other = rows().find((row) => row.category !== 'clothing');
    expect(clothing.length).toBeGreaterThan(1);

    store.getState().markCategoryPacked(tripId, 'clothing', [clothing[0].id, other?.id ?? '']);

    expect(rows().filter((row) => row.isPacked).map((row) => row.id)).toEqual([clothing[0].id]);
  });

  it('appends only the new AI rows and reports ok', async () => {
    const { store, tripId, rows } = setup();
    const before = rows();
    const existing = before.find((row) => row.memberId === null) ?? before[0];
    fetchMock.mockResolvedValue({
      items: [
        suggestion({ title: existing.title, category: existing.category }),
        suggestion(),
      ],
      status: 'ok',
    });

    await store.getState().runAiSuggestions(tripId);

    expect(rows().slice(0, before.length)).toEqual(before);
    expect(rows().slice(before.length)).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        tripId,
        title: 'Phrasebook',
        isPacked: false,
        source: 'ai',
      }),
    ]);
    expect(new Set(rows().map((row) => row.id)).size).toBe(rows().length);
    expect(store.getState().aiStatus[tripId]).toBe('ok');
  });

  it('ignores a second AI request while one is loading', async () => {
    const { store, tripId } = setup();
    const response = deferredResponse();
    fetchMock.mockReturnValue(response.promise);

    const first = store.getState().runAiSuggestions(tripId);
    const second = store.getState().runAiSuggestions(tripId);
    await second;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.getState().aiStatus[tripId]).toBe('loading');

    response.resolve({ items: [], status: 'ok' });
    await first;

    expect(store.getState().aiStatus[tripId]).toBe('ok');
  });

  it('reports unavailable and adds no rows when the service is unavailable', async () => {
    const { store, tripId, rows } = setup();
    const before = rows();
    fetchMock.mockResolvedValue({ items: [], status: 'unavailable' });

    await store.getState().runAiSuggestions(tripId);

    expect(store.getState().aiStatus[tripId]).toBe('unavailable');
    expect(rows()).toEqual(before);
  });

  it('reports unavailable when the AI request rejects', async () => {
    const { store, tripId, rows } = setup();
    const before = rows();
    fetchMock.mockRejectedValue(new Error('boom'));

    await expect(store.getState().runAiSuggestions(tripId)).resolves.toBeUndefined();

    expect(store.getState().aiStatus[tripId]).toBe('unavailable');
    expect(rows()).toEqual(before);
  });

  it('keeps a row added while loading and does not add the same title from the AI', async () => {
    const { store, tripId, rows } = setup();
    const count = rows().length;
    const response = deferredResponse();
    fetchMock.mockReturnValue(response.promise);

    const pending = store.getState().runAiSuggestions(tripId);
    store.getState().addUserItem(tripId, 'Phrasebook', null);
    response.resolve({
      items: [suggestion({ title: 'phrasebook' }), suggestion({ title: 'Pocket map' })],
      status: 'ok',
    });
    await pending;

    expect(rows().slice(count).map((row) => [row.title, row.source])).toEqual([
      ['Phrasebook', 'user'],
      ['Pocket map', 'ai'],
    ]);
  });

  it('rehydrates a saved loading status as unavailable', () => {
    const { mem, tripId } = setup();
    const blob = JSON.parse(mem.map.get('packsmart') ?? '') as {
      state: { aiStatus: Record<string, string> };
      version: number;
    };
    expect(blob.version).toBe(1);
    blob.state.aiStatus = { [tripId]: 'loading' };
    mem.map.set('packsmart', JSON.stringify(blob));

    const reopened = createTripStore(() => mem.storage);

    expect(reopened.getState().aiStatus).toEqual({ [tripId]: 'unavailable' });
    expect(reopened.getState().trips[tripId]).toBeDefined();
  });

  it.each([
    ['wrong shape', JSON.stringify({ state: { trips: [], items: 'nope' }, version: 1 })],
    ['non-JSON text', 'not json {'],
  ])('starts empty and stays usable with a corrupt blob: %s', (_label, saved) => {
    const mem = memoryStorage();
    mem.map.set('packsmart', saved);

    const store = createTripStore(() => mem.storage);

    expect(store.getState().trips).toEqual({});
    expect(store.getState().items).toEqual({});
    const tripId = store.getState().createTrip(trip, weather);
    expect(store.getState().trips[tripId]).toBeDefined();
    expect(store.getState().items[tripId].length).toBeGreaterThan(0);
  });

  it.each<[string, (state: SavedState, tripId: string) => void]>([
    ['a trip with no members', (state, id) => Object.assign(state.trips[id], { members: [] })],
    [
      'a trip that ends before it starts',
      (state, id) => Object.assign(state.trips[id], { endDate: '2026-05-01' }),
    ],
    ['a trip type that no longer exists', (state, id) => Object.assign(state.trips[id], { tripType: 'camping' })],
  ])('drops only the trip with %s, keeps the others and backs up the blob', (_label, corrupt) => {
    const { mem, store, tripId } = setup();
    const otherId = store.getState().createTrip(trip, weather);
    const otherRows = store.getState().items[otherId];
    store.getState().setCurrentMember(tripId, 'a1');
    const blob = JSON.parse(mem.map.get('packsmart') ?? '') as { state: SavedState };
    corrupt(blob.state, tripId);
    const saved = JSON.stringify(blob);
    mem.map.set('packsmart', saved);

    const reopened = createTripStore(() => mem.storage);

    expect(Object.keys(reopened.getState().trips)).toEqual([otherId]);
    expect(reopened.getState().items).toEqual({ [otherId]: otherRows });
    expect(reopened.getState().currentMember).toEqual({});
    expect(mem.map.get('packsmart-backup')).toBe(JSON.stringify(blob.state));
  });

  it('drops only an invalid row and keeps its trip', () => {
    const { mem, tripId, rows } = setup();
    const before = rows();
    const blob = JSON.parse(mem.map.get('packsmart') ?? '') as { state: SavedState };
    Object.assign(blob.state.items[tripId][0], { quantity: null });
    mem.map.set('packsmart', JSON.stringify(blob));

    const reopened = createTripStore(() => mem.storage);

    expect(reopened.getState().trips[tripId]).toBeDefined();
    expect(reopened.getState().items[tripId]).toEqual(before.slice(1));
    expect(mem.map.has('packsmart-backup')).toBe(true);
  });

  it.each([
    ['trips saved as an array', JSON.stringify({ state: { trips: [], items: {}, currentMember: {}, aiStatus: {} }, version: 1 }), JSON.stringify({ trips: [], items: {}, currentMember: {}, aiStatus: {} })],
    ['non-JSON text', 'not json {', 'not json {'],
  ])('backs up the saved data before discarding %s', (_label, saved, backup) => {
    const mem = memoryStorage();
    mem.map.set('packsmart', saved);

    const store = createTripStore(() => mem.storage);

    expect(store.getState().trips).toEqual({});
    expect(mem.map.get('packsmart-backup')).toBe(backup);
  });

  it('writes no backup when everything saved is valid', () => {
    const { mem } = setup();

    createTripStore(() => mem.storage);

    expect(mem.map.has('packsmart-backup')).toBe(false);
  });

  it('forgets a saved current member who is not on the trip', () => {
    const { mem, store, tripId } = setup();
    store.getState().setCurrentMember(tripId, 'ghost');

    const reopened = createTripStore(() => mem.storage);

    expect(reopened.getState().currentMember).toEqual({});
  });

  it('keeps saved trips when the saved version differs', () => {
    const { mem, tripId } = setup();
    const blob = JSON.parse(mem.map.get('packsmart') ?? '') as { version: number };
    blob.version = 0;
    mem.map.set('packsmart', JSON.stringify(blob));

    const reopened = createTripStore(() => mem.storage);

    expect(reopened.getState().trips[tripId]).toBeDefined();
  });

  it('keeps working in memory when storage refuses to save', () => {
    const { mem, store, tripId, rows } = setup();
    const { id } = rows()[0];
    mem.storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    expect(() => store.getState().togglePacked(tripId, id)).not.toThrow();
    expect(rows()[0].isPacked).toBe(true);
  });

  it('restores the same trip and items in a new store on the same storage', () => {
    const { mem, store, tripId, rows } = setup();

    const reopened = createTripStore(() => mem.storage);

    expect(reopened.getState().trips[tripId]).toEqual(store.getState().trips[tripId]);
    expect(reopened.getState().items[tripId]).toEqual(rows());
  });

  it('keeps the trip and its items after reload when a huge quantity was set', () => {
    const { mem, store, tripId, rows } = setup();
    const before = rows();

    store.getState().setQuantity(tripId, before[0].id, 1e20);
    const reopened = createTripStore(() => mem.storage);

    expect(reopened.getState().trips[tripId]).toEqual(store.getState().trips[tripId]);
    expect(reopened.getState().items[tripId]).toEqual([
      { ...before[0], quantity: 99 },
      ...before.slice(1),
    ]);
  });
});
