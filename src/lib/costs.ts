import type { Expense, ExpenseCategory } from "./types";
import type { Region } from "./geo";

/*
  Seed cost model — clearly-labeled 2026 estimates for the west coast corridor.
  These are starting points; the estimator blends in real logged expenses as
  the trip happens (3+ entries in a category → trust our own average).
*/

/** Regular gas, USD per gallon (BC converted from CAD/L). */
export const GAS_PRICE_USD_PER_GAL: Record<Region, number> = {
  CA: 5.05,
  OR: 4.35,
  WA: 4.75,
  BC: 4.6,
};

/** Mid-range room per night, USD. Big-city names get a bump. */
export const LODGING_PER_NIGHT: Record<Region, number> = {
  CA: 185,
  OR: 150,
  WA: 175,
  BC: 195,
};

export const BIG_CITY_BUMP = 45;
export const BIG_CITY_PATTERN = /san francisco|seattle|vancouver|santa barbara/i;

/** Per person per day, USD. */
export const FOOD_PER_PERSON_DAY = 58;
export const ACTIVITIES_PER_PERSON_DAY = 24;
export const MISC_PER_DAY = 12;

export const CATEGORIES: ExpenseCategory[] = [
  "gas",
  "lodging",
  "food",
  "activities",
  "misc",
];

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  gas: "Gas",
  lodging: "Lodging",
  food: "Food",
  activities: "Activities",
  misc: "Misc",
};

export interface CategoryProjection {
  category: ExpenseCategory;
  /** pre-trip seed estimate for the whole trip */
  estimate: number;
  /** logged so far */
  actual: number;
  /** actual + blended forecast of the remainder */
  projected: number;
  /** true once the projection uses our real spending average */
  blended: boolean;
}

export interface SeedInputs {
  /** miles driven per region across the whole route */
  milesByRegion: Record<Region, number>;
  mpg: number;
  travelers: number;
  totalDays: number;
  /** overnight counts */
  nights: { region: Region; bigCity: boolean }[];
}

export function seedEstimate(cat: ExpenseCategory, s: SeedInputs): number {
  switch (cat) {
    case "gas": {
      if (s.mpg <= 0) return 0;
      let total = 0;
      for (const [region, miles] of Object.entries(s.milesByRegion)) {
        total += (miles / s.mpg) * GAS_PRICE_USD_PER_GAL[region as Region];
      }
      return total;
    }
    case "lodging":
      return s.nights.reduce(
        (sum, n) => sum + LODGING_PER_NIGHT[n.region] + (n.bigCity ? BIG_CITY_BUMP : 0),
        0,
      );
    case "food":
      return FOOD_PER_PERSON_DAY * s.travelers * s.totalDays;
    case "activities":
      return ACTIVITIES_PER_PERSON_DAY * s.travelers * s.totalDays;
    case "misc":
      return MISC_PER_DAY * s.totalDays;
  }
}

/**
 * Progressive accuracy: before the trip the projection is the seed estimate.
 * Once underway, remaining days are forecast with our real daily average for
 * a category (if we have 3+ entries), otherwise the seed daily rate.
 */
export function projectCategory(
  cat: ExpenseCategory,
  expenses: Expense[],
  s: SeedInputs,
  daysElapsed: number, // 0 before trip, capped at totalDays
): CategoryProjection {
  const estimate = seedEstimate(cat, s);
  const entries = expenses.filter((e) => e.category === cat);
  const actual = entries.reduce((sum, e) => sum + Number(e.amount), 0);

  const remainingDays = Math.max(0, s.totalDays - daysElapsed);
  if (daysElapsed <= 0) {
    return { category: cat, estimate, actual, projected: Math.max(estimate, actual), blended: false };
  }

  const seedDaily = estimate / s.totalDays;
  const blended = entries.length >= 3;
  const daily = blended ? actual / Math.max(1, daysElapsed) : seedDaily;
  return {
    category: cat,
    estimate,
    actual,
    projected: actual + daily * remainingDays,
    blended,
  };
}
