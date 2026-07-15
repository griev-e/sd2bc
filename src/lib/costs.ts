import type { ExpenseCategory } from "./types";
import type { Region } from "./geo";

/*
  Seed cost model — clearly-labeled 2026 estimates for the west coast corridor,
  sharpened by real route miles and overnight stays as the plan takes shape.
*/

/** Regular gas, USD per gallon — AAA state averages, July 2026 (BC converted from ~C$1.80/L). */
export const GAS_PRICE_USD_PER_GAL: Record<Region, number> = {
  CA: 5.37,
  OR: 4.56,
  WA: 5.02,
  BC: 4.95,
};

/** Mid-range room per night, USD, peak-summer coastal corridor. Big-city names get a bump. */
export const LODGING_PER_NIGHT: Record<Region, number> = {
  CA: 195,
  OR: 180,
  WA: 195,
  BC: 205,
};

export const BIG_CITY_BUMP = 50;
export const BIG_CITY_PATTERN = /san francisco|seattle|vancouver|santa barbara/i;

/** Per person per day, USD — casual breakfast/lunch + one sit-down dinner. */
export const FOOD_PER_PERSON_DAY = 60;
export const ACTIVITIES_PER_PERSON_DAY = 25;

export const CATEGORIES: ExpenseCategory[] = [
  "gas",
  "lodging",
  "food",
  "activities",
];

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  gas: "Gas",
  lodging: "Lodging",
  food: "Food",
  activities: "Activities",
};

export interface SeedInputs {
  /** miles driven per region across the whole route */
  milesByRegion: Record<Region, number>;
  mpg: number;
  travelers: number;
  totalDays: number;
  /** one entry per overnight stay */
  nights: { region: Region; bigCity: boolean; free?: boolean; cost?: number | null }[];
  /** food $/person/day — trip override or {@link FOOD_PER_PERSON_DAY}. */
  foodPerDay: number;
  /** activities $/person/day — trip override or {@link ACTIVITIES_PER_PERSON_DAY}. */
  activitiesPerDay: number;
}

/** Cost of a single night: $0 if free, actual cost if known, else regional estimate. */
export function nightCost(n: {
  region: Region;
  bigCity: boolean;
  free?: boolean;
  cost?: number | null;
}): number {
  if (n.free) return 0;
  if (n.cost != null && n.cost > 0) return n.cost;
  return LODGING_PER_NIGHT[n.region] + (n.bigCity ? BIG_CITY_BUMP : 0);
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
      return s.nights.reduce((sum, n) => sum + nightCost(n), 0);
    case "food":
      return s.foodPerDay * s.travelers * s.totalDays;
    case "activities":
      return s.activitiesPerDay * s.travelers * s.totalDays;
  }
}
