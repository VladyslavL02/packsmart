import { normalizeTitle } from '../engine/generator';
import { SuggestResponseSchema } from '../engine/types';
import type {
  PackingItemDraft,
  SuggestRequest,
  SuggestResponse,
  TripInput,
  WeatherSummary,
} from '../engine/types';

const SUGGEST_URL = '/api/suggest';
// Longer than the server's 8s budget, so the server's own answer normally wins over a client abort.
const CLIENT_TIMEOUT_MS = 10_000;
// Matches SuggestRequestSchema's existingItems max.
const MAX_EXISTING_ITEMS = 150;

const unavailable = (): SuggestResponse => ({ items: [], status: 'unavailable' });

/**
 * Ask /api/suggest for AI packing suggestions. Never throws.
 * Resolves to `{ items, status }`: the server's answer, or `status: 'unavailable'` with no items on
 * abort, timeout, HTTP error, non-JSON body or schema mismatch, so the UI can offer a retry.
 * Phase 5 callers must check `signal.aborted` before using the result.
 */
export async function fetchAiSuggestions(
  trip: TripInput,
  weather: WeatherSummary | null,
  baseItems: PackingItemDraft[],
  signal?: AbortSignal,
): Promise<SuggestResponse> {
  if (signal?.aborted) {return unavailable();}
  try {
    // One entry per title (per-member rows collapse), with category and reason so the AI sees the purpose.
    const unique = new Map<string, SuggestRequest['existingItems'][number]>();
    for (const item of baseItems) {
      const id = normalizeTitle(item.title);
      if (!unique.has(id)) {
        unique.set(id, { title: item.title, category: item.category, reason: item.reason });
      }
    }
    const existingItems = [...unique.values()].slice(0, MAX_EXISTING_ITEMS);
    const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const res = await fetch(SUGGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trip, weather, existingItems }),
      signal: combined,
    });
    if (!res.ok) {
      console.warn('[suggest] HTTP', res.status);

      return unavailable();
    }
    // Vite dev serves HTML for /api, so res.json() can throw; the outer catch handles it.
    const parsed = SuggestResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn('[suggest] response did not match schema');

      return unavailable();
    }

    return parsed.data;
  } catch (error) {
    // A cancel the caller asked for is not a failure worth logging.
    if (!signal?.aborted) {
      console.warn('[suggest] failed:', error instanceof Error ? error.message : error);
    }

    return unavailable();
  }
}
