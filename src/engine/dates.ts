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

/** 'YYYY-MM-DD' for the local calendar day of `date` (the traveler's "today"). */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Same month and day `years` later (negative = earlier). Feb 29 clamps to Feb 28 in non-leap years. */
export function shiftYears(iso: string, years: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const targetYear = year + years
  const daysInMonth = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  const pad = (n: number, width: number) => String(n).padStart(width, '0')
  return `${pad(targetYear, 4)}-${pad(month, 2)}-${pad(Math.min(day, daysInMonth), 2)}`
}

/** Whole days from `today` until `date`. Negative if `date` is in the past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((parseIsoUtc(date) - parseIsoUtc(today)) / MS_PER_DAY)
}
