const MS_PER_DAY = 86_400_000

// Parse 'YYYY-MM-DD' as UTC midnight. Never use new Date(string) here:
// it can be read as local time and shift the day count across DST.
function parseIsoUtc(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** Inclusive number of days in a trip: same start and end day = 1. */
export function tripDays(start: string, end: string): number {
  return Math.round((parseIsoUtc(end) - parseIsoUtc(start)) / MS_PER_DAY) + 1
}

/** Whole days from `today` until `date`. Negative if `date` is in the past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((parseIsoUtc(date) - parseIsoUtc(today)) / MS_PER_DAY)
}
