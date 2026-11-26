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

export const AI_STORE_STATUSES = ['loading', ...AI_STATUSES] as const;
export type AiStoreStatus = (typeof AI_STORE_STATUSES)[number];

const PersistedSchema = z.object({
  trips: z.record(z.string(), StoredTripSchema),
  items: z.record(z.string(), z.array(PackingItemSchema)),
  currentMember: z.record(z.string(), z.string()),
  aiStatus: z.record(z.string(), z.enum(AI_STORE_STATUSES)),
});

type TripData = z.infer<typeof PersistedSchema>;

type TripActions = {
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

/**
 * Check the saved blob before it becomes state: anything invalid starts the app empty.
 * A saved 'loading' means the page was closed mid-request, so it becomes 'unavailable' (Retry).
 */
function sanitize(persisted: unknown): TripData {
  // Nothing saved yet.
  if (persisted === undefined) {return emptyData();}
  const parsed = PersistedSchema.safeParse(persisted);
  if (!parsed.success) {
    console.warn('[store] discarded invalid saved data');

    return emptyData();
  }
  const aiStatus = Object.fromEntries(
    Object.entries(parsed.data.aiStatus).map(([tripId, status]) => [
      tripId,
      status === 'loading' ? ('unavailable' as const) : status,
    ]),
  );

  return { ...parsed.data, aiStatus };
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
          createTrip: (input, weather) => {
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
            // `|| 1` also catches NaN, which Math.max would pass through.
            const clamped = Math.max(1, Math.round(quantity) || 1);
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
        storage: createJSONStorage(getStorage),
        partialize: ({ trips, items, currentMember, aiStatus }) => ({
          trips,
          items,
          currentMember,
          aiStatus,
        }),
        // merge runs during hydration, before any component reads the state.
        merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
      },
    ),
  );
}

export const useTripStore = createTripStore();
