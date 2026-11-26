import { describe, expect, it } from 'vitest';
import {
  BAG_LITERS,
  BASE_RULES,
  CLOTHING_CAPS,
  FAMILY_RULES,
  LUGGAGE_RULES,
  TRIP_TYPE_RULES,
  WEATHER_RULES,
  buildRuleContext,
  computePackingCapacity,
  deriveWeatherFlags,
} from './rules';
import type { PackingCapacity, Rule, RuleContext, WeatherFlags } from './rules';
import { CATEGORIES, TRIP_TYPES } from './types';
import type { LuggageEntry, Member, TripInput, WeatherSummary } from './types';

// ---------- fixture builders ----------

const adult = (id = 'a1'): Member => ({ id, name: `Adult ${id}`, kind: 'adult' });
const child = (id = 'c1'): Member => ({ id, name: `Child ${id}`, kind: 'child' });

const members = (adults: number, children: number): Member[] => [
  ...Array.from({ length: adults }, (_, i) => adult(`a${i + 1}`)),
  ...Array.from({ length: children }, (_, i) => child(`c${i + 1}`)),
];

const trip = (overrides: Partial<TripInput> = {}): TripInput => ({
  city: 'Lisbon',
  latitude: 38.72,
  longitude: -9.14,
  startDate: '2026-06-01',
  endDate: '2026-06-07',
  tripType: 'city',
  luggage: [{ type: 'carryOn', count: 1 }],
  members: [adult()],
  ...overrides,
});

// Trip lasting exactly `days` days, starting 2026-06-01 (days <= 30).
const tripOfDays = (days: number, overrides: Partial<TripInput> = {}): TripInput =>
  trip({ endDate: `2026-06-${String(days).padStart(2, '0')}`, ...overrides });

const weather = (overrides: Partial<WeatherSummary> = {}): WeatherSummary => ({
  minTemp: 12,
  maxTemp: 20,
  maxPrecipProbability: 10,
  rainDays: 0,
  isSeasonalEstimate: false,
  source: 'forecast',
  ...overrides,
});

const entry = (type: LuggageEntry['type'], count = 1): LuggageEntry => ({ type, count });

// Solo traveler luggage that yields each capacity tier.
const LUGGAGE_FOR_TIER: Record<PackingCapacity, LuggageEntry[]> = {
  light: [entry('personal')],
  standard: [entry('carryOn')],
  roomy: [entry('checked')],
  spacious: [entry('checked', 3)],
};

const ALL_TIERS: PackingCapacity[] = ['light', 'standard', 'roomy', 'spacious'];

const noFlags: WeatherFlags = { rain: false, cold: false, freezing: false, heat: false };

// Context built directly: days and capacity are set explicitly, everything else is neutral.
const directCtx = (
  days: number,
  packingCapacity: PackingCapacity,
  overrides: Partial<RuleContext> = {},
): RuleContext => ({
  input: trip(),
  weather: null,
  days,
  hasChildren: false,
  flags: noFlags,
  packingCapacity,
  ...overrides,
});

const ctxFromTrip = (input: TripInput, w: WeatherSummary | null = null): RuleContext =>
  buildRuleContext(input, w);

const luggageCtx = (luggage: LuggageEntry[]): RuleContext => ctxFromTrip(trip({ luggage }));

// ---------- rule helpers ----------

const quantityOf = (rule: Rule, ctx: RuleContext): number =>
  typeof rule.quantity === 'function' ? rule.quantity(ctx) : (rule.quantity ?? 1);

const reasonOf = (rule: Rule, ctx: RuleContext): string | undefined =>
  typeof rule.reason === 'function' ? rule.reason(ctx) : rule.reason;

const appliesIn = (rule: Rule, ctx: RuleContext): boolean => (rule.when ? rule.when(ctx) : true);

const findRule = (group: Rule[], key: string): Rule => {
  const rule = group.find((r) => r.key === key);
  if (!rule) {throw new Error(`Rule "${key}" not found in group`);}

  return rule;
};

const keysOf = (group: Rule[]): string[] => group.map((r) => r.key);

// ---------- tests ----------

describe('deriveWeatherFlags', () => {
  it('returns all flags false for null weather', () => {
    expect(deriveWeatherFlags(null)).toEqual(noFlags);
  });

  it('flags rain when rainDays is 1 even with low probability', () => {
    const flags = deriveWeatherFlags(weather({ rainDays: 1, maxPrecipProbability: 0 }));
    expect(flags.rain).toBe(true);
  });

  it('flags rain when maxPrecipProbability is 50 even with no rain days', () => {
    const flags = deriveWeatherFlags(weather({ rainDays: 0, maxPrecipProbability: 50 }));
    expect(flags.rain).toBe(true);
  });

  it('does not flag rain at probability 49 with no rain days', () => {
    const flags = deriveWeatherFlags(weather({ rainDays: 0, maxPrecipProbability: 49 }));
    expect(flags.rain).toBe(false);
  });

  it('flags cold when minTemp is exactly 8', () => {
    expect(deriveWeatherFlags(weather({ minTemp: 8 })).cold).toBe(true);
  });

  it('does not flag cold when minTemp is 9', () => {
    expect(deriveWeatherFlags(weather({ minTemp: 9 })).cold).toBe(false);
  });

  it('flags freezing when minTemp is exactly 0', () => {
    expect(deriveWeatherFlags(weather({ minTemp: 0 })).freezing).toBe(true);
  });

  it('does not flag freezing when minTemp is above 0', () => {
    expect(deriveWeatherFlags(weather({ minTemp: 0.1 })).freezing).toBe(false);
  });

  it('flags heat when maxTemp is exactly 27', () => {
    expect(deriveWeatherFlags(weather({ maxTemp: 27 })).heat).toBe(true);
  });

  it('does not flag heat when maxTemp is 26.9', () => {
    expect(deriveWeatherFlags(weather({ maxTemp: 26.9 })).heat).toBe(false);
  });
});

describe('buildRuleContext', () => {
  it('computes days as 1 for a same-day trip', () => {
    const ctx = ctxFromTrip(trip({ startDate: '2026-06-01', endDate: '2026-06-01' }));
    expect(ctx.days).toBe(1);
  });

  it('computes days inclusively for a one-week trip', () => {
    const ctx = ctxFromTrip(trip({ startDate: '2026-06-01', endDate: '2026-06-07' }));
    expect(ctx.days).toBe(7);
  });

  it('sets hasChildren true when a member is a child', () => {
    expect(ctxFromTrip(trip({ members: members(1, 1) })).hasChildren).toBe(true);
  });

  it('sets hasChildren false when all members are adults', () => {
    expect(ctxFromTrip(trip({ members: members(2, 0) })).hasChildren).toBe(false);
  });

  it('derives flags from the weather', () => {
    const w = weather({ rainDays: 2, minTemp: -3, maxTemp: 5 });
    expect(ctxFromTrip(trip(), w).flags).toEqual(deriveWeatherFlags(w));
  });

  it('has all-false flags and null weather when weather is null', () => {
    const ctx = ctxFromTrip(trip(), null);
    expect(ctx.weather).toBeNull();
    expect(ctx.flags).toEqual(noFlags);
  });

  it('passes the input and weather through', () => {
    const input = trip();
    const w = weather();
    const ctx = buildRuleContext(input, w);
    expect(ctx.input).toBe(input);
    expect(ctx.weather).toBe(w);
  });

  it('sets packingCapacity from computePackingCapacity', () => {
    const input = trip({ luggage: [entry('checked', 3)], members: members(2, 1) });
    expect(ctxFromTrip(input).packingCapacity).toBe(computePackingCapacity(input));
  });
});

describe('BAG_LITERS', () => {
  it('defines liters per bag type', () => {
    expect(BAG_LITERS).toEqual({ personal: 20, carryOn: 40, checked: 90 });
  });
});

describe('computePackingCapacity', () => {
  it.each<[string, TripInput, PackingCapacity]>([
    ['solo + 3 checked (270L)', trip({ luggage: [entry('checked', 3)] }), 'spacious'],
    ['solo + 1 checked (90L)', trip({ luggage: [entry('checked')] }), 'roomy'],
    ['solo + 1 carryOn (40L)', trip({ luggage: [entry('carryOn')] }), 'standard'],
    ['solo + personal only (20L)', trip({ luggage: [entry('personal')] }), 'light'],
    ['solo + 2 carryOn (80L)', trip({ luggage: [entry('carryOn', 2)] }), 'roomy'],
    [
      '2 adults + 2 children, 1 checked + 2 carryOn (170L / 3 units)',
      trip({
        members: members(2, 2),
        luggage: [entry('checked'), entry('carryOn', 2)],
      }),
      'standard',
    ],
  ])('classifies %s', (_label, input, expected) => {
    expect(computePackingCapacity(input)).toBe(expected);
  });

  it('counts a child as half a traveler unit', () => {
    // 90L / (1 adult + 0.5 child = 1.5 units) = 60 -> standard; solo would be roomy.
    const input = trip({ members: members(1, 1), luggage: [entry('checked')] });
    expect(computePackingCapacity(input)).toBe('standard');
  });

  it('sums liters across several luggage entries', () => {
    // checked 90 + personal 20 = 110L solo -> roomy
    const input = trip({ luggage: [entry('checked'), entry('personal')] });
    expect(computePackingCapacity(input)).toBe('roomy');
  });

  describe('tier boundaries', () => {
    it('is light just under 30 L per unit (80L / 3 units = 26.7)', () => {
      const input = trip({ members: members(3, 0), luggage: [entry('personal', 4)] });
      expect(computePackingCapacity(input)).toBe('light');
    });

    it('is standard at exactly 30 L per unit (90L / 3 units)', () => {
      const input = trip({ members: members(3, 0), luggage: [entry('checked')] });
      expect(computePackingCapacity(input)).toBe('standard');
    });

    it('is standard just under 70 L per unit (130L / 2 units = 65)', () => {
      const input = trip({
        members: members(2, 0),
        luggage: [entry('checked'), entry('carryOn')],
      });
      expect(computePackingCapacity(input)).toBe('standard');
    });

    it('is roomy at exactly 70 L per unit (140L / 2 units)', () => {
      const input = trip({
        members: members(2, 0),
        luggage: [entry('personal', 3), entry('carryOn', 2)],
      });
      expect(computePackingCapacity(input)).toBe('roomy');
    });

    it('is roomy just under 120 L per unit (110L solo)', () => {
      const input = trip({ luggage: [entry('checked'), entry('personal')] });
      expect(computePackingCapacity(input)).toBe('roomy');
    });

    it('is spacious at exactly 120 L per unit (120L solo)', () => {
      const input = trip({ luggage: [entry('carryOn', 3)] });
      expect(computePackingCapacity(input)).toBe('spacious');
    });
  });
});

describe('clothing quantities', () => {
  const UNDERWEAR_CAPS: Record<PackingCapacity, number> = {
    light: 4,
    standard: 7,
    roomy: 10,
    spacious: 10,
  };
  const TSHIRT_CAPS: Record<PackingCapacity, number> = {
    light: 3,
    standard: 5,
    roomy: 7,
    spacious: 7,
  };

  it.each(['underwear', 'socks', 't-shirts'])('%s is an everyone clothing rule', (key) => {
    const rule = findRule(BASE_RULES, key);
    expect(rule.appliesTo).toBe('everyone');
    expect(rule.category).toBe('clothing');
  });

  describe.each(['underwear', 'socks'])('%s', (key) => {
    const rule = findRule(BASE_RULES, key);

    it.each(ALL_TIERS)('is 2 for a 1-day trip at %s capacity', (tier) => {
      expect(quantityOf(rule, directCtx(1, tier))).toBe(2);
    });

    it.each(ALL_TIERS)('is capped at the %s cap for a 13-day trip', (tier) => {
      expect(quantityOf(rule, directCtx(13, tier))).toBe(UNDERWEAR_CAPS[tier]);
    });

    it('is days + 1 when under the cap', () => {
      expect(quantityOf(rule, directCtx(4, 'standard'))).toBe(5);
    });

    it('reaches the cap exactly when days + 1 equals it', () => {
      expect(quantityOf(rule, directCtx(6, 'standard'))).toBe(7);
    });

    it.each(ALL_TIERS)('matches the cap at %s via buildRuleContext', (tier) => {
      const ctx = ctxFromTrip(tripOfDays(13, { luggage: LUGGAGE_FOR_TIER[tier] }));
      expect(ctx.packingCapacity).toBe(tier);
      expect(quantityOf(rule, ctx)).toBe(UNDERWEAR_CAPS[tier]);
    });
  });

  describe('t-shirts', () => {
    const rule = findRule(BASE_RULES, 't-shirts');

    it.each(ALL_TIERS)('is capped at the %s cap for a 13-day trip', (tier) => {
      expect(quantityOf(rule, directCtx(13, tier))).toBe(TSHIRT_CAPS[tier]);
    });

    it('is 1 for a 1-day trip at every tier', () => {
      for (const tier of ALL_TIERS) {
        expect(quantityOf(rule, directCtx(1, tier))).toBe(1);
      }
    });

    it('equals days when under the cap', () => {
      expect(quantityOf(rule, directCtx(4, 'standard'))).toBe(4);
    });

    it.each(ALL_TIERS)('matches the cap at %s via buildRuleContext', (tier) => {
      const ctx = ctxFromTrip(tripOfDays(13, { luggage: LUGGAGE_FOR_TIER[tier] }));
      expect(quantityOf(rule, ctx)).toBe(TSHIRT_CAPS[tier]);
    });
  });
});

describe('business formal-outfit', () => {
  const rule = findRule(TRIP_TYPE_RULES.business, 'formal-outfit');

  it('is 2 for a 3-day trip at standard capacity', () => {
    expect(quantityOf(rule, directCtx(3, 'standard'))).toBe(2);
  });

  it('is capped at 3 for a 14-day trip at standard capacity', () => {
    expect(quantityOf(rule, directCtx(14, 'standard'))).toBe(3);
  });

  it.each<[PackingCapacity, number]>([
    ['light', 2],
    ['standard', 3],
    ['roomy', 5],
    ['spacious', 7],
  ])('is capped at the %s cap for a 30-day trip', (tier, cap) => {
    expect(quantityOf(rule, directCtx(30, tier))).toBe(cap);
  });

  it('is 1 for a 1-day trip', () => {
    expect(quantityOf(rule, directCtx(1, 'standard'))).toBe(1);
  });

  it.each(['formal-outfit', 'laptop', 'laptop-charger', 'dress-shoes'])(
    '%s applies to adults',
    (key) => {
      expect(findRule(TRIP_TYPE_RULES.business, key).appliesTo).toBe('adult');
    },
  );
});

describe('laundry-kit', () => {
  const rule = findRule(BASE_RULES, 'laundry-kit');
  const UNDERWEAR_CAP: Record<PackingCapacity, number> = {
    light: 4,
    standard: 7,
    roomy: 10,
    spacious: 10,
  };

  it('is a shared misc rule', () => {
    expect(rule.appliesTo).toBe('shared');
    expect(rule.category).toBe('misc');
  });

  it('is absent for a 5-day trip at standard capacity', () => {
    expect(appliesIn(rule, directCtx(5, 'standard'))).toBe(false);
  });

  it('is present for a 10-day trip at standard capacity', () => {
    expect(appliesIn(rule, directCtx(10, 'standard'))).toBe(true);
  });

  it('is absent for a 9-day trip at roomy capacity', () => {
    expect(appliesIn(rule, directCtx(9, 'roomy'))).toBe(false);
  });

  it.each(ALL_TIERS)('is absent when days + 1 equals the %s underwear cap', (tier) => {
    expect(appliesIn(rule, directCtx(UNDERWEAR_CAP[tier] - 1, tier))).toBe(false);
  });

  it.each(ALL_TIERS)('is present when days + 1 exceeds the %s underwear cap', (tier) => {
    expect(appliesIn(rule, directCtx(UNDERWEAR_CAP[tier], tier))).toBe(true);
  });

  it('mentions 1 wash for a 10-day standard trip', () => {
    expect(reasonOf(rule, directCtx(10, 'standard'))).toContain('1 wash');
  });

  it('mentions 2 washes for a 20-day standard trip', () => {
    expect(reasonOf(rule, directCtx(20, 'standard'))).toContain('2');
  });
});

describe('WEATHER_RULES', () => {
  const flagCtx = (flags: Partial<WeatherFlags>, w: WeatherSummary | null = null): RuleContext =>
    directCtx(7, 'standard', { flags: { ...noFlags, ...flags }, weather: w });

  const GROUPS: Array<[keyof WeatherFlags, string[]]> = [
    ['rain', ['rain-jacket', 'umbrella']],
    ['cold', ['warm-jacket', 'sweater']],
    ['freezing', ['gloves', 'warm-hat', 'thermal-layer']],
    ['heat', ['sunscreen', 'sunglasses', 'sun-cap']],
  ];

  describe.each(GROUPS)('%s flag', (flag, keys) => {
    it.each(keys)(`%s applies when ${String(flag)} is set`, (key) => {
      expect(appliesIn(findRule(WEATHER_RULES, key), flagCtx({ [flag]: true }))).toBe(true);
    });

    it.each(keys)(`%s does not apply without ${String(flag)}`, (key) => {
      expect(appliesIn(findRule(WEATHER_RULES, key), flagCtx({}))).toBe(false);
    });
  });

  it('does not apply to other flags only', () => {
    const rule = findRule(WEATHER_RULES, 'umbrella');
    expect(appliesIn(rule, flagCtx({ cold: true, freezing: true, heat: true }))).toBe(false);
  });

  it.each([
    ['rain-jacket', 'everyone'],
    ['umbrella', 'shared'],
    ['sunscreen', 'shared'],
  ])('%s has scope %s', (key, scope) => {
    expect(findRule(WEATHER_RULES, key).appliesTo).toBe(scope);
  });

  it('applies no weather rule when weather is null', () => {
    const ctx = ctxFromTrip(trip(), null);
    for (const rule of WEATHER_RULES) {
      expect(appliesIn(rule, ctx), rule.key).toBe(false);
    }
  });

  describe('reasons', () => {
    const rainJacket = findRule(WEATHER_RULES, 'rain-jacket');
    const warmJacket = findRule(WEATHER_RULES, 'warm-jacket');
    const sunscreen = findRule(WEATHER_RULES, 'sunscreen');

    it('states the number of rain days', () => {
      const ctx = ctxFromTrip(trip(), weather({ rainDays: 3 }));
      expect(reasonOf(rainJacket, ctx)).toContain('Rain expected on 3 days');
    });

    it('states the precipitation probability when there are no rain days', () => {
      const ctx = ctxFromTrip(trip(), weather({ rainDays: 0, maxPrecipProbability: 60 }));
      expect(reasonOf(rainJacket, ctx)).toContain('60%');
    });

    it('states the minimum temperature for cold', () => {
      const ctx = ctxFromTrip(trip(), weather({ minTemp: 5 }));
      expect(reasonOf(warmJacket, ctx)).toContain('5');
    });

    it('states the maximum temperature for heat', () => {
      const ctx = ctxFromTrip(trip(), weather({ maxTemp: 31 }));
      expect(reasonOf(sunscreen, ctx)).toContain('31');
    });

    it.each([
      ['rain-jacket', { rainDays: 2 }],
      ['warm-jacket', { minTemp: 4 }],
      ['sunscreen', { maxTemp: 30 }],
    ])('%s appends the seasonal-estimate suffix for seasonal weather', (key, overrides) => {
      const ctx = ctxFromTrip(trip(), weather({ ...overrides, isSeasonalEstimate: true }));
      expect(reasonOf(findRule(WEATHER_RULES, key), ctx)).toContain(' (seasonal estimate)');
    });

    it.each([
      ['rain-jacket', { rainDays: 2 }],
      ['warm-jacket', { minTemp: 4 }],
      ['sunscreen', { maxTemp: 30 }],
    ])('%s omits the seasonal-estimate suffix for forecast weather', (key, overrides) => {
      const ctx = ctxFromTrip(trip(), weather({ ...overrides, isSeasonalEstimate: false }));
      expect(reasonOf(findRule(WEATHER_RULES, key), ctx)).not.toContain('seasonal estimate');
    });
  });
});

describe('LUGGAGE_RULES', () => {
  describe.each(['liquids-kit', 'clear-zip-bag'])('%s', (key) => {
    const rule = findRule(LUGGAGE_RULES, key);

    it('is a shared toiletries rule', () => {
      expect(rule.appliesTo).toBe('shared');
      expect(rule.category).toBe('toiletries');
    });

    it('applies with carryOn only', () => {
      expect(appliesIn(rule, luggageCtx([entry('carryOn')]))).toBe(true);
    });

    it('applies with personal only', () => {
      expect(appliesIn(rule, luggageCtx([entry('personal')]))).toBe(true);
    });

    it('does not apply with checked only', () => {
      expect(appliesIn(rule, luggageCtx([entry('checked')]))).toBe(false);
    });

    it('does not apply with checked and carryOn', () => {
      expect(appliesIn(rule, luggageCtx([entry('checked'), entry('carryOn')]))).toBe(false);
    });
  });

  // The spare outfit is per person (a delayed bag leaves everyone without clothes);
  // meds & valuables are one shared pouch.
  describe.each([
    ['carry-on-spare-outfit', 'Spare outfit in carry-on', 'everyone'],
    ['carry-on-meds-valuables', 'Meds & valuables in carry-on', 'shared'],
  ])('%s', (key, title, scope) => {
    const rule = findRule(LUGGAGE_RULES, key);

    it('has the expected title, misc category and scope', () => {
      expect(rule.title).toBe(title);
      expect(rule.category).toBe('misc');
      expect(rule.appliesTo).toBe(scope);
    });

    it('applies with checked and carryOn', () => {
      expect(appliesIn(rule, luggageCtx([entry('checked'), entry('carryOn')]))).toBe(true);
    });

    it('applies with checked and personal', () => {
      expect(appliesIn(rule, luggageCtx([entry('checked'), entry('personal')]))).toBe(true);
    });

    it('does not apply with checked only', () => {
      expect(appliesIn(rule, luggageCtx([entry('checked')]))).toBe(false);
    });

    it('does not apply with carryOn only', () => {
      expect(appliesIn(rule, luggageCtx([entry('carryOn')]))).toBe(false);
    });
  });
});

describe('FAMILY_RULES', () => {
  const withChildren = ctxFromTrip(trip({ members: members(1, 1) }));
  const withoutChildren = ctxFromTrip(trip({ members: members(2, 0) }));

  it.each(FAMILY_RULES.map((r: Rule) => [r.key, r] as const))(
    '%s applies only when there are children',
    (_key, rule) => {
      expect(appliesIn(rule, withoutChildren)).toBe(false);
      expect(appliesIn(rule, withChildren)).toBe(true);
    },
  );

  it.each(['baby-wipes', 'kids-snacks'])('%s is shared', (key) => {
    expect(findRule(FAMILY_RULES, key).appliesTo).toBe('shared');
  });

  it.each(['favorite-toy', 'kids-entertainment'])('%s applies to child', (key) => {
    expect(findRule(FAMILY_RULES, key).appliesTo).toBe('child');
  });

  it.each(['favorite-toy', 'kids-entertainment'])('%s is in the kids category', (key) => {
    expect(findRule(FAMILY_RULES, key).category).toBe('kids');
  });
});

describe('TRIP_TYPE_RULES', () => {
  const EXPECTED: Record<string, string[]> = {
    city: ['walking-shoes', 'day-bag'],
    mountains: ['hiking-boots', 'fleece', 'water-bottle', 'headlamp'],
    beach: [
      'swimwear',
      'beach-towel',
      'flip-flops',
      'after-sun',
      'insect-repellent',
      'beach-bag',
    ],
    business: [
      'formal-outfit',
      'laptop',
      'laptop-charger',
      'dress-shoes',
      'casual-shoes',
      'laptop-bag',
    ],
  };

  it.each(Object.entries(EXPECTED))('%s has exactly the expected rule keys', (type, keys) => {
    const actual = keysOf(TRIP_TYPE_RULES[type as keyof typeof TRIP_TYPE_RULES]);
    expect([...actual].sort()).toEqual([...keys].sort());
  });

  it.each(TRIP_TYPES)('%s has at least one rule', (type) => {
    expect(TRIP_TYPE_RULES[type].length).toBeGreaterThan(0);
  });

  it.each(['hiking-boots', 'fleece', 'water-bottle'])('mountains %s applies to everyone', (key) => {
    expect(findRule(TRIP_TYPE_RULES.mountains, key).appliesTo).toBe('everyone');
  });

  it('mountains headlamp is shared', () => {
    expect(findRule(TRIP_TYPE_RULES.mountains, 'headlamp').appliesTo).toBe('shared');
  });

  it.each(['swimwear', 'beach-towel', 'flip-flops'])('beach %s applies to everyone', (key) => {
    expect(findRule(TRIP_TYPE_RULES.beach, key).appliesTo).toBe('everyone');
  });

  it('beach after-sun is shared', () => {
    expect(findRule(TRIP_TYPE_RULES.beach, 'after-sun').appliesTo).toBe('shared');
  });
});

describe('BASE_RULES', () => {
  const EVERYONE = [
    'passport-id',
    'toothbrush',
    'underwear',
    'socks',
    't-shirts',
    'sleepwear',
    'medications',
  ];
  const SHARED = ['power-bank', 'toothpaste', 'first-aid-kit', 'laundry-kit'];

  it('contains every expected key', () => {
    expect(keysOf(BASE_RULES)).toEqual(expect.arrayContaining([...EVERYONE, ...SHARED]));
  });

  it.each(EVERYONE)('%s applies to everyone', (key) => {
    expect(findRule(BASE_RULES, key).appliesTo).toBe('everyone');
  });

  it.each(SHARED)('%s is shared', (key) => {
    expect(findRule(BASE_RULES, key).appliesTo).toBe('shared');
  });
});

describe('rule integrity', () => {
  const ALL_RULES: Rule[] = [
    ...BASE_RULES,
    ...WEATHER_RULES,
    ...Object.values(TRIP_TYPE_RULES).flat(),
    ...LUGGAGE_RULES,
    ...FAMILY_RULES,
  ];

  it('has unique keys across all groups', () => {
    const keys = keysOf(ALL_RULES);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a non-empty key on every rule', () => {
    for (const rule of ALL_RULES) {
      expect(rule.key.length, `key of "${rule.title}"`).toBeGreaterThan(0);
    }
  });

  it('has a non-empty title on every rule', () => {
    for (const rule of ALL_RULES) {
      expect(rule.title.length, `title of ${rule.key}`).toBeGreaterThan(0);
    }
  });

  it('uses a valid category on every rule', () => {
    for (const rule of ALL_RULES) {
      expect(CATEGORIES, rule.key).toContain(rule.category);
    }
  });

  it('uses a valid appliesTo on every rule', () => {
    for (const rule of ALL_RULES) {
      expect(['shared', 'everyone', 'adult', 'child'], rule.key).toContain(rule.appliesTo);
    }
  });
});

describe('CLOTHING_CAPS', () => {
  it('pins the documented cap values per tier', () => {
    expect(CLOTHING_CAPS).toEqual({
      light: { underwear: 4, tshirts: 3, formal: 2 },
      standard: { underwear: 7, tshirts: 5, formal: 3 },
      roomy: { underwear: 10, tshirts: 7, formal: 5 },
      spacious: { underwear: 10, tshirts: 7, formal: 7 },
    });
  });

  it('never shrinks as capacity grows', () => {
    for (const field of ['underwear', 'tshirts', 'formal'] as const) {
      const values = ALL_TIERS.map((tier) => CLOTHING_CAPS[tier][field]);
      expect(values).toEqual([...values].sort((a, b) => a - b));
    }
  });

  // 40 days is far beyond every cap, so each rule must return exactly its table cap.
  it.each(ALL_TIERS)('rule quantities reach the table caps on a long %s trip', (tier) => {
    const ctx = directCtx(40, tier);
    const caps = CLOTHING_CAPS[tier];
    expect(quantityOf(findRule(BASE_RULES, 'underwear'), ctx)).toBe(caps.underwear);
    expect(quantityOf(findRule(BASE_RULES, 'socks'), ctx)).toBe(caps.underwear);
    expect(quantityOf(findRule(BASE_RULES, 't-shirts'), ctx)).toBe(caps.tshirts);
    expect(quantityOf(findRule(TRIP_TYPE_RULES.business, 'formal-outfit'), ctx)).toBe(caps.formal);
  });

  // One day below the cap the rules follow the days, not the table.
  it.each(ALL_TIERS)('underwear is days+1 just under the %s cap', (tier) => {
    const days = CLOTHING_CAPS[tier].underwear - 2;
    expect(quantityOf(findRule(BASE_RULES, 'underwear'), directCtx(days, tier))).toBe(days + 1);
  });

  it.each(ALL_TIERS)('laundry-kit switches on exactly when days+1 passes the %s cap', (tier) => {
    const cap = CLOTHING_CAPS[tier].underwear;
    const kit = findRule(BASE_RULES, 'laundry-kit');
    expect(appliesIn(kit, directCtx(cap - 1, tier))).toBe(false);
    expect(appliesIn(kit, directCtx(cap, tier))).toBe(true);
  });
});

describe('reviewer fixes', () => {
  it('bottoms: one per ~3 days plus one, capped at 4, for everyone', () => {
    const rule = findRule(BASE_RULES, 'bottoms');
    expect(rule.appliesTo).toBe('everyone');
    expect(rule.category).toBe('clothing');
    expect(quantityOf(rule, directCtx(1, 'standard'))).toBe(2);
    expect(quantityOf(rule, directCtx(3, 'standard'))).toBe(2);
    expect(quantityOf(rule, directCtx(7, 'standard'))).toBe(4);
    expect(quantityOf(rule, directCtx(30, 'standard'))).toBe(4);
  });

  it.each([
    ['wallet-cards', 'adult', 'documents'],
    ['tickets-booking', 'shared', 'documents'],
    ['deodorant', 'adult', 'toiletries'],
    ['shampoo-soap', 'shared', 'toiletries'],
    ['razor', 'adult', 'toiletries'],
    ['hairbrush', 'everyone', 'toiletries'],
    ['phone-charger', 'adult', 'electronics'],
  ])('base essential %s is %s / %s', (key, scope, category) => {
    const rule = findRule(BASE_RULES, key);
    expect(rule.appliesTo).toBe(scope);
    expect(rule.category).toBe(category);
  });

  describe('sun gear on beach trips', () => {
    const sunKeys = ['sunscreen', 'sunglasses', 'sun-cap'];
    const mild = weather({ maxTemp: 22 });

    it.each(sunKeys)('%s applies on a mild beach trip below the heat threshold', (key) => {
      const ctx = ctxFromTrip(trip({ tripType: 'beach' }), mild);
      expect(ctx.flags.heat).toBe(false);
      expect(appliesIn(findRule(WEATHER_RULES, key), ctx)).toBe(true);
    });

    it.each(sunKeys)('%s applies on a beach trip with no weather, without a bogus temperature', (key) => {
      const ctx = ctxFromTrip(trip({ tripType: 'beach' }), null);
      const rule = findRule(WEATHER_RULES, key);
      expect(appliesIn(rule, ctx)).toBe(true);
      expect(reasonOf(rule, ctx)).not.toMatch(/\d/);
    });

    it.each(sunKeys)('%s does not apply on a mild city trip', (key) => {
      expect(appliesIn(findRule(WEATHER_RULES, key), ctxFromTrip(trip(), mild))).toBe(false);
    });

    it('still cites the temperature when it is actually hot', () => {
      const ctx = ctxFromTrip(trip({ tripType: 'beach' }), weather({ maxTemp: 31 }));
      expect(reasonOf(findRule(WEATHER_RULES, 'sunscreen'), ctx)).toContain('31');
    });
  });
});

describe('second reviewer pass', () => {
  const rainy = weather({ rainDays: 3, maxPrecipProbability: 80 });
  const cold = weather({ minTemp: 4, maxTemp: 12 });
  const freezing = weather({ minTemp: -3, maxTemp: 3 });

  it('drops the sweater on cold mountain trips (the fleece covers it) but keeps it elsewhere', () => {
    const sweater = findRule(WEATHER_RULES, 'sweater');
    expect(appliesIn(sweater, ctxFromTrip(trip({ tripType: 'mountains' }), cold))).toBe(false);
    expect(appliesIn(sweater, ctxFromTrip(trip({ tripType: 'city' }), cold))).toBe(true);
  });

  it('packs rain trousers only for rain on a mountain trip', () => {
    const pants = findRule(WEATHER_RULES, 'rain-pants');
    expect(appliesIn(pants, ctxFromTrip(trip({ tripType: 'mountains' }), rainy))).toBe(true);
    expect(appliesIn(pants, ctxFromTrip(trip({ tripType: 'city' }), rainy))).toBe(false);
    expect(appliesIn(pants, ctxFromTrip(trip({ tripType: 'mountains' }), weather()))).toBe(false);
  });

  it.each([
    [12, true],
    [15, true],
    [16, false],
    [8, false],
  ])('light jacket at minTemp %s applies: %s', (minTemp, expected) => {
    const rule = findRule(WEATHER_RULES, 'light-jacket');
    expect(appliesIn(rule, ctxFromTrip(trip(), weather({ minTemp })))).toBe(expected);
  });

  it('does not pack a light jacket without weather', () => {
    expect(appliesIn(findRule(WEATHER_RULES, 'light-jacket'), ctxFromTrip(trip(), null))).toBe(
      false,
    );
  });

  it.each(['scarf', 'warm-socks'])('%s applies only when freezing', (key) => {
    const rule = findRule(WEATHER_RULES, key);
    expect(appliesIn(rule, ctxFromTrip(trip(), freezing))).toBe(true);
    expect(appliesIn(rule, ctxFromTrip(trip(), cold))).toBe(false);
  });

  it('lip balm applies when cold, as one shared item', () => {
    const rule = findRule(WEATHER_RULES, 'lip-balm');
    expect(rule.appliesTo).toBe('shared');
    expect(appliesIn(rule, ctxFromTrip(trip(), cold))).toBe(true);
    expect(appliesIn(rule, ctxFromTrip(trip(), weather()))).toBe(false);
  });

  it('warm socks are capped at 3 pairs', () => {
    const rule = findRule(WEATHER_RULES, 'warm-socks');
    expect(quantityOf(rule, directCtx(2, 'standard'))).toBe(2);
    expect(quantityOf(rule, directCtx(10, 'standard'))).toBe(3);
  });

  it.each([
    [1, 1],
    [7, 1],
    [8, 2],
    [14, 2],
    [15, 3],
  ])('sunscreen for a %s-day trip is %s bottle(s)', (days, expected) => {
    expect(quantityOf(findRule(WEATHER_RULES, 'sunscreen'), directCtx(days, 'standard'))).toBe(
      expected,
    );
  });

  it.each(['sunscreen', 'sunglasses', 'sun-cap'])(
    '%s applies on a mild mountain trip, citing altitude',
    (key) => {
      const ctx = ctxFromTrip(trip({ tripType: 'mountains' }), weather({ maxTemp: 15 }));
      const rule = findRule(WEATHER_RULES, key);
      expect(appliesIn(rule, ctx)).toBe(true);
      expect(reasonOf(rule, ctx)).toContain('altitude');
    },
  );

  it('sun-cap does not apply on a freezing mountain trip, while sunscreen and sunglasses do', () => {
    const ctx = ctxFromTrip(
      trip({ tripType: 'mountains' }),
      weather({ minTemp: -7, maxTemp: -2 }),
    );

    expect(appliesIn(findRule(WEATHER_RULES, 'sun-cap'), ctx)).toBe(false);
    expect(appliesIn(findRule(WEATHER_RULES, 'sunscreen'), ctx)).toBe(true);
    expect(appliesIn(findRule(WEATHER_RULES, 'sunglasses'), ctx)).toBe(true);
  });

  it('business trips pack half as many t-shirts and one casual bottom', () => {
    const business = (days: number) =>
      directCtx(days, 'standard', { input: trip({ tripType: 'business' }) });
    expect(quantityOf(findRule(BASE_RULES, 't-shirts'), business(4))).toBe(2);
    expect(quantityOf(findRule(BASE_RULES, 't-shirts'), business(5))).toBe(3);
    expect(quantityOf(findRule(BASE_RULES, 'bottoms'), business(10))).toBe(1);
  });

  it('city walking shoes mention a waterproof pair when wet or cold, not when dry and mild', () => {
    const shoes = findRule(TRIP_TYPE_RULES.city, 'walking-shoes');
    expect(reasonOf(shoes, ctxFromTrip(trip(), rainy))).toContain('waterproof');
    expect(reasonOf(shoes, ctxFromTrip(trip(), cold))).toContain('waterproof');
    expect(reasonOf(shoes, ctxFromTrip(trip(), weather()))).not.toContain('waterproof');
  });
});
