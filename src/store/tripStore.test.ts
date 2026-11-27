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

    it('starts a second insert for different input while the first is pending', async () => {
      const { store } = emptyStore();
      const insert = deferred<SavedTrip>();
      insertTripMock.mockReturnValueOnce(insert.promise);

      const first = store.getState().createTrip(familyTrip, weather);
      const second = store.getState().createTrip({ ...familyTrip, city: 'Rome' }, weather);
      await flush();

      expect(insertTripMock).toHaveBeenCalledTimes(2);
      insert.resolve(insertTripMock.mock.calls[0][0]);
      const [firstId, secondId] = await Promise.all([first, second]);
      expect(secondId).not.toBe(firstId);
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

  describe('changes while a fetch is pending', () => {
    type Fetched = Awaited<ReturnType<typeof fetchTrip>>;

    const serverData = (items: PackingItem[], tripId = SERVER_TRIP_ID) => ({
      trip: savedTrip({ id: tripId }),
      items,
    });
    const nextFetch = () => {
      const fetched = deferred<Fetched>();
      fetchTripMock.mockReturnValueOnce(fetched.promise);

      return fetched;
    };
    const row1 = item();
    const row2 = item({ id: 'row-2', title: 'Server hat' });

    // No items in memory yet: the changes arrive before the first rows do.
    async function firstLoad(serverRows: PackingItem[], act: (ctx: Setup['store']) => void) {
      const { store } = emptyStore();
      const fetched = nextFetch();
      const pending = store.getState().loadTrip(SERVER_TRIP_ID);

      act(store);
      fetched.resolve(serverData(serverRows));
      await pending;

      return store.getState().items[SERVER_TRIP_ID];
    }

    // Items already in memory, and the fetch returns them as they were before the change.
    async function staleReload(act: (ctx: Setup) => void) {
      const ctx = await setup();
      const stale = ctx.rows();
      const fetched = nextFetch();
      const pending = ctx.store.getState().loadTrip(ctx.tripId);

      act(ctx);
      const changed = ctx.rows();
      fetched.resolve(serverData(stale, ctx.tripId));
      await pending;

      return { ...ctx, stale, changed };
    }

    it('keeps a remote upsert of an existing row on a first load', async () => {
      const remote = { ...row1, isPacked: true, quantity: 4 };

      const rows = await firstLoad([row1, row2], (store) => {
        store.getState().applyRemoteUpsert(remote);
      });

      expect(rows).toEqual([remote, row2]);
    });

    it('keeps a remote upsert of a new row on a first load', async () => {
      const rows = await firstLoad([row1], (store) => {
        store.getState().applyRemoteUpsert(row2);
      });

      expect(rows).toEqual([row1, row2]);
    });

    it('keeps a remote delete on a first load', async () => {
      const rows = await firstLoad([row1, row2], (store) => {
        store.getState().applyRemoteDelete(row1.id);
      });

      expect(rows).toEqual([row2]);
    });

    it('applies pending changes in the order they happened', async () => {
      const row3 = item({ id: 'row-3', title: 'Server scarf' });

      const rows = await firstLoad([row1], (store) => {
        store.getState().applyRemoteUpsert({ ...row1, quantity: 2 });
        store.getState().applyRemoteUpsert({ ...row1, quantity: 5 });
        store.getState().applyRemoteUpsert(row2);
        store.getState().applyRemoteDelete(row2.id);
        store.getState().applyRemoteDelete(row3.id);
        store.getState().applyRemoteUpsert(row3);
      });

      expect(rows).toEqual([{ ...row1, quantity: 5 }, row3]);
    });

    it.each(writes)(
      'keeps a local %s over a stale reload result',
      async (_name, _failWrite, act) => {
        const { rows, stale, changed } = await staleReload(act);

        expect(changed).not.toEqual(stale);
        expect(rows()).toEqual(changed);
      },
    );

    it('does not duplicate a quick-added row the fetch already includes', async () => {
      const { store, tripId, rows } = await setup();
      const before = rows();
      const fetched = nextFetch();
      const pending = store.getState().loadTrip(tripId);

      store.getState().addUserItem(tripId, 'Lucky charm', null);
      const added = rows()[before.length];
      fetched.resolve(serverData([...before, { ...added }], tripId));
      await pending;

      expect(rows()).toEqual([...before, added]);
    });

    it.each([
      ['first', 0, 1],
      ['second', 1, 0],
    ])(
      'keeps a change through two overlapping loads when the %s resolves first',
      async (_label, earlier, later) => {
        const { store } = emptyStore();
        const fetches = [nextFetch(), nextFetch()];
        const loads = [
          store.getState().loadTrip(SERVER_TRIP_ID),
          store.getState().loadTrip(SERVER_TRIP_ID),
        ];
        const rows = () => store.getState().items[SERVER_TRIP_ID];

        store.getState().applyRemoteUpsert(row2);
        fetches[earlier].resolve(serverData([row1]));
        await loads[earlier];
        expect(rows()).toEqual([row1, row2]);

        fetches[later].resolve(serverData([row1]));
        await loads[later];

        expect(rows()).toEqual([row1, row2]);
      },
    );

    it('does not replay a change made with no load pending onto a later load', async () => {
      const { store, tripId, rows } = await setup();
      const server = rows();
      store.getState().togglePacked(tripId, server[0].id);
      store.getState().applyRemoteUpsert(item({ tripId }));
      store.getState().applyRemoteDelete(server[1].id);
      await flush();
      fetchTripMock.mockResolvedValue(serverData(server, tripId));

      await store.getState().loadTrip(tripId);

      expect(rows()).toEqual(server);
    });

    it('does not replay a change from a finished load onto the next load', async () => {
      const { store } = emptyStore();
      const first = nextFetch();
      const pending = store.getState().loadTrip(SERVER_TRIP_ID);
      store.getState().applyRemoteUpsert(row2);
      first.resolve(serverData([row1]));
      await pending;
      fetchTripMock.mockResolvedValue(serverData([row1]));

      await store.getState().loadTrip(SERVER_TRIP_ID);

      expect(store.getState().items[SERVER_TRIP_ID]).toEqual([row1]);
    });

    const row3 = item({ id: 'row-3', title: 'Server gloves' });

    it.each<[string, (store: Setup['store']) => void, PackingItem[]]>([
      [
        'upsert of an existing row',
        (store) => {
          store.getState().applyRemoteUpsert({ ...row2, quantity: 7 });
        },
        [row1, { ...row2, quantity: 7 }],
      ],
      [
        'upsert of a new row',
        (store) => {
          store.getState().applyRemoteUpsert(row3);
        },
        [row1, row2, row3],
      ],
      [
        'delete',
        (store) => {
          store.getState().applyRemoteDelete(row2.id);
        },
        [row1],
      ],
    ])(
      'keeps a remote %s that arrives during the re-fetch after a failed write',
      async (_name, remoteChange, expected) => {
        const { store } = emptyStore();
        fetchTripMock.mockResolvedValueOnce(serverData([row1, row2]));
        await store.getState().loadTrip(SERVER_TRIP_ID);
        const refetch = nextFetch();
        updateItemMock.mockRejectedValueOnce(new Error('offline'));
        store.getState().togglePacked(SERVER_TRIP_ID, row1.id);
        await flush();
        expect(fetchTripMock).toHaveBeenCalledTimes(2);

        remoteChange(store);
        refetch.resolve(serverData([row1, row2]));
        await flush();

        // row1 is back to the server value: the failed toggle is gone.
        expect(store.getState().items[SERVER_TRIP_ID]).toEqual(expected);
      },
    );

    it.each(writes)(
      'does not bring a failed %s back when the load resolves after the re-fetch',
      async (_name, failWrite, act) => {
        const ctx = await setup();
        const server = ctx.rows();
        const load = nextFetch();
        const pending = ctx.store.getState().loadTrip(ctx.tripId);
        fetchTripMock.mockResolvedValueOnce(serverData(server, ctx.tripId));
        failWrite();

        act(ctx);
        expect(ctx.rows()).not.toEqual(server);
        await flush();
        expect(ctx.rows()).toEqual(server);

        load.resolve(serverData(server, ctx.tripId));
        await pending;

        expect(ctx.rows()).toEqual(server);
      },
    );

    describe('out-of-order results', () => {
      const added = item({ id: 'row-3', title: 'Server gloves' });
      const loaded = (store: Setup['store']) => ({
        rows: store.getState().items[SERVER_TRIP_ID],
        status: store.getState().load[SERVER_TRIP_ID],
      });

      it.each([
        ['an updated row', [{ ...row1, quantity: 9 }, row2]],
        ['an added row', [row1, row2, added]],
        ['a deleted row', [row1]],
      ])('does not let an older load undo %s from a newer one', async (_label, newerRows) => {
        const { store } = emptyStore();
        const older = nextFetch();
        const newer = nextFetch();
        const olderLoad = store.getState().loadTrip(SERVER_TRIP_ID);
        const newerLoad = store.getState().loadTrip(SERVER_TRIP_ID);

        newer.resolve(serverData(newerRows));
        await newerLoad;
        older.resolve(serverData([row1, row2]));
        await olderLoad;

        expect(loaded(store)).toEqual({ rows: newerRows, status: 'ready' });
      });

      const newerRows = [{ ...row1, quantity: 9 }, row2, added];

      // A failed write starts the re-fetch, then a load starts; both are left pending.
      async function refetchThenLoad() {
        const { store } = emptyStore();
        fetchTripMock.mockResolvedValueOnce(serverData([row1, row2]));
        await store.getState().loadTrip(SERVER_TRIP_ID);
        const refetch = nextFetch();
        updateItemMock.mockRejectedValueOnce(new Error('offline'));
        store.getState().togglePacked(SERVER_TRIP_ID, row1.id);
        await flush();
        const newer = nextFetch();
        const load = store.getState().loadTrip(SERVER_TRIP_ID);

        const finish = async (order: string) => {
          const resolveRefetch = async () => {
            refetch.resolve(serverData([row1, row2]));
            await flush();
          };
          const resolveLoad = async () => {
            newer.resolve(serverData(newerRows));
            await load;
          };
          const steps =
            order === 'load' ? [resolveLoad, resolveRefetch] : [resolveRefetch, resolveLoad];
          for (const step of steps) {
            await step();
          }
        };

        return { store, finish };
      }

      it.each(['load', 're-fetch'])(
        'keeps the newer load over the re-fetch when the %s resolves first',
        async (order) => {
          const { store, finish } = await refetchThenLoad();

          await finish(order);

          expect(loaded(store)).toEqual({ rows: newerRows, status: 'ready' });
        },
      );

      it.each(['load', 're-fetch'])(
        'still reports the failed write when the %s resolves first',
        async (order) => {
          const { store, finish } = await refetchThenLoad();

          await finish(order);

          expect(store.getState().saveError).toEqual(expect.stringMatching(/\S/));
          expect(store.getState().saveErrorTripId).toBe(SERVER_TRIP_ID);
        },
      );

      it('does not let an older load overwrite a newer re-fetch result', async () => {
        const { store } = emptyStore();
        fetchTripMock.mockResolvedValueOnce(serverData([row1, row2]));
        await store.getState().loadTrip(SERVER_TRIP_ID);
        const older = nextFetch();
        const olderLoad = store.getState().loadTrip(SERVER_TRIP_ID);
        fetchTripMock.mockResolvedValueOnce(serverData(newerRows));
        updateItemMock.mockRejectedValueOnce(new Error('offline'));
        store.getState().togglePacked(SERVER_TRIP_ID, row1.id);
        await flush();

        older.resolve(serverData([row1, row2]));
        await olderLoad;

        expect(loaded(store)).toEqual({ rows: newerRows, status: 'ready' });
      });

      it.each<[string, (older: ReturnType<typeof nextFetch>) => void]>([
        ['finds nothing', (older) => older.resolve(null)],
        ['rejects', (older) => older.reject(new Error('offline'))],
      ])('keeps the trip ready when an older load %s afterwards', async (_label, settle) => {
        const { store } = emptyStore();
        const older = nextFetch();
        const newer = nextFetch();
        const olderLoad = store.getState().loadTrip(SERVER_TRIP_ID);
        const newerLoad = store.getState().loadTrip(SERVER_TRIP_ID);
        newer.resolve(serverData([row1]));
        await newerLoad;

        settle(older);
        await olderLoad;

        expect(store.getState().trips[SERVER_TRIP_ID]).toEqual(savedTrip());
        expect(loaded(store)).toEqual({ rows: [row1], status: 'ready' });
      });

      it.each(['older', 'newer'])(
        'applies the older result when the newer load rejects and the %s settles first',
        async (first) => {
          const { store } = emptyStore();
          const older = nextFetch();
          const newer = nextFetch();
          const olderLoad = store.getState().loadTrip(SERVER_TRIP_ID);
          const newerLoad = store.getState().loadTrip(SERVER_TRIP_ID);
          const succeedOlder = async () => {
            older.resolve(serverData([row1]));
            await olderLoad;
          };
          const failNewer = async () => {
            newer.reject(new Error('offline'));
            await newerLoad;
          };

          const steps =
            first === 'older' ? [succeedOlder, failNewer] : [failNewer, succeedOlder];
          for (const step of steps) {
            await step();
          }

          expect(loaded(store)).toEqual({ rows: [row1], status: 'ready' });
        },
      );
    });

    it('keeps a missing trip missing while it is loaded again', async () => {
      const { store } = emptyStore();
      await store.getState().loadTrip(SERVER_TRIP_ID);
      const fetched = nextFetch();

      const pending = store.getState().loadTrip(SERVER_TRIP_ID);

      expect(store.getState().load[SERVER_TRIP_ID]).toBe('missing');
      fetched.resolve(null);
      await pending;
      expect(store.getState().load[SERVER_TRIP_ID]).toBe('missing');
    });

    it('shows loading again when a failed load is retried', async () => {
      const { store } = emptyStore();
      fetchTripMock.mockRejectedValueOnce(new Error('offline'));
      await store.getState().loadTrip(SERVER_TRIP_ID);
      expect(store.getState().load[SERVER_TRIP_ID]).toBe('error');
      const fetched = nextFetch();

      const pending = store.getState().loadTrip(SERVER_TRIP_ID);

      expect(store.getState().load[SERVER_TRIP_ID]).toBe('loading');
      fetched.resolve(null);
      await pending;
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

  describe('saveErrorTripId', () => {
    const REFRESHED = "Couldn't save — refreshed the list";
    const OFFLINE = "Couldn't save — check your connection";

    const saveErrorState = (store: Setup['store']) => {
      const { saveError, saveErrorTripId } = store.getState();

      return { saveError, saveErrorTripId };
    };

    it('starts as null', () => {
      const { store } = emptyStore();

      expect(saveErrorState(store)).toEqual({ saveError: null, saveErrorTripId: null });
    });

    it.each(writes)(
      'names the trip when %s fails and the list is refreshed',
      async (_name, failWrite, act) => {
        const ctx = await setup();
        fetchTripMock.mockResolvedValue({
          trip: savedTrip({ id: ctx.tripId }),
          items: ctx.rows(),
        });
        failWrite();

        act(ctx);
        await flush();

        expect(saveErrorState(ctx.store)).toEqual({
          saveError: REFRESHED,
          saveErrorTripId: ctx.tripId,
        });
      },
    );

    it.each([
      ['rejects', () => fetchTripMock.mockRejectedValue(new Error('still offline'))],
      ['finds no trip', () => fetchTripMock.mockResolvedValue(null)],
    ])('names the trip in the offline case when the re-fetch %s', async (_label, failRefetch) => {
      const { store, tripId, rows } = await setup();
      updateItemMock.mockRejectedValue(new Error('offline'));
      failRefetch();

      store.getState().togglePacked(tripId, rows()[0].id);
      await flush();

      expect(saveErrorState(store)).toEqual({ saveError: OFFLINE, saveErrorTripId: tripId });
    });

    it('names the original trip when the failure arrives after another trip is opened', async () => {
      const { store, tripId, rows } = await setup();
      const otherId = await store.getState().createTrip(familyTrip, weather);
      const write = deferred();
      updateItemMock.mockReturnValueOnce(write.promise);
      store.getState().togglePacked(tripId, rows()[0].id);

      fetchTripMock.mockImplementation(async (id) => ({
        trip: savedTrip({ id }),
        items: store.getState().items[id],
      }));
      await store.getState().loadTrip(otherId);
      store.getState().touchTrip(otherId);
      write.reject(new Error('offline'));
      await flush();

      expect(saveErrorState(store)).toEqual({ saveError: REFRESHED, saveErrorTripId: tripId });
    });

    it('is reset together with saveError by clearSaveError', async () => {
      const { store, tripId, rows } = await setup();
      updateItemMock.mockRejectedValue(new Error('offline'));
      store.getState().togglePacked(tripId, rows()[0].id);
      await flush();
      expect(store.getState().saveErrorTripId).toBe(tripId);

      store.getState().clearSaveError();

      expect(saveErrorState(store)).toEqual({ saveError: null, saveErrorTripId: null });
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

    describe('echoes of this tab\'s own writes', () => {
      const first = async () => {
        const ctx = await setup();
        const row = () => ctx.rows()[0];

        return { ...ctx, row, start: { ...row() } };
      };

      it('keeps the newest quantity when an older echo arrives', async () => {
        const { store, tripId, row, start } = await first();
        const { setQuantity, applyRemoteUpsert } = store.getState();
        setQuantity(tripId, start.id, 8);
        setQuantity(tripId, start.id, 9);

        applyRemoteUpsert({ ...start, quantity: 8 });
        expect(row().quantity).toBe(9);
        applyRemoteUpsert({ ...start, quantity: 9 });
        expect(row().quantity).toBe(9);
      });

      it('keeps the last tick state through three fast clicks', async () => {
        const { store, tripId, row, start } = await first();
        const { togglePacked, applyRemoteUpsert } = store.getState();
        togglePacked(tripId, start.id);
        togglePacked(tripId, start.id);
        togglePacked(tripId, start.id);

        for (const isPacked of [true, false, true]) {
          applyRemoteUpsert({ ...start, isPacked });
          expect(row().isPacked).toBe(true);
        }
      });

      it('keeps a pending tick when the echo of another column arrives first', async () => {
        const { store, tripId, row, start } = await first();
        const { setQuantity, togglePacked, applyRemoteUpsert } = store.getState();
        setQuantity(tripId, start.id, 8);
        togglePacked(tripId, start.id);

        applyRemoteUpsert({ ...start, quantity: 8 });

        expect(row()).toMatchObject({ quantity: 8, isPacked: true });
      });

      it('keeps a category marked packed when an older echo arrives', async () => {
        const { store, tripId, row, start } = await first();
        const { togglePacked, markCategoryPacked, applyRemoteUpsert } = store.getState();
        togglePacked(tripId, start.id);
        togglePacked(tripId, start.id);
        markCategoryPacked(tripId, start.category, [start.id]);

        applyRemoteUpsert({ ...start, isPacked: true });
        applyRemoteUpsert({ ...start, isPacked: false });

        expect(row().isPacked).toBe(true);
      });

      it('takes a value from another device that this tab never wrote', async () => {
        const { store, tripId, row, start } = await first();
        store.getState().setQuantity(tripId, start.id, 8);

        store.getState().applyRemoteUpsert({ ...start, quantity: 20 });

        expect(row().quantity).toBe(20);
      });

      it('takes remote values again once its own echo has arrived', async () => {
        const { store, tripId, row, start } = await first();
        store.getState().setQuantity(tripId, start.id, 8);
        store.getState().applyRemoteUpsert({ ...start, quantity: 8 });

        store.getState().applyRemoteUpsert({ ...start });

        expect(row().quantity).toBe(start.quantity);
      });

      // The echo is lost (socket down), a reload shows the saved value, then another
      // device sets the old value back.
      it.each([
        ['tick', (ctx: Setup, id: string) => ctx.store.getState().togglePacked(ctx.tripId, id)],
        [
          'quantity',
          (ctx: Setup, id: string) => ctx.store.getState().setQuantity(ctx.tripId, id, 8),
        ],
        [
          'mark all',
          (ctx: Setup, id: string) =>
            ctx.store.getState().markCategoryPacked(ctx.tripId, ctx.rows()[0].category, [id]),
        ],
      ])('takes the old value back after a lost %s echo and a reload', async (_name, write) => {
        const ctx = await first();
        write(ctx, ctx.start.id);
        await flush();
        fetchTripMock.mockResolvedValue({
          trip: ctx.store.getState().trips[ctx.tripId],
          items: ctx.rows(),
        });
        await ctx.store.getState().loadTrip(ctx.tripId);

        ctx.store.getState().applyRemoteUpsert({ ...ctx.start });

        expect(ctx.row()).toEqual(ctx.start);
      });

      it('still skips the older echo of a write made while a reload was running', async () => {
        const { store, tripId, rows, row, start } = await first();
        const fetched = deferred<{ trip: SavedTrip; items: PackingItem[] }>();
        fetchTripMock.mockReturnValue(fetched.promise);
        const loading = store.getState().loadTrip(tripId);
        const before = { trip: store.getState().trips[tripId], items: rows() };
        store.getState().setQuantity(tripId, start.id, 8);
        store.getState().setQuantity(tripId, start.id, 9);
        fetched.resolve(before);
        await loading;

        store.getState().applyRemoteUpsert({ ...start, quantity: 8 });

        expect(row().quantity).toBe(9);
      });

      it('stops waiting for an echo that never came', async () => {
        const { store, tripId, row, start } = await first();
        store.getState().setQuantity(tripId, start.id, 8);
        vi.setSystemTime(new Date(Date.now() + 11_000));

        store.getState().applyRemoteUpsert({ ...start });

        expect(row().quantity).toBe(start.quantity);
      });

      it('takes remote values after its write failed', async () => {
        const { store, tripId, row, start } = await first();
        updateItemMock.mockRejectedValueOnce(new Error('offline'));
        store.getState().setQuantity(tripId, start.id, 8);
        await flush();

        store.getState().applyRemoteUpsert({ ...start });

        expect(row().quantity).toBe(start.quantity);
      });
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

    const preferences = (...ids: string[]) => ({
      currentMember: Object.fromEntries(ids.map((id) => [id, 'a1'])),
      aiStatus: Object.fromEntries(ids.map((id) => [id, 'ok'])),
      recent: Object.fromEntries(ids.map((id) => [id, NOW])),
    });
    const remembering = (...ids: string[]) =>
      emptyStore(JSON.stringify({ state: preferences(...ids), version: 2 }));

    it('forgets only the given trips in recent, currentMember and aiStatus', () => {
      const { store } = remembering('t1', 't2', 't3');

      store.getState().forgetTrips(['t1', 't3']);

      const { currentMember, aiStatus, recent } = store.getState();
      expect({ currentMember, aiStatus, recent }).toStrictEqual(preferences('t2'));
    });

    it('removes forgotten trips from the persisted blob', () => {
      const { mem, store } = remembering('t1', 't2');

      store.getState().forgetTrips(['t1']);

      expect(savedBlob(mem)).toStrictEqual({ state: preferences('t2'), version: 2 });
    });

    it.each([
      ['unknown ids', ['no-trip']],
      ['an empty array', []],
    ])('leaves the state unchanged when forgetting %s', (_label, ids) => {
      const { store } = remembering('t1', 't2');
      const before = store.getState();

      store.getState().forgetTrips(ids);

      expect(store.getState()).toEqual(before);
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
