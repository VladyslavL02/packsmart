import type { PackingItem } from '../engine/types';
import type { TablesUpdate } from '../lib/database.types';
import { supabase } from './supabase';
import { deletedItemId, itemToRow, rowToItem, rowToTrip, tripToRow } from './tripRows';
import type { SavedTrip } from './tripRows';

export type TripWithItems = { trip: SavedTrip; items: PackingItem[] };
export type ItemPatch = Partial<Pick<PackingItem, 'isPacked' | 'quantity'>>;
export type TripHandlers = {
  onUpsert: (item: PackingItem) => void;
  onDelete: (id: string) => void;
  /** Database changes started flowing, on join or rejoin: changes made before this weren't delivered. */
  onReady?: () => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(label: string, error: { message: string }): never {
  throw new Error(`[tripRepo] ${label}: ${error.message}`, { cause: error });
}

// Bad rows are dropped; rowToItem already warns about them.
function toItems(rows: unknown[]): PackingItem[] {
  return rows.map(rowToItem).filter((item) => item !== null);
}

export async function insertItems(items: PackingItem[]): Promise<void> {
  if (items.length === 0) {return;}

  // One bulk insert would give every row the same default created_at, leaving their order open.
  const now = Date.now();
  const rows = items.map((item, index) => ({
    ...itemToRow(item),
    created_at: new Date(now + index).toISOString(),
  }));
  const { error } = await supabase.from('packing_items').insert(rows);
  if (error) {fail('insert items', error);}
}

/**
 * If the rules rows can't be saved, the trip is deleted again. This is best effort: the delete
 * is a second request, so a lost connection or a closed tab can leave an empty trip behind.
 */
export async function insertTripWithItems(
  trip: SavedTrip,
  items: PackingItem[],
): Promise<SavedTrip> {
  const { data, error } = await supabase
    .from('trips')
    .insert(tripToRow(trip))
    .select()
    .single();
  if (error) {fail('insert trip', error);}

  try {
    await insertItems(items);
  } catch (itemsError) {
    const rollback = await supabase.from('trips').delete().eq('id', trip.id);
    if (rollback.error) {console.warn('[tripRepo] rollback failed', rollback.error.message);}

    throw itemsError;
  }

  // The returned row carries the database's created_at.
  return rowToTrip(data) ?? trip;
}

export async function fetchTrip(id: string): Promise<TripWithItems | null> {
  // Postgres rejects a malformed uuid with an error; for the user it is just "not found".
  if (!UUID.test(id)) {return null;}

  const [tripResult, itemsResult] = await Promise.all([
    supabase.from('trips').select().eq('id', id).maybeSingle(),
    // id settles the order of rows saved with the same created_at.
    supabase.from('packing_items').select().eq('trip_id', id).order('created_at').order('id'),
  ]);
  if (tripResult.error) {fail('fetch trip', tripResult.error);}
  if (itemsResult.error) {fail('fetch items', itemsResult.error);}

  const trip = tripResult.data ? rowToTrip(tripResult.data) : null;

  return trip ? { trip, items: toItems(itemsResult.data) } : null;
}

/** Ids missing from the result don't exist (or are invalid), so the caller can prune them. */
export async function fetchTripSummaries(ids: string[]): Promise<TripWithItems[]> {
  const valid = ids.filter((id) => UUID.test(id));
  if (valid.length === 0) {return [];}

  const [tripsResult, itemsResult] = await Promise.all([
    supabase.from('trips').select().in('id', valid),
    supabase.from('packing_items').select().in('trip_id', valid),
  ]);
  if (tripsResult.error) {fail('fetch trips', tripsResult.error);}
  if (itemsResult.error) {fail('fetch items', itemsResult.error);}

  const items = toItems(itemsResult.data);

  return tripsResult.data
    .map(rowToTrip)
    .filter((trip) => trip !== null)
    .map((trip) => ({ trip, items: items.filter((item) => item.tripId === trip.id) }));
}

/** Writes only the changed columns, so a stale tab can't overwrite the others. */
export async function updateItems(ids: string[], patch: ItemPatch): Promise<void> {
  const row: TablesUpdate<'packing_items'> = {
    ...(patch.isPacked !== undefined && { is_packed: patch.isPacked }),
    ...(patch.quantity !== undefined && { quantity: patch.quantity }),
  };
  if (ids.length === 0 || Object.keys(row).length === 0) {return;}

  const { error } = await supabase.from('packing_items').update(row).in('id', ids);
  if (error) {fail('update items', error);}
}

export function updateItem(id: string, patch: ItemPatch): Promise<void> {
  return updateItems([id], patch);
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('packing_items').delete().eq('id', id);
  if (error) {fail('delete item', error);}
}

export function subscribeToTrip(tripId: string, handlers: TripHandlers): () => void {
  // As in fetchTrip: such an id has no rows, and would make a broken filter.
  if (!UUID.test(tripId)) {return () => {};}

  const changes = { schema: 'public', table: 'packing_items' } as const;
  const filter = `trip_id=eq.${tripId}`;
  const upsert = (payload: { new: unknown }) => {
    const item = rowToItem(payload.new);
    if (item) {handlers.onUpsert(item);}
  };

  // A unique name: StrictMode mounts twice, and a subscribed channel can't be reused.
  const channel = supabase
    .channel(`trip:${tripId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { ...changes, event: 'INSERT', filter }, upsert)
    .on('postgres_changes', { ...changes, event: 'UPDATE', filter }, upsert)
    // Supabase can't filter deletes, so every delete arrives; the store ignores unknown ids.
    .on('postgres_changes', { ...changes, event: 'DELETE' }, (payload) => {
      const id = deletedItemId(payload.old);
      if (id) {handlers.onDelete(id);}
    })
    // Sent once database changes really flow, which is later than the channel's SUBSCRIBED.
    .on('system', {}, (payload: { extension?: string; status?: string }) => {
      if (payload.extension === 'postgres_changes' && payload.status === 'ok') {
        handlers.onReady?.();
      }
    })
    .subscribe();

  return () => void supabase.removeChannel(channel);
}
