/**
 * "$$$ Cars" domain logic — pure, so it unit-tests without a DOM.
 *
 * Two halves:
 *  - the catalog side: cascading make → model → trim lookups over `carData.ts`
 *    and the exact-MSRP hit that makes the common case free and instant.
 *  - the ranking side: an MSRP lands in a price tier, and each tier is worth
 *    points, so a sighting is *ranked*, not just listed. Beating your partner
 *    means finding rarer metal, not logging more Corollas.
 *
 * Anything the catalog can't price (an older model year, an off-catalog car)
 * gets resolved by the cached Haiku lookup behind `api/car-price`; `carPriceKey`
 * is the shared cache key for that path.
 */

import { CAR_CATALOG, CATALOG_YEAR, type CarMake, type CarModel } from "./carData";

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
 * A player's score: the points of every car they logged. Summed rather than
 * maxed so a steady stream of good finds competes with one lucky Lambo.
 */
export function scoreFor(sightings: { msrp: number }[]): number {
  return sightings.reduce((sum, s) => sum + pointsFor(s.msrp), 0);
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

export function makeNames(): string[] {
  return CAR_CATALOG.map((m) => m.name);
}

function findMake(make: string): CarMake | undefined {
  const want = norm(make);
  return CAR_CATALOG.find((m) => norm(m.name) === want);
}

function findModel(make: string, model: string): CarModel | undefined {
  const want = norm(model);
  return findMake(make)?.models.find((m) => norm(m.name) === want);
}

export function modelsForMake(make: string): CarModel[] {
  return findMake(make)?.models ?? [];
}

export function trimsForModel(make: string, model: string): { name: string; msrp: number }[] {
  return findModel(make, model)?.trims ?? [];
}

/**
 * Exact catalog MSRP, or null when the catalog can't answer — a different
 * model year, an unlisted make/model, or a trim we don't carry. Null is the
 * signal to fall back to the AI lookup; it is never a guess.
 */
export function catalogMsrp(
  year: number,
  make: string,
  model: string,
  trim: string,
): number | null {
  if (year !== CATALOG_YEAR) return null;
  const found = findModel(make, model);
  if (!found) return null;
  const want = norm(trim);
  // No trim given → the model's entry price, which is what "a 2026 RAV4"
  // means to someone who only caught a glimpse from the next lane.
  if (!want) return found.trims[0]?.msrp ?? null;
  return found.trims.find((t) => norm(t.name) === want)?.msrp ?? null;
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
