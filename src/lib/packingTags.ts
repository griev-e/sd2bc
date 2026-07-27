/**
 * Packing auto-tagging.
 *
 * Given a free-text label ("2x wool socks", "phone chargr", "kev's passport")
 * work out which packing category it belongs in, how confident we are, and
 * who it's for — with no network call and no model.
 *
 * The classifier is a small scoring ensemble, in order of authority:
 *
 *  1. **Learned neighbors.** The list the two of us already built is the best
 *     signal there is: if "wool socks" is filed under "Clothing", then "hiking
 *     socks" belongs there too — under *that* name, not our canonical one.
 *  2. **Curated lexicon.** ~600 road-trip terms mapped to nine canonical
 *     categories, matched as multi-word phrases first ("sleeping bag" beats
 *     "bag") and then as single stemmed tokens.
 *  3. **Head-noun bias.** English compounds head right: a "camera charger" is
 *     a charger, a "beach towel" is a towel. The last token scores 1.5x.
 *  4. **Fuzzy fallback.** Bounded edit distance catches phone-keyboard typos
 *     ("sunscren", "toothbursh") at a discount.
 *
 * Whatever wins is then re-expressed in the *user's* vocabulary: if the list
 * already has a "Bathroom" section, Toiletries items are filed there instead
 * of spawning a near-duplicate category.
 *
 * Everything here is pure and synchronous, so the Add sheet can re-classify on
 * every keystroke and `src/lib/packingTags.test.ts` can pin the behavior down.
 */

/** The canonical categories we can invent when the list has nothing like them. */
export const PACKING_CATEGORIES = [
  "Clothes",
  "Toiletries",
  "Health",
  "Tech",
  "Outdoors",
  "Food",
  "Car",
  "Docs",
  "Fun",
] as const;

export type PackingCategory = (typeof PACKING_CATEGORIES)[number];

/** Bucket for "we genuinely can't tell" — never suggested, only defaulted to. */
export const OTHER_CATEGORY = "Other";

export interface CategoryMeta {
  emoji: string;
  /** Design-token color for the category dot / pill ink. */
  fg: string;
  /** Matching soft tint for pill backgrounds. */
  bg: string;
}

/**
 * Palette per category. Car and Docs deliberately share slate — they're both
 * "logistics" and the token set only has eight hues; every other category is
 * unique so the list reads as nine distinguishable colors.
 */
export const CATEGORY_META: Record<string, CategoryMeta> = {
  Clothes: { emoji: "👕", fg: "var(--violet)", bg: "var(--violet-soft)" },
  Toiletries: { emoji: "🧴", fg: "var(--sky)", bg: "var(--sky-soft)" },
  Health: { emoji: "🩹", fg: "var(--green)", bg: "var(--green-soft)" },
  Tech: { emoji: "🔌", fg: "var(--indigo)", bg: "var(--indigo-soft)" },
  Outdoors: { emoji: "🏕️", fg: "var(--accent)", bg: "var(--accent-soft)" },
  Food: { emoji: "🍎", fg: "var(--coral)", bg: "var(--coral-soft)" },
  Car: { emoji: "🚗", fg: "var(--slate)", bg: "var(--slate-soft)" },
  Docs: { emoji: "🪪", fg: "var(--slate)", bg: "var(--slate-soft)" },
  Fun: { emoji: "🎲", fg: "var(--gold)", bg: "var(--gold-soft)" },
  [OTHER_CATEGORY]: { emoji: "✨", fg: "var(--fg-muted)", bg: "rgba(127,127,127,0.1)" },
};

/**
 * Names a hand-typed category might already be using for each canonical one.
 * Matched on stemmed tokens, so "Clothing" and "clothes" both land on Clothes.
 */
const CATEGORY_ALIASES: Record<PackingCategory, string[]> = {
  Clothes: ["clothes", "clothing", "apparel", "wardrobe", "outfits", "layers", "wear", "garments"],
  Toiletries: ["toiletries", "toiletry", "bathroom", "hygiene", "grooming", "shower", "bath"],
  Health: ["health", "meds", "medicine", "medication", "medications", "first aid", "medical", "pharmacy", "safety"],
  Tech: ["tech", "technology", "electronics", "gadgets", "devices", "chargers", "cables", "power"],
  Outdoors: ["outdoors", "outdoor", "camp", "camping", "gear", "hiking", "beach", "adventure", "trail"],
  Food: ["food", "snacks", "kitchen", "cooler", "drinks", "groceries", "pantry", "galley"],
  Car: ["car", "vehicle", "auto", "driving", "road", "van", "truck", "garage"],
  Docs: ["docs", "documents", "paperwork", "papers", "admin", "money", "wallet", "border"],
  Fun: ["fun", "entertainment", "games", "music", "media", "hobbies", "boredom"],
};

/**
 * The lexicon. Multi-word entries are matched as *unordered* phrases (every
 * token present anywhere in the label), so "bottle of water" and "water
 * bottle" both hit. Single words are matched as stems.
 *
 * Bias when a term is genuinely ambiguous: file it where a road tripper would
 * look for it. A cooler lives with Food, a headlamp with Outdoors, a dash cam
 * with Car — even though all three could argue for another home.
 */
const LEXICON: Record<PackingCategory, string[]> = {
  Clothes: [
    "shirt", "t shirt", "tshirt", "tee", "tank top", "blouse", "flannel", "jersey", "polo",
    "sweater", "sweatshirt", "hoodie", "fleece", "cardigan", "pullover", "crewneck",
    "jacket", "coat", "rain jacket", "raincoat", "windbreaker", "puffer", "puffy", "parka", "vest",
    "pants", "jeans", "trousers", "leggings", "joggers", "sweatpants", "shorts", "skirt", "dress",
    "sundress", "romper", "jumpsuit", "overalls",
    "underwear", "undies", "boxers", "briefs", "bra", "sports bra", "socks", "wool socks", "hiking socks",
    "pajamas", "pjs", "sleepwear", "nightgown", "robe",
    "swimsuit", "bathing suit", "swim trunks", "bikini", "board shorts", "rash guard", "cover up",
    "hat", "cap", "ball cap", "beanie", "sun hat", "visor", "bandana", "scarf", "buff", "neck gaiter",
    "gloves", "mittens", "belt", "suspenders", "sunglasses", "shades",
    "shoes", "sneakers", "trainers", "runners", "boots", "hiking boots", "rain boots", "sandals",
    "flip flops", "slides", "slippers", "crocs", "water shoes", "dress shoes", "heels",
    "base layer", "thermals", "long johns", "long underwear", "poncho", "rain pants",
    "packing cubes", "laundry bag", "dirty clothes bag", "outfit", "layers", "hangers", "lint roller",
  ],
  Toiletries: [
    "toothbrush", "toothpaste", "floss", "mouthwash", "retainer", "night guard",
    "deodorant", "antiperspirant", "shampoo", "conditioner", "body wash", "soap", "bar soap",
    "face wash", "cleanser", "toner", "moisturizer", "lotion", "body butter", "hand cream",
    "sunscreen", "sunblock", "spf", "lip balm", "chapstick", "lip gloss",
    "razor", "razor blades", "shaving cream", "shave gel", "aftershave", "trimmer", "clippers",
    "tweezers", "nail clippers", "nail file", "scissors", "comb", "hairbrush", "hair brush",
    "hair ties", "scrunchies", "bobby pins", "dry shampoo", "hair gel", "hair spray", "curling iron",
    "hair dryer", "straightener",
    "makeup", "mascara", "foundation", "concealer", "blush", "lipstick", "eyeliner", "makeup remover",
    "makeup bag", "face wipes", "wipes", "cotton swabs", "q tips", "cotton pads", "face mask",
    "contacts", "contact lenses", "contact solution", "glasses", "glasses case", "eye drops",
    "perfume", "cologne", "body spray", "deodorizer",
    "towel", "bath towel", "hand towel", "washcloth", "shower shoes", "shower caddy", "toiletry bag",
    "dopp kit", "toilet paper", "tissues", "kleenex", "hand sanitizer", "wet wipes", "baby wipes",
    "tampons", "pads", "menstrual cup", "period supplies", "nail polish", "lotion bottle",
    "laundry detergent", "detergent", "laundry soap", "stain remover", "lint brush",
  ],
  Health: [
    "first aid kit", "first aid", "band aids", "bandaids", "bandages", "gauze", "medical tape",
    "antiseptic", "neosporin", "antibiotic ointment", "alcohol wipes", "moleskin", "blister pads",
    "thermometer", "ace bandage", "instant cold pack",
    "medicine", "medication", "meds", "prescriptions", "pills", "vitamins", "supplements",
    "ibuprofen", "advil", "tylenol", "acetaminophen", "aspirin", "aleve", "painkillers", "pain reliever",
    "allergy meds", "benadryl", "claritin", "zyrtec", "antihistamine", "epipen", "inhaler", "insulin",
    "dramamine", "motion sickness", "sea bands", "pepto", "imodium", "antacid", "tums", "laxative",
    "melatonin", "sleep aid", "earplugs", "ear plugs", "eye mask", "sleep mask",
    "cough drops", "cold medicine", "dayquil", "nyquil", "throat lozenges", "electrolytes",
    "liquid iv", "pedialyte", "aloe", "aloe vera", "after sun", "hydrocortisone", "anti itch cream",
    "bite cream", "condoms", "birth control", "plan b", "masks", "covid tests", "hand warmers",
  ],
  Tech: [
    "phone", "cell phone", "charger", "phone charger", "charging cable", "cable", "cables", "cords",
    "usb cable", "usb c", "usb c cable", "lightning cable", "charging brick", "wall charger",
    "fast charger", "car charger", "power bank", "battery pack", "portable charger", "power adapter",
    "adapter", "extension cord", "power strip", "outlet splitter", "inverter",
    "headphones", "earbuds", "airpods", "noise cancelling headphones", "speaker", "bluetooth speaker",
    "aux cord", "aux cable", "phone mount", "car mount", "tripod", "selfie stick",
    "laptop", "macbook", "laptop charger", "tablet", "ipad", "kindle", "e reader", "switch",
    "camera", "gopro", "action camera", "drone", "camera battery", "lens", "memory card", "sd card",
    "sim card", "esim", "hotspot", "hard drive", "watch charger", "apple watch", "smart watch",
    "batteries", "aa batteries", "aaa batteries", "battery", "cable organizer", "cord pouch",
  ],
  Outdoors: [
    "tent", "tent stakes", "footprint", "rainfly", "sleeping bag", "sleeping pad", "sleeping mat",
    "air mattress", "pump", "camp pillow", "pillow", "camp chair", "camping chair", "folding chair",
    "hammock", "tarp", "ground cloth", "picnic blanket", "blanket", "camp table",
    "headlamp", "flashlight", "lantern", "camp light", "string lights", "lighter", "matches",
    "fire starter", "firewood", "kindling", "camp stove", "propane", "fuel canister", "mess kit",
    "hiking poles", "trekking poles", "backpack", "daypack", "day pack", "dry bag", "duffel",
    "duffel bag", "stuff sack", "water bottle", "nalgene", "hydro flask", "hydration pack", "camelbak",
    "water filter", "purification tablets", "binoculars", "compass", "trail map", "map",
    "bear spray", "bear canister", "bug spray", "insect repellent", "mosquito net", "citronella",
    "beach towel", "beach chair", "beach umbrella", "sunshade", "sand toys", "boogie board",
    "surfboard", "wetsuit", "snorkel", "swim goggles", "life jacket", "pfd", "kayak", "paddle",
    "umbrella", "sun umbrella", "shade tent",
    "fishing rod", "tackle box", "bait", "multitool", "pocket knife", "swiss army knife", "whistle",
    "paracord", "rope", "carabiner", "trowel", "biodegradable soap", "camp soap", "bike", "bikes",
    "climbing shoes", "trail runners", "gaiters", "walking sticks",
  ],
  Food: [
    "snacks", "granola bars", "protein bars", "clif bars", "trail mix", "nuts", "almonds", "jerky",
    "chips", "crackers", "pretzels", "popcorn", "cookies", "candy", "chocolate", "gum", "mints",
    "fruit", "apples", "bananas", "oranges", "berries", "carrots", "veggies", "hummus",
    "sandwiches", "bread", "bagels", "tortillas", "peanut butter", "jam", "cheese", "deli meat",
    "eggs", "milk", "oatmeal", "cereal", "instant noodles", "ramen", "pasta", "rice", "canned soup",
    "hot dogs", "burgers", "marshmallows", "smores", "graham crackers", "condiments", "hot sauce",
    "salt", "pepper", "olive oil", "spices", "sugar", "creamer",
    "food", "groceries", "coffee", "instant coffee", "coffee beans", "espresso", "french press",
    "aeropress", "pour over", "filters",
    "tea", "tea bags", "water", "water jug", "gallon of water", "gatorade", "juice", "soda", "seltzer",
    "beer", "wine", "cider", "whiskey", "cooler", "ice", "ice packs", "reusable ice",
    "plates", "bowls", "utensils", "forks", "spoons", "knives", "sporks", "cups", "mugs", "travel mug",
    "thermos", "napkins", "paper towels", "ziploc bags", "tupperware", "food containers",
    "cutting board", "chef knife", "can opener", "bottle opener", "corkscrew", "dish soap", "sponge",
    "dish towel", "grocery bags", "lunch box", "picnic basket",
  ],
  Car: [
    "jumper cables", "jump starter", "tire gauge", "tire pressure gauge", "spare tire", "jack",
    "lug wrench", "air compressor", "tire inflator", "tire plug kit", "tire chains", "snow chains",
    "motor oil", "oil", "coolant", "washer fluid", "wiper fluid", "windshield wipers", "funnel",
    "ice scraper", "windshield sunshade", "emergency kit", "road flares",
    "reflective triangle", "fire extinguisher", "tow strap", "tool kit", "wrench", "screwdriver",
    "pliers", "duct tape", "zip ties", "bungee cords", "ratchet straps", "tie downs",
    "roof rack", "cargo box", "cargo net", "bike rack", "hitch", "gas can", "gas card", "fuel card",
    "toll pass", "transponder", "parking pass", "car key", "spare key", "key fob",
    "trash bags", "car trash can", "seat covers", "floor mats", "air freshener", "car vacuum",
    "microfiber towel", "glass cleaner", "dash cam", "tire chalk", "wheel chocks", "leveling blocks",
    "car manual", "windshield washer", "spare fuses",
  ],
  Docs: [
    "passport", "passport card", "drivers license", "license", "id", "real id", "photo id",
    "birth certificate", "nexus card", "global entry", "visa", "arrivecan", "border documents",
    "insurance card", "insurance", "car insurance", "travel insurance", "registration",
    "aaa card", "roadside assistance", "membership card", "credit card", "debit card", "cash",
    "canadian cash", "canadian dollars", "currency", "wallet", "money belt", "coins",
    "itinerary", "reservations", "confirmation numbers", "hotel confirmations", "campsite reservation",
    "tickets", "park pass", "america the beautiful pass", "discover pass", "annual pass",
    "vaccination card", "emergency contacts", "phone numbers", "copies of documents",
    "printed maps", "checklists", "vehicle registration", "proof of insurance", "fishing license",
    "quarters", "small bills", "laundry quarters",
  ],
  Fun: [
    "book", "books", "paperback", "novel", "magazine", "comics", "journal", "notebook", "diary",
    "pen", "pens", "pencils", "markers", "colored pencils", "sketchbook", "watercolors",
    "cards", "playing cards", "deck of cards", "uno", "cribbage", "board game", "travel game",
    "dice", "yahtzee", "chess", "checkers", "puzzle", "crossword", "sudoku", "mad libs",
    "guitar", "ukulele", "harmonica", "aux playlist", "road trip playlist", "podcasts",
    "instax", "polaroid", "film", "stickers", "scrapbook", "souvenirs", "postcards", "stamps",
    "frisbee", "football", "spikeball", "cornhole", "beach ball", "kite", "skateboard", "yoga mat",
  ],
};

/* ------------------------------------------------------------------ *
 * Text normalization
 * ------------------------------------------------------------------ */

/**
 * Words that carry no category signal — dropped before scoring. Kept
 * deliberately short: anything that appears inside a lexicon phrase ("kit",
 * "bag", "pack", "bottle", "box") must stay, or the phrase collapses to its
 * modifier and starts matching the wrong things.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "to", "in", "on", "per", "plus",
  "my", "our", "your", "their", "his", "her", "its",
  "some", "extra", "spare", "more", "few", "couple", "another", "new", "old",
  "pair", "pairs", "set", "sets",
  "one", "two", "three", "four", "five", "each", "x",
]);

/** Irregular plurals the suffix rules below would mangle. */
const IRREGULAR: Record<string, string> = {
  knives: "knife",
  leaves: "leaf",
  shelves: "shelf",
  children: "child",
  feet: "foot",
  teeth: "tooth",
  people: "person",
  batteries: "battery",
};

/**
 * Crude singularizer. It doesn't have to be linguistically right — it only has
 * to be *consistent*, because both the lexicon and the query run through it,
 * so they meet in the middle ("glasses" and "glass" both become "glass").
 */
export function stem(word: string): string {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.length <= 3) return word;
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ves")) return `${word.slice(0, -3)}f`;
  if (/(ch|sh|x|z|s)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Lowercase, de-accent, drop punctuation and counts, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]s\b/g, "") // possessives: "kev's" → "kev"
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b\d+\s*x\b|\bx\s*\d+\b|\b\d+\b/g, " ") // "2x", "x2", bare counts
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized, stemmed, stopword-free tokens — the unit everything scores on. */
export function tokenize(text: string): string[] {
  const tokens = normalize(text)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem);
  // If stopword removal ate everything ("a pair"), fall back to the raw words
  // so we still have something to match on.
  if (tokens.length > 0) return tokens;
  return normalize(text).split(" ").filter(Boolean).map(stem);
}

/**
 * Squash runaway whitespace and sentence-case the label — but leave the first
 * word alone if it already carries a capital, so "iPhone charger" and "AAA
 * batteries" survive being typed correctly.
 */
export function tidyLabel(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  const first = clean.split(" ")[0] ?? "";
  if (first !== first.toLowerCase()) return clean;
  return clean.replace(/^[a-z]/, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ *
 * Lexicon indexes (built once at module load)
 * ------------------------------------------------------------------ */

/** Single stemmed word → category. */
const TERM_INDEX = new Map<string, PackingCategory>();
/** Stemmed token list → category, for unordered multi-word phrases. */
const PHRASE_INDEX: { tokens: string[]; category: PackingCategory }[] = [];

for (const category of PACKING_CATEGORIES) {
  for (const entry of LEXICON[category]) {
    const tokens = tokenize(entry);
    if (tokens.length === 0) continue;
    if (tokens.length === 1) {
      // First writer wins: earlier categories in PACKING_CATEGORIES own a term
      // outright, which keeps duplicates across lists from silently flipping.
      if (!TERM_INDEX.has(tokens[0])) TERM_INDEX.set(tokens[0], category);
    } else {
      PHRASE_INDEX.push({ tokens, category });
    }
  }
}

/**
 * Every word the lexicon knows — including the ones that only ever appear
 * inside a phrase ("sleeping", "jumper"). Typo correction runs against this,
 * not against whole terms, so "slepping bag" can still find "sleeping bag".
 */
const VOCAB: string[] = [
  ...new Set([...TERM_INDEX.keys(), ...PHRASE_INDEX.flatMap((p) => p.tokens)]),
];
const VOCAB_SET = new Set(VOCAB);

/** Alias lookup for resolving an existing, hand-typed category name. */
const ALIAS_INDEX = new Map<string, PackingCategory>();
for (const category of PACKING_CATEGORIES) {
  ALIAS_INDEX.set(category.toLowerCase(), category);
  for (const alias of CATEGORY_ALIASES[category]) {
    const key = tokenize(alias).join(" ");
    if (key && !ALIAS_INDEX.has(key)) ALIAS_INDEX.set(key, category);
  }
}

/**
 * Which canonical category an arbitrary category name means, if any.
 * "Clothing" → Clothes, "Bathroom & meds" → Toiletries, "Ski stuff" → null.
 */
export function canonicalCategory(name: string): PackingCategory | null {
  const tokens = tokenize(name);
  if (tokens.length === 0) return null;
  const whole = ALIAS_INDEX.get(tokens.join(" "));
  if (whole) return whole;
  // Fall back to the first token that's an alias — "Camp gear", "Beach stuff".
  for (const token of tokens) {
    const hit = ALIAS_INDEX.get(token);
    if (hit) return hit;
  }
  return null;
}

/** Emoji + colors for any category name, canonical or hand-typed. */
export function categoryMeta(name: string): CategoryMeta {
  const canonical = canonicalCategory(name);
  return CATEGORY_META[canonical ?? OTHER_CATEGORY];
}

/* ------------------------------------------------------------------ *
 * Fuzzy matching
 * ------------------------------------------------------------------ */

/**
 * Levenshtein distance, abandoned as soon as it provably exceeds `max`.
 * Returns `max + 1` when it bails, so callers only need a `<= max` test.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Spell-correct one token toward the lexicon vocabulary. Only words the
 * lexicon has never heard of are candidates, so a real word ("beans") is never
 * "corrected" into a lexicon word it happens to sit one keystroke from
 * ("jeans"). Short words aren't touched at all — at three letters a typo is
 * indistinguishable from a different word.
 */
export function correctToken(token: string): string {
  if (VOCAB_SET.has(token) || token.length < 4) return token;
  const budget = token.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = budget + 1;
  for (const word of VOCAB) {
    const d = editDistance(token, word, Math.min(budget, bestDistance - 1));
    if (d < bestDistance) {
      best = word;
      bestDistance = d;
      if (d === 1) break; // can't do better than a single-character slip
    }
  }
  return best ?? token;
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

const PHRASE_WEIGHT = 3; // per token in the matched phrase
const TERM_WEIGHT = 3;
const HEAD_BONUS = 1.5; // "camera charger" is a charger
/** Every spell-corrected token shaves this much off the whole score. */
const TYPO_PENALTY = 0.2;
/** A neighbor scoring at least this similar is worth learning from. */
const NEIGHBOR_FLOOR = 0.34;
/**
 * Weighted so a half-overlapping neighbor ("espresso maker" for "espresso
 * beans") outweighs one lexicon term, and an identical one is unbeatable —
 * how this list files things wins over how the lexicon would.
 */
const NEIGHBOR_WEIGHT = 11;
const NEIGHBOR_CURVE = 1.5;

function bump<K>(map: Map<K, number>, key: K, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/** Lexicon-only scores for a label. Exported for tests and debugging. */
export function lexiconScores(label: string): Map<PackingCategory, number> {
  const raw = tokenize(label);
  const scores = new Map<PackingCategory, number>();
  if (raw.length === 0) return scores;

  // Spell-correct first, then match once. Correcting up front (rather than
  // scoring fuzzy hits separately) is what lets a typo inside a phrase still
  // find the phrase.
  const tokens = raw.map(correctToken);
  const typos = tokens.reduce((n, t, i) => (t === raw[i] ? n : n + 1), 0);

  const present = new Set(tokens);
  for (const phrase of PHRASE_INDEX) {
    if (phrase.tokens.every((t) => present.has(t))) {
      bump(scores, phrase.category, PHRASE_WEIGHT * phrase.tokens.length);
    }
  }

  tokens.forEach((token, i) => {
    const head = i === tokens.length - 1 ? HEAD_BONUS : 1;
    const exact = TERM_INDEX.get(token);
    if (exact) bump(scores, exact, TERM_WEIGHT * head);
  });

  if (typos > 0) {
    const penalty = Math.max(0.6, 1 - TYPO_PENALTY * typos);
    for (const [category, score] of scores) scores.set(category, score * penalty);
  }
  return scores;
}

/** Sørensen–Dice overlap of two token sets, 0..1. */
function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const t of new Set(a)) if (setB.has(t)) shared++;
  return (2 * shared) / (new Set(a).size + setB.size);
}

export interface TaggableItem {
  label: string;
  category: string;
}

export interface TagContext {
  /** Items already on the list — the strongest signal we have. */
  items?: TaggableItem[];
  /** Category names to prefer, if not derivable from `items`. */
  categories?: string[];
}

export interface TagSuggestion {
  /** The category name to actually write — in the user's vocabulary. */
  category: string;
  /** What we think it *means*, or null when nothing matched. */
  canonical: PackingCategory | null;
  /** 0..1. Above ~0.4 is worth auto-applying; above ~0.6 is worth acting on. */
  confidence: number;
  /** Runners-up, best first, for a "or maybe…" affordance. */
  alternatives: string[];
  /** Which signal carried the decision. */
  source: "learned" | "lexicon" | "fallback";
}

/** Suggestions at or above this are shown as an auto-applied tag. */
export const AUTO_TAG_THRESHOLD = 0.4;
/** Suggestions at or above this are strong enough to propose re-filing. */
export const RETAG_THRESHOLD = 0.62;

/**
 * Map each canonical category onto the name the list already uses for it, so
 * we file into "Bathroom" rather than inventing a second "Toiletries".
 */
function nameForCanonical(existing: string[]): Map<PackingCategory, string> {
  const map = new Map<PackingCategory, string>();
  for (const name of existing) {
    const canonical = canonicalCategory(name);
    if (canonical && !map.has(canonical)) map.set(canonical, name);
  }
  return map;
}

/**
 * Classify one label. `ctx.items` should be the current packing list (minus the
 * item being classified, when re-tagging) — the more it holds, the more the
 * suggestion sounds like the people who wrote it.
 */
export function suggestCategory(label: string, ctx: TagContext = {}): TagSuggestion {
  const tokens = tokenize(label);
  const items = ctx.items ?? [];
  const existing = ctx.categories ?? [...new Set(items.map((i) => i.category))];
  const display = nameForCanonical(existing);

  // Everything is scored under the *display* name so learned and lexicon
  // evidence for the same bucket adds up instead of splitting the vote.
  const scores = new Map<string, number>();
  const canonicalOf = new Map<string, PackingCategory | null>();
  const nameFor = (canonical: PackingCategory): string => {
    const name = display.get(canonical) ?? canonical;
    canonicalOf.set(name, canonical);
    return name;
  };

  if (tokens.length === 0) {
    return { category: OTHER_CATEGORY, canonical: null, confidence: 0, alternatives: [], source: "fallback" };
  }

  // 1. Learned: how this list files things that look like this one.
  let learnedScore = 0;
  for (const item of items) {
    if (item.category === OTHER_CATEGORY) continue; // "Other" teaches nothing
    const sim = similarity(tokens, tokenize(item.label));
    if (sim < NEIGHBOR_FLOOR) continue;
    // curved, so a near-identical neighbor dominates a vaguely similar one
    const contribution = NEIGHBOR_WEIGHT * Math.pow(sim, NEIGHBOR_CURVE);
    bump(scores, item.category, contribution);
    if (!canonicalOf.has(item.category)) canonicalOf.set(item.category, canonicalCategory(item.category));
    learnedScore = Math.max(learnedScore, contribution);
  }

  // 2. Lexicon.
  let lexiconBest = 0;
  for (const [canonical, score] of lexiconScores(label)) {
    bump(scores, nameFor(canonical), score);
    lexiconBest = Math.max(lexiconBest, score);
  }

  // 3. Faint nudge toward categories the list already has, so a coin-flip
  //    lands on an existing section rather than spawning a new one.
  for (const name of existing) {
    if (scores.has(name)) bump(scores, name, 0.05);
  }

  const ranked = [...scores.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    return { category: OTHER_CATEGORY, canonical: null, confidence: 0, alternatives: [], source: "fallback" };
  }

  const [winner, top] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  const margin = top > 0 ? (top - second) / top : 1;
  const strength = Math.min(1, top / 7);
  const confidence = Math.round(strength * (0.55 + 0.45 * margin) * 100) / 100;

  return {
    category: winner,
    canonical: canonicalOf.get(winner) ?? canonicalCategory(winner),
    confidence,
    alternatives: ranked.slice(1, 3).map(([name]) => name),
    source: learnedScore > 0 && learnedScore >= lexiconBest ? "learned" : "lexicon",
  };
}

/* ------------------------------------------------------------------ *
 * Assignee detection
 * ------------------------------------------------------------------ */

export interface TagPerson {
  id: string;
  /** Lowercase names/nicknames/pronouns that mean this person. */
  aliases: string[];
}

/**
 * Aliases the Packing tab passes for each traveler. Partner pronouns stay
 * gender-neutral on purpose — a name never tells you someone's pronouns.
 */
export const SELF_ALIASES = ["me", "my", "mine"];
export const PARTNER_ALIASES = ["them", "their", "theirs"];

/** Aliases that may sit bare in front of the item ("my jacket"). */
const BARE_PREFIX = new Set([...SELF_ALIASES, ...PARTNER_ALIASES, "her", "hers", "his"]);

/**
 * Every way a name might be written in a label: the whole thing, each word,
 * and the short forms people actually type ("Kevin" → "kev", "kevi"). Only
 * ever consulted alongside an ownership marker — "Kev's charger", never a bare
 * "Kev" — so a truncation can't quietly eat a word out of an item.
 */
export function nameAliases(name: string | null | undefined): string[] {
  const clean = (name ?? "").toLowerCase().trim();
  if (!clean) return [];
  const out = new Set<string>();
  for (const part of [clean, ...clean.split(/\s+/)]) {
    if (!part) continue;
    out.add(part);
    if (part.includes(" ")) continue; // don't truncate a full name
    for (let n = 3; n < part.length; n++) out.add(part.slice(0, n));
  }
  return [...out];
}

export interface AssigneeMatch {
  /** Profile id, or null for shared / nobody named. */
  assignedTo: string | null;
  /** The label with the ownership marker stripped out. */
  label: string;
  matched: boolean;
}

/**
 * Pull an owner out of the label: "Kev's passport", "passport (kev)",
 * "kev: passport", "passport for kev", "my jacket". The marker is removed so
 * the list doesn't repeat what the assignment pill already says.
 */
export function detectAssignee(label: string, people: TagPerson[]): AssigneeMatch {
  const text = label.trim();
  for (const person of people) {
    for (const alias of person.aliases) {
      const a = alias.trim().toLowerCase();
      if (!a) continue;
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const patterns = [
        new RegExp(`^${esc}['’]s\\s+`, "i"), // Kev's passport
        new RegExp(`^${esc}\\s*[:\\-–—]\\s*`, "i"), // Kev: passport
        new RegExp(`\\s*\\(${esc}\\)\\s*$`, "i"), // passport (kev)
        new RegExp(`\\s+for\\s+${esc}\\s*$`, "i"), // passport for kev
        new RegExp(`\\s*[\\-–—]\\s*${esc}\\s*$`, "i"), // passport — kev
      ];
      // "my jacket" / "their sunglasses" — bare pronouns only, so a name like
      // "Kev" can't swallow the first word of "Kev Adapter".
      if (BARE_PREFIX.has(a)) patterns.push(new RegExp(`^${esc}\\s+`, "i"));
      for (const re of patterns) {
        if (re.test(text)) {
          const stripped = text.replace(re, " ").trim();
          // Never strip the whole label away — "kev's" alone stays as typed.
          if (!stripped) return { assignedTo: person.id, label: text, matched: true };
          return { assignedTo: person.id, label: tidyLabel(stripped), matched: true };
        }
      }
    }
  }
  return { assignedTo: null, label: tidyLabel(text), matched: false };
}

/* ------------------------------------------------------------------ *
 * Multi-entry parsing
 * ------------------------------------------------------------------ */

/**
 * Split a paste into individual items. Newlines, commas and semicolons split;
 * "and" deliberately doesn't ("salt and pepper" is one thing). List bullets
 * and numbering are stripped so a pasted checklist comes in clean.
 */
export function parsePackingEntries(text: string): string[] {
  return text
    .split(/[\n\r,;]+/)
    .map((part) => part.replace(/^\s*(?:[-–—*•]|\d+[.)])\s*/, "").trim())
    .filter((part) => part.length > 0)
    .map(tidyLabel);
}

/* ------------------------------------------------------------------ *
 * Bulk cleanup
 * ------------------------------------------------------------------ */

export interface RetagProposal<T extends TaggableItem = TaggableItem> {
  item: T;
  from: string;
  to: string;
  confidence: number;
}

/**
 * Items the classifier is confident are filed in the wrong section — the input
 * to the "tidy up" review sheet. Each item is classified against every *other*
 * item so it can't simply vote for where it already sits, and a proposal only
 * survives if it's confident and actually changes the bucket (a "Clothing" →
 * "Clothes" rename is noise, not a fix).
 */
export function suggestRetags<T extends TaggableItem>(
  items: T[],
  threshold = RETAG_THRESHOLD,
): RetagProposal<T>[] {
  const categories = [...new Set(items.map((i) => i.category))];
  const proposals: RetagProposal<T>[] = [];
  for (const item of items) {
    const others = items.filter((o) => o !== item);
    const suggestion = suggestCategory(item.label, { items: others, categories });
    if (suggestion.confidence < threshold) continue;
    if (suggestion.category === item.category) continue;
    const currentCanonical = canonicalCategory(item.category);
    if (currentCanonical && currentCanonical === suggestion.canonical) continue;
    proposals.push({
      item,
      from: item.category,
      to: suggestion.category,
      confidence: suggestion.confidence,
    });
  }
  return proposals.sort((a, b) => b.confidence - a.confidence);
}
