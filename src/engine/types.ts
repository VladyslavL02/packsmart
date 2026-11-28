import { z } from 'zod';

// /add-trip-preset appends to TRIP_TYPES.
export const TRIP_TYPES = ['city', 'mountains', 'beach', 'business'] as const;
export const LUGGAGE = ['personal', 'carryOn', 'checked'] as const;
export const CATEGORIES = [
  'clothing',
  'toiletries',
  'documents',
  'electronics',
  'health',
  'kids',
  'misc',
] as const;
// 'everyone' is expanded per member by mergeItems; the DB scope stays shared | adult | child.
export const AI_SCOPES = ['shared', 'everyone', 'adult', 'child'] as const;

// Upper bounds keep a public /api/suggest request from flooding the Gemini prompt.
export const MAX_CITY_LENGTH = 100;
export const MAX_COUNTRY_LENGTH = 100;
export const MAX_MEMBERS = 20;
export const MAX_MEMBER_NAME_LENGTH = 40;

export const TripTypeSchema = z.enum(TRIP_TYPES);
export const LuggageTypeSchema = z.enum(LUGGAGE);
export const CategorySchema = z.enum(CATEGORIES);

export const MemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(MAX_MEMBER_NAME_LENGTH),
  kind: z.enum(['adult', 'child']),
});

// A family can bring several bags of the same type, so luggage is a count per type.
export const LuggageEntrySchema = z.object({
  type: LuggageTypeSchema,
  count: z.number().int().min(1),
});

export const TripInputSchema = z
  .object({
    city: z.string().min(1).max(MAX_CITY_LENGTH),
    // Filled from the picked city (no form field); saved to trips.country.
    country: z.string().max(MAX_COUNTRY_LENGTH).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    // z.iso.date() rejects impossible dates like 2026-02-31, which Date.UTC would roll over.
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    tripType: TripTypeSchema,
    luggage: z
      .array(LuggageEntrySchema)
      .min(1)
      .max(LUGGAGE.length)
      .refine((entries) => new Set(entries.map((e) => e.type)).size === entries.length, {
        message: 'Each luggage type may be listed only once',
      }),
    members: z.array(MemberSchema).min(1).max(MAX_MEMBERS),
    notes: z.string().max(500).optional(),
  })
  .refine((trip) => trip.endDate >= trip.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

export const WeatherSummarySchema = z.object({
  minTemp: z.number(),
  maxTemp: z.number(),
  maxPrecipProbability: z.number().min(0).max(100),
  rainDays: z.number().int().min(0),
  isSeasonalEstimate: z.boolean(),
  source: z.enum(['forecast', 'seasonal']),
});

export const AiScopeSchema = z.enum(AI_SCOPES);

// What /api/suggest returns, before mergeItems expands it per member.
export const AiSuggestionSchema = z.object({
  title: z.string().trim().min(1).max(60),
  category: CategorySchema,
  scope: AiScopeSchema,
  quantity: z.number().int().min(1).max(10).default(1),
  reason: z.string().max(140).nullable(),
});

// A rules-list item as the AI sees it, so it can avoid duplicates and near-duplicates.
export const ExistingItemSchema = z.object({
  title: z.string().min(1).max(60),
  category: CategorySchema,
  reason: z.string().max(140).nullable(),
});

// What /api/suggest reports: 'empty' = Gemini answered with nothing usable,
// 'unavailable' = it could not be reached (no key, HTTP error, timeout…), so the UI can offer a retry.
export const AI_STATUSES = ['ok', 'empty', 'unavailable'] as const;
export const AiStatusSchema = z.enum(AI_STATUSES);

export const SuggestRequestSchema = z.object({
  trip: TripInputSchema,
  weather: WeatherSummarySchema.nullable(),
  existingItems: z.array(ExistingItemSchema).max(150),
});

export const SuggestResponseSchema = z.object({
  items: z.array(AiSuggestionSchema),
  status: AiStatusSchema,
});

export const PackingItemDraftSchema = z.object({
  key: z.string().min(1).nullable(),
  title: z.string().min(1),
  category: CategorySchema,
  scope: z.enum(['shared', 'adult', 'child']),
  memberId: z.string().nullable(),
  quantity: z.number().int().min(1),
  source: z.enum(['rules', 'ai', 'user']),
  reason: z.string().nullable(),
});

// DB row shape, used in Phase 6.
export const PackingItemSchema = PackingItemDraftSchema.extend({
  id: z.string().min(1),
  tripId: z.string().min(1),
  isPacked: z.boolean(),
});

export type TripType = z.infer<typeof TripTypeSchema>;
export type LuggageType = z.infer<typeof LuggageTypeSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Member = z.infer<typeof MemberSchema>;
export type LuggageEntry = z.infer<typeof LuggageEntrySchema>;
export type TripInput = z.infer<typeof TripInputSchema>;
export type WeatherSummary = z.infer<typeof WeatherSummarySchema>;
export type AiScope = z.infer<typeof AiScopeSchema>;
export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;
export type SuggestRequest = z.infer<typeof SuggestRequestSchema>;
export type AiStatus = z.infer<typeof AiStatusSchema>;
export type SuggestResponse = z.infer<typeof SuggestResponseSchema>;
export type PackingItemDraft = z.infer<typeof PackingItemDraftSchema>;
export type PackingItem = z.infer<typeof PackingItemSchema>;
