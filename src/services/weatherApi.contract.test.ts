import { describe, expect, it } from 'vitest';
import { generateBasePackingList } from '../engine/generator';
import { PackingItemDraftSchema, TripInputSchema, WeatherSummarySchema } from '../engine/types';
import { seasonalEstimate } from './weatherApi';

const trip = () =>
  TripInputSchema.parse({
    city: 'Lisbon',
    latitude: 38.72,
    longitude: -9.14,
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    tripType: 'city',
    luggage: [{ type: 'carryOn', count: 1 }],
    members: [{ id: 'a1', name: 'Adult a1', kind: 'adult' }],
  });

describe('seasonalEstimate to generator contract', () => {
  it('produces weather the generator turns into non-empty rows that pass PackingItemDraftSchema', () => {
    const input = trip();
    const weather = WeatherSummarySchema.parse(seasonalEstimate(input.latitude, input.startDate));
    const rows = generateBasePackingList(input, weather);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {expect(PackingItemDraftSchema.safeParse(row).success).toBe(true);}
  });
});
