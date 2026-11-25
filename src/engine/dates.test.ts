import { afterEach, describe, expect, it, vi } from 'vitest'
import { daysUntil, shiftYears, toIsoDate, tripDays } from './dates'

// The date logic only uses UTC, so results must not depend on the process
// timezone. We run the same assertions under zones that have DST changes.
const TIMEZONES = ['Pacific/Auckland', 'America/Los_Angeles', 'Europe/Berlin']

// Every range spans a real 2026 DST transition in at least one zone above.
// All ranges run under every zone, so each zone also sees the others' ranges.
const DST_RANGES = [
  { label: 'Los Angeles DST start (Mar 8)', start: '2026-03-07', end: '2026-03-09' },
  { label: 'Los Angeles DST end (Nov 1)', start: '2026-10-31', end: '2026-11-02' },
  { label: 'Auckland DST start (Sep 27)', start: '2026-09-26', end: '2026-09-28' },
  { label: 'Auckland DST end (Apr 5)', start: '2026-04-04', end: '2026-04-06' },
  { label: 'Berlin DST start (Mar 29)', start: '2026-03-28', end: '2026-03-30' },
  { label: 'Berlin DST end (Oct 25)', start: '2026-10-24', end: '2026-10-26' },
]

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.each(TIMEZONES)('dates under TZ=%s', (tz) => {
  const useTz = () => {
    vi.stubEnv('TZ', tz)
  }

  describe('tripDays', () => {
    it('counts a single-day trip as 1', () => {
      useTz()
      expect(tripDays('2026-06-01', '2026-06-01')).toBe(1)
    })

    it('is inclusive of both start and end', () => {
      useTz()
      expect(tripDays('2026-06-01', '2026-06-05')).toBe(5)
    })

    it.each(DST_RANGES)('gives 3 days across $label', ({ start, end }) => {
      useTz()
      expect(tripDays(start, end)).toBe(3)
    })

    it('handles a month and year boundary', () => {
      useTz()
      expect(tripDays('2026-12-30', '2027-01-02')).toBe(4)
    })
  })

  describe('toIsoDate', () => {
    it('formats the local calendar day with zero padding', () => {
      useTz()
      expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    })

    it('keeps the local day just after local midnight', () => {
      useTz()
      expect(toIsoDate(new Date(2026, 10, 25, 0, 1))).toBe('2026-11-25')
    })
  })

  describe('shiftYears', () => {
    it('moves the same month and day back by whole years', () => {
      useTz()
      expect(shiftYears('2027-07-10', -1)).toBe('2026-07-10')
      expect(shiftYears('2027-07-10', -3)).toBe('2024-07-10')
    })

    it('moves forward too', () => {
      useTz()
      expect(shiftYears('2026-12-31', 1)).toBe('2027-12-31')
    })

    it('clamps Feb 29 to Feb 28 in a non-leap year and keeps it in a leap year', () => {
      useTz()
      expect(shiftYears('2028-02-29', -1)).toBe('2027-02-28')
      expect(shiftYears('2028-02-29', -4)).toBe('2024-02-29')
    })
  })

  describe('daysUntil', () => {
    it('returns the positive day count for a future date', () => {
      useTz()
      expect(daysUntil('2026-12-01', '2026-11-25')).toBe(6)
    })

    it('returns 0 for the same day', () => {
      useTz()
      expect(daysUntil('2026-11-25', '2026-11-25')).toBe(0)
    })

    it('returns a negative count for a past date', () => {
      useTz()
      expect(daysUntil('2026-11-20', '2026-11-25')).toBe(-5)
    })

    it.each(DST_RANGES)('gives 2 days across $label', ({ start, end }) => {
      useTz()
      expect(daysUntil(end, start)).toBe(2)
    })

    it.each(DST_RANGES)('gives -2 days backwards across $label', ({ start, end }) => {
      useTz()
      expect(daysUntil(start, end)).toBe(-2)
    })
  })
})
