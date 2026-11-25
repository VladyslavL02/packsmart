import { describe, expect, it } from 'vitest';
import { mergeItems } from './merge';
import { PackingItemDraftSchema } from './types';
import type { AiSuggestion, Member, PackingItemDraft } from './types';

// ---------- fixture builders ----------

const adult = (id = 'a1'): Member => ({ id, name: `Adult ${id}`, kind: 'adult' });
const child = (id = 'c1'): Member => ({ id, name: `Child ${id}`, kind: 'child' });

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
});

const suggestion = (overrides: Partial<AiSuggestion> = {}): AiSuggestion => ({
  title: 'Travel pillow',
  category: 'misc',
  scope: 'shared',
  quantity: 1,
  reason: null,
  ...overrides,
});

// ---------- helpers ----------

const aiRows = (items: PackingItemDraft[]): PackingItemDraft[] =>
  items.filter((item) => item.source === 'ai');

const titlesLower = (items: PackingItemDraft[]): string[] =>
  items.map((item) => item.title.trim().toLowerCase());

// ---------- tests ----------

describe('mergeItems', () => {
  it('drops an AI item whose title matches a base title ignoring case and spacing', () => {
    const base = [draft()];
    const ai = [suggestion({ title: ' RAIN jacket ', scope: 'adult' })];

    const result = mergeItems(base, ai, [adult()]);

    expect(aiRows(result)).toHaveLength(0);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(draft());
  });

  it('leaves base rows unchanged and does not mutate the input when ai is empty', () => {
    const base = [
      draft(),
      draft({ key: 'passport', title: 'Passport', category: 'documents', scope: 'adult' }),
    ];
    const snapshot = structuredClone(base);

    const result = mergeItems(base, [], [adult()]);

    expect(base).toEqual(snapshot);
    expect(result).toHaveLength(base.length);
    for (const row of snapshot) {
      expect(result).toContainEqual(row);
    }
  });

  it('expands an everyone item into one row per member with scope from member kind', () => {
    const roster = [adult('a1'), adult('a2'), child('c1')];

    const result = aiRows(
      mergeItems([], [suggestion({ title: 'Sunglasses', scope: 'everyone' })], roster),
    );

    expect(result).toHaveLength(3);
    const byMember = Object.fromEntries(result.map((row) => [row.memberId, row.scope]));
    expect(byMember).toEqual({ a1: 'adult', a2: 'adult', c1: 'child' });
  });

  it('drops a child item when the trip has no children', () => {
    const base = [draft()];

    const result = mergeItems(
      base,
      [suggestion({ title: 'Kids tablet', scope: 'child', category: 'kids' })],
      [adult('a1'), adult('a2')],
    );

    expect(aiRows(result)).toHaveLength(0);
    expect(result).toContainEqual(draft());
  });

  it('expands an adult item to one row per adult only', () => {
    const roster = [adult('a1'), adult('a2'), child('c1')];

    const result = aiRows(
      mergeItems([], [suggestion({ title: 'Adult book', scope: 'adult' })], roster),
    );

    expect(result.map((row) => row.memberId).sort()).toEqual(['a1', 'a2']);
    expect(result.every((row) => row.scope === 'adult')).toBe(true);
  });

  it('expands a shared item into a single row with null memberId and shared scope', () => {
    const result = aiRows(
      mergeItems([], [suggestion({ title: 'Travel pillow', scope: 'shared' })], [adult(), child()]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ scope: 'shared', memberId: null, title: 'Travel pillow' });
  });

  it('collapses duplicate AI titles to the first one despite case, spacing and scope', () => {
    const ai = [
      suggestion({ title: 'Neck pillow', scope: 'shared', quantity: 2, reason: 'first' }),
      suggestion({ title: '  NECK   pillow ', scope: 'everyone', quantity: 5, reason: 'second' }),
      suggestion({ title: 'neck pillow', scope: 'adult', quantity: 7, reason: 'third' }),
    ];

    const result = aiRows(mergeItems([], ai, [adult('a1'), child('c1')]));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      scope: 'shared',
      memberId: null,
      quantity: 2,
      reason: 'first',
    });
  });

  it('produces schema-valid rows and AI rows with key null, source ai, quantity and reason kept', () => {
    const base = [draft()];
    const ai = [
      suggestion({ title: '  Portable fan  ', scope: 'everyone', quantity: 3, reason: 'Hot days' }),
      suggestion({ title: 'Board game', scope: 'shared', quantity: 1, reason: null }),
    ];
    const roster = [adult('a1'), child('c1')];

    const result = mergeItems(base, ai, roster);

    for (const row of result) {
      expect(() => PackingItemDraftSchema.parse(row)).not.toThrow();
    }
    const added = aiRows(result);
    expect(added).toHaveLength(3);
    expect(added.every((row) => row.key === null)).toBe(true);
    const fans = added.filter((row) => row.title === 'Portable fan');
    expect(fans).toHaveLength(2);
    expect(fans.every((row) => row.quantity === 3 && row.reason === 'Hot days')).toBe(true);
    const game = added.find((row) => row.title === 'Board game');
    expect(game).toMatchObject({ quantity: 1, reason: null });
    expect(titlesLower(result)).not.toContain('  portable fan  ');
  });

  it('returns identical output for identical input', () => {
    const base = [draft()];
    const ai = [
      suggestion({ title: 'Portable fan', scope: 'everyone' }),
      suggestion({ title: 'Board game', scope: 'shared' }),
    ];
    const roster = [adult('a1'), child('c1')];

    const first = mergeItems(base, ai, roster);
    const second = mergeItems(base, ai, roster);

    expect(first.length).toBeGreaterThan(base.length);
    expect(second).toEqual(first);
  });

  it('returns the same sorted output when unrelated AI inputs are reversed', () => {
    const base = [draft()];
    const ai = [
      suggestion({ title: 'Portable fan', scope: 'everyone', category: 'electronics' }),
      suggestion({ title: 'Board game', scope: 'shared', category: 'misc' }),
      suggestion({ title: 'Kids snacks', scope: 'child', category: 'kids' }),
    ];
    const roster = [adult('a1'), child('c1')];

    const forward = mergeItems(base, ai, roster);
    const backward = mergeItems(base, [...ai].reverse(), roster);

    expect(forward.length).toBeGreaterThan(base.length);
    expect(backward).toEqual(forward);
  });
});
