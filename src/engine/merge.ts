import { dedupeItems, normalizeTitle, sortItems } from './generator'
import type { AiSuggestion, Member, PackingItemDraft } from './types'

/**
 * Merge AI suggestions into the rules-only list.
 * AI items whose normalized title already exists (in base or earlier in ai) are dropped,
 * the rest are expanded per member. Base rows are never changed.
 */
export function mergeItems(
  base: PackingItemDraft[],
  ai: AiSuggestion[],
  members: Member[],
): PackingItemDraft[] {
  const seen = new Set(base.map((item) => normalizeTitle(item.title)))
  const expanded: PackingItemDraft[] = []

  for (const suggestion of ai) {
    const normalized = normalizeTitle(suggestion.title)
    if (seen.has(normalized)) continue
    seen.add(normalized)

    const row = {
      key: null,
      title: suggestion.title.trim(),
      category: suggestion.category,
      quantity: suggestion.quantity,
      source: 'ai' as const,
      reason: suggestion.reason,
    }

    if (suggestion.scope === 'shared') {
      expanded.push({ ...row, scope: 'shared', memberId: null })
      continue
    }

    const targets =
      suggestion.scope === 'everyone'
        ? members
        : members.filter((member) => member.kind === suggestion.scope)
    for (const member of targets) {
      expanded.push({ ...row, scope: member.kind, memberId: member.id })
    }
  }

  return sortItems(dedupeItems([...base, ...expanded]), members)
}
