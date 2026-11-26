import { describe, expect, it } from 'vitest';
import { BASE_RULES, FAMILY_RULES, LUGGAGE_RULES, TRIP_TYPE_RULES, WEATHER_RULES } from './rules';
import { RULE_SYNONYMS, isSameItem } from './synonyms';

const base = (key: string | null, title: string) => ({ key, title });

const ruleKeys = new Set(
  [BASE_RULES, WEATHER_RULES, ...Object.values(TRIP_TYPE_RULES), LUGGAGE_RULES, FAMILY_RULES]
    .flat()
    .map((rule) => rule.key),
);

describe('isSameItem: matches', () => {
  it.each([
    ['Sun hat with chin strap', 'sun-cap', 'Cap'],
    ['Kids sun hat', 'sun-cap', 'Cap'],
    ['Sunscreen SPF 50', 'sunscreen', 'Sunscreen'],
    ['Sun cream', 'sunscreen', 'Sunscreen'],
    ['Raincoat', 'rain-jacket', 'Rain jacket'],
    ['Beanie', 'warm-hat', 'Warm hat'],
    ['Passport holder', 'passport-id', 'Passport / ID'],
    ['ID card', 'passport-id', 'Passport / ID'],
    ['Bug spray', 'insect-repellent', 'Insect repellent'],
    ['Insulated water bottle', 'water-bottle', 'Water bottle'],
    ['Swimsuits', 'swimwear', 'Swimwear'],
  ])('%s matches base %s', (aiTitle, key, title) => {
    expect(isSameItem(aiTitle, base(key, title))).toBe(true);
  });

  it('is case and whitespace insensitive', () => {
    expect(isSameItem('  SUN   CREAM ', base('sunscreen', 'Sunscreen'))).toBe(true);
  });
});

describe('isSameItem: no match', () => {
  it('does not match when the AI title is only a part of the base phrase (one-way)', () => {
    expect(isSameItem('Hat', base('warm-hat', 'Warm hat'))).toBe(false);
  });

  it('matches whole words only', () => {
    expect(isSameItem('Capsule wardrobe', base('sun-cap', 'Cap'))).toBe(false);
  });

  it('does not match a rash guard against swimwear', () => {
    expect(isSameItem('Rash guard', base('swimwear', 'Swimwear'))).toBe(false);
  });

  it('does not match sunglasses against sunscreen', () => {
    expect(isSameItem('Sunglasses', base('sunscreen', 'Sunscreen'))).toBe(false);
  });

  it('uses only title phrases when the base key is null', () => {
    expect(isSameItem('Sun cream', base(null, 'Sunscreen'))).toBe(false);
    expect(isSameItem('Sunscreen SPF 50', base(null, 'Sunscreen'))).toBe(true);
  });
});

// Real Gemini titles from live runs. Protecting against duplicates is the priority, so the
// must-drop list below must never shrink without an explicit decision. Balaclava was moved to
// must-keep on purpose: it protects the face, which a warm hat does not.
describe('isSameItem: real Gemini titles', () => {
  it.each([
    ['Aloe vera gel', 'after-sun', 'After-sun lotion'],
    ['Sun hat with chin strap', 'sun-cap', 'Cap'],
    ['Thermos flask', 'water-bottle', 'Water bottle'],
    ['Sun cream', 'sunscreen', 'Sunscreen'],
    ['Travel insurance details', 'tickets-booking', 'Tickets & booking confirmations'],
  ])('drops %s as a duplicate of %s', (aiTitle, key, title) => {
    expect(isSameItem(aiTitle, base(key, title))).toBe(true);
  });

  it.each([
    ['Temple-appropriate pants', 'bottoms', 'Trousers / shorts'],
    ['Motion sickness pills', 'medications', 'Medications'],
    ['Rash guard', 'swimwear', 'Swimwear'],
    ['Balaclava', 'warm-hat', 'Warm hat'],
  ])('keeps %s against %s', (aiTitle, key, title) => {
    expect(isSameItem(aiTitle, base(key, title))).toBe(false);
  });
});

describe('RULE_SYNONYMS', () => {
  it('includes travel insurance for tickets-booking', () => {
    expect(RULE_SYNONYMS['tickets-booking']).toContain('travel insurance');
  });

  it.each(Object.keys(RULE_SYNONYMS))('%s is a key of an existing rule', (key) => {
    expect(ruleKeys.has(key)).toBe(true);
  });

  it('has only non-empty lowercase synonyms', () => {
    for (const phrases of Object.values(RULE_SYNONYMS)) {
      for (const phrase of phrases) {
        expect(phrase.trim().length).toBeGreaterThan(0);
        expect(phrase).toBe(phrase.toLowerCase());
      }
    }
  });
});
