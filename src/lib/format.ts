// Dates are date-only strings (read as UTC), so format them in UTC too.
const DATE_RANGE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function formatDateRange(startDate: string, endDate: string): string {
  return DATE_RANGE.formatRange(new Date(startDate), new Date(endDate));
}
