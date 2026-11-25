import { describe, expect, it } from 'vitest'
import { dedupeItems, generateBasePackingList, normalizeTitle, sortItems } from './generator'
import { CATEGORIES, PackingItemDraftSchema } from './types'
import type { LuggageEntry, Member, PackingItemDraft, TripInput, WeatherSummary } from './types'

// ---------- fixture builders ----------

const adult = (id = 'a1'): Member => ({ id, name: `Adult ${id}`, kind: 'adult' })
const child = (id = 'c1'): Member => ({ id, name: `Child ${id}`, kind: 'child' })

const members = (adults: number, children: number): Member[] => [
  ...Array.from({ length: adults }, (_, i) => adult(`a${i + 1}`)),
  ...Array.from({ length: children }, (_, i) => child(`c${i + 1}`)),
]

const trip = (overrides: Partial<TripInput> = {}): TripInput => ({
  city: 'Lisbon',
  latitude: 38.72,
  longitude: -9.14,
  startDate: '2026-06-01',
  endDate: '2026-06-07',
  tripType: 'city',
  luggage: [{ type: 'carryOn', count: 1 }],
  members: [adult()],
  ...overrides,
})

// Trip lasting exactly `days` days, starting 2026-06-01 (days <= 30).
const tripOfDays = (days: number, overrides: Partial<TripInput> = {}): TripInput =>
  trip({ endDate: `2026-06-${String(days).padStart(2, '0')}`, ...overrides })

const weather = (overrides: Partial<WeatherSummary> = {}): WeatherSummary => ({
  minTemp: 15,
  maxTemp: 22,
  maxPrecipProbability: 10,
  rainDays: 0,
  isSeasonalEstimate: false,
  source: 'forecast',
  ...overrides,
})

const entry = (type: LuggageEntry['type'], count = 1): LuggageEntry => ({ type, count })

const draft = (overrides: Partial<PackingItemDraft> = {}): PackingItemDraft => ({
  key: 'rain-jacket',
  title: 'Rain jacket',
  category: 'clothing',
  scope: 'adult',
  memberId: 'a1',
  quantity: 1,
  source: 'rules',
  reason: null,
  ...overrides,
})

// ---------- helpers ----------

const rowsFor = (items: PackingItemDraft[], key: string): PackingItemDraft[] =>
  items.filter((item) => item.key === key)

const keysIn = (items: PackingItemDraft[]): string[] =>
  items.map((item) => item.key).filter((key): key is string => key !== null)

const rainyMountains = () =>
  generateBasePackingList(
    trip({
      tripType: 'mountains',
      members: members(2, 1),
      luggage: [entry('checked', 2), entry('carryOn')],
    }),
    weather({ rainDays: 2, maxPrecipProbability: 80 }),
  )

// ---------- tests ----------

describe('generateBasePackingList', () => {
  describe('solo adult city trip with dry weather', () => {
    const items = generateBasePackingList(tripOfDays(3), weather())

    it('includes liquids-kit, clear-zip-bag and walking-shoes', () => {
      const keys = keysIn(items)
      expect(keys).toContain('liquids-kit')
      expect(keys).toContain('clear-zip-bag')
      expect(keys).toContain('walking-shoes')
    })

    it('has no umbrella and no carry-on-spare-outfit', () => {
      const keys = keysIn(items)
      expect(keys).not.toContain('umbrella')
      expect(keys).not.toContain('carry-on-spare-outfit')
    })

    it('packs 4 underwear for a 3-day trip', () => {
      const rows = rowsFor(items, 'underwear')
      expect(rows).toHaveLength(1)
      expect(rows[0].quantity).toBe(4)
    })
  })

  describe('family on a rainy mountain trip', () => {
    const items = rainyMountains()

    it('gives one rain-jacket row per member with matching scope and memberId', () => {
      const rows = rowsFor(items, 'rain-jacket')
      expect(rows).toHaveLength(3)
      expect(rows.map((r) => [r.scope, r.memberId])).toEqual([
        ['adult', 'a1'],
        ['adult', 'a2'],
        ['child', 'c1'],
      ])
    })

    it('has exactly one shared umbrella with null memberId', () => {
      const rows = rowsFor(items, 'umbrella')
      expect(rows).toHaveLength(1)
      expect(rows[0].scope).toBe('shared')
      expect(rows[0].memberId).toBeNull()
    })

    it('has exactly one shared first-aid-kit', () => {
      const rows = rowsFor(items, 'first-aid-kit')
      expect(rows).toHaveLength(1)
      expect(rows[0].scope).toBe('shared')
      expect(rows[0].memberId).toBeNull()
    })

    it('limits favorite-toy and kids-entertainment to the child', () => {
      for (const key of ['favorite-toy', 'kids-entertainment']) {
        const rows = rowsFor(items, key)
        expect(rows).toHaveLength(1)
        expect(rows[0].memberId).toBe('c1')
        expect(rows[0].scope).toBe('child')
      }
    })

    it('gives hiking-boots 3 rows', () => {
      expect(rowsFor(items, 'hiking-boots')).toHaveLength(3)
    })
  })

  describe('hot beach trip with checked and carry-on bags', () => {
    const items = generateBasePackingList(
      trip({ tripType: 'beach', luggage: [entry('checked'), entry('carryOn')] }),
      weather({ minTemp: 22, maxTemp: 30 }),
    )

    it('includes swimwear and sunscreen', () => {
      const keys = keysIn(items)
      expect(keys).toContain('swimwear')
      expect(keys).toContain('sunscreen')
    })

    it('omits liquids-kit because a checked bag is present', () => {
      expect(keysIn(items)).not.toContain('liquids-kit')
    })

    it('includes carry-on-spare-outfit and carry-on-meds-valuables', () => {
      const keys = keysIn(items)
      expect(keys).toContain('carry-on-spare-outfit')
      expect(keys).toContain('carry-on-meds-valuables')
    })
  })

  describe('seasonal estimate weather', () => {
    const items = generateBasePackingList(
      trip(),
      weather({ rainDays: 2, maxPrecipProbability: 70, isSeasonalEstimate: true, source: 'seasonal' }),
    )

    it('adds rain-jacket and umbrella with a seasonal estimate reason', () => {
      for (const key of ['rain-jacket', 'umbrella']) {
        const rows = rowsFor(items, key)
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) expect(row.reason).toContain('seasonal estimate')
      }
    })
  })

  describe('headcount', () => {
    it('gives 3 toothbrush rows and 1 toothpaste row for 2 adults and 1 child', () => {
      const items = generateBasePackingList(trip({ members: members(2, 1) }), weather())
      expect(rowsFor(items, 'toothbrush')).toHaveLength(3)
      expect(rowsFor(items, 'toothpaste')).toHaveLength(1)
    })

    it('gives adult-only business items 2 rows and none for the child', () => {
      const items = generateBasePackingList(
        trip({ tripType: 'business', members: members(2, 1) }),
        weather(),
      )
      for (const key of ['formal-outfit', 'laptop']) {
        const rows = rowsFor(items, key)
        expect(rows).toHaveLength(2)
        expect(rows.every((r) => r.scope === 'adult')).toBe(true)
        expect(rows.some((r) => r.memberId === 'c1')).toBe(false)
      }
    })
  })

  describe('null weather', () => {
    const WEATHER_KEYS = [
      'rain-jacket',
      'umbrella',
      'warm-jacket',
      'sweater',
      'gloves',
      'warm-hat',
      'thermal-layer',
      'sunscreen',
      'sunglasses',
      'sun-cap',
    ]

    it('produces no weather-rule keys on a city trip', () => {
      const keys = keysIn(generateBasePackingList(trip(), null))
      for (const key of WEATHER_KEYS) expect(keys).not.toContain(key)
    })

    it('still includes sun gear on a beach trip', () => {
      const keys = keysIn(generateBasePackingList(trip({ tripType: 'beach' }), null))
      expect(keys).toContain('sunscreen')
      expect(keys).toContain('sunglasses')
      expect(keys).toContain('sun-cap')
    })
  })

  describe('determinism and ordering', () => {
    const input = trip({ tripType: 'mountains', members: members(2, 1), luggage: [entry('checked')] })
    const w = weather({ rainDays: 1 })

    it('has no duplicate key and memberId pairs', () => {
      const ids = generateBasePackingList(input, w).map((i) => `${i.key}|${i.memberId ?? 'shared'}`)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('returns deep-equal output for two calls with the same input', () => {
      expect(generateBasePackingList(input, w)).toEqual(generateBasePackingList(input, w))
    })

    it('sorts by category order, then title', () => {
      const items = generateBasePackingList(input, w)
      const indexes = items.map((i) => CATEGORIES.indexOf(i.category))
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
      for (let i = 1; i < items.length; i++) {
        if (items[i].category === items[i - 1].category) {
          expect(items[i - 1].title.localeCompare(items[i].title)).toBeLessThanOrEqual(0)
        }
      }
    })

    it('orders per-member rows of the same title by input member order', () => {
      const items = generateBasePackingList(input, w)
      const rows = items.filter((i) => i.key === 'rain-jacket')
      expect(rows.map((r) => r.memberId)).toEqual(['a1', 'a2', 'c1'])
    })
  })

  describe('row validity', () => {
    const items = rainyMountains()

    it('has every row pass PackingItemDraftSchema', () => {
      for (const item of items) expect(() => PackingItemDraftSchema.parse(item)).not.toThrow()
    })

    it('marks every row with source rules', () => {
      expect(items.length).toBeGreaterThan(0)
      expect(items.every((i) => i.source === 'rules')).toBe(true)
    })
  })
})

describe('normalizeTitle', () => {
  it('lowercases, trims and collapses internal whitespace', () => {
    expect(normalizeTitle('  Rain   Jacket ')).toBe('rain jacket')
  })
})

describe('dedupeItems', () => {
  it('merges same-key same-member items, taking max quantity and the first reason', () => {
    const result = dedupeItems([
      draft({ quantity: 2, reason: 'first' }),
      draft({ quantity: 5, reason: 'second' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(5)
    expect(result[0].reason).toBe('first')
  })

  it('keeps separate rows for the same key with different memberId', () => {
    const result = dedupeItems([draft({ memberId: 'a1' }), draft({ memberId: 'a2' })])
    expect(result).toHaveLength(2)
  })

  it('merges null-key items whose normalized titles match', () => {
    const result = dedupeItems([
      draft({ key: null, title: ' Beach  Towel', memberId: null, scope: 'shared' }),
      draft({ key: null, title: 'beach towel', memberId: null, scope: 'shared' }),
    ])
    expect(result).toHaveLength(1)
  })

  it('replaces a null reason with the later reason', () => {
    const result = dedupeItems([draft({ reason: null }), draft({ reason: 'later' })])
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('later')
  })

  it('keeps the first occurrence position after merging', () => {
    const result = dedupeItems([
      draft({ key: 'a', title: 'A', memberId: null, scope: 'shared' }),
      draft({ key: 'b', title: 'B', memberId: null, scope: 'shared' }),
      draft({ key: 'a', title: 'A', memberId: null, scope: 'shared', quantity: 3 }),
    ])
    expect(result.map((r) => r.key)).toEqual(['a', 'b'])
    expect(result[0].quantity).toBe(3)
  })
})

describe('reviewer fixes', () => {
  const cold = weather({ minTemp: 2, maxTemp: 12 })

  it('packs gloves and a warm hat on a cold (not freezing) mountain trip', () => {
    const keys = keysIn(generateBasePackingList(trip({ tripType: 'mountains' }), cold))
    expect(keys).toContain('gloves')
    expect(keys).toContain('warm-hat')
  })

  it('skips gloves and a warm hat on a cold city trip that is not freezing', () => {
    const keys = keysIn(generateBasePackingList(trip({ tripType: 'city' }), cold))
    expect(keys).not.toContain('gloves')
    expect(keys).not.toContain('warm-hat')
  })

  it('still packs gloves and a warm hat when it is freezing on a city trip', () => {
    const keys = keysIn(
      generateBasePackingList(trip({ tripType: 'city' }), weather({ minTemp: -3, maxTemp: 4 })),
    )
    expect(keys).toContain('gloves')
    expect(keys).toContain('warm-hat')
  })

  it('packs a spare swimsuit from 3 days, one for shorter trips', () => {
    const swimwear = (days: number) =>
      rowsFor(generateBasePackingList(tripOfDays(days, { tripType: 'beach' }), weather()), 'swimwear')[0]
        .quantity
    expect(swimwear(2)).toBe(1)
    expect(swimwear(3)).toBe(2)
    expect(swimwear(14)).toBe(2)
  })
})

describe('sortItems and edge cases', () => {
  it('sorts a shared row before member rows with the same category and title', () => {
    const rows = [
      draft({ key: 'a', title: 'Item', memberId: 'c1', scope: 'child' }),
      draft({ key: 'b', title: 'Item', memberId: 'a1' }),
      draft({ key: 'c', title: 'Item', memberId: null, scope: 'shared' }),
    ]
    const sorted = sortItems(rows, members(1, 1))
    expect(sorted.map((r) => r.memberId)).toEqual([null, 'a1', 'c1'])
  })

  it('returns only shared rows without throwing when there are no members', () => {
    const items = generateBasePackingList(trip({ members: [] }), weather())
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.memberId === null)).toBe(true)
  })
})
