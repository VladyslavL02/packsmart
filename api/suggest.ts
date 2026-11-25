import { TripInputSchema } from '../src/engine/types.js';

export async function POST(request: Request): Promise<Response> {
  console.log('[suggest] GEMINI_API_KEY set:', Boolean(process.env.GEMINI_API_KEY));
  const body: unknown = await request.json().catch(() => null);
  const parsed = TripInputSchema.safeParse(body);
  if (!parsed.success) {return Response.json({ ok: false }, { status: 400 });}

  return Response.json({ ok: true, city: parsed.data.city });
}
