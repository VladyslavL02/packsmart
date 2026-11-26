import { normalizeTitle } from './generator';
import { CATEGORIES } from './types';
import type { Category, Member, PackingItem, PackingItemDraft } from './types';

export type ItemFilter = 'all' | 'mine' | 'shared' | { memberId: string };
export type Ratio = { packed: number; total: number };
export type FilterCounts = {
  all: number;
  mine: number;
  shared: number;
  byMember: Record<string, number>;
};
export type PackingProgress = Ratio & {
  percent: number;
  shared: Ratio;
  adults: Ratio;
  kids: Ratio;
};

function matchesFilter(
  item: PackingItem,
  filter: ItemFilter,
  currentMemberId: string | null,
): boolean {
  if (filter === 'all') {return true;}
  if (filter === 'shared') {return item.memberId === null;}
  // With no current member, 'mine' leaves only the shared rows.
  if (filter === 'mine') {return item.memberId === null || item.memberId === currentMemberId;}

  return item.memberId === filter.memberId;
}

export function filterItems(
  items: PackingItem[],
  filter: ItemFilter,
  currentMemberId: string | null,
  unpackedOnly: boolean,
): PackingItem[] {
  return items.filter(
    (item) => matchesFilter(item, filter, currentMemberId) && !(unpackedOnly && item.isPacked),
  );
}

export function groupByCategory<T extends { category: Category }>(
  items: T[],
): { category: Category; items: T[] }[] {
  return CATEGORIES.map((category) => ({
    category,
    items: items.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);
}

function ratio(items: PackingItem[]): Ratio {
  return { packed: items.filter((item) => item.isPacked).length, total: items.length };
}

/** Counts rows, not quantities. */
export function packingProgress(items: PackingItem[]): PackingProgress {
  const all = ratio(items);

  return {
    ...all,
    percent: all.total === 0 ? 0 : Math.round((all.packed / all.total) * 100),
    shared: ratio(items.filter((item) => item.scope === 'shared')),
    adults: ratio(items.filter((item) => item.scope === 'adult')),
    kids: ratio(items.filter((item) => item.scope === 'child')),
  };
}

function titleAndOwner(item: Pick<PackingItemDraft, 'title' | 'memberId'>): string {
  return `${normalizeTitle(item.title)}|${item.memberId ?? ''}`;
}

/** The AI rows of a merged list that aren't in the current one, so Retry inserts only those. */
export function newAiRows(
  current: Pick<PackingItemDraft, 'title' | 'memberId'>[],
  merged: PackingItemDraft[],
): PackingItemDraft[] {
  const existing = new Set(current.map(titleAndOwner));

  return merged.filter((item) => item.source === 'ai' && !existing.has(titleAndOwner(item)));
}

/** The number of rows each filter chip would show. */
export function filterCounts(
  items: PackingItem[],
  members: Member[],
  currentMemberId: string | null,
  unpackedOnly: boolean,
): FilterCounts {
  const count = (filter: ItemFilter) =>
    filterItems(items, filter, currentMemberId, unpackedOnly).length;

  return {
    all: count('all'),
    mine: count('mine'),
    shared: count('shared'),
    byMember: Object.fromEntries(members.map(({ id }) => [id, count({ memberId: id })])),
  };
}

/** "3 travelers (2A, 1K)" */
export function travelersLabel(members: Member[]): string {
  const adults = members.filter((member) => member.kind === 'adult').length;
  const kids = members.length - adults;
  const groups = [adults > 0 ? `${adults}A` : null, kids > 0 ? `${kids}K` : null];
  const noun = members.length === 1 ? 'traveler' : 'travelers';

  return `${members.length} ${noun} (${groups.filter(Boolean).join(', ')})`;
}
