import { describe, expect, it } from 'vitest';
import {
  filterCounts,
  filterItems,
  groupByCategory,
  newAiRows,
  packingProgress,
  travelersLabel,
} from './listView';
import { CATEGORIES } from './types';
import type { Member, PackingItem, PackingItemDraft } from './types';

// ---------- fixture builders ----------

const draft = (overrides: Partial<PackingItemDraft> = {}): PackingItemDraft => ({
  key: null,
  title: 'Travel pillow',
  category: 'misc',
  scope: 'adult',
  memberId: 'a1',
  quantity: 1,
  source: 'ai',
  reason: null,
  ...overrides,
});

const item = (id: string, overrides: Partial<PackingItem> = {}): PackingItem => ({
  ...draft({ title: `Item ${id}`, source: 'rules' }),
  id,
  tripId: 't1',
  isPacked: false,
  ...overrides,
});

const sharedItem = (id: string, overrides: Partial<PackingItem> = {}): PackingItem =>
  item(id, { scope: 'shared', memberId: null, ...overrides });

const childItem = (id: string, overrides: Partial<PackingItem> = {}): PackingItem =>
  item(id, { scope: 'child', memberId: 'c1', ...overrides });

const adult = (id: string): Member => ({ id, name: `Adult ${id}`, kind: 'adult' });

const child = (id: string): Member => ({ id, name: `Child ${id}`, kind: 'child' });

// ---------- helpers ----------

const ids = (items: PackingItem[]): string[] => items.map((row) => row.id);

const mixedList = (): PackingItem[] => [
  item('a1-open'),
  sharedItem('shared-open'),
  childItem('c1-packed', { isPacked: true }),
  item('a2-open', { memberId: 'a2' }),
  item('a1-packed', { isPacked: true }),
  sharedItem('shared-packed', { isPacked: true }),
  childItem('c1-open'),
];

const family = (): Member[] => [adult('a1'), adult('a2'), child('c1')];

// ---------- tests ----------

describe('filterItems', () => {
  it('returns an empty list for an empty list under every filter', () => {
    for (const filter of ['all', 'mine', 'shared', { memberId: 'a1' }] as const) {
      expect(filterItems([], filter, 'a1', false)).toEqual([]);
      expect(filterItems([], filter, null, true)).toEqual([]);
    }
  });

  it('returns every row in input order for all', () => {
    const items = mixedList();

    expect(filterItems(items, 'all', 'a1', false)).toEqual(items);
  });

  it('returns only rows with a null memberId for shared', () => {
    const result = filterItems(mixedList(), 'shared', 'a1', false);

    expect(ids(result)).toEqual(['shared-open', 'shared-packed']);
  });

  it('returns the current member rows plus shared rows for mine', () => {
    const result = filterItems(mixedList(), 'mine', 'a1', false);

    expect(ids(result)).toEqual(['a1-open', 'shared-open', 'a1-packed', 'shared-packed']);
  });

  it('returns shared rows only for mine when there is no current member', () => {
    const result = filterItems(mixedList(), 'mine', null, false);

    expect(ids(result)).toEqual(['shared-open', 'shared-packed']);
  });

  it('returns only that member rows without shared rows for a memberId filter', () => {
    const result = filterItems(mixedList(), { memberId: 'c1' }, 'a1', false);

    expect(ids(result)).toEqual(['c1-packed', 'c1-open']);
  });

  it('drops packed rows from all when unpackedOnly is set', () => {
    const result = filterItems(mixedList(), 'all', 'a1', true);

    expect(ids(result)).toEqual(['a1-open', 'shared-open', 'a2-open', 'c1-open']);
  });

  it('drops packed rows after the shared, mine and member filters when unpackedOnly is set', () => {
    const items = mixedList();

    expect(ids(filterItems(items, 'shared', 'a1', true))).toEqual(['shared-open']);
    expect(ids(filterItems(items, 'mine', 'a1', true))).toEqual(['a1-open', 'shared-open']);
    expect(ids(filterItems(items, 'mine', null, true))).toEqual(['shared-open']);
    expect(ids(filterItems(items, { memberId: 'c1' }, 'a1', true))).toEqual(['c1-open']);
  });

  it('does not mutate the input', () => {
    const items = mixedList();
    const snapshot = structuredClone(items);

    filterItems(items, 'mine', 'a1', true);
    filterItems(items, { memberId: 'c1' }, null, true);

    expect(items).toEqual(snapshot);
  });
});

describe('groupByCategory', () => {
  it('returns an empty list for an empty list', () => {
    expect(groupByCategory([])).toEqual([]);
  });

  it('orders groups by CATEGORIES regardless of input order', () => {
    const items = [...CATEGORIES].reverse().map((category) => draft({ category }));

    const result = groupByCategory(items);

    expect(result.map((group) => group.category)).toEqual([...CATEGORIES]);
  });

  it('omits categories that have no rows', () => {
    const items = [draft({ category: 'misc' }), draft({ category: 'clothing' })];

    const result = groupByCategory(items);

    expect(result.map((group) => group.category)).toEqual(['clothing', 'misc']);
  });

  it('keeps input order within a group', () => {
    const zip = item('zip', { category: 'clothing' });
    const passport = item('passport', { category: 'documents' });
    const anorak = item('anorak', { category: 'clothing' });
    const mittens = item('mittens', { category: 'clothing' });

    const result = groupByCategory([zip, passport, anorak, mittens]);

    expect(result).toEqual([
      { category: 'clothing', items: [zip, anorak, mittens] },
      { category: 'documents', items: [passport] },
    ]);
  });
});

describe('packingProgress', () => {
  const none = { packed: 0, total: 0 };

  it('returns all zeros for an empty list', () => {
    expect(packingProgress([])).toEqual({
      packed: 0,
      total: 0,
      percent: 0,
      shared: none,
      adults: none,
      kids: none,
    });
  });

  it('splits packed and total by shared, adult and child scope', () => {
    const items = [
      sharedItem('s1', { isPacked: true }),
      sharedItem('s2'),
      sharedItem('s3'),
      item('a1', { isPacked: true }),
      item('a2', { memberId: 'a2', isPacked: true }),
      childItem('c1', { isPacked: true }),
      childItem('c2'),
    ];

    expect(packingProgress(items)).toEqual({
      packed: 4,
      total: 7,
      percent: 57,
      shared: { packed: 1, total: 3 },
      adults: { packed: 2, total: 2 },
      kids: { packed: 1, total: 2 },
    });
  });

  it('counts rows rather than quantity', () => {
    const items = [item('socks', { quantity: 8, isPacked: true }), item('hat', { quantity: 1 })];

    expect(packingProgress(items)).toMatchObject({
      packed: 1,
      total: 2,
      percent: 50,
      adults: { packed: 1, total: 2 },
    });
  });

  it('rounds percent to the nearest whole number', () => {
    const onePacked = [item('1', { isPacked: true }), item('2'), item('3')];
    const twoPacked = [item('1', { isPacked: true }), item('2', { isPacked: true }), item('3')];

    expect(packingProgress(onePacked).percent).toBe(33);
    expect(packingProgress(twoPacked).percent).toBe(67);
  });

  it('reports zero adults and a correct percent for a kids-only trip', () => {
    const items = [
      childItem('1', { isPacked: true }),
      childItem('2', { memberId: 'c2', isPacked: true }),
      childItem('3'),
      childItem('4', { memberId: 'c2', isPacked: true }),
    ];

    expect(packingProgress(items)).toEqual({
      packed: 3,
      total: 4,
      percent: 75,
      shared: none,
      adults: none,
      kids: { packed: 3, total: 4 },
    });
  });
});

describe('newAiRows', () => {
  it('returns an empty list when both lists are empty', () => {
    expect(newAiRows([], [])).toEqual([]);
  });

  it('returns an empty list when merged is empty but current is not', () => {
    expect(newAiRows([draft()], [])).toEqual([]);
  });

  it('returns every AI row when current is empty', () => {
    const merged = [
      draft(),
      draft({ title: 'Board game', scope: 'shared', memberId: null }),
      draft({ title: 'Snacks', scope: 'child', memberId: 'c1' }),
    ];

    const result = newAiRows([], merged);

    expect(result).toHaveLength(merged.length);
    expect(result).toEqual(expect.arrayContaining(merged));
  });

  it('returns an empty list when merged has no AI rows', () => {
    const merged = [
      draft({ title: 'Passport', source: 'rules' }),
      draft({ title: 'Camera', source: 'user' }),
    ];

    expect(newAiRows([], merged)).toEqual([]);
  });

  it('never returns rules or user rows', () => {
    const fresh = draft({ title: 'Board game' });
    const merged = [
      draft({ title: 'Passport', source: 'rules' }),
      fresh,
      draft({ title: 'Camera', source: 'user' }),
    ];

    expect(newAiRows([], merged)).toEqual([fresh]);
  });

  it('blocks an AI row on Retry when the user added the same title for that member', () => {
    const current = [draft({ title: 'Travel pillow', source: 'user', memberId: 'a1' })];
    const merged = [draft({ title: 'travel pillow', memberId: 'a1' })];

    expect(newAiRows(current, merged)).toEqual([]);
  });

  it('keeps the AI row for another member when the user added that title for one member', () => {
    const current = [draft({ title: 'Travel pillow', source: 'user', memberId: 'a1' })];
    const other = draft({ title: 'travel pillow', memberId: 'a2' });
    const merged = [draft({ title: 'travel pillow', memberId: 'a1' }), other];

    expect(newAiRows(current, merged)).toEqual([other]);
  });

  it('matches titles ignoring case and extra whitespace', () => {
    const current = [{ title: '  TRAVEL    Pillow ', memberId: 'a1' }];

    expect(newAiRows(current, [draft({ title: 'travel pillow' })])).toEqual([]);
  });

  it('blocks an AI row whatever the source of the current row', () => {
    for (const source of ['rules', 'ai', 'user'] as const) {
      expect(newAiRows([draft({ source })], [draft()])).toEqual([]);
    }
  });

  it('blocks a shared AI row only with a shared current row', () => {
    const shared = draft({ scope: 'shared', memberId: null });

    expect(newAiRows([{ title: 'Travel pillow', memberId: null }], [shared])).toEqual([]);
    expect(newAiRows([{ title: 'Travel pillow', memberId: 'a1' }], [shared])).toEqual([shared]);
  });

  it('does not block a member AI row with a shared current row', () => {
    const memberRow = draft({ memberId: 'a1' });

    expect(newAiRows([{ title: 'Travel pillow', memberId: null }], [memberRow])).toEqual([
      memberRow,
    ]);
  });
});

describe('filterCounts', () => {
  it('returns zero for every count and every member when the list is empty', () => {
    expect(filterCounts([], family(), 'a1', false)).toEqual({
      all: 0,
      mine: 0,
      shared: 0,
      byMember: { a1: 0, a2: 0, c1: 0 },
    });
  });

  it('counts rows for all, mine, shared and each member', () => {
    expect(filterCounts(mixedList(), family(), 'a1', false)).toEqual({
      all: 7,
      mine: 4,
      shared: 2,
      byMember: { a1: 2, a2: 1, c1: 2 },
    });
  });

  it('counts rows rather than quantity', () => {
    const items = [item('socks', { quantity: 8 }), sharedItem('towel', { quantity: 3 })];

    expect(filterCounts(items, [adult('a1')], 'a1', false)).toEqual({
      all: 2,
      mine: 2,
      shared: 1,
      byMember: { a1: 1 },
    });
  });

  it('counts only shared rows as mine when there is no current member', () => {
    const counts = filterCounts(mixedList(), family(), null, false);

    expect(counts).toMatchObject({ all: 7, mine: 2, shared: 2 });
  });

  it('leaves packed rows out of every count when unpackedOnly is set', () => {
    expect(filterCounts(mixedList(), family(), 'a1', true)).toEqual({
      all: 4,
      mine: 2,
      shared: 1,
      byMember: { a1: 1, a2: 1, c1: 1 },
    });
  });

  it('gives a member with no rows a zero entry', () => {
    const counts = filterCounts(mixedList(), [...family(), child('c2')], 'a1', false);

    expect(counts.byMember).toEqual({ a1: 2, a2: 1, c1: 2, c2: 0 });
  });

  it('matches the filterItems result length for every filter', () => {
    const items = mixedList();

    for (const currentMemberId of ['a1', 'c1', null]) {
      for (const unpackedOnly of [false, true]) {
        const size = (filter: Parameters<typeof filterItems>[1]): number =>
          filterItems(items, filter, currentMemberId, unpackedOnly).length;

        expect(filterCounts(items, family(), currentMemberId, unpackedOnly)).toEqual({
          all: size('all'),
          mine: size('mine'),
          shared: size('shared'),
          byMember: {
            a1: size({ memberId: 'a1' }),
            a2: size({ memberId: 'a2' }),
            c1: size({ memberId: 'c1' }),
          },
        });
      }
    }
  });
});

describe('travelersLabel', () => {
  it('shows the total with adult and kid counts for a mixed trip', () => {
    expect(travelersLabel(family())).toBe('3 travelers (2A, 1K)');
  });

  it('uses the singular for one traveler', () => {
    expect(travelersLabel([adult('a1')])).toBe('1 traveler (1A)');
  });

  it('omits the adult group for a kids-only trip', () => {
    expect(travelersLabel([child('c1'), child('c2')])).toBe('2 travelers (2K)');
  });

  it('omits the kid group for an adults-only trip', () => {
    expect(travelersLabel([adult('a1'), adult('a2')])).toBe('2 travelers (2A)');
  });
});
