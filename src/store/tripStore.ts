import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { generateBasePackingList, normalizeTitle } from '../engine/generator';
import { newAiRows } from '../engine/listView';
import { mergeItems } from '../engine/merge';
import {
  AI_STATUSES,
  PackingItemSchema,
  TripInputSchema,
  WeatherSummarySchema,
} from '../engine/types';
import type {
  Category,
  PackingItem,
  PackingItemDraft,
  TripInput,
  WeatherSummary,
} from '../engine/types';
import { fetchAiSuggestions } from '../services/suggestApi';

// `.and`, not `.extend`: TripInputSchema is refined, and Zod can't extend a refined object.
export const StoredTripSchema = TripInputSchema.and(
  z.object({
    id: z.string().min(1),
    weather: WeatherSummarySchema.nullable(),
    createdAt: z.iso.datetime(),
    lastOpenedAt: z.iso.datetime(),
  }),
);
export type StoredTrip = z.infer<typeof StoredTripSchema>;

/** A huge quantity fails the schema on reload, which would discard every trip. */
export const MAX_QUANTITY = 99;

export const AI_STORE_STATUSES = ['loading', ...AI_STATUSES] as const;
export type AiStoreStatus = (typeof AI_STORE_STATUSES)[number];

type TripData = {
  trips: Record<string, StoredTrip>;
  items: Record<string, PackingItem[]>;
  currentMember: Record<string, string>;
  aiStatus: Record<string, AiStoreStatus>;
};

type TripActions = {
  /** Throws on input that fails TripInputSchema: once saved, it would discard every trip on reload. */
  createTrip: (input: TripInput, weather: WeatherSummary | null) => string;
  togglePacked: (tripId: string, itemId: string) => void;
  setQuantity: (tripId: string, itemId: string, quantity: number) => void;
  deleteItem: (tripId: string, itemId: string) => void;
  /** False when nothing was added: empty title, unknown trip or member, or already on the list. */
  addUserItem: (tripId: string, title: string, memberId: string | null) => boolean;
  /** `itemIds` limits the change to the rows on screen, so a filtered view only ticks what it shows. */
  markCategoryPacked: (tripId: string, category: Category, itemIds?: string[]) => void;
  setCurrentMember: (tripId: string, memberId: string) => void;
  touchTrip: (tripId: string) => void;
  /** Also the Retry action: sends the current rows and appends only the new AI ones. */
  runAiSuggestions: (tripId: string) => Promise<void>;
};

export type TripState = TripData & TripActions;

const emptyData = (): TripData => ({ trips: {}, items: {}, currentMember: {}, aiStatus: {} });

const toRows = (tripId: string, drafts: PackingItemDraft[]): PackingItem[] =>
  drafts.map((draft) => ({ ...draft, id: crypto.randomUUID(), tripId, isPacked: false }));

const BACKUP_KEY = 'packsmart-backup';

// Only the outer shape: a wrong shape here discards (and backs up) everything.
const LooseSchema = z.object({
  trips: z.record(z.string(), z.unknown()),
  items: z.record(z.string(), z.unknown()),
  currentMember: z.record(z.string(), z.unknown()),
  aiStatus: z.record(z.string(), z.unknown()),
});

/**
 * Check the saved blob before it becomes state, one trip and one row at a time: an invalid trip
 * or row is dropped on its own, so it can't take every other trip with it. Whatever was dropped
 * stays readable in `packsmart-backup`, since the next save overwrites the main key.
 * A saved 'loading' means the page was closed mid-request, so it becomes 'unavailable' (Retry).
 */
function sanitize(persisted: unknown, backup: (raw: unknown) => void): TripData {
  // Nothing saved yet.
  if (persisted === undefined || persisted === null) {return emptyData();}
  const loose = LooseSchema.safeParse(persisted);
  if (!loose.success) {
    console.warn('[store] discarded invalid saved data');
    backup(persisted);

    return emptyData();
  }
  const data = emptyData();
  let dropped = 0;
  for (const [tripId, raw] of Object.entries(loose.data.trips)) {
    const trip = StoredTripSchema.safeParse(raw);
    if (!trip.success || trip.data.id !== tripId) {
      dropped += 1;
      continue;
    }
    data.trips[tripId] = trip.data;
    const rawItems = loose.data.items[tripId];
    const rows = Array.isArray(rawItems) ? rawItems : [];
    data.items[tripId] = rows.flatMap((row) => {
      const item = PackingItemSchema.safeParse(row);
      if (item.success && item.data.tripId === tripId) {return [item.data];}
      dropped += 1;

      return [];
    });
    const member = loose.data.currentMember[tripId];
    if (typeof member === 'string' && trip.data.members.some((m) => m.id === member)) {
      data.currentMember[tripId] = member;
    }
    const status = z.enum(AI_STORE_STATUSES).safeParse(loose.data.aiStatus[tripId]);
    if (status.success) {
      data.aiStatus[tripId] = status.data === 'loading' ? 'unavailable' : status.data;
    }
  }
  if (dropped > 0) {
    console.warn(`[store] dropped ${dropped} invalid saved trip(s) or row(s)`);
    backup(persisted);
  }

  return data;
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
        const setAiStatus = (tripId: string, status: AiStoreStatus) => {
          set((state) => ({ aiStatus: { ...state.aiStatus, [tripId]: status } }));
        };

        return {
          ...emptyData(),

          // The only place the rules run: existing rows are never regenerated.
          createTrip: (rawInput, weather) => {
            const input = TripInputSchema.parse(rawInput);
            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const trip: StoredTrip = { ...input, id, weather, createdAt: now, lastOpenedAt: now };
            const rows = toRows(id, generateBasePackingList(input, weather));
            set((state) => ({
              trips: { ...state.trips, [id]: trip },
              items: { ...state.items, [id]: rows },
            }));

            return id;
          },

          togglePacked: (tripId, itemId) => {
            updateItem(tripId, itemId, (item) => ({ ...item, isPacked: !item.isPacked }));
          },

          setQuantity: (tripId, itemId, quantity) => {
            // NaN and Infinity save as null, which would discard every trip on reload.
            const clamped = Number.isFinite(quantity)
              ? Math.min(MAX_QUANTITY, Math.max(1, Math.round(quantity)))
              : 1;
            updateItem(tripId, itemId, (item) => ({ ...item, quantity: clamped }));
          },

          deleteItem: (tripId, itemId) => {
            updateItems(tripId, (items) => items.filter((item) => item.id !== itemId));
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

            return true;
          },

          markCategoryPacked: (tripId, category, itemIds) => {
            const only = itemIds && new Set(itemIds);
            updateItems(tripId, (items) =>
              items.map((item) =>
                item.category === category && (!only || only.has(item.id))
                  ? { ...item, isPacked: true }
                  : item,
              ),
            );
          },

          setCurrentMember: (tripId, memberId) => {
            set((state) => ({ currentMember: { ...state.currentMember, [tripId]: memberId } }));
          },

          touchTrip: (tripId) => {
            set((state) => {
              const trip = state.trips[tripId];
              if (!trip) {return state;}
              const touched = { ...trip, lastOpenedAt: new Date().toISOString() };

              return { trips: { ...state.trips, [tripId]: touched } };
            });
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
              updateItems(tripId, (items) => [...items, ...rows]);
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
        version: 1,
        storage: createJSONStorage(() => safeStorage(getStorage())),
        partialize: ({ trips, items, currentMember, aiStatus }) => ({
          trips,
          items,
          currentMember,
          aiStatus,
        }),
        // Without a migrate, a future version bump would load nothing at all; sanitize keeps what
        // still fits the current schemas.
        migrate: (persisted) => persisted as TripData,
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
