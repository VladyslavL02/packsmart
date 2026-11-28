import { dedupeItems, normalizeTitle, sortItems } from './generator';
import { isSameItem } from './synonyms';
import type { AiScope, AiSuggestion, Member, PackingItemDraft } from './types';

/** Gemini's quantity is per person for member-scoped items, so a high number is multiplied by the family. */
export const AI_MAX_PER_PERSON = 3;

// Gear a group shares rather than one per person (a couple doesn't pack two cameras).
const SHARED_GEAR = /\b(cameras?|drones?|tripods?|binoculars|speakers?|adapters?)\b/i;
const ADAPTER = /\badapters?\b/i;
const MAX_SHARED_ADAPTERS = 2;

/**
 * Fix scopes the model often gets wrong, by category, so the result doesn't depend on the model:
 * documents and electronics belong to adults (no phone pouch for a toddler), and health items
 * are one shared kit for the group unless the model made them child-specific. Group gear (camera,
 * drone, adapter…) is shared. If a trip has no adults, an adult-only result keeps the original scope so the item isn't lost.
 */
export function normalizeAiScope(suggestion: AiSuggestion, members: Member[]): AiScope {
  const { category, scope, title } = suggestion;
  if (SHARED_GEAR.test(title)) {return 'shared';}
  if (category === 'documents' || category === 'electronics') {
    if (scope !== 'everyone' && scope !== 'child') {return scope;}

    return members.some((member) => member.kind === 'adult') ? 'adult' : scope;
  }
  if (category === 'health' && (scope === 'everyone' || scope === 'adult')) {return 'shared';}

  return scope;
}

/**
 * Merge AI suggestions into the rules-only list.
 * AI items are dropped when their normalized title already exists (in base or earlier in ai),
 * or when they are a synonym of a base item (see synonyms.ts). A member-scoped item is skipped
 * only for members who already have that base item, or when a shared base item covers it.
 * Scopes are first normalized by category (normalizeAiScope); the rest are expanded per member.
 * Base rows are never changed.
 */
export function mergeItems(
  base: PackingItemDraft[],
  ai: AiSuggestion[],
  members: Member[],
): PackingItemDraft[] {
  const seen = new Set(base.map((item) => normalizeTitle(item.title)));
  const expanded: PackingItemDraft[] = [];

  for (const original of ai) {
    const suggestion = { ...original, scope: normalizeAiScope(original, members) };
    const normalized = normalizeTitle(suggestion.title);
    if (seen.has(normalized)) {continue;}

    const row = {
      key: null,
      title: suggestion.title.trim(),
      category: suggestion.category,
      quantity: suggestion.quantity,
      source: 'ai' as const,
      reason: suggestion.reason,
    };

    if (suggestion.scope === 'shared') {
      if (base.some((item) => isSameItem(suggestion.title, item))) {continue;}
      seen.add(normalized);
      // Each adult charges their own devices, so one adapter for two adults is too few.
      const adults = members.filter((member) => member.kind === 'adult').length;
      const quantity = ADAPTER.test(suggestion.title)
        ? Math.max(row.quantity, Math.min(adults, MAX_SHARED_ADAPTERS))
        : row.quantity;
      expanded.push({ ...row, quantity, scope: 'shared', memberId: null });
      continue;
    }

    const targets = (
      suggestion.scope === 'everyone'
        ? members
        : members.filter((member) => member.kind === suggestion.scope)
    ).filter(
      (member) =>
        !base.some(
          (item) =>
            (item.memberId === null || item.memberId === member.id) &&
            isSameItem(suggestion.title, item),
        ),
    );
    if (targets.length === 0) {continue;}
    seen.add(normalized);
    const quantity = Math.min(suggestion.quantity, AI_MAX_PER_PERSON);
    for (const member of targets) {
      expanded.push({ ...row, quantity, scope: member.kind, memberId: member.id });
    }
  }

  return sortItems(dedupeItems([...base, ...expanded]), members);
}
