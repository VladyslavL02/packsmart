import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuggestRequest } from '../../src/engine/types.js';
import {
  GEMINI_URL,
  MAX_AI_ITEMS,
  MAX_OUTPUT_TOKENS,
  RETRY_DELAY_MS,
  RETRY_STATUSES,
  buildPrompt,
  getAiSuggestions,
  parseGeminiResponse,
} from './gemini.js';

const KEY = 'test-secret-key-123';

const req: SuggestRequest = {
  trip: {
    city: 'London',
    country: 'United Kingdom',
    latitude: 51.5,
    longitude: -0.12,
    startDate: '2026-12-01',
    endDate: '2026-12-03',
    tripType: 'city',
    luggage: [{ type: 'checked', count: 2 }],
    members: [
      { id: 'm1', name: 'Alice', kind: 'adult' },
      { id: 'm2', name: 'Bob', kind: 'adult' },
      { id: 'm3', name: 'Cleo', kind: 'child' },
    ],
    notes: 'client dinner on Friday',
  },
  weather: {
    minTemp: 2,
    maxTemp: 9,
    maxPrecipProbability: 70,
    rainDays: 2,
    isSeasonalEstimate: false,
    source: 'forecast',
  },
  existingItems: [
    { title: 'Passport', category: 'documents', reason: null },
    { title: 'Toothbrush', category: 'toiletries', reason: 'Daily hygiene' },
    { title: 'Rain jacket', category: 'clothing', reason: 'Rain expected' },
    { title: 'Socks', category: 'clothing', reason: null },
  ],
};

const UNAVAILABLE = { items: [], status: 'unavailable' };

const item = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  category: 'misc',
  scope: 'shared',
  quantity: 1,
  reason: 'because',
  ...extra,
});

const envelope = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const envelopeOf = (items: unknown) => envelope(JSON.stringify(items));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('parseGeminiResponse', () => {
  it('parses a valid response', () => {
    const out = parseGeminiResponse(envelopeOf([item('Umbrella'), item('Adapter', { reason: null })]))!;
    expect(out.map((i) => i.title)).toEqual(['Umbrella', 'Adapter']);
    expect(out[1].reason).toBeNull();
  });

  it('caps at 15 items', () => {
    const many = Array.from({ length: 16 }, (_, i) => item(`Item ${i}`));
    expect(parseGeminiResponse(envelopeOf(many))).toHaveLength(MAX_AI_ITEMS);
  });

  it('skips a malformed item and keeps the rest', () => {
    const out = parseGeminiResponse(
      envelopeOf([item('Good'), item('Bad', { category: 'nope' }), { nonsense: true }, item('Fine')]),
    );
    expect(out?.map((i) => i.title)).toEqual(['Good', 'Fine']);
  });

  it('returns [] for a valid empty array', () => {
    expect(parseGeminiResponse(envelopeOf([]))).toEqual([]);
  });

  it('returns null for non-JSON text', () => {
    expect(parseGeminiResponse(envelope('not json {'))).toBeNull();
  });

  it('returns null when text is an object, not an array', () => {
    expect(parseGeminiResponse(envelope(JSON.stringify({ title: 'x' })))).toBeNull();
  });

  it('returns null for a blocked prompt', () => {
    expect(parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toBeNull();
  });

  it('returns null for empty candidates, empty parts and garbage', () => {
    expect(parseGeminiResponse({ candidates: [] })).toBeNull();
    expect(parseGeminiResponse({ candidates: [{ content: { parts: [] } }] })).toBeNull();
    expect(parseGeminiResponse(null)).toBeNull();
    expect(parseGeminiResponse('x')).toBeNull();
  });
});

describe('parseGeminiResponse: thought parts and a real response', () => {
  it('skips thought parts and reads the answer part', () => {
    const answer = JSON.stringify([
      { title: 'Umbrella', category: 'misc', scope: 'shared', quantity: 1, reason: null },
    ]);
    const json = {
      candidates: [
        {
          content: {
            parts: [{ text: 'let me think about London weather', thought: true }, { text: answer }],
          },
        },
      ],
    };
    expect(parseGeminiResponse(json)?.map((i) => i.title)).toEqual(['Umbrella']);
  });

  it('returns null when every part is a thought', () => {
    const json = { candidates: [{ content: { parts: [{ text: '[]', thought: true }] } }] };
    expect(parseGeminiResponse(json)).toBeNull();
  });

  // Trimmed from a real gemini-flash-lite-latest (= gemini-3.5-flash-lite) call, 2026-11-26.
  it('parses a real response and drops the one item over the quantity cap', () => {
    const text = JSON.stringify([
      { title: 'Business Suit', category: 'clothing', scope: 'adult', quantity: 1, reason: 'Required for the client dinner.' },
      { title: 'Dress Shirts', category: 'clothing', scope: 'adult', quantity: 3, reason: 'Business days and evening dining.' },
      { title: 'Wool Overcoat', category: 'clothing', scope: 'adult', quantity: 1, reason: 'Cold December weather in London.' },
      { title: 'UK Power Adapter', category: 'electronics', scope: 'adult', quantity: 1, reason: 'Type G plugs are used in the UK.' },
      { title: 'Business Cards', category: 'documents', scope: 'adult', quantity: 50, reason: 'Handy for networking.' },
    ]);
    const real = {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 237, candidatesTokenCount: 393, totalTokenCount: 630 },
      modelVersion: 'gemini-3.5-flash-lite',
    };
    const out = parseGeminiResponse(real);
    expect(out?.map((i) => i.title)).toEqual([
      'Business Suit',
      'Dress Shirts',
      'Wool Overcoat',
      'UK Power Adapter',
    ]);
  });
});

describe('buildPrompt', () => {
  it('includes trip facts, notes and existing items but no member names', () => {
    const prompt = buildPrompt(req);
    expect(prompt).not.toContain('Alice');
    expect(prompt).not.toContain('Bob');
    expect(prompt).not.toContain('Cleo');
    expect(prompt).not.toContain('m1');
    expect(prompt).toContain('2 adults, 1 child');
    expect(prompt).toContain('London, United Kingdom');
    expect(prompt).toContain('3 days');
    expect(prompt).toContain('2× checked');
    expect(prompt).toContain('client dinner on Friday');
    expect(prompt).toContain('Passport');
    expect(prompt).toContain('Toothbrush');
    expect(prompt).toContain('2–9 °C');
  });

  it('lists existing items under the header, grouped by category in CATEGORIES order', () => {
    const lines = buildPrompt(req).split('\n');
    const header = lines.indexOf(
      'Already on the list (do NOT suggest these, or other names, variants or substitutes for them):',
    );
    expect(header).toBeGreaterThan(-1);
    expect(lines.slice(header + 1, header + 4)).toEqual([
      '- clothing: Rain jacket (Rain expected); Socks',
      '- toiletries: Toothbrush (Daily hygiene)',
      '- documents: Passport',
    ]);
  });

  it('does not use the old "Do NOT include" line', () => {
    expect(buildPrompt(req)).not.toContain('Do NOT include any of these');
  });

  it('writes (none) under the header when there are no existing items', () => {
    const lines = buildPrompt({ ...req, existingItems: [] }).split('\n');
    const header = lines.indexOf(
      'Already on the list (do NOT suggest these, or other names, variants or substitutes for them):',
    );
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]).toBe('(none)');
  });

  it('contains the quantity, scope and notes rule lines and drops the old quantity line', () => {
    const lines = buildPrompt(req).split('\n');
    expect(lines).toContain(
      '- quantity: for shared it is the total for the group; for everyone/adult/child it is per person (e.g. 1 water bottle each = quantity 1).',
    );
    expect(lines).toContain(
      '- Use scope adult for phones, electronics, documents and money; use child only for items made for children.',
    );
    expect(lines).toContain('- Use the traveler notes for specific clothing or gear.');
    expect(lines).toContain('- Items used in pairs (trekking poles, gloves, shoes) count one per pair.');
    expect(lines).not.toContain('- quantity is a whole number from 1 to 10.');
  });

  it('says unknown when weather is null', () => {
    expect(buildPrompt({ ...req, weather: null })).toContain('Weather: unknown');
  });

  it('omits the notes block when there are no notes', () => {
    const prompt = buildPrompt({ ...req, trip: { ...req.trip, notes: undefined } });
    expect(prompt).not.toContain('<<<NOTES');
  });
});

describe('getAiSuggestions', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const warnedText = () => JSON.stringify(warn.mock.calls);

  it('returns parsed items and sends the right request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(envelopeOf([item('Umbrella')])));
    vi.stubGlobal('fetch', fetchMock);

    const out = await getAiSuggestions(req, KEY);

    expect(out.status).toBe('ok');
    expect(out.items.map((i) => i.title)).toEqual(['Umbrella']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GEMINI_URL);
    expect(url).not.toContain('key=');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(url).toContain('gemini-3.5-flash-lite');
    expect(body.generationConfig.responseSchema.type).toBe('ARRAY');
    expect(body.generationConfig.responseSchema.items.properties.quantity).toMatchObject({
      minimum: 1,
      maximum: 10,
    });
    expect(body.contents[0].parts[0].text).toContain('London');
    expect(body.generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBe(2500);
  });

  it('is unavailable without calling fetch when the key is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getAiSuggestions(req, undefined)).toEqual(UNAVAILABLE);
    expect(await getAiSuggestions(req, '')).toEqual(UNAVAILABLE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is unavailable on HTTP 500 and does not log the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'echoed prompt London' }, 500)));
    expect(await getAiSuggestions(req, KEY)).toEqual(UNAVAILABLE);
    expect(warn).toHaveBeenCalledWith('[gemini] HTTP', 500);
    expect(warnedText()).not.toContain('echoed');
  });

  it('is unavailable on a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError');
    }));
    expect(await getAiSuggestions(req, KEY)).toEqual(UNAVAILABLE);
  });

  it('is unavailable on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    expect(await getAiSuggestions(req, KEY)).toEqual(UNAVAILABLE);
  });

  it('is unavailable without fetching when the caller signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    expect(await getAiSuggestions(req, KEY, controller.signal)).toEqual(UNAVAILABLE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is unavailable when the caller aborts mid-flight', async () => {
    const caller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    ));
    const pending = getAiSuggestions(req, KEY, caller.signal);
    caller.abort();
    expect(await pending).toEqual(UNAVAILABLE);
  });

  it.each([
    ['a blocked prompt', { promptFeedback: { blockReason: 'SAFETY' } }],
    ['no candidates', { candidates: [] }],
    ['a candidate blocked without content', { candidates: [{ finishReason: 'SAFETY' }] }],
    ['non-JSON text', envelope('not json {')],
    ['a non-array answer', envelope('{}')],
  ])('is unavailable for %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)));
    expect(await getAiSuggestions(req, KEY)).toEqual(UNAVAILABLE);
    expect(warn).toHaveBeenCalledWith('[gemini] unparseable response');
  });

  it.each([
    ['cut-off JSON', { content: { parts: [{ text: '[{"title":"Umb' }] }, finishReason: 'MAX_TOKENS' }],
    ['no parts at all', { content: {}, finishReason: 'MAX_TOKENS' }],
  ])('is unavailable and logs truncation for %s', async (_label, candidate) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ candidates: [candidate] })));
    expect(await getAiSuggestions(req, KEY)).toEqual(UNAVAILABLE);
    expect(warn).toHaveBeenCalledWith('[gemini] truncated');
  });

  it('is empty when the model returns an empty array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(envelopeOf([]))));
    expect(await getAiSuggestions(req, KEY)).toEqual({ items: [], status: 'empty' });
    expect(warn).toHaveBeenCalledWith('[gemini] no valid items');
  });

  it('is empty when every item is invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(envelopeOf([item('Bad', { category: 'nope' }), { nonsense: true }])),
    ));
    expect(await getAiSuggestions(req, KEY)).toEqual({ items: [], status: 'empty' });
  });

  it('is unavailable when the response body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    expect(await getAiSuggestions(req, KEY)).toEqual(UNAVAILABLE);
  });

  it('never logs the key or the prompt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));
    await getAiSuggestions(req, KEY);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('boom');
    }));
    await getAiSuggestions(req, KEY);
    await getAiSuggestions(req, undefined);
    expect(warn).toHaveBeenCalled();
    expect(warnedText()).not.toContain(KEY);
    expect(warnedText()).not.toContain('client dinner');
  });

  describe('retry', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const ok = () => jsonResponse(envelopeOf([item('Umbrella')]));
    const status = (code: number) => jsonResponse({ error: 'x' }, code);

    it('exports the retry constants', () => {
      expect([...RETRY_STATUSES]).toEqual([429, 503]);
      expect(RETRY_DELAY_MS).toBe(500);
    });

    it.each([503, 429])('retries once after HTTP %i and returns the items', async (code) => {
      vi.useFakeTimers();
      const fetchMock = vi.fn()
        .mockImplementationOnce(async () => status(code))
        .mockImplementationOnce(async () => ok());
      vi.stubGlobal('fetch', fetchMock);

      const pending = getAiSuggestions(req, KEY);
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      const out = await pending;

      expect(out.status).toBe('ok');
      expect(out.items.map((i) => i.title)).toEqual(['Umbrella']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up after two 503s, unavailable with a warning', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(async () => status(503));
      vi.stubGlobal('fetch', fetchMock);

      const pending = getAiSuggestions(req, KEY);
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

      expect(await pending).toEqual(UNAVAILABLE);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalled();
    });

    it('does not retry on HTTP 500', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(async () => status(500));
      vi.stubGlobal('fetch', fetchMock);

      const pending = getAiSuggestions(req, KEY);
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

      expect(await pending).toEqual(UNAVAILABLE);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('is unavailable without a second fetch when the caller aborts during the retry delay', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(async () => status(503));
      vi.stubGlobal('fetch', fetchMock);
      const caller = new AbortController();

      const pending = getAiSuggestions(req, KEY, caller.signal);
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS / 2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      caller.abort();
      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

      expect(await pending).toEqual(UNAVAILABLE);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
