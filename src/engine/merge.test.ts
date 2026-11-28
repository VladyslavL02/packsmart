import { describe, expect, it } from 'vitest';
import { AI_MAX_PER_PERSON, mergeItems, normalizeAiScope } from './merge';
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

describe('mergeItems: per-person cap', () => {
  it('exports a cap of 3', () => {
    expect(AI_MAX_PER_PERSON).toBe(3);
  });

  it.each(['everyone', 'adult', 'child'] as const)('caps quantity for %s scope', (scope) => {
    const result = aiRows(
      mergeItems([], [suggestion({ title: 'Snacks', scope, quantity: 8 })], [adult('a1'), child('c1')]),
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((row) => row.quantity === AI_MAX_PER_PERSON)).toBe(true);
  });

  it('keeps a quantity below the cap for per-person scopes', () => {
    const result = aiRows(
      mergeItems([], [suggestion({ title: 'Snacks', scope: 'everyone', quantity: 2 })], [adult()]),
    );

    expect(result[0].quantity).toBe(2);
  });

  it('keeps the full quantity for shared scope', () => {
    const result = aiRows(
      mergeItems([], [suggestion({ title: 'Water jugs', scope: 'shared', quantity: 8 })], [adult()]),
    );

    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(8);
  });
});

describe('mergeItems: synonym dedupe', () => {
  const sunCap = (overrides: Partial<PackingItemDraft> = {}) =>
    draft({ key: 'sun-cap', title: 'Cap', category: 'clothing', ...overrides });

  it('drops a shared AI item that matches any base row', () => {
    const base = [sunCap()];

    const result = mergeItems(base, [suggestion({ title: 'Sun hat', scope: 'shared' })], [adult()]);

    expect(aiRows(result)).toHaveLength(0);
    expect(result).toEqual(base);
  });

  it('skips only the member whose base row matches, others still get the item', () => {
    const base = [sunCap()];
    const roster = [adult('a1'), child('c1')];

    const result = aiRows(
      mergeItems(base, [suggestion({ title: 'Sun hat', scope: 'everyone' })], roster),
    );

    expect(result.map((row) => row.memberId)).toEqual(['c1']);
  });

  it('skips every member when a shared base row matches', () => {
    const base = [sunCap({ scope: 'shared', memberId: null })];
    const roster = [adult('a1'), child('c1')];

    const result = mergeItems(base, [suggestion({ title: 'Sun hat', scope: 'everyone' })], roster);

    expect(aiRows(result)).toHaveLength(0);
  });

  it('keeps an AI item that matches no base row and leaves base rows unchanged', () => {
    const base = [sunCap()];
    const snapshot = structuredClone(base);

    const result = mergeItems(base, [suggestion({ title: 'Board game' })], [adult()]);

    expect(aiRows(result)).toHaveLength(1);
    expect(base).toEqual(snapshot);
    expect(result).toContainEqual(snapshot[0]);
  });
});

describe('normalizeAiScope', () => {
  const family = [adult('a1'), adult('a2'), child('c1')];
  const scopeOf = (category: AiSuggestion['category'], scope: AiSuggestion['scope']) =>
    normalizeAiScope(suggestion({ category, scope }), family);

  it.each(['documents', 'electronics'] as const)('moves %s everyone and child to adult', (cat) => {
    expect(scopeOf(cat, 'everyone')).toBe('adult');
    expect(scopeOf(cat, 'child')).toBe('adult');
  });

  it.each(['documents', 'electronics'] as const)('keeps %s adult and shared', (cat) => {
    expect(scopeOf(cat, 'adult')).toBe('adult');
    expect(scopeOf(cat, 'shared')).toBe('shared');
  });

  it('moves health everyone and adult to shared', () => {
    expect(scopeOf('health', 'everyone')).toBe('shared');
    expect(scopeOf('health', 'adult')).toBe('shared');
  });

  it('keeps health child and shared', () => {
    expect(scopeOf('health', 'child')).toBe('child');
    expect(scopeOf('health', 'shared')).toBe('shared');
  });

  it.each(['clothing', 'toiletries', 'kids', 'misc'] as const)('leaves %s untouched', (cat) => {
    for (const scope of ['everyone', 'adult', 'child', 'shared'] as const) {
      expect(scopeOf(cat, scope)).toBe(scope);
    }
  });

  it('falls back to the original scope when the result is adult but there are no adults', () => {
    const kids = [child('c1'), child('c2')];
    const everyone = suggestion({ category: 'documents', scope: 'everyone' });
    const onlyChild = suggestion({ category: 'electronics', scope: 'child' });
    expect(normalizeAiScope(everyone, kids)).toBe('everyone');
    expect(normalizeAiScope(onlyChild, kids)).toBe('child');
  });
});

describe('mergeItems: deterministic scope by category', () => {
  const roster = [adult('a1'), adult('a2'), child('c1'), child('c2')];

  it('turns health everyone into one uncapped shared row', () => {
    const ai = [
      suggestion({ title: 'Motion sickness pills', category: 'health', scope: 'everyone', quantity: 8 }),
    ];

    const result = aiRows(mergeItems([], ai, roster));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ scope: 'shared', memberId: null, quantity: 8 });
  });

  it('gives electronics everyone rows to adults only', () => {
    const ai = [
      suggestion({ title: 'Waterproof phone pouch', category: 'electronics', scope: 'everyone' }),
    ];

    const result = aiRows(mergeItems([], ai, roster));

    expect(result.map((row) => row.memberId).sort()).toEqual(['a1', 'a2']);
    expect(result.every((row) => row.scope === 'adult')).toBe(true);
  });

  it('keeps health child as per-child rows', () => {
    const ai = [suggestion({ title: "Kids' fever medicine", category: 'health', scope: 'child' })];

    const result = aiRows(mergeItems([], ai, roster));

    expect(result.map((row) => row.memberId).sort()).toEqual(['c1', 'c2']);
    expect(result.every((row) => row.scope === 'child')).toBe(true);
  });

  it('keeps documents everyone per child on an all-children trip', () => {
    const ai = [suggestion({ title: 'Travel consent letter', category: 'documents', scope: 'everyone' })];

    const result = aiRows(mergeItems([], ai, [child('c1'), child('c2')]));

    expect(result.map((row) => row.memberId).sort()).toEqual(['c1', 'c2']);
    expect(result.every((row) => row.scope === 'child')).toBe(true);
  });

  it('makes group gear one shared row even when the model said everyone', () => {
    const ai = [suggestion({ title: 'Camera', category: 'electronics', scope: 'everyone' })];

    const result = aiRows(mergeItems([], ai, roster));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ scope: 'shared', memberId: null });
  });

  it('gives a shared adapter one per adult, at most 2', () => {
    const adapter = suggestion({
      title: 'Universal travel adapter',
      category: 'electronics',
      scope: 'shared',
      quantity: 1,
    });

    expect(aiRows(mergeItems([], [adapter], roster))[0].quantity).toBe(2);
    expect(aiRows(mergeItems([], [adapter], [adult('a1')]))[0].quantity).toBe(1);
    const three = [adult('a1'), adult('a2'), adult('a3')];
    expect(aiRows(mergeItems([], [adapter], three))[0].quantity).toBe(2);
  });

  it('keeps a higher adapter quantity the model asked for', () => {
    const adapter = suggestion({ title: 'Plug adapter', category: 'electronics', scope: 'shared', quantity: 3 });

    expect(aiRows(mergeItems([], [adapter], roster))[0].quantity).toBe(3);
  });

  it('does not treat words that only contain a gear word as gear', () => {
    const ai = [suggestion({ title: 'Cameraman vest', category: 'clothing', scope: 'everyone' })];

    expect(aiRows(mergeItems([], ai, roster))).toHaveLength(4);
  });
});
