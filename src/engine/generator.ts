import {
  BASE_RULES,
  FAMILY_RULES,
  LUGGAGE_RULES,
  TRIP_TYPE_RULES,
  WEATHER_RULES,
  buildRuleContext,
} from './rules';
import type { Rule, RuleContext } from './rules';
import { CATEGORIES } from './types';
import type { Member, PackingItemDraft, TripInput, WeatherSummary } from './types';

/** Lowercase, trim and collapse whitespace, so near-identical titles compare equal. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function identity(item: PackingItemDraft): string {
  return `${item.key ?? normalizeTitle(item.title)}|${item.memberId ?? 'shared'}`;
}

/**
 * Collapse items with the same key (or normalized title) for the same member.
 * The first occurrence keeps its position, takes the higher quantity and keeps
 * its reason unless that reason is null.
 */
export function dedupeItems(items: PackingItemDraft[]): PackingItemDraft[] {
  const byIdentity = new Map<string, PackingItemDraft>();
  for (const item of items) {
    const id = identity(item);
    const existing = byIdentity.get(id);
    if (!existing) {
      byIdentity.set(id, { ...item });
      continue;
    }
    existing.quantity = Math.max(existing.quantity, item.quantity);
    existing.reason = existing.reason ?? item.reason;
  }

  return [...byIdentity.values()];
}

function resolveQuantity(rule: Rule, ctx: RuleContext): number {
  if (rule.quantity === undefined) {return 1;}

  return typeof rule.quantity === 'function' ? rule.quantity(ctx) : rule.quantity;
}

function resolveReason(rule: Rule, ctx: RuleContext): string | null {
  if (rule.reason === undefined) {return null;}

  return typeof rule.reason === 'function' ? rule.reason(ctx) : rule.reason;
}

function expandRule(rule: Rule, ctx: RuleContext): PackingItemDraft[] {
  const base = {
    key: rule.key,
    title: rule.title,
    category: rule.category,
    quantity: resolveQuantity(rule, ctx),
    source: 'rules' as const,
    reason: resolveReason(rule, ctx),
  };
  if (rule.appliesTo === 'shared') {
    return [{ ...base, scope: 'shared', memberId: null }];
  }
  const targets: Member[] =
    rule.appliesTo === 'everyone'
      ? ctx.input.members
      : ctx.input.members.filter((member) => member.kind === rule.appliesTo);

  return targets.map((member) => ({ ...base, scope: member.kind, memberId: member.id }));
}

/** Category order, then title, then shared rows before member rows in input order. */
export function sortItems(items: PackingItemDraft[], members: Member[]): PackingItemDraft[] {
  const memberOrder = new Map(members.map((member, index) => [member.id, index]));
  const memberRank = (item: PackingItemDraft) =>
    item.memberId === null ? -1 : (memberOrder.get(item.memberId) ?? members.length);

  return [...items].sort(
    (a, b) =>
      CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
      a.title.localeCompare(b.title) ||
      memberRank(a) - memberRank(b),
  );
}

/** The rules-only packing list: per member, deduplicated, deterministically sorted. */
export function generateBasePackingList(
  input: TripInput,
  weather: WeatherSummary | null,
): PackingItemDraft[] {
  const ctx = buildRuleContext(input, weather);
  const rules = [
    ...BASE_RULES,
    ...WEATHER_RULES,
    ...TRIP_TYPE_RULES[input.tripType],
    ...LUGGAGE_RULES,
    ...FAMILY_RULES,
  ].filter((rule) => rule.when?.(ctx) ?? true);
  const items = rules.flatMap((rule) => expandRule(rule, ctx));

  return sortItems(dedupeItems(items), input.members);
}
