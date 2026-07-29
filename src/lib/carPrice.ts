/**
 * "$$$ Cars" domain logic — pure, so it unit-tests without a DOM.
 *
 * Two halves:
 *  - the catalog side: cascading make → model → trim lookups over `carData.ts`
 *    and the exact-MSRP hit that makes the common case free and instant. Every
 *    lookup is scoped to a model year: the current lineup answers for
 *    CATALOG_YEAR, the legacy table answers for the years each trim was sold.
 *  - the scoring side: an MSRP lands in a price tier, and each tier is worth
 *    points. The game is **cooperative** — the two of you are filling one
 *    shared haul, so the tiers are a collection to complete and the points are
 *    a joint total, not a duel.
 *
 * Anything the catalog can't price (a car older than the legacy table, an
 * off-catalog model) gets resolved by the cached Haiku lookup behind
 * `api/car-price`; `carPriceKey` is the shared cache key for that path.
 */

import {
  CAR_CATALOG,
  CATALOG_YEAR,
  LEGACY_CATALOG,
  type CarMake,
  type CarModel,
  type CarTrim,
  type LegacyModel,
} from "./carData";

/** One logged sighting, as stored in a `cars` game event's `value`. */
export interface CarSighting {
  year: number;
  make: string;
  model: string;
  /** "" when the spotter couldn't tell the trim apart. */
  trim: string;
  /** Base MSRP in USD. */
  msrp: number;
  /** Where the number came from — drives the little provenance dot in the UI. */
  source: PriceSource;
}

/** How a price was resolved, best provenance first. */
export type PriceSource = "catalog" | "ai" | "manual";

export type PriceTier = "economy" | "mainstream" | "premium" | "luxury" | "exotic" | "hyper";

export interface TierMeta {
  id: PriceTier;
  label: string;
  /** Lowest MSRP that lands in this tier. */
  floor: number;
  /** What one sighting in this tier is worth on the scoreboard. */
  points: number;
  emoji: string;
}

/**
 * The tiers, richest first — `tierOf` walks this in order and takes the first
 * floor the price clears, so ordering here *is* the banding logic.
 * Points double per tier: one hypercar (32) outweighs a parking lot of
 * commuters, which is the whole point of the game.
 */
export const TIERS: TierMeta[] = [
  { id: "hyper", label: "Hypercar", floor: 1_000_000, points: 32, emoji: "👑" },
  { id: "exotic", label: "Exotic", floor: 250_000, points: 16, emoji: "🔥" },
  { id: "luxury", label: "Luxury", floor: 100_000, points: 8, emoji: "💎" },
  { id: "premium", label: "Premium", floor: 60_000, points: 4, emoji: "✨" },
  { id: "mainstream", label: "Mainstream", floor: 30_000, points: 2, emoji: "🚗" },
  { id: "economy", label: "Economy", floor: 0, points: 1, emoji: "🧃" },
];

export function tierOf(msrp: number): TierMeta {
  // TIERS is richest-first, so the first floor cleared is the right band; the
  // economy floor of 0 makes the last entry a guaranteed match.
  return TIERS.find((t) => msrp >= t.floor) ?? TIERS[TIERS.length - 1];
}

/** Scoreboard value of one sighting. */
export function pointsFor(msrp: number): number {
  return tierOf(msrp).points;
}

/**
 * The haul's score: the points of every car logged, whoever spotted it.
 * Summed rather than maxed so a steady stream of good finds still adds up
 * next to one lucky Lambo.
 */
export function scoreFor(sightings: { msrp: number }[]): number {
  return sightings.reduce((sum, s) => sum + pointsFor(s.msrp), 0);
}

export interface HaulLevel {
  /** Points needed to reach this level. */
  at: number;
  label: string;
}

/**
 * Shared goalposts for the trip. Cooperative games need something to play
 * *against* once you've stopped playing against each other, so the two of you
 * are climbing this ladder together — the spacing roughly doubles, matching
 * the tier points, so a level always costs a handful of good spots.
 */
export const HAUL_LEVELS: HaulLevel[] = [
  { at: 0, label: "Parking lot" },
  { at: 20, label: "Onramp" },
  { at: 50, label: "Fast lane" },
  { at: 110, label: "Canyon run" },
  { at: 240, label: "Cars & Coffee" },
  { at: 500, label: "Pebble Beach" },
];

/** How the pair is doing in one tier — the collection board's row. */
export interface TierProgress<T> {
  tier: TierMeta;
  count: number;
  /** Priciest car the two of you logged in this tier, or null if none yet. */
  best: T | null;
}

export interface TeamHaul<T> {
  points: number;
  count: number;
  /** Richest tier first, same order as TIERS — the six-slot collection. */
  tiers: TierProgress<T>[];
  /** How many of the six tiers have at least one sighting. */
  collected: number;
  level: HaulLevel;
  /** The level being climbed toward, or null once the ladder is topped out. */
  next: HaulLevel | null;
  /** 0–1 through the current level; 1 at the top of the ladder. */
  progress: number;
}

/**
 * The whole cooperative scoreboard in one pass: joint points, the tier
 * collection, and where the pair sits on the level ladder. Generic over the
 * sighting so callers keep whatever they attached to it (who spotted it, when)
 * on the `best` car.
 */
export function teamHaul<T extends { msrp: number }>(sightings: T[]): TeamHaul<T> {
  const points = scoreFor(sightings);

  const tiers = TIERS.map((tier) => {
    const inTier = sightings.filter((s) => tierOf(s.msrp).id === tier.id);
    return {
      tier,
      count: inTier.length,
      best: inTier.reduce<T | null>((b, s) => (!b || s.msrp > b.msrp ? s : b), null),
    };
  });

  // HAUL_LEVELS is cheapest-first, so the last threshold cleared is the level.
  const reached = HAUL_LEVELS.filter((l) => points >= l.at);
  const level = reached[reached.length - 1] ?? HAUL_LEVELS[0];
  const next = HAUL_LEVELS[reached.length] ?? null;

  return {
    points,
    count: sightings.length,
    tiers,
    collected: tiers.filter((t) => t.count > 0).length,
    level,
    next,
    progress: next ? (points - level.at) / (next.at - level.at) : 1,
  };
}

/**
 * Loose match key: lowercase, with every separator *removed* rather than
 * collapsed to a space. Car names are written inconsistently by everyone —
 * "MX-5" / "MX 5" / "mx5", "RAV4" / "RAV 4", "Land Rover" / "landrover" — and
 * dropping the separators makes all of those one key, so the picker's search
 * finds them and the price cache stores them once.
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findMake(make: string): CarMake | undefined {
  const want = norm(make);
  return CAR_CATALOG.find((m) => norm(m.name) === want);
}

function findModel(make: string, model: string): CarModel | undefined {
  const want = norm(model);
  return findMake(make)?.models.find((m) => norm(m.name) === want);
}

function findLegacyModel(make: string, model: string): LegacyModel | undefined {
  const wantMake = norm(make);
  const wantModel = norm(model);
  return LEGACY_CATALOG.find((m) => norm(m.name) === wantMake)?.models.find(
    (m) => norm(m.name) === wantModel,
  );
}

/** Legacy trims of one model that were on sale in `year`, cheapest first. */
function legacyTrims(make: string, model: string, year: number): CarTrim[] {
  return (findLegacyModel(make, model)?.trims ?? [])
    .filter((t) => year >= t.from && year <= t.to)
    .map(({ name, msrp }) => ({ name, msrp }));
}

/** Merge two name-keyed lists, keeping the first spelling of any duplicate. */
function mergeByName<T extends { name: string }>(first: T[], second: T[]): T[] {
  const seen = new Set(first.map((x) => norm(x.name)));
  return [...first, ...second.filter((x) => !seen.has(norm(x.name)))];
}

/**
 * Makes to offer for a model year. The current lineup always shows; picking an
 * older year also unlocks the marques that no longer exist (Pontiac, Saturn,
 * Saab…), which is exactly when you need them.
 */
export function makeNames(year: number = CATALOG_YEAR): string[] {
  const current = CAR_CATALOG.map((m) => m.name);
  if (year === CATALOG_YEAR) return current;
  return mergeByName(
    current.map((name) => ({ name })),
    LEGACY_CATALOG.map((m) => ({ name: m.name })),
  )
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Models for a make in a given year: the current lineup, plus any nameplate
 * the legacy table sold that year. Current models aren't filtered by year —
 * the table carries no "on sale since" for them — so an old year lists a few
 * cars that didn't exist yet. Harmless: the picker is a search box, and a
 * wrong pick just falls through to the AI lookup instead of a catalog price.
 */
export function modelsForMake(make: string, year: number = CATALOG_YEAR): CarModel[] {
  const current = findMake(make)?.models ?? [];
  if (year === CATALOG_YEAR) return current;
  const legacy = (LEGACY_CATALOG.find((m) => norm(m.name) === norm(make))?.models ?? [])
    .filter((m) => m.trims.some((t) => year >= t.from && year <= t.to))
    .map((m) => ({ name: m.name, trims: legacyTrims(make, m.name, year) }));
  return mergeByName(current, legacy).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Trims to offer for one model in one year. Era-correct trims lead — an
 * AMG GT R belongs at the top of a 2019 AMG GT, not buried under this year's
 * GT 43/55/63 — with the current lineup's names appended after them, since a
 * recent-but-not-current car (a 2023 C 300) still wears them.
 */
export function trimsForModel(
  make: string,
  model: string,
  year: number = CATALOG_YEAR,
): CarTrim[] {
  const current = findModel(make, model)?.trims ?? [];
  if (year === CATALOG_YEAR) return current;
  return mergeByName(legacyTrims(make, model, year), current);
}

/**
 * Exact catalog MSRP, or null when neither table can answer — a year older
 * than the legacy table covers, an unlisted make/model, or a trim we don't
 * carry. Null is the signal to fall back to the AI lookup; it is never a
 * guess. Legacy prices are what the car cost new that year, which is the
 * fairest way to rank a 2004 Viper against a 2026 Corvette.
 */
export function catalogMsrp(
  year: number,
  make: string,
  model: string,
  trim: string,
): number | null {
  const trims =
    year === CATALOG_YEAR
      ? (findModel(make, model)?.trims ?? [])
      : legacyTrims(make, model, year);
  if (trims.length === 0) return null;
  const want = norm(trim);
  // No trim given → the model's entry price, which is what "a 2026 RAV4"
  // means to someone who only caught a glimpse from the next lane.
  if (!want) return trims[0]?.msrp ?? null;
  return trims.find((t) => norm(t.name) === want)?.msrp ?? null;
}

/**
 * Shared cache key for one exact car. Normalized so "RAV4"/"rav 4" and a
 * stray trailing space all land on the same cached answer — both phones and
 * every repeat sighting read one row instead of re-billing the model.
 */
export function carPriceKey(year: number, make: string, model: string, trim: string): string {
  return [year, norm(make), norm(model), norm(trim)].join("|");
}

/** "2026 Porsche 911 Turbo S" — the human label for a sighting. */
export function carLabel(car: {
  year: number;
  make: string;
  model: string;
  trim?: string;
}): string {
  return [car.year, car.make.trim(), car.model.trim(), car.trim?.trim()]
    .filter(Boolean)
    .join(" ");
}

/**
 * Substring filter for the pickers' search boxes. Matches on the normalized
 * form so "landrover" finds "Land Rover" and "mx5" finds "MX-5 Miata".
 */
export function filterNames(names: string[], query: string): string[] {
  const q = norm(query);
  if (!q) return names;
  return names.filter((n) => norm(n).includes(q));
}

/** Selectable model years, newest first (the catalog year leads). */
export function yearOptions(minYear: number): number[] {
  const years: number[] = [];
  for (let y = CATALOG_YEAR; y >= minYear; y--) years.push(y);
  return years;
}

/**
 * Parse a `cars` game-event value into a sighting. Tolerant by design: the
 * game shipped with only `{ name, price }` rows, and those still have to rank
 * on the same leaderboard as everything logged since.
 */
export function parseSighting(value: Record<string, unknown>): CarSighting | null {
  const msrp = Number(value.msrp ?? value.price ?? 0);
  if (!Number.isFinite(msrp) || msrp <= 0) return null;

  const source: PriceSource =
    value.source === "catalog" || value.source === "ai" ? value.source : "manual";
  const year = Number(value.year);
  const make = typeof value.make === "string" ? value.make : "";
  const model = typeof value.model === "string" ? value.model : "";

  // Legacy row: one free-text name, no structured fields. Keep the text as the
  // "model" so it still renders and ranks.
  if (!make && !model) {
    const legacy = typeof value.name === "string" ? value.name.trim() : "";
    if (!legacy) return null;
    return { year: 0, make: "", model: legacy, trim: "", msrp: Math.round(msrp), source };
  }

  return {
    year: Number.isFinite(year) && year > 0 ? year : 0,
    make,
    model,
    trim: typeof value.trim === "string" ? value.trim : "",
    msrp: Math.round(msrp),
    source,
  };
}

/** Display name for a parsed sighting, including the legacy free-text case. */
export function sightingLabel(car: CarSighting): string {
  if (!car.make && !car.year) return car.model;
  return carLabel(car);
}
