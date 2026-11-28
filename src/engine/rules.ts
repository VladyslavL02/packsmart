import { tripDays } from './dates';
import type { Category, LuggageType, TripInput, TripType, WeatherSummary } from './types';

export type WeatherFlags = { rain: boolean; cold: boolean; freezing: boolean; heat: boolean };
export type PackingCapacity = 'light' | 'standard' | 'roomy' | 'spacious';
type RuleScope = 'shared' | 'everyone' | 'adult' | 'child';

export type RuleContext = {
  input: TripInput;
  weather: WeatherSummary | null;
  days: number;
  hasChildren: boolean;
  flags: WeatherFlags;
  packingCapacity: PackingCapacity;
};

export type Rule = {
  key: string;
  title: string;
  category: Category;
  appliesTo: RuleScope;
  quantity?: number | ((ctx: RuleContext) => number);
  when?: (ctx: RuleContext) => boolean;
  reason?: string | ((ctx: RuleContext) => string);
};

// --- Weather thresholds -------------------------------------------------

const RAIN_PROB_THRESHOLD = 50;
const LIGHT_LAYER_MAX = 15;
const COLD_MAX = 8;
const FREEZING_MAX = 0;
const HEAT_MIN = 27;

export function deriveWeatherFlags(weather: WeatherSummary | null): WeatherFlags {
  if (!weather) {return { rain: false, cold: false, freezing: false, heat: false };}

  // A day that never rises above freezing brings snow, not rain.
  const thaws = weather.maxTemp > FREEZING_MAX;

  return {
    rain: thaws && (weather.rainDays >= 1 || weather.maxPrecipProbability >= RAIN_PROB_THRESHOLD),
    cold: weather.minTemp <= COLD_MAX,
    freezing: weather.minTemp <= FREEZING_MAX,
    heat: weather.maxTemp >= HEAT_MIN,
  };
}

// --- Packing capacity ---------------------------------------------------
// There is no authoritative dataset for "how much to pack". Travel guidance converges on:
// ~1 underwear/socks per day plus a spare, never more than about a week's worth (do laundry),
// and rewear tops. The days set how much is needed; the caps below set how much fits.

/** Typical usable volume per bag, in liters. */
export const BAG_LITERS: Record<LuggageType, number> = {
  personal: 20,
  carryOn: 40,
  checked: 90,
};

/** Children's clothes take about half the room of an adult's. */
const CHILD_SPACE_WEIGHT = 0.5;

/** Liters per traveler unit at which each tier starts. Below the first value is 'light'. */
const CAPACITY_MIN_LITERS: Record<Exclude<PackingCapacity, 'light'>, number> = {
  standard: 30,
  roomy: 70,
  spacious: 120,
};

export const CLOTHING_CAPS: Record<
  PackingCapacity,
  { underwear: number; tshirts: number; formal: number }
> = {
  light: { underwear: 4, tshirts: 3, formal: 2 },
  standard: { underwear: 7, tshirts: 5, formal: 3 },
  roomy: { underwear: 10, tshirts: 7, formal: 5 },
  spacious: { underwear: 10, tshirts: 7, formal: 7 },
};

export function computePackingCapacity(input: TripInput): PackingCapacity {
  const totalLiters = input.luggage.reduce((sum, bag) => sum + bag.count * BAG_LITERS[bag.type], 0);
  const units = input.members.reduce(
    (sum, member) => sum + (member.kind === 'child' ? CHILD_SPACE_WEIGHT : 1),
    0,
  );
  const litersPerUnit = totalLiters / units;
  if (litersPerUnit >= CAPACITY_MIN_LITERS.spacious) {return 'spacious';}
  if (litersPerUnit >= CAPACITY_MIN_LITERS.roomy) {return 'roomy';}
  if (litersPerUnit >= CAPACITY_MIN_LITERS.standard) {return 'standard';}

  return 'light';
}

export function buildRuleContext(input: TripInput, weather: WeatherSummary | null): RuleContext {
  return {
    input,
    weather,
    days: tripDays(input.startDate, input.endDate),
    hasChildren: input.members.some((member) => member.kind === 'child'),
    flags: deriveWeatherFlags(weather),
    packingCapacity: computePackingCapacity(input),
  };
}

// --- Helpers ------------------------------------------------------------

function hasLuggage(ctx: RuleContext, type: LuggageType): boolean {
  return ctx.input.luggage.some((bag) => bag.type === type);
}

function withSeasonalNote(ctx: RuleContext, text: string): string {
  return ctx.weather?.isSeasonalEstimate ? `${text} (seasonal estimate)` : text;
}

function degrees(value: number): string {
  return `${Math.round(value)}°C`;
}

function underwearCap(ctx: RuleContext): number {
  return CLOTHING_CAPS[ctx.packingCapacity].underwear;
}

function washesNeeded(ctx: RuleContext): number {
  return Math.max(0, Math.ceil((ctx.days + 1) / underwearCap(ctx)) - 1);
}

const underwearQuantity = (ctx: RuleContext) => Math.min(ctx.days + 1, underwearCap(ctx));

const warmSocksQuantity = (ctx: RuleContext) => Math.min(ctx.days, 3);

// Flip-flop days on hot or beach trips halve the socks (hiking still needs them), and warm socks
// replace some pairs when freezing.
const socksQuantity = (ctx: RuleContext) => {
  const barefootDays =
    ctx.input.tripType !== 'mountains' && (ctx.input.tripType === 'beach' || ctx.flags.heat);
  const base = barefootDays ? Math.ceil(underwearQuantity(ctx) / 2) : underwearQuantity(ctx);

  return ctx.flags.freezing ? Math.max(1, base - warmSocksQuantity(ctx)) : base;
};

// Bottoms can be worn several times: one per ~3 days plus one, never more than 4.
// On business trips the formal outfits cover most days, so one casual pair is enough.
const bottomsQuantity = (ctx: RuleContext) =>
  ctx.input.tripType === 'business' ? 1 : Math.min(Math.ceil(ctx.days / 3) + 1, 4);

const rainReason = (ctx: RuleContext) =>
  withSeasonalNote(
    ctx,
    ctx.weather && ctx.weather.rainDays >= 1
      ? `Rain expected on ${ctx.weather.rainDays} ${ctx.weather.rainDays === 1 ? 'day' : 'days'}`
      : `Up to ${ctx.weather?.maxPrecipProbability ?? 0}% chance of rain`,
  );
const coldReason = (ctx: RuleContext) =>
  withSeasonalNote(ctx, `Lows around ${degrees(ctx.weather?.minTemp ?? 0)}`);
const freezingReason = (ctx: RuleContext) =>
  withSeasonalNote(ctx, `Lows down to ${degrees(ctx.weather?.minTemp ?? 0)}`);
const heatReason = (ctx: RuleContext) =>
  withSeasonalNote(ctx, `Highs up to ${degrees(ctx.weather?.maxTemp ?? 0)}`);

// Beach and mountain trips need sun gear even when the forecast stays below the heat threshold
// (water reflects the sun, and UV is stronger at altitude).
const needsSunProtection = (ctx: RuleContext) =>
  ctx.flags.heat || ctx.input.tripType === 'beach' || ctx.input.tripType === 'mountains';
const sunReason = (ctx: RuleContext) =>
  ctx.flags.heat
    ? heatReason(ctx)
    : ctx.input.tripType === 'mountains'
      ? 'Stronger sun at altitude'
      : 'Sun exposure on a beach trip';

// Mountain trips get cold hands and ears well above freezing, especially in rain.
const needsHandsAndHead = (ctx: RuleContext) =>
  ctx.flags.freezing || (ctx.flags.cold && ctx.input.tripType === 'mountains');

const onlyWithBags = (ctx: RuleContext) =>
  hasLuggage(ctx, 'checked') && (hasLuggage(ctx, 'carryOn') || hasLuggage(ctx, 'personal'));

// --- Rule groups --------------------------------------------------------

export const BASE_RULES: Rule[] = [
  { key: 'passport-id', title: 'Passport / ID', category: 'documents', appliesTo: 'everyone' },
  {
    key: 'travel-insurance',
    title: 'Travel insurance',
    category: 'documents',
    appliesTo: 'shared',
    reason: 'Medical cover and cancellations',
  },
  { key: 'wallet-cards', title: 'Wallet, cards & cash', category: 'documents', appliesTo: 'adult' },
  {
    key: 'tickets-booking',
    title: 'Tickets & booking confirmations',
    category: 'documents',
    appliesTo: 'shared',
  },
  { key: 'phone-charger', title: 'Phone charger', category: 'electronics', appliesTo: 'adult' },
  { key: 'power-bank', title: 'Power bank', category: 'electronics', appliesTo: 'shared' },
  { key: 'toothbrush', title: 'Toothbrush', category: 'toiletries', appliesTo: 'everyone' },
  { key: 'toothpaste', title: 'Toothpaste', category: 'toiletries', appliesTo: 'shared' },
  { key: 'deodorant', title: 'Deodorant', category: 'toiletries', appliesTo: 'adult' },
  { key: 'shampoo-soap', title: 'Shampoo & soap', category: 'toiletries', appliesTo: 'shared' },
  { key: 'razor', title: 'Razor', category: 'toiletries', appliesTo: 'adult' },
  { key: 'hairbrush', title: 'Hairbrush', category: 'toiletries', appliesTo: 'everyone' },
  {
    key: 'underwear',
    title: 'Underwear',
    category: 'clothing',
    appliesTo: 'everyone',
    quantity: underwearQuantity,
  },
  {
    key: 'socks',
    title: 'Socks',
    category: 'clothing',
    appliesTo: 'everyone',
    quantity: socksQuantity,
  },
  {
    key: 't-shirts',
    title: 'T-shirts',
    category: 'clothing',
    appliesTo: 'everyone',
    // Business trips mostly wear formal outfits, so casual tops are halved.
    // When freezing they are only a base under warm layers, so three are enough.
    quantity: (ctx) =>
      Math.min(
        ctx.input.tripType === 'business' ? Math.ceil(ctx.days / 2) : ctx.days,
        CLOTHING_CAPS[ctx.packingCapacity].tshirts,
        ctx.flags.freezing ? 3 : Infinity,
      ),
  },
  {
    key: 'bottoms',
    title: 'Trousers / shorts',
    category: 'clothing',
    appliesTo: 'everyone',
    quantity: bottomsQuantity,
    when: (ctx) => !ctx.flags.freezing,
  },
  {
    key: 'trousers',
    title: 'Trousers',
    category: 'clothing',
    appliesTo: 'everyone',
    quantity: (ctx) => Math.min(bottomsQuantity(ctx), 3),
    when: (ctx) => ctx.flags.freezing,
    reason: (ctx) => freezingReason(ctx),
  },
  { key: 'sleepwear', title: 'Sleepwear', category: 'clothing', appliesTo: 'everyone' },
  { key: 'medications', title: 'Medications', category: 'health', appliesTo: 'everyone' },
  { key: 'first-aid-kit', title: 'First-aid kit', category: 'health', appliesTo: 'shared' },
  {
    key: 'laundry-kit',
    title: 'Travel laundry kit',
    category: 'misc',
    appliesTo: 'shared',
    when: (ctx) => ctx.days + 1 > underwearCap(ctx),
    reason: (ctx) => {
      const washes = washesNeeded(ctx);

      return `${ctx.days}-day trip: plan ${washes} ${washes === 1 ? 'wash' : 'washes'}`;
    },
  },
];

export const WEATHER_RULES: Rule[] = [
  {
    key: 'rain-jacket',
    title: 'Rain jacket',
    category: 'clothing',
    appliesTo: 'everyone',
    when: (ctx) => ctx.flags.rain,
    reason: rainReason,
  },
  {
    key: 'umbrella',
    title: 'Umbrella',
    category: 'misc',
    appliesTo: 'shared',
    when: (ctx) => ctx.flags.rain,
    reason: rainReason,
  },
  {
    key: 'warm-jacket',
    title: 'Warm jacket',
    category: 'clothing',
    appliesTo: 'everyone',
    when: (ctx) => ctx.flags.cold,
    reason: coldReason,
  },
  {
    key: 'sweater',
    title: 'Sweater',
    category: 'clothing',
    appliesTo: 'everyone',
    // The mountain fleece already covers this layer.
    when: (ctx) => ctx.flags.cold && ctx.input.tripType !== 'mountains',
    reason: coldReason,
  },
  {
    key: 'rain-pants',
    title: 'Rain trousers',
    category: 'clothing',
    appliesTo: 'everyone',
    when: (ctx) => ctx.flags.rain && ctx.input.tripType === 'mountains',
    reason: rainReason,
  },
  {
    key: 'light-jacket',
    title: 'Light jacket',
    category: 'clothing',
    appliesTo: 'everyone',
    // Cool but not cold enough for the warm jacket.
    when: (ctx) => (
      ctx.weather !== null && !ctx.flags.cold && ctx.weather.minTemp <= LIGHT_LAYER_MAX
    ),
    reason: (ctx) =>
      withSeasonalNote(ctx, `Lows around ${degrees(ctx.weather?.minTemp ?? 0)}`),
  },
  {
    key: 'scarf',
    title: 'Scarf',
    category: 'clothing',
    appliesTo: 'everyone',
    when: (ctx) => ctx.flags.freezing,
    reason: freezingReason,
  },
  {
    key: 'warm-socks',
    title: 'Warm socks',
    category: 'clothing',
    appliesTo: 'everyone',
    quantity: warmSocksQuantity,
    when: (ctx) => ctx.flags.freezing,
    reason: freezingReason,
  },
  {
    key: 'lip-balm',
    title: 'Lip balm',
    category: 'toiletries',
    appliesTo: 'everyone',
    when: (ctx) => ctx.flags.cold,
    reason: coldReason,
  },
  {
    key: 'gloves',
    title: 'Gloves',
    category: 'clothing',
    appliesTo: 'everyone',
    when: needsHandsAndHead,
    reason: freezingReason,
  },
  {
    key: 'warm-hat',
    title: 'Warm hat',
    category: 'clothing',
    appliesTo: 'everyone',
    when: needsHandsAndHead,
    reason: freezingReason,
  },
  {
    key: 'thermal-layer',
    title: 'Thermal layer',
    category: 'clothing',
    appliesTo: 'everyone',
    when: (ctx) => ctx.flags.freezing,
    reason: freezingReason,
  },
  {
    key: 'sunscreen',
    title: 'Sunscreen',
    category: 'toiletries',
    appliesTo: 'shared',
    // One bottle lasts about 10 person-days of heavy use (heat or beach) and twice that otherwise.
    // More than four is better bought there.
    quantity: (ctx) => {
      const personDaysPerBottle = ctx.flags.heat || ctx.input.tripType === 'beach' ? 10 : 20;
      const bottles = Math.ceil((ctx.days * ctx.input.members.length) / personDaysPerBottle);

      return Math.min(Math.max(1, bottles), 4);
    },
    when: needsSunProtection,
    reason: sunReason,
  },
  {
    key: 'hand-sanitizer',
    title: 'Hand sanitizer',
    category: 'toiletries',
    appliesTo: 'shared',
    when: (ctx) => ctx.flags.heat,
    reason: heatReason,
  },
  {
    key: 'sunglasses',
    title: 'Sunglasses',
    category: 'clothing',
    appliesTo: 'everyone',
    when: needsSunProtection,
    reason: sunReason,
  },
  {
    key: 'sun-cap',
    title: 'Cap',
    category: 'clothing',
    appliesTo: 'everyone',
    // In freezing or cold-mountain weather the Warm hat covers the head; sunglasses and sunscreen stay.
    when: (ctx) => needsSunProtection(ctx) && !needsHandsAndHead(ctx),
    reason: sunReason,
  },
];

export const TRIP_TYPE_RULES: Record<TripType, Rule[]> = {
  city: [
    {
      key: 'walking-shoes',
      title: 'Comfortable walking shoes',
      category: 'clothing',
      appliesTo: 'everyone',
      reason: (ctx) => {
        if (ctx.flags.freezing) {
          return 'City trips mean a lot of walking: bring a warm, waterproof pair with good grip';
        }

        return ctx.flags.rain || ctx.flags.cold
          ? 'City trips mean a lot of walking: bring a waterproof pair'
          : 'City trips mean a lot of walking';
      },
    },
    { key: 'day-bag', title: 'Day bag', category: 'misc', appliesTo: 'everyone' },
  ],
  mountains: [
    { key: 'hiking-boots', title: 'Hiking boots', category: 'clothing', appliesTo: 'everyone' },
    { key: 'fleece', title: 'Fleece', category: 'clothing', appliesTo: 'everyone' },
    { key: 'water-bottle', title: 'Water bottle', category: 'misc', appliesTo: 'everyone' },
    {
      key: 'hiking-daypack',
      title: 'Daypack',
      category: 'misc',
      appliesTo: 'adult',
      reason: 'Carries water and layers on hikes',
    },
    { key: 'headlamp', title: 'Headlamp', category: 'electronics', appliesTo: 'shared' },
    {
      key: 'drivers-licence',
      title: "Driver's licence",
      category: 'documents',
      appliesTo: 'adult',
      reason: 'Mountain areas are often easiest to reach by car',
    },
  ],
  beach: [
    {
      key: 'swimwear',
      title: 'Swimwear',
      category: 'clothing',
      appliesTo: 'everyone',
      // A spare so one suit can dry while the other is worn.
      quantity: (ctx) => (ctx.days >= 3 ? 2 : 1),
    },
    { key: 'beach-towel', title: 'Beach towel', category: 'misc', appliesTo: 'everyone' },
    { key: 'flip-flops', title: 'Flip-flops', category: 'clothing', appliesTo: 'everyone' },
    {
      key: 'closed-shoes',
      title: 'Closed shoes',
      category: 'clothing',
      appliesTo: 'everyone',
      reason: 'For temples, towns and day trips',
    },
    { key: 'after-sun', title: 'After-sun lotion', category: 'toiletries', appliesTo: 'shared' },
    {
      key: 'insect-repellent',
      title: 'Insect repellent',
      category: 'toiletries',
      appliesTo: 'shared',
    },
    { key: 'beach-bag', title: 'Beach bag', category: 'misc', appliesTo: 'shared' },
  ],
  business: [
    {
      key: 'formal-outfit',
      title: 'Formal outfit',
      category: 'clothing',
      appliesTo: 'adult',
      quantity: (ctx) =>
        Math.min(Math.ceil(ctx.days / 2), CLOTHING_CAPS[ctx.packingCapacity].formal),
    },
    { key: 'laptop', title: 'Laptop', category: 'electronics', appliesTo: 'adult' },
    { key: 'laptop-charger', title: 'Laptop charger', category: 'electronics', appliesTo: 'adult' },
    { key: 'dress-shoes', title: 'Dress shoes', category: 'clothing', appliesTo: 'adult' },
    { key: 'casual-shoes', title: 'Casual shoes', category: 'clothing', appliesTo: 'adult' },
    { key: 'laptop-bag', title: 'Laptop bag', category: 'misc', appliesTo: 'adult' },
  ],
};

export const LUGGAGE_RULES: Rule[] = [
  {
    key: 'liquids-kit',
    title: 'Liquids kit (100 ml bottles + clear zip bag)',
    category: 'toiletries',
    appliesTo: 'shared',
    when: (ctx) => !hasLuggage(ctx, 'checked'),
    reason: 'No checked bag: liquids up to 100 ml each, in one clear bag',
  },
  {
    key: 'carry-on-spare-outfit',
    title: 'Spare outfit in carry-on',
    category: 'misc',
    appliesTo: 'everyone',
    when: onlyWithBags,
    reason: 'In case the checked bag is delayed',
  },
  {
    key: 'carry-on-meds-valuables',
    title: 'Meds & valuables in carry-on',
    category: 'misc',
    appliesTo: 'shared',
    when: onlyWithBags,
    reason: 'Keep essentials with you, not in the checked bag',
  },
];

export const FAMILY_RULES: Rule[] = [
  {
    key: 'baby-wipes',
    title: 'Wipes',
    category: 'kids',
    appliesTo: 'shared',
    when: (ctx) => ctx.hasChildren,
  },
  {
    key: 'kids-snacks',
    title: 'Snacks',
    category: 'kids',
    appliesTo: 'shared',
    when: (ctx) => ctx.hasChildren,
  },
  {
    key: 'favorite-toy',
    title: 'Favorite toy',
    category: 'kids',
    appliesTo: 'child',
    when: (ctx) => ctx.hasChildren,
  },
  {
    key: 'kids-entertainment',
    title: "Kids' entertainment",
    category: 'kids',
    appliesTo: 'child',
    when: (ctx) => ctx.hasChildren,
  },
];
