import { describe, expect, it } from 'vitest';
import { formatDateRange } from './format';

// Intl puts thin and narrow spaces around the dash; compare with plain ones.
const range = (start: string, end: string) => formatDateRange(start, end).replace(/\s/g, ' ');

describe('formatDateRange', () => {
  it.each([
    ['2026-06-01', '2026-06-07', 'Jun 1 – 7'],
    ['2026-06-28', '2026-07-03', 'Jun 28 – Jul 3'],
    ['2026-06-01', '2026-06-01', 'Jun 1'],
  ])('formats %s to %s', (start, end, expected) => {
    expect(range(start, end)).toBe(expected);
  });
});
