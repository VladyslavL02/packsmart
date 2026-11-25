import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTripWeather,
  historyRanges,
  searchCities,
  seasonalEstimate,
  summarizeDaily,
  summarizeHistory,
  type DailyForecast,
} from './weatherApi'

const TODAY = new Date(2026, 10, 25) // local 2026-11-25

const trip = {
  latitude: 52.52,
  longitude: 13.41,
  startDate: '2026-11-28',
  endDate: '2026-12-01',
}

function daily(overrides: Partial<DailyForecast> = {}): DailyForecast {
  return {
    time: ['2026-11-28', '2026-11-29', '2026-11-30'],
    temperature_2m_max: [10, 12, 8],
    temperature_2m_min: [2, 4, 1],
    precipitation_probability_max: [10, 30, 20],
    precipitation_sum: [0, 0.2, 0],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const ARCHIVE_HOST = 'archive-api.open-meteo.com'
const ARCHIVE_URL = `https://${ARCHIVE_HOST}/v1/archive`
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

const farTrip = {
  latitude: 52.52,
  longitude: 13.41,
  startDate: '2027-07-10',
  endDate: '2027-07-17',
}

type YearOptions = { min: number; max: number; rain: number; days?: number }

// One archive year: constant temperatures, `rain` rainy days first, no probability array.
function historyYear({ min, max, rain, days = 4 }: YearOptions): DailyForecast {
  return {
    time: Array.from({ length: days }, (_, i) => `2025-07-${String(i + 1).padStart(2, '0')}`),
    temperature_2m_max: Array.from({ length: days }, () => max),
    temperature_2m_min: Array.from({ length: days }, () => min),
    precipitation_probability_max: [],
    precipitation_sum: Array.from({ length: days }, (_, i) => (i < rain ? 5 : 0)),
  }
}

function nullYear(days = 4): DailyForecast {
  return {
    time: Array.from({ length: days }, (_, i) => `2025-07-${String(i + 1).padStart(2, '0')}`),
    temperature_2m_max: Array.from({ length: days }, () => null),
    temperature_2m_min: Array.from({ length: days }, () => null),
    precipitation_probability_max: [],
    precipitation_sum: Array.from({ length: days }, () => null),
  }
}

// An archive response body: the real API has no precipitation_probability_max.
function archiveResponse(options: YearOptions): Response {
  const { time, temperature_2m_max, temperature_2m_min, precipitation_sum } = historyYear(options)
  return jsonResponse({
    daily: { time, temperature_2m_max, temperature_2m_min, precipitation_sum },
  })
}

type Route = (url: URL) => Response | Promise<Response>

// Routes fetch by host so tests never touch the network. Unrouted hosts fail loudly.
function routeFetch(routes: { forecast?: Route; archive?: Route }) {
  fetchMock.mockImplementation(async (input: string) => {
    const url = new URL(String(input))
    const route = url.hostname === ARCHIVE_HOST ? routes.archive : routes.forecast
    if (!route) throw new Error(`unrouted fetch: ${url.hostname}`)
    return route(url)
  })
}

const startYear = (url: URL) => (url.searchParams.get('start_date') ?? '').slice(0, 4)

const fetchedUrls = () => fetchMock.mock.calls.map((call) => new URL(String(call[0])))

// A fetch that never settles until the request signal aborts.
function pendingUntilAbort() {
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }),
  )
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('summarizeDaily', () => {
  it('summarizes a normal forecast', () => {
    expect(summarizeDaily(daily())).toEqual({
      minTemp: 1,
      maxTemp: 12,
      maxPrecipProbability: 30,
      rainDays: 0,
      isSeasonalEstimate: false,
      source: 'forecast',
    })
  })

  it('ignores nulls while keeping days aligned', () => {
    const result = summarizeDaily(
      daily({
        temperature_2m_max: [null, 12, 8],
        temperature_2m_min: [2, null, 1],
        precipitation_probability_max: [null, 60, null],
        precipitation_sum: [null, null, 3],
      }),
    )
    expect(result).toMatchObject({
      minTemp: 1,
      maxTemp: 12,
      maxPrecipProbability: 60,
      rainDays: 2,
    })
  })

  it('returns null when all temperatures are null', () => {
    const result = summarizeDaily(
      daily({ temperature_2m_max: [null, null, null], temperature_2m_min: [null, null, null] }),
    )
    expect(result).toBeNull()
  })

  it('counts rain from precipitation sum only', () => {
    const result = summarizeDaily(
      daily({ precipitation_probability_max: [null, null, null], precipitation_sum: [1, 0.9, 5] }),
    )
    expect(result?.rainDays).toBe(2)
  })

  it('counts rain from probability only', () => {
    const result = summarizeDaily(
      daily({ precipitation_probability_max: [50, 49, 100], precipitation_sum: [null, null, null] }),
    )
    expect(result?.rainDays).toBe(2)
    expect(result?.maxPrecipProbability).toBe(100)
  })
})

describe('seasonalEstimate', () => {
  it('covers the tropical band', () => {
    const r = seasonalEstimate(1, '2026-07-10')
    expect(r.minTemp).toBeGreaterThanOrEqual(20)
    expect(r).toMatchObject({ isSeasonalEstimate: true, source: 'seasonal' })
  })

  it('covers the temperate band', () => {
    const r = seasonalEstimate(52.5, '2026-07-10')
    expect(r.maxTemp).toBeGreaterThan(20)
    expect(r.minTemp).toBeLessThan(20)
  })

  it('gives a hot summer for the warm northern band (Dubai in July)', () => {
    const r = seasonalEstimate(25.2, '2026-07-10')
    expect(r.maxTemp).toBeGreaterThanOrEqual(33)
    expect(r.minTemp).toBeGreaterThanOrEqual(22)
  })

  it('gives a mild winter for the warm northern band (Cairo in January)', () => {
    const r = seasonalEstimate(30, '2026-01-10')
    expect(r.maxTemp).toBeLessThan(25)
  })

  it('uses the milder southern table (Sydney summer and winter)', () => {
    const summer = seasonalEstimate(-33.9, '2026-01-15')
    expect(summer.maxTemp).toBeGreaterThan(22)
    expect(summer.maxTemp).toBeLessThan(32)
    const winter = seasonalEstimate(-33.9, '2026-07-15')
    expect(winter.minTemp).toBeGreaterThanOrEqual(4)
    expect(winter.maxTemp).toBeLessThanOrEqual(20)
  })

  it('switches from warm to temperate at 35 degrees north', () => {
    const warm = seasonalEstimate(34.9, '2026-07-10')
    const temperate = seasonalEstimate(35.1, '2026-07-10')
    expect(warm.maxTemp).toBeGreaterThan(temperate.maxTemp)
  })

  it('covers the cold band', () => {
    const r = seasonalEstimate(69, '2026-01-10')
    expect(r.maxTemp).toBeLessThan(0)
  })

  it('flips seasons in the southern hemisphere', () => {
    const sydney = seasonalEstimate(-33.9, '2026-01-15')
    const stockholm = seasonalEstimate(59.3, '2026-01-15')
    expect(sydney.maxTemp).toBeGreaterThan(22)
    expect(stockholm.maxTemp).toBeLessThan(0)
  })

  it('handles the equator as tropical', () => {
    const r = seasonalEstimate(0, '2026-03-01')
    expect(r.minTemp).toBeGreaterThanOrEqual(20)
  })

  it('sets rainDays from rain probability', () => {
    expect(seasonalEstimate(1, '2026-06-10').rainDays).toBe(1)
    expect(seasonalEstimate(52, '2026-07-10').rainDays).toBe(0)
  })
})

describe('historyRanges', () => {
  it('uses the last three full years for a trip a few months out', () => {
    expect(historyRanges('2027-07-10', '2027-07-17', TODAY)).toEqual([
      { start: '2026-07-10', end: '2026-07-17' },
      { start: '2025-07-10', end: '2025-07-17' },
      { start: '2024-07-10', end: '2024-07-17' },
    ])
  })

  it('skips a year whose shifted end would be after today', () => {
    expect(historyRanges('2027-11-20', '2027-11-27', TODAY)).toEqual([
      { start: '2025-11-20', end: '2025-11-27' },
      { start: '2024-11-20', end: '2024-11-27' },
      { start: '2023-11-20', end: '2023-11-27' },
    ])
  })

  it('never returns future dates for a trip two years out', () => {
    expect(historyRanges('2028-07-01', '2028-07-08', TODAY)).toEqual([
      { start: '2026-07-01', end: '2026-07-08' },
      { start: '2025-07-01', end: '2025-07-08' },
      { start: '2024-07-01', end: '2024-07-08' },
    ])
  })

  it('clamps a Feb 29 end to Feb 28 one year back', () => {
    const today = new Date(2027, 2, 20) // local 2027-03-20
    const ranges = historyRanges('2028-02-25', '2028-02-29', today)
    expect(ranges[0]).toEqual({ start: '2027-02-25', end: '2027-02-28' })
  })

  it('keeps the leap day in a leap year and clamps in the others', () => {
    expect(historyRanges('2028-02-25', '2028-02-29', TODAY)).toEqual([
      { start: '2026-02-25', end: '2026-02-28' },
      { start: '2025-02-25', end: '2025-02-28' },
      { start: '2024-02-25', end: '2024-02-29' },
    ])
  })

  it('accepts an end exactly 7 days before today', () => {
    expect(historyRanges('2027-11-15', '2027-11-18', TODAY)[0]).toEqual({
      start: '2026-11-15',
      end: '2026-11-18',
    })
  })

  it('rejects an end 6 days before today (archive delay)', () => {
    expect(historyRanges('2027-11-16', '2027-11-19', TODAY)[0]).toEqual({
      start: '2025-11-16',
      end: '2025-11-19',
    })
  })

  it.each([
    ['2027-07-10', '2027-07-17'],
    ['2027-11-20', '2027-11-27'],
    ['2028-07-01', '2028-07-08'],
    ['2031-01-01', '2031-01-05'],
  ])('always returns 3 ranges with descending years for %s..%s', (start, end) => {
    const ranges = historyRanges(start, end, TODAY)
    expect(ranges).toHaveLength(3)
    const years = ranges.map((r) => Number(r.end.slice(0, 4)))
    expect(years[0]).toBeGreaterThan(years[1])
    expect(years[1]).toBeGreaterThan(years[2])
    expect(years[0] - years[1]).toBe(1)
    expect(years[1] - years[2]).toBe(1)
  })
})

describe('summarizeHistory', () => {
  it('averages three years (worked example)', () => {
    const a = daily({
      time: ['d1', 'd2', 'd3', 'd4'],
      temperature_2m_max: [10, 12, 14, 8],
      temperature_2m_min: [2, 4, 1, 3],
      precipitation_probability_max: [],
      precipitation_sum: [0, 2, 0, 0],
    }) // min 1, max 14, rain 1
    const b = daily({
      time: ['d1', 'd2', 'd3', 'd4'],
      temperature_2m_max: [20, 22, 18, 16],
      temperature_2m_min: [10, 12, 9, 11],
      precipitation_probability_max: [],
      precipitation_sum: [1, 1, 0, 0],
    }) // min 9, max 22, rain 2
    const c = daily({
      time: ['d1', 'd2', 'd3', 'd4'],
      temperature_2m_max: [15, 16, 17, 18],
      temperature_2m_min: [5, 6, 7, 8],
      precipitation_probability_max: [],
      precipitation_sum: [0, 0, 0, 0],
    }) // min 5, max 18, rain 0
    expect(summarizeHistory([a, b, c])).toEqual({
      minTemp: 5, // (1 + 9 + 5) / 3
      maxTemp: 18, // (14 + 22 + 18) / 3
      maxPrecipProbability: 25, // 3 rainy days of 12
      rainDays: 1, // (1 + 2 + 0) / 3
      isSeasonalEstimate: true,
      source: 'seasonal',
    })
  })

  it('skips an all-null year without letting it count toward the totals', () => {
    const result = summarizeHistory([
      historyYear({ min: 4, max: 10, rain: 2 }),
      nullYear(),
      historyYear({ min: 8, max: 20, rain: 0 }),
    ])
    expect(result).toEqual({
      minTemp: 6,
      maxTemp: 15,
      maxPrecipProbability: 25, // 2 of 8 days, not 2 of 12
      rainDays: 1,
      isSeasonalEstimate: true,
      source: 'seasonal',
    })
  })

  it('returns null when no year is usable', () => {
    expect(summarizeHistory([nullYear(), nullYear(), nullYear()])).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(summarizeHistory([])).toBeNull()
  })

  it('rounds temperatures to 1 decimal', () => {
    const result = summarizeHistory([
      historyYear({ min: 1, max: 10, rain: 0 }),
      historyYear({ min: 2, max: 10, rain: 0 }),
      historyYear({ min: 2, max: 11, rain: 0 }),
    ])
    expect(result?.minTemp).toBe(1.7) // 5 / 3
    expect(result?.maxTemp).toBe(10.3) // 31 / 3
  })

  it('rounds the average rain days to a whole number', () => {
    const down = summarizeHistory([
      historyYear({ min: 1, max: 2, rain: 1 }),
      historyYear({ min: 1, max: 2, rain: 0 }),
      historyYear({ min: 1, max: 2, rain: 0 }),
    ])
    const up = summarizeHistory([
      historyYear({ min: 1, max: 2, rain: 1 }),
      historyYear({ min: 1, max: 2, rain: 1 }),
      historyYear({ min: 1, max: 2, rain: 0 }),
    ])
    expect(down?.rainDays).toBe(0) // 1/3
    expect(up?.rainDays).toBe(1) // 2/3
  })

  it('derives the probability from the share of rainy days, not from rainDays', () => {
    const result = summarizeHistory([
      historyYear({ min: 1, max: 2, rain: 1 }),
      historyYear({ min: 1, max: 2, rain: 0 }),
      historyYear({ min: 1, max: 2, rain: 0 }),
    ])
    expect(result?.maxPrecipProbability).toBe(8) // 1 of 12 = 8.33
    expect(result?.rainDays).toBe(0)
  })

  it('weights the probability by days when years differ in length', () => {
    const result = summarizeHistory([
      historyYear({ min: 1, max: 2, rain: 4, days: 4 }),
      historyYear({ min: 1, max: 2, rain: 0, days: 2 }),
    ])
    expect(result?.maxPrecipProbability).toBe(67) // 4 of 6, not the 50 of averaged shares
    expect(result?.rainDays).toBe(2)
  })

  it('caps the probability at 100 when every day is rainy', () => {
    const result = summarizeHistory([
      historyYear({ min: 1, max: 2, rain: 4 }),
      historyYear({ min: 1, max: 2, rain: 4 }),
      historyYear({ min: 1, max: 2, rain: 4 }),
    ])
    expect(result?.maxPrecipProbability).toBe(100)
    expect(result?.rainDays).toBe(4)
  })

  it('works with a single usable year', () => {
    expect(summarizeHistory([historyYear({ min: 3, max: 9, rain: 2 })])).toEqual({
      minTemp: 3,
      maxTemp: 9,
      maxPrecipProbability: 50,
      rainDays: 2,
      isSeasonalEstimate: true,
      source: 'seasonal',
    })
  })
})

describe('getTripWeather', () => {
  it('uses the archive, not the forecast, when the trip ends 16 days away', async () => {
    routeFetch({ archive: () => archiveResponse({ min: 5, max: 10, rain: 0 }) })
    const result = await getTripWeather({ ...trip, endDate: '2026-12-11' }, TODAY)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const url of fetchedUrls()) expect(url.hostname).toBe(ARCHIVE_HOST)
    expect(result.source).toBe('seasonal')
  })

  it('averages three archive years for a far trip and sends the expected params', async () => {
    const byYear: Record<string, YearOptions> = {
      '2026': { min: 10, max: 20, rain: 2 },
      '2025': { min: 12, max: 22, rain: 1 },
      '2024': { min: 14, max: 24, rain: 0 },
    }
    routeFetch({ archive: (url) => archiveResponse(byYear[startYear(url)]) })

    const result = await getTripWeather(farTrip, TODAY)

    expect(result).toEqual({
      minTemp: 12,
      maxTemp: 22,
      maxPrecipProbability: 25, // 3 rainy days of 12
      rainDays: 1,
      isSeasonalEstimate: true,
      source: 'seasonal',
    })

    const urls = fetchedUrls()
    expect(urls).toHaveLength(3)
    for (const url of urls) {
      expect(url.origin + url.pathname).toBe(ARCHIVE_URL)
      expect(url.searchParams.get('latitude')).toBe('52.52')
      expect(url.searchParams.get('longitude')).toBe('13.41')
      expect(url.searchParams.get('daily')).toBe(
        'temperature_2m_max,temperature_2m_min,precipitation_sum',
      )
      expect(url.searchParams.get('timezone')).toBe('auto')
    }
    expect(urls.some((u) => u.href.startsWith(FORECAST_URL))).toBe(false)
    const ranges = urls
      .map((u) => `${u.searchParams.get('start_date')}..${u.searchParams.get('end_date')}`)
      .sort()
    expect(ranges).toEqual([
      '2024-07-10..2024-07-17',
      '2025-07-10..2025-07-17',
      '2026-07-10..2026-07-17',
    ])
  })

  const oneYearFails: [string, Route][] = [
    [
      'rejects',
      () => {
        throw new TypeError('network')
      },
    ],
    ['returns HTTP 500', () => new Response('boom', { status: 500 })],
  ]

  it.each(oneYearFails)(
    'averages the other two years when one archive request %s',
    async (_name, failing) => {
      routeFetch({
        archive: (url) => {
          const year = startYear(url)
          if (year === '2024') return failing(url)
          return archiveResponse(
            year === '2026' ? { min: 10, max: 20, rain: 2 } : { min: 12, max: 22, rain: 0 },
          )
        },
      })
      const result = await getTripWeather(farTrip, TODAY)
      expect(result).toEqual({
        minTemp: 11,
        maxTemp: 21,
        maxPrecipProbability: 25, // 2 rainy days of 8
        rainDays: 1,
        isSeasonalEstimate: true,
        source: 'seasonal',
      })
      expect(result).not.toEqual(seasonalEstimate(farTrip.latitude, farTrip.startDate))
    },
  )

  const allYearsFail: [string, Route][] = [
    [
      'reject',
      () => {
        throw new TypeError('network')
      },
    ],
    ['HTTP 500', () => new Response('boom', { status: 500 })],
    ['invalid JSON', () => new Response('not json', { status: 200 })],
    ['schema mismatch', () => jsonResponse({ daily: { time: 'x' } })],
    [
      'all-null temperatures',
      () =>
        jsonResponse({
          daily: {
            time: ['2025-07-10', '2025-07-11'],
            temperature_2m_max: [null, null],
            temperature_2m_min: [null, null],
            precipitation_sum: [null, null],
          },
        }),
    ],
  ]

  it.each(allYearsFail)(
    'falls back to the tables and warns when all three archive requests fail with %s',
    async (_name, failing) => {
      routeFetch({ archive: failing })
      const result = await getTripWeather(farTrip, TODAY)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(result).toEqual(seasonalEstimate(farTrip.latitude, farTrip.startDate))
      expect(console.warn).toHaveBeenCalled()
    },
  )

  it('returns right away when the caller aborts while archive requests are pending', async () => {
    pendingUntilAbort()
    const controller = new AbortController()
    const pending = getTripWeather(farTrip, TODAY, controller.signal)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    controller.abort()
    const result = await pending
    expect(result).toEqual(seasonalEstimate(farTrip.latitude, farTrip.startDate))
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('does not fetch a far trip when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await getTripWeather(farTrip, TODAY, controller.signal)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual(seasonalEstimate(farTrip.latitude, farTrip.startDate))
  })

  const forecastFails: [string, Route][] = [
    [
      'rejects',
      () => {
        throw new TypeError('network')
      },
    ],
    ['returns HTTP 500', () => new Response('boom', { status: 500 })],
  ]

  it.each(forecastFails)(
    'tries the forecast first and falls back to the archive average when it %s',
    async (_name, failing) => {
      routeFetch({
        forecast: failing,
        archive: (url) =>
          archiveResponse(
            startYear(url) === '2025'
              ? { min: 0, max: 10, rain: 1 }
              : { min: 2, max: 12, rain: 1 },
          ),
      })
      const result = await getTripWeather(trip, TODAY)

      const urls = fetchedUrls()
      expect(urls).toHaveLength(4)
      expect(urls[0].origin + urls[0].pathname).toBe(FORECAST_URL)
      for (const url of urls.slice(1)) expect(url.origin + url.pathname).toBe(ARCHIVE_URL)
      expect(urls.slice(1).map((u) => u.searchParams.get('start_date')).sort()).toEqual([
        '2023-11-28',
        '2024-11-28',
        '2025-11-28',
      ])
      expect(result.source).toBe('seasonal')
      expect(result.isSeasonalEstimate).toBe(true)
      expect(result).not.toEqual(seasonalEstimate(trip.latitude, trip.startDate))
      expect(result).toMatchObject({ minTemp: 1.3, maxTemp: 11.3, rainDays: 1 })
    },
  )

  it('falls back to the tables when both the forecast and the archive fail', async () => {
    routeFetch({
      forecast: () => new Response('boom', { status: 500 }),
      archive: () => new Response('boom', { status: 500 }),
    })
    const result = await getTripWeather(trip, TODAY)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result).toEqual(seasonalEstimate(trip.latitude, trip.startDate))
    expect(console.warn).toHaveBeenCalled()
  })

  it('does not call the archive when the forecast succeeds', async () => {
    routeFetch({ forecast: () => jsonResponse({ daily: daily() }) })
    const result = await getTripWeather(trip, TODAY)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.source).toBe('forecast')
  })

  it('fetches when the trip ends exactly 15 days away', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ daily: daily() }))
    await getTripWeather({ ...trip, endDate: '2026-12-10' }, TODAY)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns a forecast and sends the expected params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ daily: daily() }))
    const result = await getTripWeather(trip, TODAY)
    expect(result.source).toBe('forecast')
    expect(result.isSeasonalEstimate).toBe(false)

    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(url.searchParams.get('latitude')).toBe('52.52')
    expect(url.searchParams.get('longitude')).toBe('13.41')
    expect(url.searchParams.get('daily')).toBe(
      'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
    )
    expect(url.searchParams.get('timezone')).toBe('auto')
    expect(url.searchParams.get('start_date')).toBe('2026-11-28')
    expect(url.searchParams.get('end_date')).toBe('2026-12-01')
  })

  it('keeps the real temperatures when precipitation arrays are missing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        daily: {
          time: ['2026-11-28', '2026-11-29'],
          temperature_2m_max: [10, 12],
          temperature_2m_min: [2, 4],
        },
      }),
    )
    const result = await getTripWeather(trip, TODAY)
    expect(result).toEqual({
      minTemp: 2,
      maxTemp: 12,
      maxPrecipProbability: 0,
      rainDays: 0,
      isSeasonalEstimate: false,
      source: 'forecast',
    })
  })

  it('returns right away when the caller aborts mid-request, without waiting for the timeout', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const controller = new AbortController()
    const pending = getTripWeather(trip, TODAY, controller.signal)
    controller.abort()
    const result = await pending
    expect(result.source).toBe('seasonal')
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('does not fetch when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await getTripWeather(trip, TODAY, controller.signal)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.source).toBe('seasonal')
  })

  const fallbackCases: [string, () => void][] = [
    ['fetch rejects', () => fetchMock.mockRejectedValue(new TypeError('network'))],
    ['timeout', () => fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'))],
    ['HTTP 500', () => fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))],
    [
      'HTTP 400',
      () => fetchMock.mockResolvedValue(jsonResponse({ error: true, reason: 'bad' }, 400)),
    ],
    ['invalid JSON', () => fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))],
    ['schema mismatch', () => fetchMock.mockResolvedValue(jsonResponse({ daily: { time: 'x' } }))],
    [
      'all-null data',
      () =>
        fetchMock.mockResolvedValue(
          jsonResponse({
            daily: daily({
              temperature_2m_max: [null, null, null],
              temperature_2m_min: [null, null, null],
            }),
          }),
        ),
    ],
  ]

  it.each(fallbackCases)('falls back to seasonal on %s', async (_name, arrange) => {
    arrange()
    const result = await getTripWeather(trip, TODAY)
    expect(result.source).toBe('seasonal')
    expect(result.isSeasonalEstimate).toBe(true)
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('searchCities', () => {
  it('does not fetch for short or whitespace-only queries', async () => {
    expect(await searchCities('a')).toEqual([])
    expect(await searchCities('   ')).toEqual([])
    expect(await searchCities(' b ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns [] when results is missing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ generationtime_ms: 0.5 }))
    expect(await searchCities('Nowhereville')).toEqual([])
  })

  it('maps results and builds the request URL', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          {
            id: 2950159,
            name: 'Berlin',
            country: 'Germany',
            admin1: 'Berlin',
            latitude: 52.52,
            longitude: 13.41,
            elevation: 74,
          },
        ],
      }),
    )
    const result = await searchCities('  Berlin ')
    expect(result).toEqual([
      {
        id: 2950159,
        name: 'Berlin',
        country: 'Germany',
        admin1: 'Berlin',
        latitude: 52.52,
        longitude: 13.41,
      },
    ])
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.origin + url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search')
    expect(url.searchParams.get('name')).toBe('Berlin')
    expect(url.searchParams.get('count')).toBe('5')
    expect(url.searchParams.get('language')).toBe('en')
    expect(url.searchParams.get('format')).toBe('json')
  })

  it('handles missing country and admin1', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ id: 1, name: 'Somewhere', latitude: 1, longitude: 2 }] }),
    )
    const [city] = await searchCities('Somewhere')
    expect(city.country).toBe('')
    expect('admin1' in city).toBe(false)
  })

  it('returns [] when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'))
    expect(await searchCities('Berlin')).toEqual([])
  })

  it('returns [] when aborted', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    const controller = new AbortController()
    controller.abort()
    expect(await searchCities('Berlin', controller.signal)).toEqual([])
  })
})
