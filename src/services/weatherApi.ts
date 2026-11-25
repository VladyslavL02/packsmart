import { z } from 'zod'
import { daysUntil, shiftYears, toIsoDate } from '../engine/dates'
import type { WeatherSummary } from '../engine/types'

export type City = {
  id: number | string
  name: string
  country: string
  admin1?: string
  latitude: number
  longitude: number
}

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const MAX_FORECAST_DAYS = 15
const FORECAST_TIMEOUT_MS = 8000
// The archive lags real time by a few days, so only use years that ended at least this long ago.
const ARCHIVE_DELAY_DAYS = 7
const HISTORY_YEARS = 3

const GeocodingSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]),
        name: z.string(),
        country: z.string().optional(),
        admin1: z.string().optional(),
        latitude: z.number(),
        longitude: z.number(),
      }),
    )
    .optional(),
})

// Open-Meteo can omit a variable entirely (e.g. precipitation probability for past dates).
// A missing array is treated as "all null", so good temperatures are never thrown away.
const NullableNumbers = z.array(z.number().nullable()).default([])

const DailySchema = z.object({
  time: z.array(z.string()),
  temperature_2m_max: NullableNumbers,
  temperature_2m_min: NullableNumbers,
  precipitation_probability_max: NullableNumbers,
  precipitation_sum: NullableNumbers,
})

const ForecastSchema = z.object({ daily: DailySchema })

export type DailyForecast = z.infer<typeof DailySchema>

/** One Open-Meteo "daily" request, validated. Throws on any failure; callers decide the fallback. */
async function fetchDaily(
  baseUrl: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<DailyForecast> {
  const res = await fetch(`${baseUrl}?${new URLSearchParams(params)}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const parsed = ForecastSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('schema mismatch')
  return parsed.data.daily
}

export async function searchCities(query: string, signal?: AbortSignal): Promise<City[]> {
  const name = query.trim()
  if (name.length < 2) return []
  try {
    const params = new URLSearchParams({ name, count: '5', language: 'en', format: 'json' })
    const res = await fetch(`${GEOCODING_URL}?${params}`, { signal })
    if (!res.ok) return []
    const parsed = GeocodingSchema.safeParse(await res.json())
    if (!parsed.success) return []
    return (parsed.data.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country ?? '',
      ...(r.admin1 ? { admin1: r.admin1 } : {}),
      latitude: r.latitude,
      longitude: r.longitude,
    }))
  } catch {
    return []
  }
}

/** Summarize per day index so min/max/precip arrays stay aligned. Null if no temperatures. */
export function summarizeDaily(daily: DailyForecast): WeatherSummary | null {
  let minTemp = Infinity
  let maxTemp = -Infinity
  let maxProb = 0
  let rainDays = 0
  for (let i = 0; i < daily.time.length; i++) {
    const tMin = daily.temperature_2m_min[i] ?? null
    const tMax = daily.temperature_2m_max[i] ?? null
    const prob = daily.precipitation_probability_max[i] ?? null
    const sum = daily.precipitation_sum[i] ?? null
    if (tMin !== null) minTemp = Math.min(minTemp, tMin)
    if (tMax !== null) maxTemp = Math.max(maxTemp, tMax)
    if (prob !== null) maxProb = Math.max(maxProb, prob)
    if ((sum ?? 0) >= 1 || (prob ?? 0) >= 50) rainDays++
  }
  if (minTemp === Infinity && maxTemp === -Infinity) return null
  // If only one side exists, reuse it so neither value is Infinity.
  if (minTemp === Infinity) minTemp = maxTemp
  if (maxTemp === -Infinity) maxTemp = minTemp
  return {
    minTemp,
    maxTemp,
    maxPrecipProbability: Math.min(100, Math.max(0, maxProb)),
    rainDays,
    isSeasonalEstimate: false,
    source: 'forecast',
  }
}

/**
 * The same dates in the last 3 full years, newest first. Picks the smallest year offset whose
 * end date is already safely in the archive, so a trip 2 years out never asks for future dates.
 */
export function historyRanges(
  startDate: string,
  endDate: string,
  today: Date,
): { start: string; end: string }[] {
  const todayIso = toIsoDate(today)
  let first = 1
  while (daysUntil(todayIso, shiftYears(endDate, -first)) < ARCHIVE_DELAY_DAYS) first++
  return Array.from({ length: HISTORY_YEARS }, (_, i) => ({
    start: shiftYears(startDate, -(first + i)),
    end: shiftYears(endDate, -(first + i)),
  }))
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Average several past years of the same dates. Years with no usable temperatures are skipped.
 * Rain chance is the share of rainy days over all days, because the archive has no probability.
 */
export function summarizeHistory(years: DailyForecast[]): WeatherSummary | null {
  const usable = years.flatMap((year) => {
    const summary = summarizeDaily(year)
    return summary ? [{ summary, days: year.time.length }] : []
  })
  if (usable.length === 0) return null
  const average = (pick: (u: (typeof usable)[number]) => number) =>
    usable.reduce((sum, u) => sum + pick(u), 0) / usable.length
  const totalDays = usable.reduce((sum, u) => sum + u.days, 0)
  const rainyDays = usable.reduce((sum, u) => sum + u.summary.rainDays, 0)
  return {
    minTemp: round1(average((u) => u.summary.minTemp)),
    maxTemp: round1(average((u) => u.summary.maxTemp)),
    maxPrecipProbability: Math.min(100, Math.max(0, Math.round((100 * rainyDays) / totalDays))),
    rainDays: Math.round(average((u) => u.summary.rainDays)),
    isSeasonalEstimate: true,
    source: 'seasonal',
  }
}

type MonthClimate = { min: number; max: number; rainProb: number }

// Index 0 = January, northern-hemisphere seasons.
const TROPICAL: MonthClimate[] = [
  { min: 23, max: 31, rainProb: 40 },
  { min: 23, max: 31, rainProb: 40 },
  { min: 24, max: 32, rainProb: 40 },
  { min: 24, max: 33, rainProb: 50 },
  { min: 25, max: 33, rainProb: 60 },
  { min: 25, max: 32, rainProb: 65 },
  { min: 24, max: 31, rainProb: 65 },
  { min: 24, max: 31, rainProb: 65 },
  { min: 24, max: 31, rainProb: 65 },
  { min: 24, max: 31, rainProb: 60 },
  { min: 24, max: 31, rainProb: 50 },
  { min: 23, max: 31, rainProb: 45 },
]

// Northern subtropics, 23-35 N: Cairo, Dubai, Marrakech, Houston, Delhi, Los Angeles, Shanghai.
// Rough average of those cities: hot dry summers (highs mid-30s), mild winters, little rain.
const WARM: MonthClimate[] = [
  { min: 8, max: 19, rainProb: 25 },
  { min: 9, max: 21, rainProb: 25 },
  { min: 12, max: 24, rainProb: 25 },
  { min: 15, max: 28, rainProb: 20 },
  { min: 19, max: 32, rainProb: 20 },
  { min: 22, max: 35, rainProb: 20 },
  { min: 24, max: 36, rainProb: 30 },
  { min: 24, max: 36, rainProb: 30 },
  { min: 22, max: 34, rainProb: 20 },
  { min: 18, max: 30, rainProb: 15 },
  { min: 13, max: 25, rainProb: 20 },
  { min: 9, max: 20, rainProb: 25 },
]

// Southern hemisphere, 23-45 S: Sydney, Perth, Johannesburg, Buenos Aires, Santiago.
// Mostly coastal, so winters are far milder than a northern table would give. Same indexing as the
// others (index 0 = northern January), so it is flipped by 6 months like the rest.
const SOUTH_MILD: MonthClimate[] = [
  { min: 6, max: 16, rainProb: 40 },
  { min: 7, max: 18, rainProb: 35 },
  { min: 9, max: 20, rainProb: 35 },
  { min: 12, max: 22, rainProb: 35 },
  { min: 14, max: 24, rainProb: 30 },
  { min: 16, max: 26, rainProb: 30 },
  { min: 17, max: 27, rainProb: 30 },
  { min: 17, max: 27, rainProb: 30 },
  { min: 15, max: 25, rainProb: 35 },
  { min: 12, max: 22, rainProb: 35 },
  { min: 9, max: 19, rainProb: 40 },
  { min: 7, max: 16, rainProb: 40 },
]

// Mid-latitudes, 35-55: Rome, Madrid, Berlin, Kyiv, New York, Tokyo, and (flipped) Sydney or Santiago.
const TEMPERATE: MonthClimate[] = [
  { min: 0, max: 6, rainProb: 45 },
  { min: 1, max: 8, rainProb: 40 },
  { min: 3, max: 12, rainProb: 40 },
  { min: 6, max: 16, rainProb: 40 },
  { min: 10, max: 21, rainProb: 45 },
  { min: 13, max: 24, rainProb: 40 },
  { min: 16, max: 27, rainProb: 35 },
  { min: 15, max: 26, rainProb: 40 },
  { min: 12, max: 22, rainProb: 40 },
  { min: 8, max: 16, rainProb: 50 },
  { min: 4, max: 10, rainProb: 50 },
  { min: 1, max: 7, rainProb: 50 },
]

const COLD: MonthClimate[] = [
  { min: -12, max: -4, rainProb: 30 },
  { min: -12, max: -3, rainProb: 30 },
  { min: -8, max: 1, rainProb: 30 },
  { min: -2, max: 6, rainProb: 30 },
  { min: 3, max: 13, rainProb: 35 },
  { min: 8, max: 18, rainProb: 40 },
  { min: 11, max: 21, rainProb: 45 },
  { min: 9, max: 19, rainProb: 45 },
  { min: 5, max: 13, rainProb: 45 },
  { min: 0, max: 6, rainProb: 40 },
  { min: -5, max: 0, rainProb: 35 },
  { min: -10, max: -3, rainProb: 30 },
]

/** Rough climate guess from latitude band and month of `startDate` (UTC-parsed). */
export function seasonalEstimate(latitude: number, startDate: string): WeatherSummary {
  const abs = Math.abs(latitude)
  // The hemispheres differ: northern subtropics are desert-heavy (WARM), the south is mostly coastal.
  const table =
    abs < 23
      ? TROPICAL
      : latitude < 0 && abs < 45
        ? SOUTH_MILD
        : abs < 35
          ? WARM
          : abs < 55
            ? TEMPERATE
            : COLD
  const parsedMonth = Number(startDate.split('-')[1]) - 1
  const month = Number.isInteger(parsedMonth) && parsedMonth >= 0 && parsedMonth < 12 ? parsedMonth : 0
  const index = latitude < 0 ? (month + 6) % 12 : month
  const { min, max, rainProb } = table[index]
  return {
    minTemp: min,
    maxTemp: max,
    maxPrecipProbability: rainProb,
    rainDays: rainProb >= 50 ? 1 : 0,
    isSeasonalEstimate: true,
    source: 'seasonal',
  }
}

export async function getTripWeather(
  trip: { latitude: number; longitude: number; startDate: string; endDate: string },
  today: Date = new Date(),
  signal?: AbortSignal,
): Promise<WeatherSummary> {
  const { latitude, longitude, startDate, endDate } = trip
  // The last resort: pure code, no network, cannot fail.
  const tables = () => seasonalEstimate(latitude, startDate)
  if (signal?.aborted) return tables()

  // Whichever fires first wins: the caller cancelling, or the timeout (fresh for each stage).
  const stageSignal = () => {
    const timeout = AbortSignal.timeout(FORECAST_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }
  const place = { latitude: String(latitude), longitude: String(longitude) }

  // Stage 1: a real forecast, only when the trip is inside the 16-day window.
  if (daysUntil(endDate, toIsoDate(today)) <= MAX_FORECAST_DAYS) {
    try {
      const forecast = summarizeDaily(
        await fetchDaily(
          FORECAST_URL,
          {
            ...place,
            daily:
              'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
            timezone: 'auto',
            start_date: startDate,
            end_date: endDate,
          },
          stageSignal(),
        ),
      )
      if (forecast) return forecast
      console.warn('[weather] forecast had no usable temperatures')
    } catch (error) {
      // A cancel the caller asked for is not a failure worth logging.
      if (signal?.aborted) return tables()
      console.warn('[weather] forecast failed:', error instanceof Error ? error.message : error)
    }
  }

  // Stage 2: the same dates in the last 3 years. One failed year doesn't stop the others.
  const history = stageSignal()
  const settled = await Promise.allSettled(
    historyRanges(startDate, endDate, today).map((range) =>
      fetchDaily(
        ARCHIVE_URL,
        {
          ...place,
          daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
          timezone: 'auto',
          start_date: range.start,
          end_date: range.end,
        },
        history,
      ),
    ),
  )
  if (signal?.aborted) return tables()
  const years = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const averaged = summarizeHistory(years)
  if (averaged) return averaged

  // Stage 3: every source failed.
  console.warn('[weather] fallback to seasonal tables: forecast and history unavailable')
  return tables()
}
