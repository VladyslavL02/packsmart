import { describe, expect, it } from 'vitest';
import {
  AI_SCOPES,
  AiSuggestionSchema,
  CATEGORIES,
  LUGGAGE,
  LuggageEntrySchema,
  PackingItemDraftSchema,
  PackingItemSchema,
  SuggestRequestSchema,
  SuggestResponseSchema,
  TRIP_TYPES,
  TripInputSchema,
  WeatherSummarySchema,
} from './types';

const validWeather = (overrides: Record<string, unknown> = {}) => ({
  minTemp: 8,
  maxTemp: 19,
  maxPrecipProbability: 40,
  rainDays: 2,
  isSeasonalEstimate: false,
  source: 'forecast',
  ...overrides,
});

const validTrip = (overrides: Record<string, unknown> = {}) => ({
  city: 'Lisbon',
  latitude: 38.72,
  longitude: -9.14,
  startDate: '2026-06-01',
  endDate: '2026-06-07',
  tripType: 'city',
  luggage: [{ type: 'carryOn', count: 1 }],
  members: [{ id: 'm1', name: 'Anna', kind: 'adult' }],
  ...overrides,
});

const members = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, name: `Member ${i + 1}`, kind: 'adult' }));

const validDraft = (overrides: Record<string, unknown> = {}) => ({
  key: 'passport',
  title: 'Passport',
  category: 'documents',
  scope: 'adult',
  memberId: 'm1',
  quantity: 1,
  source: 'rules',
  reason: null,
  ...overrides,
});

const validSuggestion = (overrides: Record<string, unknown> = {}) => ({
  title: 'Plug adapter type G',
  category: 'electronics',
  scope: 'shared',
  quantity: 2,
  reason: 'UK sockets differ from EU ones',
  ...overrides,
});

const validItem = (overrides: Record<string, unknown> = {}) => ({
  ...validDraft(),
  id: 'item-1',
  tripId: 'trip-1',
  isPacked: false,
  ...overrides,
});

const without = (obj: Record<string, unknown>, key: string) => {
  const copy = { ...obj };
  delete copy[key];

  return copy;
};

describe('TripInputSchema', () => {
  it('parses a valid trip', () => {
    expect(TripInputSchema.safeParse(validTrip()).success).toBe(true);
  });

  it('allows multiple bags of different types with counts', () => {
    const luggage = [
      { type: 'checked', count: 3 },
      { type: 'carryOn', count: 2 },
    ];
    expect(TripInputSchema.safeParse(validTrip({ luggage })).success).toBe(true);
  });

  it('rejects a luggage count of 0', () => {
    const luggage = [{ type: 'checked', count: 0 }];
    expect(TripInputSchema.safeParse(validTrip({ luggage })).success).toBe(false);
  });

  it('rejects duplicate luggage types', () => {
    const luggage = [
      { type: 'checked', count: 1 },
      { type: 'checked', count: 2 },
    ];
    expect(TripInputSchema.safeParse(validTrip({ luggage })).success).toBe(false);
  });

  it('rejects an endDate earlier than startDate', () => {
    const trip = validTrip({ startDate: '2026-06-05', endDate: '2026-06-04' });
    const result = TripInputSchema.safeParse(trip);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['endDate']);
  });

  it.each(['2026-02-31', '2026-13-01'])('rejects the impossible startDate %s', (startDate) => {
    expect(TripInputSchema.safeParse(validTrip({ startDate })).success).toBe(false);
  });

  it('accepts the leap day 2028-02-29', () => {
    const trip = validTrip({ startDate: '2028-02-29', endDate: '2028-03-01' });
    expect(TripInputSchema.safeParse(trip).success).toBe(true);
  });

  it('accepts an endDate equal to startDate', () => {
    const trip = validTrip({ startDate: '2026-06-05', endDate: '2026-06-05' });
    expect(TripInputSchema.safeParse(trip).success).toBe(true);
  });

  it('rejects an empty luggage array', () => {
    expect(TripInputSchema.safeParse(validTrip({ luggage: [] })).success).toBe(false);
  });

  it('rejects an empty members array', () => {
    expect(TripInputSchema.safeParse(validTrip({ members: [] })).success).toBe(false);
  });

  it('accepts notes of 500 characters', () => {
    const trip = validTrip({ notes: 'a'.repeat(500) });
    expect(TripInputSchema.safeParse(trip).success).toBe(true);
  });

  it('rejects notes of 501 characters', () => {
    const trip = validTrip({ notes: 'a'.repeat(501) });
    expect(TripInputSchema.safeParse(trip).success).toBe(false);
  });

  it('rejects a bad date format', () => {
    const trip = validTrip({ startDate: '2026/06/01' });
    expect(TripInputSchema.safeParse(trip).success).toBe(false);
  });

  it.each([90, -90])('accepts a latitude of %s', (latitude) => {
    expect(TripInputSchema.safeParse(validTrip({ latitude })).success).toBe(true);
  });

  it.each([90.1, -90.1])('rejects a latitude of %s', (latitude) => {
    expect(TripInputSchema.safeParse(validTrip({ latitude })).success).toBe(false);
  });

  it.each([180, -180])('accepts a longitude of %s', (longitude) => {
    expect(TripInputSchema.safeParse(validTrip({ longitude })).success).toBe(true);
  });

  it.each([180.1, -180.1])('rejects a longitude of %s', (longitude) => {
    expect(TripInputSchema.safeParse(validTrip({ longitude })).success).toBe(false);
  });

  it('rejects an unknown tripType', () => {
    expect(TripInputSchema.safeParse(validTrip({ tripType: 'safari' })).success).toBe(false);
  });

  it.each(TRIP_TYPES)('accepts the tripType %s', (tripType) => {
    expect(TripInputSchema.safeParse(validTrip({ tripType })).success).toBe(true);
  });

  it('rejects an empty city', () => {
    expect(TripInputSchema.safeParse(validTrip({ city: '' })).success).toBe(false);
  });

  it('rejects a member with an empty id', () => {
    const members = [{ id: '', name: 'Anna', kind: 'adult' }];
    expect(TripInputSchema.safeParse(validTrip({ members })).success).toBe(false);
  });

  it('rejects a member with an empty name', () => {
    const members = [{ id: 'm1', name: '', kind: 'adult' }];
    expect(TripInputSchema.safeParse(validTrip({ members })).success).toBe(false);
  });

  it('rejects a member with kind pet', () => {
    const members = [{ id: 'm1', name: 'Rex', kind: 'pet' }];
    expect(TripInputSchema.safeParse(validTrip({ members })).success).toBe(false);
  });

  it('accepts a member with kind child', () => {
    const members = [{ id: 'm1', name: 'Mia', kind: 'child' }];
    expect(TripInputSchema.safeParse(validTrip({ members })).success).toBe(true);
  });

  it('rejects a luggage entry with an unknown type', () => {
    const luggage = [{ type: 'trunk', count: 1 }];
    expect(TripInputSchema.safeParse(validTrip({ luggage })).success).toBe(false);
  });

  it('rejects a fractional luggage count', () => {
    const luggage = [{ type: 'checked', count: 1.5 }];
    expect(TripInputSchema.safeParse(validTrip({ luggage })).success).toBe(false);
  });

  it('accepts the largest luggage count the form allows', () => {
    const luggage = [{ type: 'checked', count: 9 }];
    expect(TripInputSchema.safeParse(validTrip({ luggage })).success).toBe(true);
  });

  it('rejects a luggage count above the form maximum', () => {
    const luggage = [{ type: 'checked', count: 10 }];
    expect(TripInputSchema.safeParse(validTrip({ luggage })).success).toBe(false);
  });

  it('accepts a member id of 64 characters and rejects 65', () => {
    const withId = (length: number) =>
      validTrip({ members: [{ id: 'a'.repeat(length), name: 'Ann', kind: 'adult' }] });
    expect(TripInputSchema.safeParse(withId(64)).success).toBe(true);
    expect(TripInputSchema.safeParse(withId(65)).success).toBe(false);
  });

  it.each(LUGGAGE)('accepts %s as a single luggage entry', (type) => {
    const luggage = [{ type, count: 1 }];
    expect(TripInputSchema.safeParse(validTrip({ luggage })).success).toBe(true);
  });

  it.each([
    'city',
    'latitude',
    'longitude',
    'startDate',
    'endDate',
    'tripType',
    'luggage',
    'members',
  ])('rejects a trip missing %s', (field) => {
    expect(TripInputSchema.safeParse(without(validTrip(), field)).success).toBe(false);
  });

  it('accepts a trip without notes', () => {
    expect(TripInputSchema.safeParse(without(validTrip(), 'notes')).success).toBe(true);
  });

  it.each(['city', 'country'])('accepts a %s of 100 characters', (field) => {
    const trip = validTrip({ [field]: 'x'.repeat(100) });
    expect(TripInputSchema.safeParse(trip).success).toBe(true);
  });

  it.each(['city', 'country'])('rejects a %s of 101 characters', (field) => {
    const trip = validTrip({ [field]: 'x'.repeat(101) });
    expect(TripInputSchema.safeParse(trip).success).toBe(false);
  });

  it('accepts 20 members', () => {
    expect(TripInputSchema.safeParse(validTrip({ members: members(20) })).success).toBe(true);
  });

  it('rejects 21 members', () => {
    expect(TripInputSchema.safeParse(validTrip({ members: members(21) })).success).toBe(false);
  });

  it('accepts a member name of 40 characters', () => {
    const trip = validTrip({ members: [{ id: 'm1', name: 'x'.repeat(40), kind: 'adult' }] });
    expect(TripInputSchema.safeParse(trip).success).toBe(true);
  });

  it('rejects a member name of 41 characters', () => {
    const trip = validTrip({ members: [{ id: 'm1', name: 'x'.repeat(41), kind: 'adult' }] });
    expect(TripInputSchema.safeParse(trip).success).toBe(false);
  });

  it('accepts one luggage entry of each type', () => {
    const luggage = LUGGAGE.map((type) => ({ type, count: 1 }));
    expect(TripInputSchema.safeParse(validTrip({ luggage })).success).toBe(true);
  });

  it('reports too_big on luggage for 4 entries', () => {
    const luggage = [...LUGGAGE, LUGGAGE[0]].map((type) => ({ type, count: 1 }));
    const result = TripInputSchema.safeParse(validTrip({ luggage }));
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ code: 'too_big', path: ['luggage'] }),
    );
  });
});

describe('LuggageEntrySchema', () => {
  it('rejects a count of 0', () => {
    expect(LuggageEntrySchema.safeParse({ type: 'checked', count: 0 }).success).toBe(false);
  });

  it('accepts a count of 1', () => {
    expect(LuggageEntrySchema.safeParse({ type: 'checked', count: 1 }).success).toBe(true);
  });
});

describe('WeatherSummarySchema', () => {
  it('parses a valid summary', () => {
    expect(WeatherSummarySchema.safeParse(validWeather()).success).toBe(true);
  });

  it.each([101, -1])('rejects a maxPrecipProbability of %s', (maxPrecipProbability) => {
    expect(WeatherSummarySchema.safeParse(validWeather({ maxPrecipProbability })).success).toBe(
      false,
    );
  });

  it('rejects a fractional rainDays', () => {
    expect(WeatherSummarySchema.safeParse(validWeather({ rainDays: 1.5 })).success).toBe(false);
  });

  it('rejects a negative rainDays', () => {
    expect(WeatherSummarySchema.safeParse(validWeather({ rainDays: -1 })).success).toBe(false);
  });

  it('rejects an unknown source', () => {
    expect(WeatherSummarySchema.safeParse(validWeather({ source: 'guess' })).success).toBe(false);
  });

  it.each([0, 100])('accepts a maxPrecipProbability of %s', (maxPrecipProbability) => {
    expect(WeatherSummarySchema.safeParse(validWeather({ maxPrecipProbability })).success).toBe(
      true,
    );
  });

  it('rejects a summary missing isSeasonalEstimate', () => {
    const weather = without(validWeather(), 'isSeasonalEstimate');
    expect(WeatherSummarySchema.safeParse(weather).success).toBe(false);
  });
});

describe('PackingItemDraftSchema', () => {
  it.each([
    ['category', { category: 'furniture' }],
    ['scope', { scope: 'pet' }],
    ['source', { source: 'magic' }],
    ['title', { title: '' }],
  ])('rejects an invalid %s', (_field, overrides) => {
    expect(PackingItemDraftSchema.safeParse(validDraft(overrides)).success).toBe(false);
  });

  it('rejects a quantity of 0', () => {
    expect(PackingItemDraftSchema.safeParse(validDraft({ quantity: 0 })).success).toBe(false);
  });

  it('rejects a fractional quantity', () => {
    expect(PackingItemDraftSchema.safeParse(validDraft({ quantity: 1.5 })).success).toBe(false);
  });

  it.each(CATEGORIES)('accepts the category %s', (category) => {
    expect(PackingItemDraftSchema.safeParse(validDraft({ category })).success).toBe(true);
  });

  it.each([null, 'Visa required'])('accepts a reason of %s', (reason) => {
    expect(PackingItemDraftSchema.safeParse(validDraft({ reason })).success).toBe(true);
  });

  it('rejects an empty-string key', () => {
    expect(PackingItemDraftSchema.safeParse(validDraft({ key: '' })).success).toBe(false);
  });

  it('parses a draft with null key and null memberId', () => {
    const draft = validDraft({ key: null, memberId: null });
    expect(PackingItemDraftSchema.safeParse(draft).success).toBe(true);
  });
});

describe('PackingItemSchema', () => {
  it('parses a full item', () => {
    expect(PackingItemSchema.safeParse(validItem()).success).toBe(true);
  });

  it.each(['id', 'tripId', 'isPacked'])('rejects an item missing %s', (field) => {
    expect(PackingItemSchema.safeParse(without(validItem(), field)).success).toBe(false);
  });
});

describe('TripInputSchema country', () => {
  it('parses with a country', () => {
    expect(TripInputSchema.safeParse(validTrip({ country: 'Portugal' })).success).toBe(true);
  });

  it('parses without a country', () => {
    expect(TripInputSchema.safeParse(validTrip()).success).toBe(true);
  });
});

describe('AiSuggestionSchema', () => {
  it('parses a valid suggestion', () => {
    expect(AiSuggestionSchema.safeParse(validSuggestion()).success).toBe(true);
  });

  it('defaults quantity to 1', () => {
    const result = AiSuggestionSchema.safeParse(without(validSuggestion(), 'quantity'));
    expect(result.success && result.data.quantity).toBe(1);
  });

  it('trims the title', () => {
    const result = AiSuggestionSchema.safeParse(validSuggestion({ title: '  Plug adapter  ' }));
    expect(result.success && result.data.title).toBe('Plug adapter');
  });

  it('accepts a null reason', () => {
    expect(AiSuggestionSchema.safeParse(validSuggestion({ reason: null })).success).toBe(true);
  });

  it.each(AI_SCOPES)('accepts scope %s', (scope) => {
    expect(AiSuggestionSchema.safeParse(validSuggestion({ scope })).success).toBe(true);
  });

  it.each([
    ['whitespace-only title', { title: '   ' }],
    ['61-char title', { title: 'a'.repeat(61) }],
    ['quantity 0', { quantity: 0 }],
    ['quantity 11', { quantity: 11 }],
    ['fractional quantity', { quantity: 1.5 }],
    ['141-char reason', { reason: 'a'.repeat(141) }],
    ['unknown scope', { scope: 'pets' }],
    ['unknown category', { category: 'garden' }],
  ])('rejects %s', (_name, overrides) => {
    expect(AiSuggestionSchema.safeParse(validSuggestion(overrides)).success).toBe(false);
  });
});

describe('SuggestRequestSchema', () => {
  const existingItem = (overrides: Record<string, unknown> = {}) => ({
    title: 'Passport',
    category: 'documents',
    reason: null,
    ...overrides,
  });

  const validRequest = (overrides: Record<string, unknown> = {}) => ({
    trip: validTrip(),
    weather: validWeather(),
    existingItems: [existingItem()],
    ...overrides,
  });

  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => existingItem({ title: `Item ${i}` }));

  it('parses a valid request', () => {
    expect(SuggestRequestSchema.safeParse(validRequest()).success).toBe(true);
  });

  it('accepts null weather', () => {
    expect(SuggestRequestSchema.safeParse(validRequest({ weather: null })).success).toBe(true);
  });

  it('accepts a string reason up to 140 chars', () => {
    const existingItems = [existingItem({ reason: 'a'.repeat(140) })];
    expect(SuggestRequestSchema.safeParse(validRequest({ existingItems })).success).toBe(true);
  });

  it('accepts 150 existing items but rejects 151', () => {
    const parse = (count: number) =>
      SuggestRequestSchema.safeParse(validRequest({ existingItems: items(count) })).success;
    expect(parse(150)).toBe(true);
    expect(parse(151)).toBe(false);
  });

  it.each([
    ['unknown category', { category: 'garden' }],
    ['empty title', { title: '' }],
    ['141-char reason', { reason: 'a'.repeat(141) }],
  ])('rejects an existing item with %s', (_name, overrides) => {
    const existingItems = [existingItem(overrides)];
    expect(SuggestRequestSchema.safeParse(validRequest({ existingItems })).success).toBe(false);
  });

  it('rejects an invalid nested trip', () => {
    const trip = validTrip({ startDate: '2026-06-07', endDate: '2026-06-01' });
    expect(SuggestRequestSchema.safeParse(validRequest({ trip })).success).toBe(false);
  });

  it('rejects a trip with a 101-character city', () => {
    const trip = validTrip({ city: 'x'.repeat(101) });
    expect(SuggestRequestSchema.safeParse(validRequest({ trip })).success).toBe(false);
  });

  it('rejects a trip with 21 members', () => {
    const trip = validTrip({ members: members(21) });
    expect(SuggestRequestSchema.safeParse(validRequest({ trip })).success).toBe(false);
  });

  it('rejects a missing existingItems', () => {
    expect(SuggestRequestSchema.safeParse(without(validRequest(), 'existingItems')).success).toBe(false);
  });

  it('rejects the old existingTitles shape', () => {
    const old = without(validRequest(), 'existingItems');
    expect(SuggestRequestSchema.safeParse({ ...old, existingTitles: ['Passport'] }).success).toBe(false);
  });
});

describe('SuggestResponseSchema', () => {
  it('accepts empty items with status empty', () => {
    expect(SuggestResponseSchema.safeParse({ items: [], status: 'empty' }).success).toBe(true);
  });

  it('accepts valid items with status ok', () => {
    const body = { items: [validSuggestion()], status: 'ok' };
    expect(SuggestResponseSchema.safeParse(body).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(SuggestResponseSchema.safeParse({ items: [], status: 'weird' }).success).toBe(false);
  });

  it('rejects a missing status', () => {
    expect(SuggestResponseSchema.safeParse({ items: [] }).success).toBe(false);
  });
});
