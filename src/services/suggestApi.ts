import { z } from 'zod';
import { AiSuggestionSchema } from '../engine/types';
import type { AiSuggestion, PackingItemDraft, TripInput, WeatherSummary } from '../engine/types';

const SUGGEST_URL = '/api/suggest';
// Longer than the server's 8s budget, so the server's own [] normally wins over a client abort.
const CLIENT_TIMEOUT_MS = 10_000;
// Matches SuggestRequestSchema's existingTitles max.
const MAX_EXISTING_TITLES = 150;

const ResponseSchema = z.object({ items: z.array(AiSuggestionSchema) });

/**
 * Ask /api/suggest for AI packing suggestions. Never throws.
 * Returns [] on abort, timeout, HTTP error, non-JSON body or schema mismatch, so Phase 5 callers
 * must check `signal.aborted` before using the result.
 */
export async function fetchAiSuggestions(
  trip: TripInput,
  weather: WeatherSummary | null,
  baseItems: PackingItemDraft[],
  signal?: AbortSignal,
): Promise<AiSuggestion[]> {
  if (signal?.aborted) {return [];}
  try {
    const existingTitles = [...new Set(baseItems.map((item) => item.title))].slice(
      0,
      MAX_EXISTING_TITLES,
    );
    const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const res = await fetch(SUGGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trip, weather, existingTitles }),
      signal: combined,
    });
    if (!res.ok) {
      console.warn('[suggest] HTTP', res.status);

      return [];
    }
    // Vite dev serves HTML for /api, so res.json() can throw; the outer catch handles it.
    const parsed = ResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn('[suggest] response did not match schema');

      return [];
    }

    return parsed.data.items;
  } catch (error) {
    // A cancel the caller asked for is not a failure worth logging.
    if (!signal?.aborted) {
      console.warn('[suggest] failed:', error instanceof Error ? error.message : error);
    }

    return [];
  }
}
