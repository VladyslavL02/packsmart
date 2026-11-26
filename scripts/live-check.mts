/**
 * Live check of the AI suggestion pipeline against real Gemini and Open-Meteo.
 * Needs `vercel dev` running (default http://localhost:3000, override with LIVE_CHECK_URL).
 * Not part of `npm test` or CI: it costs Gemini quota and depends on the network.
 *
 *   npm run check:ai [-- <output.md>]
 *
 * Prints a PASS/FAIL table and writes the merged lists (with the AI items the merge dropped)
 * to a Markdown file for the rules-reviewer agent.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAiSuggestions } from '../api/_lib/gemini.ts';
import { generateBasePackingList, normalizeTitle } from '../src/engine/generator.ts';
import { AI_MAX_PER_PERSON, mergeItems } from '../src/engine/merge.ts';
import { AiSuggestionSchema } from '../src/engine/types.ts';
import type { SuggestResponse, TripInput } from '../src/engine/types.ts';
import { getTripWeather } from '../src/services/weatherApi.ts';
import { fetchAiSuggestions } from '../src/services/suggestApi.ts';

const BASE_URL = process.env.LIVE_CHECK_URL ?? 'http://localhost:3000';
const OUTPUT = process.argv[2] ?? join(tmpdir(), 'packsmart-live-check.md');
const MAX_LATENCY_MS = 8000;
const MAX_ATTEMPTS = 3;

// fetchAiSuggestions calls the relative /api/suggest like the browser does; point it at vercel dev.
const realFetch = globalThis.fetch;
let lastLatency = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && input.startsWith('/api/')) {
    const started = performance.now();
    try {
      return await realFetch(BASE_URL + input, init);
    } finally {
      lastLatency = performance.now() - started;
    }
  }

  return realFetch(input, init);
}) as typeof fetch;

const trips: TripInput[] = [
  {
    city: 'Bangkok', country: 'Thailand', latitude: 13.75, longitude: 100.5,
    startDate: '2027-07-10', endDate: '2027-07-20', tripType: 'beach',
    luggage: [{ type: 'checked', count: 2 }, { type: 'carryOn', count: 2 }],
    members: [
      { id: 'a1', name: 'Adult 1', kind: 'adult' },
      { id: 'a2', name: 'Adult 2', kind: 'adult' },
      { id: 'c1', name: 'Child 1', kind: 'child' },
      { id: 'c2', name: 'Child 2', kind: 'child' },
    ],
  },
  {
    city: 'London', country: 'United Kingdom', latitude: 51.51, longitude: -0.13,
    startDate: '2027-03-08', endDate: '2027-03-11', tripType: 'business',
    luggage: [{ type: 'carryOn', count: 1 }],
    members: [{ id: 'a1', name: 'Adult 1', kind: 'adult' }],
    notes: 'client dinner',
  },
  {
    city: 'Reykjavik', country: 'Iceland', latitude: 64.15, longitude: -21.94,
    startDate: '2027-02-12', endDate: '2027-02-18', tripType: 'mountains',
    luggage: [{ type: 'checked', count: 2 }],
    members: [
      { id: 'a1', name: 'Adult 1', kind: 'adult' },
      { id: 'a2', name: 'Adult 2', kind: 'adult' },
    ],
  },
];

const report: string[] = ['# PackSmart live check', ''];
const rows: string[] = [];
let allPass = true;

for (const trip of trips) {
  const weather = await getTripWeather(trip);
  const base = generateBasePackingList(trip, weather);

  // The app makes one call; retrying here only separates a Gemini outage from a real bug.
  const statuses: string[] = [];
  let result: SuggestResponse = { items: [], status: 'unavailable' };
  for (let attempt = 0; attempt < MAX_ATTEMPTS && result.status !== 'ok'; attempt++) {
    result = await fetchAiSuggestions(trip, weather, base);
    statuses.push(result.status);
  }
  const ai = result.items;
  const latency = Math.round(lastLatency);

  const baseTitles = new Set(base.map((item) => normalizeTitle(item.title)));
  const collisions = ai.filter((s) => baseTitles.has(normalizeTitle(s.title))).map((s) => s.title);
  const allValid = ai.every((s) => AiSuggestionSchema.safeParse(s).success);
  const merged = mergeItems(base, ai, trip.members);
  const aiRows = merged.filter((item) => item.source === 'ai');
  const keptTitles = new Set(aiRows.map((item) => normalizeTitle(item.title)));
  const dropped = ai
    .filter((s) => !keptTitles.has(normalizeTitle(s.title)))
    .map((s) => `${s.title} (${s.category}/${s.scope})`);
  const maxPerPerson = Math.max(
    0,
    ...aiRows.filter((item) => item.scope !== 'shared').map((item) => item.quantity),
  );
  const badScope = aiRows
    .filter(
      (item) =>
        item.scope === 'child' &&
        (item.category === 'documents' || item.category === 'electronics'),
    )
    .map((item) => `${item.title}@${item.memberId}`);

  const checks = {
    status: result.status === 'ok',
    count: ai.length >= 1 && ai.length <= 15,
    valid: allValid,
    latency: latency < MAX_LATENCY_MS,
    collisions: collisions.length === 0,
    quantity: maxPerPerson <= AI_MAX_PER_PERSON,
    scope: badScope.length === 0,
  };
  const pass = Object.values(checks).every(Boolean);
  if (!pass) {allPass = false;}
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  rows.push(
    `| ${trip.city} | ${statuses.join(' → ')} | ${latency} ms | ${ai.length} | ` +
      `${dropped.length} | ${maxPerPerson} | ${pass ? 'PASS' : `FAIL (${failed.join(', ')})`} |`,
  );
  console.log(`[${trip.city}] dropped by merge: ${dropped.join(' | ') || 'none'}`);

  report.push(
    `## ${trip.city} (${trip.tripType}, ${trip.startDate} → ${trip.endDate}` +
      `${trip.notes ? `, notes: "${trip.notes}"` : ''})`,
    `Members: ${trip.members.map((m) => `${m.id}/${m.kind}`).join(', ')}`,
    `Luggage: ${trip.luggage.map((l) => `${l.count}x ${l.type}`).join(', ')}`,
    `Weather: ${JSON.stringify(weather)}`,
    `AI status: ${statuses.join(' → ')}; base items: ${base.length}, AI suggestions: ${ai.length}, ` +
      `merged: ${merged.length}`,
    `Dropped by merge (exact or synonym match): ${dropped.join(' | ') || 'none'}`,
    '',
    '### Raw AI JSON',
    '```json',
    JSON.stringify(ai, null, 2),
    '```',
    '',
    '### Merged list (AI rows marked **AI**)',
  );
  let category = '';
  for (const item of merged) {
    if (item.category !== category) {
      category = item.category;
      report.push('', `**${category}**`);
    }
    const mark = item.source === 'ai' ? '**AI** ' : '';
    const reason = item.reason ? ` — ${item.reason}` : '';
    report.push(
      `- ${mark}${item.title} ×${item.quantity} [${item.scope}/${item.memberId ?? 'shared'}] ` +
        `(${item.source})${reason}`,
    );
  }
  report.push('', '');
}

// Failure drills on the Gemini client directly: both must report 'unavailable' with no items.
const drillReq = {
  trip: trips[1],
  weather: await getTripWeather(trips[1]),
  existingItems: [],
};
const noKey = await getAiSuggestions(drillReq, undefined);
const badKey = await getAiSuggestions(drillReq, 'bogus-key');
const drillsPass = [noKey, badKey].every((r) => r.status === 'unavailable' && r.items.length === 0);

writeFileSync(OUTPUT, report.join('\n'));

console.log('\n| Trip | Status | Latency | AI items | Dropped | Max/person | Result |');
console.log('|---|---|---|---|---|---|---|');
console.log(rows.join('\n'));
console.log(
  `\nDrills (no key: ${noKey.status}, bogus key: ${badKey.status}): ${drillsPass ? 'PASS' : 'FAIL'}`,
);
console.log(`Report for rules-reviewer: ${OUTPUT}`);
console.log(`OVERALL: ${allPass && drillsPass ? 'PASS' : 'FAIL'}`);
process.exitCode = allPass && drillsPass ? 0 : 1;
