import { SuggestRequestSchema } from '../src/engine/types.js';
import { getAiSuggestions } from './_lib/gemini.js';

const HEADERS = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = SuggestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ items: [], status: 'unavailable' }, { status: 400, headers: HEADERS });
  }
  const result = await getAiSuggestions(parsed.data, process.env.GEMINI_API_KEY, request.signal);

  return Response.json(result, { headers: HEADERS });
}
