import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { generateBasePackingList, normalizeTitle } from '../engine/generator';
import { newAiRows } from '../engine/listView';
import { mergeItems } from '../engine/merge';
import { AI_STATUSES, TripInputSchema } from '../engine/types';
import type {
  Category,
  PackingItem,
  PackingItemDraft,
  TripInput,
  WeatherSummary,
} from '../engine/types';
import { fetchAiSuggestions } from '../services/suggestApi';
import * as tripRepo from '../services/tripRepo';
import type { SavedTrip } from '../services/tripRows';

export const MAX_QUANTITY = 99;

export const AI_STORE_STATUSES = ['loading', ...AI_STATUSES] as const;
export type AiStoreStatus = (typeof AI_STORE_STATUSES)[number];

export type LoadStatus = 'loading' | 'ready' | 'missing' | 'error';

const RELOADED_MESSAGE = "Couldn't save — refreshed the list";
const OFFLINE_MESSAGE = "Couldn't save — check your connection";
// After this long an echo counts as lost, so remote values are taken again.
const ECHO_TIMEOUT_MS = 10_000;

type Column = 'isPacked' | 'quantity';
/** Values this tab wrote to one column and hasn't seen come back, oldest first. */
type PendingEcho = {
  base: PackingItem[Column];
  values: PackingItem[Column][];
  sentAt: number;
  /** Number of the latest write, to tell whether a fetch started after it. */
  write: number;
};

/** The only part kept in localStorage: trips and items live in Supabase. */
type Preferences = {
  currentMember: Record<string, string>;
  aiStatus: Record<string, AiStoreStatus>;
  /** Trip id to the time it was last opened on this browser. */
  recent: Record<string, string>;
};

type TripData = Preferences & {
  trips: Record<string, SavedTrip>;
  items: Record<string, PackingItem[]>;
  load: Record<string, LoadStatus>;
  saveError: string | null;
  /** The trip whose write failed, so the message doesn't show on another one. */
  saveErrorTripId: string | null;
};

type TripActions = {
  /** Rejects and keeps nothing if the input is invalid or the save fails. */
  createTrip: (input: TripInput, weather: WeatherSummary | null) => Promise<string>;
  loadTrip: (tripId: string) => Promise<void>;
  applyRemoteUpsert: (item: PackingItem) => void;
  applyRemoteDelete: (itemId: string) => void;
  clearSaveError: () => void;
  togglePacked: (tripId: string, itemId: string) => void;
  setQuantity: (tripId: string, itemId: string, quantity: number) => void;
  deleteItem: (tripId: string, itemId: string) => void;
  /** False when nothing was added: empty title, unknown trip or member, or already on the list. */
  addUserItem: (tripId: string, title: string, memberId: string | null) => boolean;
  /** `itemIds` limits the change to the rows on screen, so a filtered view only ticks what it shows. */
  markCategoryPacked: (tripId: string, category: Category, itemIds?: string[]) => void;
  setCurrentMember: (tripId: string, memberId: string) => void;
  touchTrip: (tripId: string) => void;
  /** Drops the saved preferences of trips that no longer exist. */
  forgetTrips: (tripIds: string[]) => void;
  /** Also the Retry action: sends the current rows and appends only the new AI ones. */
  runAiSuggestions: (tripId: string) => Promise<void>;
};

export type TripState = TripData & TripActions;

const emptyPreferences = (): Preferences => ({ currentMember: {}, aiStatus: {}, recent: {} });

const emptyData = (): TripData => ({
  ...emptyPreferences(),
  trips: {},
  items: {},
  load: {},
  saveError: null,
  saveErrorTripId: null,
});

type ItemsUpdate = (items: PackingItem[]) => PackingItem[];

// Skips rows already there: a Realtime echo or a fetch may have brought them first.
const appendRows = (rows: PackingItem[]): ItemsUpdate => (items) => {
  const known = new Set(items.map((item) => item.id));

  return [...items, ...rows.filter((row) => !known.has(row.id))];
};

const toRows = (tripId: string, drafts: PackingItemDraft[]): PackingItem[] =>
  drafts.map((draft) => ({ ...draft, id: crypto.randomUUID(), tripId, isPacked: false }));

const BACKUP_KEY = 'packsmart-backup';

// Only the outer shape: a wrong shape here discards (and backs up) everything.
const LooseSchema = z.object({
  currentMember: z.record(z.string(), z.unknown()),
  aiStatus: z.record(z.string(), z.unknown()),
  recent: z.record(z.string(), z.unknown()),
});

function validEntries<T>(record: Record<string, unknown>, schema: z.ZodType<T>) {
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, value]) => {
      const result = schema.safeParse(value);

      return result.success ? [[key, result.data] as const] : [];
    }),
  );
}

/**
 * Check the saved blob before it becomes state, one entry at a time. Anything discarded as a whole
 * stays readable in `packsmart-backup`, since the next save overwrites the main key.
 * A saved 'loading' means the page was closed mid-request, so it becomes 'unavailable' (Retry).
 */
function sanitize(persisted: unknown, backup: (raw: unknown) => void): Preferences {
  // Nothing saved yet.
  if (persisted === undefined || persisted === null) {return emptyPreferences();}
  const loose = LooseSchema.safeParse(persisted);
  if (!loose.success) {
    console.warn('[store] discarded invalid saved data');
    backup(persisted);

    return emptyPreferences();
  }
  const aiStatus = validEntries(loose.data.aiStatus, z.enum(AI_STORE_STATUSES));
  for (const [tripId, status] of Object.entries(aiStatus)) {
    if (status === 'loading') {aiStatus[tripId] = 'unavailable';}
  }

  return {
    currentMember: validEntries(loose.data.currentMember, z.string()),
    aiStatus,
    recent: validEntries(loose.data.recent, z.iso.datetime()),
  };
}

// Version 1 kept whole trips here. Only the preferences and the opened times carry over.
const V1Schema = z.object({
  trips: z.record(z.string(), z.unknown()),
  currentMember: z.record(z.string(), z.unknown()),
  aiStatus: z.record(z.string(), z.unknown()),
});

function migrateV1(persisted: unknown): unknown {
  const v1 = V1Schema.safeParse(persisted);
  if (!v1.success) {return persisted;}
  const recent = Object.fromEntries(
    Object.entries(v1.data.trips).flatMap(([tripId, trip]) => {
      const parsed = z.object({ lastOpenedAt: z.iso.datetime() }).safeParse(trip);

      return parsed.success ? [[tripId, parsed.data.lastOpenedAt] as const] : [];
    }),
  );

  return { currentMember: v1.data.currentMember, aiStatus: v1.data.aiStatus, recent };
}

/**
 * A full or blocked storage must not break the click that saved; the change stays in memory.
 * Text that isn't JSON is backed up and read as "nothing saved", since the next save overwrites it.
 */
function safeStorage(storage: StateStorage): StateStorage {
  return {
    getItem: (name) => {
      const raw = storage.getItem(name);
      if (typeof raw !== 'string') {return raw;}
      try {
        JSON.parse(raw);

        return raw;
      } catch {
        console.warn('[store] discarded saved data that is not JSON');
        try {
          void storage.setItem(BACKUP_KEY, raw);
        } catch {
          // Best effort only.
        }

        return null;
      }
    },
    removeItem: (name) => storage.removeItem(name),
    setItem: (name, value) => {
      try {
        return storage.setItem(name, value);
      } catch (error) {
        console.warn('[store] could not save:', error);
      }
    },
  };
}

/** A factory so tests get an isolated store; the app uses `useTripStore`. */
export function createTripStore(getStorage: () => StateStorage = () => localStorage) {
  return create<TripState>()(
    persist(
      (set, get) => {
        let pending: { key: string; promise: Promise<string> } | null = null;

        // One list per running fetch: what changed while it ran, to apply on top of its result.
        const journals = new Map<string, Set<ItemsUpdate[]>>();
        const setItems = (tripId: string, update: ItemsUpdate) => {
          set((state) => {
            const items = state.items[tripId];

            return items ? { items: { ...state.items, [tripId]: update(items) } } : state;
          });
        };
        const updateItems = (tripId: string, update: ItemsUpdate) => {
          journals.get(tripId)?.forEach((journal) => journal.push(update));
          setItems(tripId, update);
        };
        // Responses can arrive out of order: one is stale if a later request's was applied first.
        const started = new Map<string, number>();
        const applied = new Map<string, number>();
        const startFetch = (tripId: string) => {
          const order = (started.get(tripId) ?? 0) + 1;
          started.set(tripId, order);

          return {
            isStale: () => order < (applied.get(tripId) ?? 0),
            markApplied: () => applied.set(tripId, order),
          };
        };
        // The response can be older than changes made meanwhile, here or on another device.
        const fetchLatest = async (tripId: string) => {
          const journal: ItemsUpdate[] = [];
          const open = journals.get(tripId) ?? new Set<ItemsUpdate[]>();
          journals.set(tripId, open.add(journal));
          try {
            const data = await tripRepo.fetchTrip(tripId);

            return data && {
              trip: data.trip,
              items: journal.reduce((items, update) => update(items), data.items),
            };
          } finally {
            open.delete(journal);
            if (open.size === 0) {journals.delete(tripId);}
          }
        };
        const updateItem = (
          tripId: string,
          itemId: string,
          update: (item: PackingItem) => PackingItem,
        ) => {
          updateItems(tripId, (items) =>
            items.map((item) => (item.id === itemId ? update(item) : item)),
          );
        };
        const findItem = (tripId: string, itemId: string) =>
          get().items[tripId]?.find((item) => item.id === itemId);

        // Row id to the writes whose Realtime echo is still on its way.
        const echoes = new Map<string, Partial<Record<Column, PendingEcho>>>();
        let writes = 0;
        // Server rows replace the screen, so stop waiting for echoes of writes made before
        // the fetch: if one was lost, it must not hide a later change from another device.
        const forgetEchoes = (rows: PackingItem[], writesBeforeFetch: number) => {
          for (const { id } of rows) {
            for (const column of ['isPacked', 'quantity'] as const) {
              const echo = echoes.get(id)?.[column];
              if (echo && echo.write <= writesBeforeFetch) {delete echoes.get(id)?.[column];}
            }
          }
        };
        const pendingEcho = (itemId: string, column: Column) => {
          const echo = echoes.get(itemId)?.[column];

          return echo && Date.now() - echo.sentAt < ECHO_TIMEOUT_MS ? echo : undefined;
        };
        // Call before the change is on screen: `item` still holds the old value.
        const expectEcho = <C extends Column>(
          item: PackingItem,
          column: C,
          value: PackingItem[C],
        ) => {
          const echo = pendingEcho(item.id, column);
          echoes.set(item.id, {
            ...echoes.get(item.id),
            [column]: {
              base: echo ? echo.base : item[column],
              values: [...(echo?.values ?? []), value],
              sentAt: Date.now(),
              write: ++writes,
            },
          });
        };
        // Echoes arrive in write order, so an older one must not undo a newer change.
        const withoutStaleValues = (remote: PackingItem): PackingItem => {
          let item = remote;
          for (const column of ['isPacked', 'quantity'] as const) {
            const echo = pendingEcho(remote.id, column);
            if (!echo) {continue;}
            const latest = echo.values[echo.values.length - 1];
            if (remote[column] === echo.values[0]) {
              echo.base = echo.values[0];
              echo.values = echo.values.slice(1);
            } else if (remote[column] !== echo.base) {
              // A value this tab didn't write: it comes from another device.
              echo.values = [];
            }
            if (echo.values.length === 0) {
              // The last own echo, or another device's value: show what arrived.
              delete echoes.get(remote.id)?.[column];
            } else {
              item = { ...item, [column]: latest };
            }
          }

          return item;
        };
        const setAiStatus = (tripId: string, status: AiStoreStatus) => {
          set((state) => ({ aiStatus: { ...state.aiStatus, [tripId]: status } }));
        };
        const setLoad = (tripId: string, status: LoadStatus) => {
          set((state) => ({ load: { ...state.load, [tripId]: status } }));
        };

        // After a failed write the screen is ahead of the database, so take the server's rows.
        const reload = async (tripId: string) => {
          const request = startFetch(tripId);
          const writesBeforeFetch = writes;
          try {
            const data = await fetchLatest(tripId);
            if (data) {
              if (!request.isStale()) {
                request.markApplied();
                forgetEchoes(data.items, writesBeforeFetch);
                // Not journaled: a load still running started later and has newer rows.
                setItems(tripId, () => data.items);
              }
              set({ saveError: RELOADED_MESSAGE, saveErrorTripId: tripId });

              return;
            }
          } catch (error) {
            console.warn('[store] could not reload the list:', error);
          }
          set({ saveError: OFFLINE_MESSAGE, saveErrorTripId: tripId });
        };
        // The change is already on screen; this only persists it.
        const save = (tripId: string, write: Promise<void>, itemIds: string[] = []) => {
          void write.catch((error: unknown) => {
            console.warn('[store] could not save the change:', error);
            // No echo will come for a failed write.
            itemIds.forEach((id) => echoes.delete(id));

            return reload(tripId);
          });
        };

        // The only place the rules run: existing rows are never regenerated.
        const insertTrip = async (rawInput: TripInput, weather: WeatherSummary | null) => {
          const input = TripInputSchema.parse(rawInput);
          const id = crypto.randomUUID();
          const rows = toRows(id, generateBasePackingList(input, weather));
          const trip = await tripRepo.insertTripWithItems(
            { ...input, id, weather, createdAt: new Date().toISOString() },
            rows,
          );
          set((state) => ({
            trips: { ...state.trips, [id]: trip },
            items: { ...state.items, [id]: rows },
            load: { ...state.load, [id]: 'ready' },
            recent: { ...state.recent, [id]: new Date().toISOString() },
          }));

          return id;
        };

        return {
          ...emptyData(),

          // A double submit gets the running insert instead of starting a second one.
          createTrip: (input, weather) => {
            const key = JSON.stringify([input, weather]);
            if (pending?.key === key) {return pending.promise;}
            const promise = insertTrip(input, weather).finally(() => {
              if (pending?.promise === promise) {pending = null;}
            });
            pending = { key, promise };

            return promise;
          },

          loadTrip: async (tripId) => {
            // A repeat load of a missing trip must not flash the skeleton.
            if (get().load[tripId] !== 'missing') {setLoad(tripId, 'loading');}
            const request = startFetch(tripId);
            const writesBeforeFetch = writes;
            // A result that doesn't count must not leave the status on 'loading'.
            const settle = () => {
              if (get().load[tripId] === 'loading' && get().items[tripId]) {
                setLoad(tripId, 'ready');
              }
            };
            try {
              const data = await fetchLatest(tripId);
              if (request.isStale()) {
                settle();

                return;
              }
              request.markApplied();
              if (!data) {
                setLoad(tripId, 'missing');

                return;
              }
              forgetEchoes(data.items, writesBeforeFetch);
              set((state) => ({
                trips: { ...state.trips, [tripId]: data.trip },
                items: { ...state.items, [tripId]: data.items },
                load: { ...state.load, [tripId]: 'ready' },
              }));
            } catch (error) {
              console.warn('[store] could not load the trip:', error);
              // A trip already on screen stays usable.
              if (!request.isStale() && !get().items[tripId]) {
                setLoad(tripId, 'error');
              } else {
                settle();
              }
            }
          },

          // Matched by id, so the echo of this tab's own insert doesn't duplicate the row.
          applyRemoteUpsert: (remote) => {
            const item = withoutStaleValues(remote);
            updateItems(item.tripId, (items) =>
              items.some((row) => row.id === item.id)
                ? items.map((row) => (row.id === item.id ? item : row))
                : [...items, item],
            );
          },

          // Every delete arrives, whatever the trip, so an unknown id must change nothing.
          applyRemoteDelete: (itemId) => {
            const remove: ItemsUpdate = (items) => items.filter((item) => item.id !== itemId);
            // The payload has no trip id, and a first load has no rows to find it in.
            journals.forEach((open) => open.forEach((journal) => journal.push(remove)));
            const tripId = Object.keys(get().items).find((id) => findItem(id, itemId));
            if (tripId) {setItems(tripId, remove);}
          },

          clearSaveError: () => {
            set({ saveError: null, saveErrorTripId: null });
          },

          togglePacked: (tripId, itemId) => {
            const item = findItem(tripId, itemId);
            if (!item) {return;}
            const isPacked = !item.isPacked;
            expectEcho(item, 'isPacked', isPacked);
            updateItem(tripId, itemId, (row) => ({ ...row, isPacked }));
            save(tripId, tripRepo.updateItem(itemId, { isPacked }), [itemId]);
          },

          setQuantity: (tripId, itemId, quantity) => {
            // NaN and Infinity would be written as null.
            const clamped = Number.isFinite(quantity)
              ? Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity)))
              : 1;
            const item = findItem(tripId, itemId);
            if (!item) {return;}
            expectEcho(item, 'quantity', clamped);
            updateItem(tripId, itemId, (row) => ({ ...row, quantity: clamped }));
            save(tripId, tripRepo.updateItem(itemId, { quantity: clamped }), [itemId]);
          },

          deleteItem: (tripId, itemId) => {
            if (!findItem(tripId, itemId)) {return;}
            updateItems(tripId, (items) => items.filter((item) => item.id !== itemId));
            save(tripId, tripRepo.deleteItem(itemId));
          },

          addUserItem: (tripId, title, memberId) => {
            const trip = get().trips[tripId];
            const trimmed = title.trim();
            if (!trip || !trimmed) {return false;}
            const member = trip.members.find((m) => m.id === memberId);
            if (memberId !== null && !member) {return false;}
            const normalized = normalizeTitle(trimmed);
            const exists = (get().items[tripId] ?? []).some(
              (item) => item.memberId === memberId && normalizeTitle(item.title) === normalized,
            );
            if (exists) {return false;}
            const rows = toRows(tripId, [
              {
                key: null,
                title: trimmed,
                category: 'misc',
                scope: member?.kind ?? 'shared',
                memberId,
                quantity: 1,
                source: 'user',
                reason: null,
              },
            ]);
            updateItems(tripId, appendRows(rows));
            save(tripId, tripRepo.insertItems(rows));

            return true;
          },

          markCategoryPacked: (tripId, category, itemIds) => {
            const only = itemIds && new Set(itemIds);
            const unpacked = (get().items[tripId] ?? []).filter(
              (item) =>
                item.category === category && !item.isPacked && (!only || only.has(item.id)),
            );
            if (unpacked.length === 0) {return;}
            unpacked.forEach((item) => expectEcho(item, 'isPacked', true));
            const ids = unpacked.map((item) => item.id);
            const marked = new Set(ids);
            updateItems(tripId, (items) =>
              items.map((item) => (marked.has(item.id) ? { ...item, isPacked: true } : item)),
            );
            save(tripId, tripRepo.updateItems(ids, { isPacked: true }), ids);
          },

          setCurrentMember: (tripId, memberId) => {
            set((state) => ({ currentMember: { ...state.currentMember, [tripId]: memberId } }));
          },

          touchTrip: (tripId) => {
            if (!get().trips[tripId]) {return;}
            set((state) => ({ recent: { ...state.recent, [tripId]: new Date().toISOString() } }));
          },

          forgetTrips: (tripIds) => {
            const gone = new Set(tripIds);
            const keep = <T>(record: Record<string, T>) =>
              Object.fromEntries(Object.entries(record).filter(([id]) => !gone.has(id)));
            set((state) => ({
              currentMember: keep(state.currentMember),
              aiStatus: keep(state.aiStatus),
              recent: keep(state.recent),
            }));
          },

          // Lives in the store, not a component, so navigating away doesn't cancel it.
          runAiSuggestions: async (tripId) => {
            const trip = get().trips[tripId];
            if (!trip || get().aiStatus[tripId] === 'loading') {return;}
            setAiStatus(tripId, 'loading');
            try {
              const res = await fetchAiSuggestions(trip, trip.weather, get().items[tripId] ?? []);
              // Re-read: the user may have added or deleted rows while the request was pending.
              const latest = get().items[tripId];
              if (!latest) {return;}
              const merged = mergeItems(latest, res.items, trip.members);
              const rows = toRows(tripId, newAiRows(latest, merged));
              // Saved first: a failed insert leaves the list as it was.
              await tripRepo.insertItems(rows);
              updateItems(tripId, appendRows(rows));
              setAiStatus(tripId, res.status);
            } catch (error) {
              // Never leave the status stuck on 'loading'.
              console.warn('[store] AI suggestions failed:', error);
              setAiStatus(tripId, 'unavailable');
            }
          },
        };
      },
      {
        name: 'packsmart',
        version: 2,
        storage: createJSONStorage(() => safeStorage(getStorage())),
        partialize: ({ currentMember, aiStatus, recent }) => ({ currentMember, aiStatus, recent }),
        // Without a migrate, a version change would load nothing at all.
        migrate: (persisted, version) =>
          (version === 1 ? migrateV1(persisted) : persisted) as Preferences,
        // merge runs during hydration, before any component reads the state.
        merge: (persisted, current) => ({
          ...current,
          ...sanitize(persisted, (raw) => {
            try {
              getStorage().setItem(BACKUP_KEY, JSON.stringify(raw));
            } catch {
              // Best effort only.
            }
          }),
        }),
      },
    ),
  );
}

export const useTripStore = createTripStore();
