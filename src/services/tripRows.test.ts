import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackingItem } from '../engine/types';
import type { Tables } from '../lib/database.types';
import { deletedItemId, itemToRow, rowToItem, rowToTrip, tripToRow } from './tripRows';
import type { SavedTrip } from './tripRows';

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2026-11-27T10:00:00.000Z';
const DB_CREATED_AT = '2026-11-27T10:00:00.123456+00:00';

const members: SavedTrip['members'] = [
  { id: 'a1', name: 'Anna', kind: 'adult' },
  { id: 'c1', name: 'Max', kind: 'child' },
];
const luggage: SavedTrip['luggage'] = [
  { type: 'carryOn', count: 1 },
  { type: 'checked', count: 1 },
];
const weather: NonNullable<SavedTrip['weather']> = {
  minTemp: 5,
  maxTemp: 12,
  maxPrecipProbability: 60,
  rainDays: 2,
  isSeasonalEstimate: false,
  source: 'forecast',
};

const tripFixture = (overrides: Partial<SavedTrip> = {}): SavedTrip => ({
  id: TRIP_ID,
  city: 'Lisbon',
  country: 'Portugal',
  latitude: 38.72,
  longitude: -9.14,
  startDate: '2026-12-01',
  endDate: '2026-12-07',
  tripType: 'city',
  luggage,
  members,
  notes: 'Museum days',
  weather,
  createdAt: CREATED_AT,
  ...overrides,
});

const tripRow = (overrides: Record<string, unknown> = {}) => ({
  id: TRIP_ID,
  city: 'Lisbon',
  country: 'Portugal',
  latitude: 38.72,
  longitude: -9.14,
  start_date: '2026-12-01',
  end_date: '2026-12-07',
  trip_type: 'city',
  luggage,
  members,
  notes: 'Museum days',
  weather_summary: weather,
  created_at: DB_CREATED_AT,
  ...overrides,
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
  isPacked: true,
  source: 'rules',
  reason: 'Rain expected on 2 days',
  ...overrides,
});

const itemRow = (overrides: Record<string, unknown> = {}): Tables<'packing_items'> => ({
  id: ITEM_ID,
  trip_id: TRIP_ID,
  key: 'rain-jacket',
  title: 'Rain jacket',
  category: 'clothing',
  scope: 'adult',
  member_id: 'a1',
  quantity: 2,
  is_packed: true,
  source: 'rules',
  reason: 'Rain expected on 2 days',
  created_at: DB_CREATED_AT,
  ...overrides,
});

const withoutCreatedAt = (row: object) =>
  Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'created_at'));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trip rows', () => {
  it('round-trips a trip through a row', () => {
    const trip = tripFixture();
    expect(rowToTrip({ ...tripToRow(trip), created_at: CREATED_AT })).toEqual(trip);
  });

  it('round-trips a row through a trip, leaving created_at to the database', () => {
    const row = tripRow();
    expect(tripToRow(rowToTrip(row)!)).toStrictEqual(withoutCreatedAt(row));
  });

  it('turns a Postgres timestamp into a Z ISO string', () => {
    expect(rowToTrip(tripRow())?.createdAt).toBe('2026-11-27T10:00:00.123Z');
  });

  it('drops null country and notes, and writes missing ones as null', () => {
    const trip = rowToTrip(tripRow({ country: null, notes: null }));
    expect(trip).not.toBeNull();
    expect(trip).not.toHaveProperty('country');
    expect(trip).not.toHaveProperty('notes');
    const row = tripToRow(tripFixture({ country: undefined, notes: undefined }));
    expect(row.country).toBeNull();
    expect(row.notes).toBeNull();
  });

  it('keeps a null weather_summary as null weather and back', () => {
    expect(rowToTrip(tripRow({ weather_summary: null }))?.weather).toBeNull();
    expect(tripToRow(tripFixture({ weather: null })).weather_summary).toBeNull();
  });

  it('ignores extra columns', () => {
    const trip = rowToTrip(tripRow({ owner: 'x' }));
    expect(trip).not.toBeNull();
    expect(trip).not.toHaveProperty('owner');
  });

  it.each([
    ['unknown trip_type', { trip_type: 'cruise' }],
    ['no members', { members: [] }],
    ['a luggage count of 0', { luggage: [{ type: 'carryOn', count: 0 }] }],
    ['weather without a source', { weather_summary: { ...weather, source: undefined } }],
    ['end_date before start_date', { end_date: '2026-11-30' }],
  ])('returns null and warns once for %s', (_name, overrides) => {
    expect(rowToTrip(tripRow(overrides))).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe('item rows', () => {
  it('round-trips an item through a row', () => {
    expect(rowToItem(itemToRow(item()))).toEqual(item());
  });

  it('round-trips a row through an item, leaving created_at to the database', () => {
    const row = itemRow();
    expect(itemToRow(rowToItem(row)!)).toStrictEqual(withoutCreatedAt(row));
  });

  it('reads a null member_id as a shared item', () => {
    expect(rowToItem(itemRow({ member_id: null, scope: 'shared' }))).toMatchObject({
      memberId: null,
      scope: 'shared',
    });
  });

  it('ignores extra columns', () => {
    expect(rowToItem({ ...itemRow(), owner: 'x' })).toEqual(item());
  });

  it.each([
    ['category', { category: 'food' }],
    ['scope', { scope: 'everyone' }],
    ['source', { source: 'import' }],
    ['quantity', { quantity: 0 }],
  ])('returns null and warns once for a bad %s', (_name, overrides) => {
    expect(rowToItem(itemRow(overrides))).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe('delete payloads and junk input', () => {
  it('reads the id from a DELETE payload that holds nothing else', () => {
    expect(deletedItemId({ id: ITEM_ID })).toBe(ITEM_ID);
  });

  it('does not treat a DELETE payload as a full item', () => {
    expect(rowToItem({ id: ITEM_ID })).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('returns no id for a payload without one', () => {
    expect(deletedItemId({})).toBeNull();
    expect(deletedItemId(null)).toBeNull();
  });

  it.each([null, 'x'])('returns null for %s instead of throwing', (input) => {
    expect(rowToTrip(input)).toBeNull();
    expect(rowToItem(input)).toBeNull();
  });
});
