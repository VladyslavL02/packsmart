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
});

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
        let pending: Promise<string> | null = null;

        const updateItems = (tripId: string, update: (items: PackingItem[]) => PackingItem[]) => {
          set((state) => {
            const items = state.items[tripId];

            return items ? { items: { ...state.items, [tripId]: update(items) } } : state;
          });
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
        const setAiStatus = (tripId: string, status: AiStoreStatus) => {
          set((state) => ({ aiStatus: { ...state.aiStatus, [tripId]: status } }));
        };
        const setLoad = (tripId: string, status: LoadStatus) => {
          set((state) => ({ load: { ...state.load, [tripId]: status } }));
        };

        // After a failed write the screen is ahead of the database, so take the server's rows.
        const reload = async (tripId: string) => {
          try {
            const data = await tripRepo.fetchTrip(tripId);
            if (data) {
              updateItems(tripId, () => data.items);
              set({ saveError: RELOADED_MESSAGE });

              return;
            }
          } catch (error) {
            console.warn('[store] could not reload the list:', error);
          }
          set({ saveError: OFFLINE_MESSAGE });
        };
        // The change is already on screen; this only persists it.
        const save = (tripId: string, write: Promise<void>) => {
          void write.catch((error: unknown) => {
            console.warn('[store] could not save the change:', error);

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
            pending ??= insertTrip(input, weather).finally(() => {
              pending = null;
            });

            return pending;
          },

          loadTrip: async (tripId) => {
            setLoad(tripId, 'loading');
            try {
              const data = await tripRepo.fetchTrip(tripId);
              if (!data) {
                setLoad(tripId, 'missing');

                return;
              }
              set((state) => ({
                trips: { ...state.trips, [tripId]: data.trip },
                items: { ...state.items, [tripId]: data.items },
                load: { ...state.load, [tripId]: 'ready' },
              }));
            } catch (error) {
              console.warn('[store] could not load the trip:', error);
              setLoad(tripId, 'error');
            }
          },

          // Matched by id, so the echo of this tab's own insert doesn't duplicate the row.
          applyRemoteUpsert: (item) => {
            updateItems(item.tripId, (items) =>
              items.some((row) => row.id === item.id)
                ? items.map((row) => (row.id === item.id ? item : row))
                : [...items, item],
            );
          },

          // Every delete arrives, whatever the trip, so an unknown id must change nothing.
          applyRemoteDelete: (itemId) => {
            const tripId = Object.keys(get().items).find((id) => findItem(id, itemId));
            if (tripId) {
              updateItems(tripId, (items) => items.filter((item) => item.id !== itemId));
            }
          },

          clearSaveError: () => {
            set({ saveError: null });
          },

          togglePacked: (tripId, itemId) => {
            const item = findItem(tripId, itemId);
            if (!item) {return;}
            const isPacked = !item.isPacked;
            updateItem(tripId, itemId, (row) => ({ ...row, isPacked }));
            save(tripId, tripRepo.updateItem(itemId, { isPacked }));
          },

          setQuantity: (tripId, itemId, quantity) => {
            // NaN and Infinity would be written as null.
            const clamped = Number.isFinite(quantity)
              ? Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity)))
              : 1;
            if (!findItem(tripId, itemId)) {return;}
            updateItem(tripId, itemId, (row) => ({ ...row, quantity: clamped }));
            save(tripId, tripRepo.updateItem(itemId, { quantity: clamped }));
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
            updateItems(tripId, (items) => [...items, ...rows]);
            save(tripId, tripRepo.insertItems(rows));

            return true;
          },

          markCategoryPacked: (tripId, category, itemIds) => {
            const only = itemIds && new Set(itemIds);
            const ids = (get().items[tripId] ?? [])
              .filter(
                (item) =>
                  item.category === category && !item.isPacked && (!only || only.has(item.id)),
              )
              .map((item) => item.id);
            if (ids.length === 0) {return;}
            const marked = new Set(ids);
            updateItems(tripId, (items) =>
              items.map((item) => (marked.has(item.id) ? { ...item, isPacked: true } : item)),
            );
            save(tripId, tripRepo.updateItems(ids, { isPacked: true }));
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
              // The Realtime echo may have added some of these while the insert was running.
              updateItems(tripId, (items) => {
                const known = new Set(items.map((item) => item.id));

                return [...items, ...rows.filter((row) => !known.has(row.id))];
              });
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
