import { z } from 'zod';
import {
  CategorySchema,
  LuggageEntrySchema,
  MemberSchema,
  PackingItemSchema,
  TripInputSchema,
  TripTypeSchema,
  WeatherSummarySchema,
} from '../engine/types';
import type { PackingItem } from '../engine/types';
import type { TablesInsert } from '../lib/database.types';

// `.and`, not `.extend`: TripInputSchema is refined, and Zod can't extend a refined object.
const SavedTripSchema = TripInputSchema.and(
  z.object({
    id: z.string().min(1),
    weather: WeatherSummarySchema.nullable(),
    createdAt: z.iso.datetime(),
  }),
);
export type SavedTrip = z.infer<typeof SavedTripSchema>;

// Plain z.object strips unknown keys, so a new column doesn't break old clients.
const TripRowSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  country: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  trip_type: TripTypeSchema,
  luggage: z.array(LuggageEntrySchema),
  members: z.array(MemberSchema),
  notes: z.string().nullable(),
  weather_summary: WeatherSummarySchema.nullable(),
  // Postgres sends timestamptz with a +00:00 offset.
  created_at: z.iso.datetime({ offset: true }),
});

const ItemRowSchema = z.object({
  id: z.string().min(1),
  trip_id: z.string().min(1),
  key: z.string().nullable(),
  title: z.string(),
  category: CategorySchema,
  scope: PackingItemSchema.shape.scope,
  member_id: z.string().nullable(),
  quantity: z.number().int().min(1),
  is_packed: z.boolean(),
  source: PackingItemSchema.shape.source,
  reason: z.string().nullable(),
});

// With RLS on, a Realtime DELETE carries only the primary key.
const DeletedItemRowSchema = z.object({ id: z.string().min(1) });

function parseOrWarn<T>(schema: z.ZodType<T>, value: unknown, label: string): T | null {
  const result = schema.safeParse(value);
  if (result.success) {return result.data;}
  console.warn(`[tripRows] invalid ${label} row`, result.error.issues);

  return null;
}

export function tripToRow(trip: SavedTrip): TablesInsert<'trips'> {
  return {
    id: trip.id,
    city: trip.city,
    country: trip.country ?? null,
    latitude: trip.latitude,
    longitude: trip.longitude,
    start_date: trip.startDate,
    end_date: trip.endDate,
    trip_type: trip.tripType,
    luggage: trip.luggage,
    members: trip.members,
    notes: trip.notes ?? null,
    weather_summary: trip.weather,
  };
}

export function rowToTrip(value: unknown): SavedTrip | null {
  const row = parseOrWarn(TripRowSchema, value, 'trip');
  if (!row) {return null;}

  // Parsed again so the TripInput refinements (date order, unique bags, 1+ members) apply too.
  return parseOrWarn(
    SavedTripSchema,
    {
      id: row.id,
      city: row.city,
      ...(row.country !== null && { country: row.country }),
      latitude: row.latitude,
      longitude: row.longitude,
      startDate: row.start_date,
      endDate: row.end_date,
      tripType: row.trip_type,
      luggage: row.luggage,
      members: row.members,
      ...(row.notes !== null && { notes: row.notes }),
      weather: row.weather_summary,
      createdAt: new Date(row.created_at).toISOString(),
    },
    'trip',
  );
}

export function itemToRow(item: PackingItem): TablesInsert<'packing_items'> {
  return {
    id: item.id,
    trip_id: item.tripId,
    key: item.key,
    title: item.title,
    category: item.category,
    scope: item.scope,
    member_id: item.memberId,
    quantity: item.quantity,
    is_packed: item.isPacked,
    source: item.source,
    reason: item.reason,
  };
}

export function rowToItem(value: unknown): PackingItem | null {
  const row = parseOrWarn(ItemRowSchema, value, 'item');
  if (!row) {return null;}

  return parseOrWarn(
    PackingItemSchema,
    {
      id: row.id,
      tripId: row.trip_id,
      key: row.key,
      title: row.title,
      category: row.category,
      scope: row.scope,
      memberId: row.member_id,
      quantity: row.quantity,
      isPacked: row.is_packed,
      source: row.source,
      reason: row.reason,
    },
    'item',
  );
}

export function deletedItemId(old: unknown): string | null {
  const result = DeletedItemRowSchema.safeParse(old);

  return result.success ? result.data.id : null;
}
