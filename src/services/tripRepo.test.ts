import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PackingItem } from '../engine/types';
import { supabase } from './supabase';
import {
  deleteItem,
  fetchTrip,
  fetchTripSummaries,
  insertItems,
  insertTripWithItems,
  subscribeToTrip,
  updateItem,
  updateItems,
} from './tripRepo';
import { itemToRow, tripToRow } from './tripRows';
import type { SavedTrip } from './tripRows';

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TRIP_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = '2026-11-27T10:00:00.000Z';

const trip = (overrides: Partial<SavedTrip> = {}): SavedTrip => ({
  id: TRIP_ID,
  city: 'Lisbon',
  country: 'Portugal',
  latitude: 38.72,
  longitude: -9.14,
  startDate: '2026-12-01',
  endDate: '2026-12-07',
  tripType: 'city',
  luggage: [{ type: 'carryOn', count: 1 }],
  members: [{ id: 'a1', name: 'Anna', kind: 'adult' }],
  notes: 'Museum days',
  weather: null,
  createdAt: CREATED_AT,
  ...overrides,
});

const tripRow = (overrides: Partial<SavedTrip> = {}) => ({
  ...tripToRow(trip(overrides)),
  created_at: CREATED_AT,
});

const item = (overrides: Partial<PackingItem> = {}): PackingItem => ({
  id: ITEM_ID,
  tripId: TRIP_ID,
  key: 'rain-jacket',
  title: 'Rain jacket',
  category: 'clothing',
  scope: 'adult',
  memberId: 'a1',
  quantity: 2,
  isPacked: false,
  source: 'rules',
  reason: null,
  ...overrides,
});

const itemRow = (overrides: Partial<PackingItem> = {}) => ({
  ...itemToRow(item(overrides)),
  created_at: CREATED_AT,
});

type Table = 'trips' | 'packing_items';
type Result = { data: unknown; error: { message: string } | null };

const ok = (data: unknown = null): Result => ({ data, error: null });
const fail = (message: string): Result => ({ data: null, error: { message } });

const fakeBuilder = (table: Table, result: Result) => {
  const chain = (): Mock<(...args: unknown[]) => unknown> => vi.fn(() => builder);
  const builder: Record<'insert' | 'select' | 'single' | 'maybeSingle' | 'eq' | 'in', Mock> &
    Record<'order' | 'update' | 'delete', Mock> & { table: Table; then: unknown } = {
      table,
      insert: chain(),
      select: chain(),
      single: chain(),
      maybeSingle: chain(),
      eq: chain(),
      in: chain(),
      order: chain(),
      update: chain(),
      delete: chain(),
      then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };

  return builder;
};

// Results are queued per table; each from() call takes the next one.
let queued: Record<Table, Result[]>;
let queries: ReturnType<typeof fakeBuilder>[];

const queue = (table: Table, ...results: Result[]) => queued[table].push(...results);
const tables = () => queries.map((query) => query.table);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  queued = { trips: [], packing_items: [] };
  queries = [];
  vi.mocked(supabase.from).mockImplementation(((table: Table) => {
    const builder = fakeBuilder(table, queued[table].shift() ?? ok());
    queries.push(builder);

    return builder;
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('insertTripWithItems', () => {
  const items = [item(), item({ id: OTHER_ITEM_ID, key: 'socks', title: 'Socks' })];

  it('inserts the trip, then all items in one call, and returns the saved trip', async () => {
    queue('trips', ok(tripRow()));

    await expect(insertTripWithItems(trip(), items)).resolves.toEqual(trip());

    expect(tables()).toEqual(['trips', 'packing_items']);
    expect(queries[0].insert).toHaveBeenCalledWith(tripToRow(trip()));
    expect(queries[0].select).toHaveBeenCalled();
    expect(queries[0].single).toHaveBeenCalled();
    expect(queries[1].insert).toHaveBeenCalledTimes(1);
    expect(queries[1].insert).toHaveBeenCalledWith(
      items.map((row) => ({ ...itemToRow(row), created_at: expect.any(String) })),
    );
  });

  it('deletes the trip and rethrows the items error when the items insert fails', async () => {
    queue('trips', ok(tripRow()), ok());
    queue('packing_items', fail('items failed'));

    await expect(insertTripWithItems(trip(), items)).rejects.toThrow('items failed');

    expect(tables()).toEqual(['trips', 'packing_items', 'trips']);
    expect(queries[2].delete).toHaveBeenCalled();
    expect(queries[2].eq).toHaveBeenCalledWith('id', TRIP_ID);
  });

  it('rethrows the items error even when the rollback delete also fails', async () => {
    queue('trips', ok(tripRow()), fail('delete failed'));
    queue('packing_items', fail('items failed'));

    await expect(insertTripWithItems(trip(), items)).rejects.toThrow('items failed');
    expect(queries[2].delete).toHaveBeenCalled();
  });

  it('neither inserts items nor deletes when the trip insert fails', async () => {
    queue('trips', fail('trip failed'));

    await expect(insertTripWithItems(trip(), items)).rejects.toThrow('trip failed');

    expect(tables()).toEqual(['trips']);
    expect(queries[0].delete).not.toHaveBeenCalled();
  });

  it('skips the items insert for an empty item list', async () => {
    queue('trips', ok(tripRow()));

    await insertTripWithItems(trip(), []);

    expect(tables()).toEqual(['trips']);
  });

  it('returns the saved row, not the input, so created_at is the database value', async () => {
    const createdAt = '2026-11-27T11:00:00.000Z';
    queue('trips', ok({ ...tripRow(), created_at: createdAt }));

    await expect(insertTripWithItems(trip(), items)).resolves.toEqual(trip({ createdAt }));
  });
});

describe('row order', () => {
  it('inserts rows with increasing created_at, so a reload keeps the list order', async () => {
    const rows = [item(), item({ id: OTHER_ITEM_ID, key: 'socks', title: 'Socks' })];

    await insertItems(rows);

    const sent = queries[0].insert.mock.calls[0][0] as { id: string; created_at: string }[];
    expect(sent.map((row) => row.id)).toEqual([ITEM_ID, OTHER_ITEM_ID]);
    expect(Date.parse(sent[1].created_at)).toBeGreaterThan(Date.parse(sent[0].created_at));
  });

  it('sorts fetched items by created_at, then id for rows that share it', async () => {
    queue('trips', ok(tripRow()));
    queue('packing_items', ok([itemRow()]));

    await fetchTrip(TRIP_ID);

    expect(queries[1].order.mock.calls).toEqual([['created_at'], ['id']]);
  });
});

describe('fetchTrip', () => {
  it('returns null for a non-UUID id without querying', async () => {
    await expect(fetchTrip('not-a-uuid')).resolves.toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('queries the trip first, then its items', async () => {
    queue('trips', ok(tripRow()));
    queue('packing_items', ok([itemRow()]));

    await expect(fetchTrip(TRIP_ID)).resolves.toEqual({ trip: trip(), items: [item()] });

    expect(tables()).toEqual(['trips', 'packing_items']);
    expect(queries[0].eq).toHaveBeenCalledWith('id', TRIP_ID);
    expect(queries[1].eq).toHaveBeenCalledWith('trip_id', TRIP_ID);
  });

  it('returns null when there is no trip row', async () => {
    queue('trips', ok(null));
    queue('packing_items', ok([]));

    await expect(fetchTrip(TRIP_ID)).resolves.toBeNull();
  });

  it('drops a bad item row and keeps the rest', async () => {
    queue('trips', ok(tripRow()));
    queue('packing_items', ok([{ ...itemRow({ id: OTHER_ITEM_ID }), quantity: 0 }, itemRow()]));

    await expect(fetchTrip(TRIP_ID)).resolves.toMatchObject({ items: [item()] });
  });

  it('throws when the query errors', async () => {
    queue('trips', fail('read failed'));

    await expect(fetchTrip(TRIP_ID)).rejects.toThrow('read failed');
  });

  it('throws when only the items query errors', async () => {
    queue('trips', ok(tripRow()));
    queue('packing_items', fail('items read failed'));

    await expect(fetchTrip(TRIP_ID)).rejects.toThrow('items read failed');
  });
});

describe('fetchTripSummaries', () => {
  it('returns an empty list without querying when no id is a UUID', async () => {
    await expect(fetchTripSummaries(['nope'])).resolves.toEqual([]);
    await expect(fetchTripSummaries([])).resolves.toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('queries only the UUID ids and groups items per trip', async () => {
    const otherItem = { id: OTHER_ITEM_ID, tripId: OTHER_TRIP_ID };
    queue('trips', ok([tripRow(), tripRow({ id: OTHER_TRIP_ID })]));
    queue('packing_items', ok([itemRow(otherItem), itemRow()]));

    const summaries = await fetchTripSummaries([TRIP_ID, 'nope', OTHER_TRIP_ID]);

    const tripsQuery = queries.find((query) => query.table === 'trips');
    expect(tripsQuery?.in).toHaveBeenCalledWith('id', [TRIP_ID, OTHER_TRIP_ID]);
    expect(summaries).toHaveLength(2);
    expect(summaries).toEqual(
      expect.arrayContaining([
        { trip: trip(), items: [item()] },
        { trip: trip({ id: OTHER_TRIP_ID }), items: [item(otherItem)] },
      ]),
    );
  });

  // An empty list on error would make Recent forget every trip.
  it.each(['trips', 'packing_items'] as const)(
    'throws when the %s query errors',
    async (table) => {
      queue(table, fail('summary read failed'));

      await expect(fetchTripSummaries([TRIP_ID])).rejects.toThrow('summary read failed');
    },
  );
});

describe('item writes', () => {
  it('does nothing when inserting an empty item list', async () => {
    await insertItems([]);

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('bulk inserts items as rows', async () => {
    await insertItems([item()]);

    expect(tables()).toEqual(['packing_items']);
    expect(queries[0].insert).toHaveBeenCalledWith([
      { ...itemToRow(item()), created_at: expect.any(String) },
    ]);
  });

  it.each([
    [{ isPacked: false }, { is_packed: false }],
    [{ quantity: 3 }, { quantity: 3 }],
    [
      { isPacked: true, quantity: 3 },
      { is_packed: true, quantity: 3 },
    ],
  ])('writes only the changed columns for %o', async (patch, columns) => {
    await updateItems([ITEM_ID, OTHER_ITEM_ID], patch);

    expect(tables()).toEqual(['packing_items']);
    expect(queries[0].update.mock.calls[0][0]).toStrictEqual(columns);
    expect(queries[0].in).toHaveBeenCalledWith('id', [ITEM_ID, OTHER_ITEM_ID]);
  });

  it('updates a single item through updateItem', async () => {
    await updateItem(ITEM_ID, { isPacked: true });

    expect(queries[0].update.mock.calls[0][0]).toStrictEqual({ is_packed: true });
    expect(queries[0].in).toHaveBeenCalledWith('id', [ITEM_ID]);
  });

  it('deletes an item by id', async () => {
    await deleteItem(ITEM_ID);

    expect(tables()).toEqual(['packing_items']);
    expect(queries[0].delete).toHaveBeenCalled();
    expect(queries[0].eq).toHaveBeenCalledWith('id', ITEM_ID);
  });

  it.each([
    ['insertItems', () => insertItems([item()])],
    ['updateItems', () => updateItems([ITEM_ID], { isPacked: true })],
    ['deleteItem', () => deleteItem(ITEM_ID)],
  ])('throws when %s gets an error', async (_name, write) => {
    queue('packing_items', fail('write failed'));

    await expect(write()).rejects.toThrow('write failed');
  });
});

describe('subscribeToTrip', () => {
  type Filter = { event: string; schema: string; table: string; filter?: string };
  type Listener = (payload: { new: unknown; old: unknown }) => void;

  const subscribe = (tripId = TRIP_ID, { withReady = true } = {}) => {
    const listeners: { type: string; filter: Filter; callback: Listener }[] = [];
    const channel: { on: Mock; subscribe: Mock } = {
      on: vi.fn((type: string, filter: Filter, callback: Listener) => {
        listeners.push({ type, filter, callback });

        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    vi.mocked(supabase.channel).mockReturnValue(channel as never);
    const onReady = vi.fn();
    const handlers = { onUpsert: vi.fn(), onDelete: vi.fn() };
    // A variable, not an inline literal, so the optional onReady is accepted structurally.
    const passed = withReady ? { ...handlers, onReady } : handlers;
    const unsubscribe = subscribeToTrip(tripId, passed);
    // Plays the part of the server's `system` message.
    const report = (extension: string, status: string) => {
      const found = listeners.find((entry) => entry.type === 'system');
      if (!found) {throw new Error('no system listener');}
      (found.callback as unknown as (payload: object) => void)({ extension, status });
    };
    const listener = (event: string) => {
      const found = listeners.find((entry) => entry.filter.event === event);
      if (!found) {throw new Error(`no ${event} listener`);}

      return found;
    };

    return { channel, handlers, unsubscribe, listener, onReady, report };
  };

  // The channel status 'SUBSCRIBED' comes before the database stream is live.
  it('calls onReady each time the server says the database subscription is live', () => {
    const { onReady, report } = subscribe();
    expect(onReady).not.toHaveBeenCalled();

    report('postgres_changes', 'ok');
    report('postgres_changes', 'ok');

    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['postgres_changes', 'error'],
    ['system', 'ok'],
  ])('does not call onReady for a %s message with status %s', (extension, status) => {
    const { onReady, report } = subscribe();

    report(extension, status);

    expect(onReady).not.toHaveBeenCalled();
  });

  it('does not throw on the live message when the handlers have no onReady', () => {
    const { report } = subscribe(TRIP_ID, { withReady: false });

    expect(() => report('postgres_changes', 'ok')).not.toThrow();
  });

  it('subscribes to inserts and updates filtered by trip id', () => {
    const { channel, listener } = subscribe();

    for (const event of ['INSERT', 'UPDATE']) {
      expect(listener(event).type).toBe('postgres_changes');
      expect(listener(event).filter).toEqual({
        event,
        schema: 'public',
        table: 'packing_items',
        filter: `trip_id=eq.${TRIP_ID}`,
      });
    }
    expect(channel.subscribe).toHaveBeenCalled();
  });

  it('subscribes to deletes without a filter', () => {
    const { listener } = subscribe();

    expect(listener('DELETE').type).toBe('postgres_changes');
    expect(listener('DELETE').filter).toStrictEqual({
      event: 'DELETE',
      schema: 'public',
      table: 'packing_items',
    });
  });

  it.each(['INSERT', 'UPDATE'])('passes a camelCase item to onUpsert on %s', (event) => {
    const { handlers, listener } = subscribe();

    listener(event).callback({ new: itemRow(), old: {} });

    expect(handlers.onUpsert).toHaveBeenCalledWith(item());
  });

  it('passes the deleted id to onDelete', () => {
    const { handlers, listener } = subscribe();

    listener('DELETE').callback({ new: {}, old: { id: ITEM_ID } });

    expect(handlers.onDelete).toHaveBeenCalledWith(ITEM_ID);
  });

  it('ignores invalid payloads', () => {
    const { handlers, listener } = subscribe();

    listener('INSERT').callback({ new: { id: ITEM_ID }, old: {} });
    listener('UPDATE').callback({ new: null, old: {} });
    listener('DELETE').callback({ new: {}, old: {} });

    expect(handlers.onUpsert).not.toHaveBeenCalled();
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });

  it('removes the channel on unsubscribe', () => {
    const { channel, unsubscribe } = subscribe();

    unsubscribe();

    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('uses a new channel name for each subscription to the same trip', () => {
    // StrictMode: subscribe, unsubscribe, subscribe again.
    subscribe().unsubscribe();
    subscribe();

    const names = vi.mocked(supabase.channel).mock.calls.map(([name]) => name);
    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name.startsWith(`trip:${TRIP_ID}:`)).toBe(true);
    }
    expect(names[0]).not.toBe(names[1]);
  });

  it.each(['constructor', 'not-a-uuid'])('opens no channel for the non-UUID id %s', (id) => {
    subscribe(id);

    expect(supabase.channel).not.toHaveBeenCalled();
  });

  it.each(['constructor', 'not-a-uuid'])(
    'returns a safe no-op unsubscribe for the non-UUID id %s',
    (id) => {
      const { unsubscribe } = subscribe(id);

      expect(unsubscribe).not.toThrow();
      expect(supabase.removeChannel).not.toHaveBeenCalled();
    },
  );
});
