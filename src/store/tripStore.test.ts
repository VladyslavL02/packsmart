import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { generateBasePackingList } from '../engine/generator';
import type {
  AiSuggestion,
  PackingItem,
  SuggestResponse,
  TripInput,
  WeatherSummary,
} from '../engine/types';
import { fetchAiSuggestions } from '../services/suggestApi';
import {
  deleteItem,
  fetchTrip,
  fetchTripSummaries,
  insertItems,
  insertTripWithItems,
  subscribeToTrip,
  updateItem,
  updateItems,
} from '../services/tripRepo';
import type { SavedTrip } from '../services/tripRows';
import { createTripStore } from './tripStore';

vi.mock('../services/suggestApi', () => ({ fetchAiSuggestions: vi.fn() }));
// A factory, so the real module (and the Supabase client behind it) is never imported.
vi.mock('../services/tripRepo', () => ({
  insertTripWithItems: vi.fn(),
  insertItems: vi.fn(),
  fetchTrip: vi.fn(),
  updateItem: vi.fn(),
  updateItems: vi.fn(),
  deleteItem: vi.fn(),
  fetchTripSummaries: vi.fn(),
  subscribeToTrip: vi.fn(),
}));

const NOW = '2026-05-20T10:00:00.000Z';
const LATER = '2026-05-21T08:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVER_TRIP_ID = '11111111-1111-4111-8111-111111111111';

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

const savedTrip = (overrides: Partial<SavedTrip> = {}): SavedTrip => ({
  ...familyTrip,
  id: SERVER_TRIP_ID,
  weather,
  createdAt: NOW,
  ...overrides,
});

const item = (overrides: Partial<PackingItem> = {}): PackingItem => ({
  id: 'row-1',
  tripId: SERVER_TRIP_ID,
  key: null,
  title: 'Server socks',
  category: 'clothing',
  scope: 'shared',
  memberId: null,
  quantity: 1,
  source: 'rules',
  isPacked: false,
  reason: null,
  ...overrides,
});

const suggestion = (overrides: Partial<AiSuggestion> = {}): AiSuggestion => ({
  title: 'Phrasebook',
  category: 'misc',
  scope: 'shared',
  quantity: 1,
  reason: 'Handy in Lisbon',
  ...overrides,
});

const fetchMock = vi.mocked(fetchAiSuggestions);
const insertTripMock = vi.mocked(insertTripWithItems);
const insertItemsMock = vi.mocked(insertItems);
const fetchTripMock = vi.mocked(fetchTrip);
const updateItemMock = vi.mocked(updateItem);
const updateItemsMock = vi.mocked(updateItems);
const deleteItemMock = vi.mocked(deleteItem);

function resetMocks() {
  fetchMock.mockReset();
  insertTripMock.mockReset().mockImplementation(async (saved) => saved);
  insertItemsMock.mockReset().mockResolvedValue(undefined);
  fetchTripMock.mockReset().mockResolvedValue(null);
  updateItemMock.mockReset().mockResolvedValue(undefined);
  updateItemsMock.mockReset().mockResolvedValue(undefined);
  deleteItemMock.mockReset().mockResolvedValue(undefined);
  vi.mocked(fetchTripSummaries).mockReset().mockResolvedValue([]);
  vi.mocked(subscribeToTrip).mockReset().mockReturnValue(() => undefined);
}

function memoryStorage(saved?: string) {
  const map = new Map<string, string>();
  if (saved !== undefined) {map.set('packsmart', saved);}
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

function emptyStore(saved?: string) {
  const mem = memoryStorage(saved);
  const store = createTripStore(() => mem.storage);

  return { mem, store };
}

async function setup(input: TripInput = familyTrip) {
  const { mem, store } = emptyStore();
  const tripId = await store.getState().createTrip(input, weather);
  const rows = () => store.getState().items[tripId];

  return { mem, store, tripId, rows };
}

function savedBlob(mem: ReturnType<typeof memoryStorage>) {
  return JSON.parse(mem.map.get('packsmart') ?? 'null') as {
    state: Record<string, unknown>;
    version: number;
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

// Every mock settles on the microtask queue, so one macrotask drains whole write/recover chains.
const flush = () => new Promise<void>((done) => setTimeout(done, 0));

type Setup = Awaited<ReturnType<typeof setup>>;

const writes: [string, () => void, (ctx: Setup) => void][] = [
  [
    'togglePacked',
    () => updateItemMock.mockRejectedValue(new Error('offline')),
    ({ store, tripId, rows }) => store.getState().togglePacked(tripId, rows()[0].id),
  ],
  [
    'setQuantity',
    () => updateItemMock.mockRejectedValue(new Error('offline')),
    ({ store, tripId, rows }) => store.getState().setQuantity(tripId, rows()[0].id, 3),
  ],
  [
    'deleteItem',
    () => deleteItemMock.mockRejectedValue(new Error('offline')),
    ({ store, tripId, rows }) => store.getState().deleteItem(tripId, rows()[0].id),
  ],
  [
    'markCategoryPacked',
    () => updateItemsMock.mockRejectedValue(new Error('offline')),
    ({ store, tripId }) => store.getState().markCategoryPacked(tripId, 'clothing'),
  ],
  [
    'addUserItem',
    () => insertItemsMock.mockRejectedValue(new Error('offline')),
    ({ store, tripId }) => {
      store.getState().addUserItem(tripId, 'Lucky charm', null);
    },
  ],
];

describe('tripStore', () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('createTrip', () => {
    it('inserts the trip with unpacked rules rows under client UUIDs and no AI request', async () => {
      const { store } = emptyStore();

      const id = await store.getState().createTrip(familyTrip, weather);

      expect(id).toMatch(UUID);
      expect(insertTripMock).toHaveBeenCalledTimes(1);
      const [sentTrip, sentRows] = insertTripMock.mock.calls[0];
      expect(sentTrip).toEqual({ ...familyTrip, id, weather, createdAt: NOW });
      expect(sentRows).toHaveLength(generateBasePackingList(familyTrip, weather).length);
      expect(sentRows.length).toBeGreaterThan(0);
      expect(new Set(sentRows.map((row) => row.id)).size).toBe(sentRows.length);
      for (const row of sentRows) {
        expect(row.id).toMatch(UUID);
        expect(row).toMatchObject({ tripId: id, isPacked: false, source: 'rules' });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('stores the trip, rows, ready state and recent time after the insert succeeds', async () => {
      const { store } = emptyStore();

      const id = await store.getState().createTrip(familyTrip, weather);

      const state = store.getState();
      expect(state.trips).toEqual({ [id]: { ...familyTrip, id, weather, createdAt: NOW } });
      expect(state.items[id]).toEqual(insertTripMock.mock.calls[0]?.[1]);
      expect(state.load[id]).toBe('ready');
      expect(state.recent).toEqual({ [id]: NOW });
    });

    it('keeps nothing in the store while the insert is pending', async () => {
      const { store } = emptyStore();
      const insert = deferred<SavedTrip>();
      insertTripMock.mockReturnValue(insert.promise);

      const pending = store.getState().createTrip(familyTrip, weather);
      await flush();

      expect(store.getState().trips).toEqual({});
      expect(store.getState().items).toEqual({});
      expect(store.getState().recent).toEqual({});

      insert.resolve(insertTripMock.mock.calls[0][0]);
      const id = await pending;

      expect(store.getState().trips[id]).toBeDefined();
    });

    it('rejects invalid input without inserting', async () => {
      const { store } = emptyStore();

      await expect(
        store.getState().createTrip({ ...trip, members: [] }, weather),
      ).rejects.toThrow();

      expect(insertTripMock).not.toHaveBeenCalled();
      expect(store.getState().trips).toEqual({});
    });

    it('rejects and keeps nothing when the insert fails', async () => {
      const { mem, store } = emptyStore();
      insertTripMock.mockRejectedValueOnce(new Error('offline'));

      await expect(store.getState().createTrip(familyTrip, weather)).rejects.toThrow('offline');

      expect(store.getState().trips).toEqual({});
      expect(store.getState().items).toEqual({});
      expect(store.getState().load).toEqual({});
      expect(store.getState().recent).toEqual({});
      expect(mem.map.get('packsmart') ?? '').not.toContain(NOW);
    });

    it('returns the same id with one insert when called again while pending', async () => {
      const { store } = emptyStore();
      const insert = deferred<SavedTrip>();
      insertTripMock.mockReturnValue(insert.promise);

      const first = store.getState().createTrip(familyTrip, weather);
      const second = store.getState().createTrip(familyTrip, weather);
      await flush();

      expect(insertTripMock).toHaveBeenCalledTimes(1);
      insert.resolve(insertTripMock.mock.calls[0][0]);
      const [firstId, secondId] = await Promise.all([first, second]);
      expect(secondId).toBe(firstId);
      expect(Object.keys(store.getState().trips)).toEqual([firstId]);
    });

    it('tries the insert again on a call after a failure', async () => {
      const { store } = emptyStore();
      insertTripMock.mockRejectedValueOnce(new Error('offline'));
      await expect(store.getState().createTrip(familyTrip, weather)).rejects.toThrow('offline');

      const id = await store.getState().createTrip(familyTrip, weather);

      expect(insertTripMock).toHaveBeenCalledTimes(2);
      expect(store.getState().trips[id]).toBeDefined();
      expect(store.getState().load[id]).toBe('ready');
    });
  });

  describe('loadTrip', () => {
    it('shows loading while the fetch is pending', async () => {
      const { store } = emptyStore();
      const fetched = deferred<null>();
      fetchTripMock.mockReturnValue(fetched.promise);

      const pending = store.getState().loadTrip(SERVER_TRIP_ID);

      expect(store.getState().load[SERVER_TRIP_ID]).toBe('loading');
      fetched.resolve(null);
      await pending;
    });

    it('stores the fetched trip and items and marks them ready', async () => {
      const { store } = emptyStore();
      const data = { trip: savedTrip(), items: [item()] };
      fetchTripMock.mockResolvedValue(data);

      await store.getState().loadTrip(SERVER_TRIP_ID);

      expect(fetchTripMock).toHaveBeenCalledWith(SERVER_TRIP_ID);
      expect(store.getState().trips[SERVER_TRIP_ID]).toEqual(data.trip);
      expect(store.getState().items[SERVER_TRIP_ID]).toEqual(data.items);
      expect(store.getState().load[SERVER_TRIP_ID]).toBe('ready');
    });

    it('marks a trip that does not exist as missing', async () => {
      const { store } = emptyStore();

      await store.getState().loadTrip(SERVER_TRIP_ID);

      expect(store.getState().load[SERVER_TRIP_ID]).toBe('missing');
      expect(store.getState().trips).toEqual({});
      expect(store.getState().items).toEqual({});
    });

    it('marks a failed fetch as error without rejecting', async () => {
      const { store } = emptyStore();
      fetchTripMock.mockRejectedValue(new Error('offline'));

      await expect(store.getState().loadTrip(SERVER_TRIP_ID)).resolves.toBeUndefined();

      expect(store.getState().load[SERVER_TRIP_ID]).toBe('error');
    });
  });

  describe('item writes', () => {
    it('toggles one row to packed and back, writing each new value', async () => {
      const { store, tripId, rows } = await setup();
      const before = rows();

      store.getState().togglePacked(tripId, before[0].id);
      expect(rows()).toEqual([{ ...before[0], isPacked: true }, ...before.slice(1)]);
      await flush();
      expect(updateItemMock).toHaveBeenLastCalledWith(before[0].id, { isPacked: true });

      store.getState().togglePacked(tripId, before[0].id);
      expect(rows()).toEqual(before);
      await flush();
      expect(updateItemMock).toHaveBeenLastCalledWith(before[0].id, { isPacked: false });
      expect(updateItemMock).toHaveBeenCalledTimes(2);
      expect(store.getState().saveError).toBeNull();
    });

    it.each([
      [0, 1],
      [-3, 1],
      [Number.NaN, 1],
      [Number.POSITIVE_INFINITY, 1],
      [4, 4],
      [4.6, 5],
      [99, 99],
      [500, 99],
      [1e20, 99],
    ])('stores and writes quantity %s as %s', async (input, expected) => {
      const { store, tripId, rows } = await setup();
      const { id } = rows()[0];

      store.getState().setQuantity(tripId, id, input);

      expect(rows()[0]).toMatchObject({ id, quantity: expected, source: 'rules' });
      await flush();
      expect(updateItemMock).toHaveBeenCalledWith(id, { quantity: expected });
    });

    it('removes exactly one row at once and deletes it in the repo', async () => {
      const { store, tripId, rows } = await setup();
      const before = rows();

      store.getState().deleteItem(tripId, before[1].id);

      expect(rows()).toEqual(before.filter((_, index) => index !== 1));
      await flush();
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
      expect(deleteItemMock).toHaveBeenCalledWith(before[1].id);
    });

    it('marks only the category as packed with one write of its unpacked ids', async () => {
      const { store, tripId, rows } = await setup();
      const clothing = rows().filter((row) => row.category === 'clothing');
      expect(clothing.length).toBeGreaterThan(1);
      expect(rows().length).toBeGreaterThan(clothing.length);
      store.getState().togglePacked(tripId, clothing[0].id);

      store.getState().markCategoryPacked(tripId, 'clothing');

      for (const row of rows()) {
        expect(row.isPacked).toBe(row.category === 'clothing');
      }
      await flush();
      expect(updateItemsMock).toHaveBeenCalledTimes(1);
      const [ids, patch] = updateItemsMock.mock.calls[0];
      expect([...ids].sort()).toEqual(clothing.slice(1).map((row) => row.id).sort());
      expect(patch).toEqual({ isPacked: true });
    });

    it('marks and writes only the listed rows of the category when itemIds is given', async () => {
      const { store, tripId, rows } = await setup();
      const clothing = rows().filter((row) => row.category === 'clothing');
      const other = rows().find((row) => row.category !== 'clothing');
      expect(clothing.length).toBeGreaterThan(1);

      store.getState().markCategoryPacked(tripId, 'clothing', [clothing[0].id, other?.id ?? '']);

      expect(rows().filter((row) => row.isPacked).map((row) => row.id)).toEqual([clothing[0].id]);
      await flush();
      expect(updateItemsMock).toHaveBeenCalledTimes(1);
      expect(updateItemsMock).toHaveBeenCalledWith([clothing[0].id], { isPacked: true });
    });
  });

  describe('addUserItem', () => {
    it.each([
      ['a1', 'adult'],
      ['c1', 'child'],
      [null, 'shared'],
    ])('appends and inserts a user row for member %s with scope %s', async (memberId, scope) => {
      const { store, tripId, rows } = await setup();
      const count = rows().length;

      const added = store.getState().addUserItem(tripId, 'Lucky charm', memberId);

      expect(added).toBe(true);
      expect(rows()).toHaveLength(count + 1);
      expect(rows()[count]).toMatchObject({
        id: expect.stringMatching(UUID),
        tripId,
        title: 'Lucky charm',
        source: 'user',
        category: 'misc',
        key: null,
        scope,
        memberId,
        isPacked: false,
      });
      await flush();
      expect(insertItemsMock).toHaveBeenCalledTimes(1);
      expect(insertItemsMock).toHaveBeenCalledWith([rows()[count]]);
    });

    it('rejects a title the same member already has, ignoring case and spacing', async () => {
      const { store, tripId, rows } = await setup();
      store.getState().addUserItem(tripId, 'Lucky charm', 'a1');
      const before = rows();
      await flush();
      insertItemsMock.mockClear();

      const added = store.getState().addUserItem(tripId, '  LUCKY   Charm ', 'a1');

      expect(added).toBe(false);
      expect(rows()).toEqual(before);
      await flush();
      expect(insertItemsMock).not.toHaveBeenCalled();
    });

    it('accepts the same user title for another member and as shared', async () => {
      const { store, tripId, rows } = await setup();
      store.getState().addUserItem(tripId, 'Lucky charm', 'a1');
      const count = rows().length;

      expect(store.getState().addUserItem(tripId, 'Lucky charm', 'a2')).toBe(true);
      expect(store.getState().addUserItem(tripId, 'Lucky charm', null)).toBe(true);
      expect(rows()).toHaveLength(count + 2);
    });

    it('returns false and inserts nothing for an empty title, unknown member or trip', async () => {
      const { store, tripId } = await setup();
      const before = store.getState().items;

      expect(store.getState().addUserItem(tripId, '   ', 'a1')).toBe(false);
      expect(store.getState().addUserItem(tripId, 'Lucky charm', 'nobody')).toBe(false);
      expect(store.getState().addUserItem('no-trip', 'Lucky charm', null)).toBe(false);

      expect(store.getState().items).toEqual(before);
      await flush();
      expect(insertItemsMock).not.toHaveBeenCalled();
    });
  });

  describe('failed writes', () => {
    it.each(writes)(
      'replaces the items with the server copy and sets saveError when %s fails',
      async (_name, failWrite, act) => {
        const ctx = await setup();
        const serverRows = [item({ tripId: ctx.tripId })];
        fetchTripMock.mockResolvedValue({
          trip: savedTrip({ id: ctx.tripId }),
          items: serverRows,
        });
        failWrite();

        act(ctx);
        await flush();

        expect(fetchTripMock).toHaveBeenCalledWith(ctx.tripId);
        expect(ctx.rows()).toEqual(serverRows);
        expect(ctx.store.getState().saveError).toEqual(expect.stringMatching(/\S/));
      },
    );

    it.each(writes)(
      'still sets saveError without throwing when %s and the refetch both fail',
      async (_name, failWrite, act) => {
        const ctx = await setup();
        fetchTripMock.mockRejectedValue(new Error('still offline'));
        failWrite();

        expect(() => act(ctx)).not.toThrow();
        await flush();

        expect(fetchTripMock).toHaveBeenCalledWith(ctx.tripId);
        expect(ctx.store.getState().saveError).toEqual(expect.stringMatching(/\S/));
      },
    );

    it('clears saveError', async () => {
      const { store, tripId, rows } = await setup();
      updateItemMock.mockRejectedValue(new Error('offline'));
      store.getState().togglePacked(tripId, rows()[0].id);
      await flush();
      expect(store.getState().saveError).toEqual(expect.any(String));

      store.getState().clearSaveError();

      expect(store.getState().saveError).toBeNull();
    });
  });

  describe('runAiSuggestions', () => {
    it('inserts and appends only the new AI rows and reports ok', async () => {
      const { store, tripId, rows } = await setup();
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

      const added = rows().slice(before.length);
      expect(rows().slice(0, before.length)).toEqual(before);
      expect(added).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(UUID),
          tripId,
          title: 'Phrasebook',
          isPacked: false,
          source: 'ai',
        }),
      ]);
      expect(insertItemsMock).toHaveBeenCalledTimes(1);
      expect(insertItemsMock).toHaveBeenCalledWith(added);
      expect(store.getState().aiStatus[tripId]).toBe('ok');
    });

    it('adds the AI rows only after the insert resolves', async () => {
      const { store, tripId, rows } = await setup();
      const before = rows();
      const insert = deferred();
      insertItemsMock.mockReturnValue(insert.promise);
      fetchMock.mockResolvedValue({ items: [suggestion()], status: 'ok' });

      const pending = store.getState().runAiSuggestions(tripId);
      await flush();

      expect(insertItemsMock).toHaveBeenCalledTimes(1);
      expect(rows()).toEqual(before);

      insert.resolve();
      await pending;

      expect(rows()).toHaveLength(before.length + 1);
    });

    it('reports unavailable and changes no data when the AI insert fails', async () => {
      const { store, tripId, rows } = await setup();
      const before = rows();
      const savedBefore = store.getState().trips[tripId];
      insertItemsMock.mockRejectedValue(new Error('offline'));
      fetchMock.mockResolvedValue({ items: [suggestion()], status: 'ok' });

      await expect(store.getState().runAiSuggestions(tripId)).resolves.toBeUndefined();

      expect(insertItemsMock).toHaveBeenCalledTimes(1);
      expect(store.getState().aiStatus[tripId]).toBe('unavailable');
      expect(rows()).toEqual(before);
      expect(store.getState().trips[tripId]).toEqual(savedBefore);
    });

    it('keeps one copy of an AI row echoed before the insert resolves', async () => {
      const { store, tripId, rows } = await setup();
      const count = rows().length;
      const insert = deferred();
      insertItemsMock.mockReturnValue(insert.promise);
      fetchMock.mockResolvedValue({ items: [suggestion()], status: 'ok' });

      const pending = store.getState().runAiSuggestions(tripId);
      await flush();
      const [echo] = insertItemsMock.mock.calls[0][0];
      store.getState().applyRemoteUpsert({ ...echo });
      insert.resolve();
      await pending;

      expect(rows().filter((row) => row.id === echo.id)).toHaveLength(1);
      expect(rows()).toHaveLength(count + 1);
      expect(store.getState().aiStatus[tripId]).toBe('ok');
    });

    it('ignores a second AI request while one is loading', async () => {
      const { store, tripId } = await setup();
      const response = deferred<SuggestResponse>();
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
      const { store, tripId, rows } = await setup();
      const before = rows();
      fetchMock.mockResolvedValue({ items: [], status: 'unavailable' });

      await store.getState().runAiSuggestions(tripId);

      expect(store.getState().aiStatus[tripId]).toBe('unavailable');
      expect(rows()).toEqual(before);
    });

    it('reports unavailable when the AI request rejects', async () => {
      const { store, tripId, rows } = await setup();
      const before = rows();
      fetchMock.mockRejectedValue(new Error('boom'));

      await expect(store.getState().runAiSuggestions(tripId)).resolves.toBeUndefined();

      expect(store.getState().aiStatus[tripId]).toBe('unavailable');
      expect(rows()).toEqual(before);
    });

    it('keeps a row added while loading and does not add the same title from the AI', async () => {
      const { store, tripId, rows } = await setup();
      const count = rows().length;
      const response = deferred<SuggestResponse>();
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
  });

  describe('remote changes', () => {
    it('replaces a row with the same id on a remote upsert', async () => {
      const { store, rows } = await setup();
      const before = rows();
      const changed = { ...before[1], isPacked: true, quantity: 6 };

      store.getState().applyRemoteUpsert(changed);

      expect(rows()).toEqual([before[0], changed, ...before.slice(2)]);
    });

    it('appends an unknown row on a remote upsert', async () => {
      const { store, tripId, rows } = await setup();
      const before = rows();
      const remote = item({ tripId });

      store.getState().applyRemoteUpsert(remote);

      expect(rows()).toEqual([...before, remote]);
    });

    it('ignores a remote upsert for a trip whose items are not loaded', async () => {
      const { store } = await setup();
      const before = store.getState().items;

      store.getState().applyRemoteUpsert(item({ tripId: 'not-loaded' }));

      expect(store.getState().items).toEqual(before);
      expect(store.getState().items).not.toHaveProperty('not-loaded');
    });

    it('does not duplicate a quick-added row when its echo arrives', async () => {
      const { store, tripId, rows } = await setup();
      store.getState().addUserItem(tripId, 'Lucky charm', null);
      const before = rows();

      store.getState().applyRemoteUpsert({ ...before[before.length - 1] });

      expect(rows()).toEqual(before);
    });

    it('removes a remotely deleted row from the trip that holds it', async () => {
      const { store, tripId } = await setup();
      const otherId = await store.getState().createTrip(familyTrip, weather);
      const first = store.getState().items[tripId];
      const other = store.getState().items[otherId];

      store.getState().applyRemoteDelete(other[0].id);

      expect(store.getState().items[otherId]).toEqual(other.slice(1));
      expect(store.getState().items[tripId]).toEqual(first);
    });

    it('leaves the state untouched on a remote delete of an unknown id', async () => {
      const { store } = await setup();
      const before = store.getState();

      store.getState().applyRemoteDelete('unknown-row');

      expect(store.getState()).toBe(before);
    });
  });

  describe('trip bookkeeping', () => {
    it('sets and overwrites the current member for one trip only', async () => {
      const { store, tripId } = await setup();
      const otherId = await store.getState().createTrip(familyTrip, weather);
      store.getState().setCurrentMember(otherId, 'a2');

      store.getState().setCurrentMember(tripId, 'a1');
      store.getState().setCurrentMember(tripId, 'c1');

      expect(store.getState().currentMember).toEqual({ [tripId]: 'c1', [otherId]: 'a2' });
    });

    it('updates only the recent time on touch', async () => {
      const { store, tripId } = await setup();
      const { trips, items } = store.getState();
      vi.setSystemTime(new Date(LATER));

      store.getState().touchTrip(tripId);

      expect(store.getState().recent).toEqual({ [tripId]: LATER });
      expect(store.getState().trips).toEqual(trips);
      expect(store.getState().items).toEqual(items);
    });

    it('ignores a touch for a trip that is not in the store', async () => {
      const { store, tripId } = await setup();

      store.getState().touchTrip('no-trip');

      expect(store.getState().recent).toEqual({ [tripId]: NOW });
    });
  });

  describe('persistence', () => {
    const v2 = (state: object) => JSON.stringify({ state, version: 2 });

    it('saves only currentMember, aiStatus and recent as version 2', async () => {
      const { mem, store, tripId } = await setup();
      fetchMock.mockResolvedValue({ items: [], status: 'ok' });
      store.getState().setCurrentMember(tripId, 'a1');

      await store.getState().runAiSuggestions(tripId);

      expect(savedBlob(mem)).toEqual({
        state: {
          currentMember: { [tripId]: 'a1' },
          aiStatus: { [tripId]: 'ok' },
          recent: { [tripId]: NOW },
        },
        version: 2,
      });
    });

    it('restores the saved preferences but no trip data in a new store', () => {
      const saved = {
        currentMember: { t1: 'a1' },
        aiStatus: { t1: 'empty' },
        recent: { t1: NOW },
      };

      const { store } = emptyStore(v2(saved));

      expect(store.getState()).toMatchObject({ ...saved, saveError: null });
      expect(store.getState().trips).toEqual({});
      expect(store.getState().items).toEqual({});
      expect(store.getState().load).toEqual({});
    });

    it('rehydrates a saved loading status as unavailable', () => {
      const { store } = emptyStore(
        v2({ currentMember: {}, aiStatus: { t1: 'loading' }, recent: {} }),
      );

      expect(store.getState().aiStatus).toEqual({ t1: 'unavailable' });
    });

    it('drops invalid saved entries and keeps the valid ones', () => {
      const { store } = emptyStore(
        v2({
          currentMember: { t1: 'a1' },
          aiStatus: { t1: 'ok', t2: 'bogus' },
          recent: { t1: NOW, t2: 'yesterday', t3: 5 },
        }),
      );

      expect(store.getState().currentMember).toEqual({ t1: 'a1' });
      expect(store.getState().aiStatus).toEqual({ t1: 'ok' });
      expect(store.getState().recent).toEqual({ t1: NOW });
    });

    it('migrates a version 1 blob, keeping preferences and dropping trips and items', () => {
      const v1Trip = (id: string, lastOpenedAt: string) => ({
        ...savedTrip({ id }),
        lastOpenedAt,
      });
      const { mem, store } = emptyStore(
        JSON.stringify({
          state: {
            trips: { t1: v1Trip('t1', NOW), t2: v1Trip('t2', LATER) },
            items: { t1: [item({ tripId: 't1' })], t2: [] },
            currentMember: { t1: 'a1' },
            aiStatus: { t1: 'ok' },
          },
          version: 1,
        }),
      );
      const expected = {
        currentMember: { t1: 'a1' },
        aiStatus: { t1: 'ok' },
        recent: { t1: NOW, t2: LATER },
      };

      expect(store.getState()).toMatchObject(expected);
      expect(store.getState().trips).toEqual({});
      expect(store.getState().items).toEqual({});
      expect(savedBlob(mem)).toEqual({ state: expected, version: 2 });
    });

    it.each([
      [
        'wrong-shape data',
        v2({ currentMember: [], aiStatus: 'nope', recent: [] }),
        JSON.stringify({ currentMember: [], aiStatus: 'nope', recent: [] }),
      ],
      ['non-JSON text', 'not json {', 'not json {'],
    ])('backs up %s, starts empty and stays usable', async (_label, saved, backup) => {
      const { mem, store } = emptyStore(saved);

      expect(store.getState().currentMember).toEqual({});
      expect(store.getState().aiStatus).toEqual({});
      expect(store.getState().recent).toEqual({});
      expect(mem.map.get('packsmart-backup')).toBe(backup);

      const id = await store.getState().createTrip(trip, weather);

      expect(store.getState().recent).toEqual({ [id]: NOW });
    });

    it('writes no backup when everything saved is valid', () => {
      const { mem } = emptyStore(
        v2({ currentMember: { t1: 'a1' }, aiStatus: { t1: 'ok' }, recent: { t1: NOW } }),
      );

      expect(mem.map.has('packsmart-backup')).toBe(false);
    });

    it('keeps working in memory when storage refuses to save', async () => {
      const { mem, store, tripId, rows } = await setup();
      const { id } = rows()[0];
      mem.storage.setItem = () => {
        throw new Error('QuotaExceededError');
      };

      expect(() => store.getState().togglePacked(tripId, id)).not.toThrow();
      expect(() => store.getState().setCurrentMember(tripId, 'a2')).not.toThrow();

      expect(rows()[0].isPacked).toBe(true);
      expect(store.getState().currentMember[tripId]).toBe('a2');
    });
  });
});
