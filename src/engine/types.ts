import { z } from 'zod'

// /add-trip-preset appends to TRIP_TYPES.
export const TRIP_TYPES = ['city', 'mountains', 'beach', 'business'] as const
export const LUGGAGE = ['personal', 'carryOn', 'checked'] as const
export const CATEGORIES = [
  'clothing',
  'toiletries',
  'documents',
  'electronics',
  'health',
  'kids',
  'misc',
] as const

export const TripTypeSchema = z.enum(TRIP_TYPES)
export const LuggageTypeSchema = z.enum(LUGGAGE)
export const CategorySchema = z.enum(CATEGORIES)

export const MemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['adult', 'child']),
})

// A family can bring several bags of the same type, so luggage is a count per type.
export const LuggageEntrySchema = z.object({
  type: LuggageTypeSchema,
  count: z.number().int().min(1),
})

export const TripInputSchema = z
  .object({
    city: z.string().min(1),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    // z.iso.date() rejects impossible dates like 2026-02-31, which Date.UTC would roll over.
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    tripType: TripTypeSchema,
    luggage: z
      .array(LuggageEntrySchema)
      .min(1)
      .refine((entries) => new Set(entries.map((e) => e.type)).size === entries.length, {
        message: 'Each luggage type may be listed only once',
      }),
    members: z.array(MemberSchema).min(1),
    notes: z.string().max(500).optional(),
  })
  .refine((trip) => trip.endDate >= trip.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })

export const WeatherSummarySchema = z.object({
  minTemp: z.number(),
  maxTemp: z.number(),
  maxPrecipProbability: z.number().min(0).max(100),
  rainDays: z.number().int().min(0),
  isSeasonalEstimate: z.boolean(),
  source: z.enum(['forecast', 'seasonal']),
})

export const PackingItemDraftSchema = z.object({
  key: z.string().min(1).nullable(),
  title: z.string().min(1),
  category: CategorySchema,
  scope: z.enum(['shared', 'adult', 'child']),
  memberId: z.string().nullable(),
  quantity: z.number().int().min(1),
  source: z.enum(['rules', 'ai', 'user']),
  reason: z.string().nullable(),
})

// DB row shape, used in Phase 6.
export const PackingItemSchema = PackingItemDraftSchema.extend({
  id: z.string().min(1),
  tripId: z.string().min(1),
  isPacked: z.boolean(),
})

export type TripType = z.infer<typeof TripTypeSchema>
export type LuggageType = z.infer<typeof LuggageTypeSchema>
export type Category = z.infer<typeof CategorySchema>
export type Member = z.infer<typeof MemberSchema>
export type LuggageEntry = z.infer<typeof LuggageEntrySchema>
export type TripInput = z.infer<typeof TripInputSchema>
export type WeatherSummary = z.infer<typeof WeatherSummarySchema>
export type PackingItemDraft = z.infer<typeof PackingItemDraftSchema>
export type PackingItem = z.infer<typeof PackingItemSchema>
