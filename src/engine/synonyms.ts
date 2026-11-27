/**
 * Extra names for rule items, beyond the rule's own title. Keyed by rule key (src/engine/rules.ts).
 * Used by mergeItems to drop AI suggestions that are the same thing under another name.
 * Add a phrase here when the live check shows a duplicate slipping through.
 */
export const RULE_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  'passport-id': ['passport', 'id card', 'identity card'],
  'wallet-cards': ['wallet', 'credit card', 'debit card', 'cash'],
  'tickets-booking': [
    'boarding pass',
    'e-ticket',
    'booking confirmation',
    'travel documents',
  ],
  'travel-insurance': ['travel insurance'],
  'phone-charger': ['charging cable', 'usb cable', 'phone cable'],
  'power-bank': ['portable charger', 'battery pack', 'external battery'],
  'toothbrush': ['tooth brush'],
  'toothpaste': ['tooth paste', 'dental care'],
  'deodorant': ['antiperspirant'],
  'shampoo-soap': ['shampoo', 'soap', 'body wash', 'shower gel'],
  'razor': ['shaver', 'shaving kit'],
  'hairbrush': ['comb', 'hair brush'],
  'underwear': ['underpants', 'boxers', 'briefs', 'knickers'],
  'socks': ['sock'],
  't-shirts': ['tee', 'tshirt'],
  'bottoms': ['jeans'],
  'sleepwear': ['pajamas', 'pyjamas', 'nightwear'],
  'medications': ['prescription'],
  'first-aid-kit': ['first aid', 'plasters', 'band-aids', 'bandages', 'band aid'],
  'laundry-kit': ['laundry bag', 'laundry detergent', 'travel detergent'],
  'rain-jacket': ['raincoat', 'waterproof jacket', 'rain shell', 'poncho', 'windbreaker'],
  'umbrella': ['brolly'],
  'warm-jacket': ['winter coat', 'winter jacket', 'puffer jacket', 'down jacket', 'parka'],
  'sweater': ['jumper', 'pullover', 'cardigan', 'sweatshirt'],
  'rain-pants': ['waterproof trousers', 'waterproof pants', 'rain pants', 'overtrousers'],
  'light-jacket': ['light coat', 'denim jacket', 'bomber jacket'],
  'scarf': ['neck warmer', 'neck gaiter', 'buff'],
  'warm-socks': ['wool socks', 'thermal socks', 'hiking socks'],
  'lip-balm': ['lip care', 'chapstick', 'lip salve'],
  'gloves': ['mittens', 'glove liners'],
  // No 'balaclava': it covers the face, which a warm hat does not.
  'warm-hat': ['beanie', 'winter hat', 'wool hat', 'knit hat', 'bobble hat'],
  'thermal-layer': ['base layer', 'thermal underwear', 'long johns', 'thermals'],
  'sunscreen': ['sun cream', 'sunblock', 'sun block', 'sun lotion', 'spf', 'suncream'],
  'sunglasses': ['shades', 'sun glasses'],
  'sun-cap': ['sun hat', 'baseball cap', 'bucket hat', 'visor', 'cap', 'sunhat'],
  'walking-shoes': ['walking shoe', 'trainers', 'sneakers', 'comfortable shoes'],
  'day-bag': ['daypack', 'day pack', 'backpack', 'small backpack'],
  'hiking-boots': ['hiking shoes', 'trekking boots', 'trail shoes', 'walking boots'],
  'fleece': ['fleece jacket'],
  'water-bottle': ['reusable bottle', 'thermos', 'flask', 'hydration bladder', 'drinking bottle'],
  'headlamp': ['head torch', 'headtorch', 'head lamp'],
  'swimwear': ['swimsuit', 'swim trunks', 'bikini', 'bathing suit', 'swimming costume'],
  'beach-towel': ['travel towel', 'microfiber towel', 'microfibre towel', 'towel'],
  'flip-flops': ['flip flop', 'sandals', 'slides', 'thongs'],
  'after-sun': ['aloe vera', 'aloe gel', 'aftersun', 'soothing lotion'],
  'insect-repellent': ['mosquito repellent', 'bug spray', 'deet', 'repellent', 'mosquito spray'],
  'beach-bag': ['beach tote', 'tote bag'],
  'formal-outfit': ['business suit', 'suit', 'blazer', 'dress shirt', 'smart outfit'],
  'laptop': ['notebook computer', 'macbook'],
  'laptop-charger': ['laptop power adapter', 'laptop adapter'],
  'dress-shoes': ['formal shoes', 'oxford shoes', 'smart shoes', 'loafers'],
  'casual-shoes': ['casual shoe'],
  'laptop-bag': ['laptop sleeve', 'laptop case', 'briefcase'],
  'liquids-kit': [
    'liquids bag',
    'travel size toiletries',
    'travel-size toiletries',
    'ziplock bag',
    'zip lock bag',
    'toiletry bag',
    'quart bag',
  ],
  'trousers': ['pants', 'jeans'],
  'hiking-daypack': ['day pack', 'day bag', 'backpack', 'small backpack'],
  'closed-shoes': ['trainers', 'sneakers', 'walking shoes', 'comfortable shoes'],
  'hand-sanitizer': ['sanitizer', 'sanitiser', 'hand gel'],
  'drivers-licence': ['driving licence', 'driving license', "driver's license", 'drivers license'],
  'carry-on-spare-outfit': ['spare clothes', 'change of clothes', 'spare outfit'],
  'carry-on-meds-valuables': ['valuables', 'important medication'],
  'baby-wipes': ['wet wipes', 'wipes', 'baby wipes'],
  'kids-snacks': ['snack', 'kids snacks', 'children snacks'],
  'favorite-toy': ['favourite toy', 'comfort toy', 'stuffed animal', 'teddy bear', 'toy'],
};

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[&/,'’-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

function containsPhrase(words: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || phrase.length > words.length) {return false;}
  for (let i = 0; i <= words.length - phrase.length; i++) {
    if (phrase.every((word, j) => words[i + j] === word)) {return true;}
  }

  return false;
}

/**
 * True if an AI suggestion names the same thing as a rule item: any phrase of the rule
 * (its title split on " / ", plus its synonyms) appears as whole words inside the AI title.
 * One-way on purpose: "Hat" does not match "Warm hat", but "Warm hat with ear flaps" does.
 */
export function isSameItem(aiTitle: string, base: { key: string | null; title: string }): boolean {
  const words = normalizeWords(aiTitle);
  const phrases = [
    ...base.title.split(' / '),
    ...(base.key !== null ? (RULE_SYNONYMS[base.key] ?? []) : []),
  ];

  return phrases.some((phrase) => containsPhrase(words, normalizeWords(phrase)));
}
