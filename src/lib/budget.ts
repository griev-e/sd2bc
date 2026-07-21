import {
  ACTIVITIES_PER_PERSON_DAY,
  BIG_CITY_PATTERN,
  CATEGORIES,
  FOOD_PER_PERSON_DAY,
  GAS_PRICE_USD_PER_GAL,
  nightCost,
  seedEstimate,
  type SeedInputs,
} from "./costs";
import { regionOf, type Region } from "./geo";
import type { Day, DayRoute, ExpenseCategory, Stop, Trip } from "./types";

/*
  The whole budget forecast in one pure function — shared by the Budget tab
  and the AI trip analyzer so the two can never disagree about the numbers.
  Route miles are attributed to the region of each segment's *origin* stop.
*/

export const M_PER_MI = 1609.344;

export interface BudgetForecast {
  seed: SeedInputs;
  estimates: Record<ExpenseCategory, number>;
  /** Sum of all category estimates. */
  total: number;
  /** Route miles across every computed day. */
  totalMiles: number;
  /** Estimated spend per category per day, in day-seq order. */
  daily: Record<ExpenseCategory, number[]>;
}

export function computeBudget(
  trip: Trip | null,
  days: Day[],
  stops: Stop[],
  routes: Record<string, DayRoute>,
): BudgetForecast {
  const mpg = trip?.mpg ?? 28;
  const travelers = trip?.travelers ?? 2;
  const orderedDays = [...days].sort((a, b) => a.seq - b.seq);
  const stopById = new Map(stops.map((s) => [s.id, s]));

  const milesByRegion: Record<Region, number> = { CA: 0, OR: 0, WA: 0, BC: 0 };
  for (const r of Object.values(routes)) {
    for (const seg of r.segments) {
      const from = stopById.get(seg.fromStopId);
      if (!from) continue;
      milesByRegion[regionOf(from.lat)] += seg.distanceM / M_PER_MI;
    }
  }

  const nights = stops
    .filter((s) => s.is_overnight)
    .map((s) => ({
      region: regionOf(s.lat),
      bigCity: BIG_CITY_PATTERN.test(s.name),
      free: s.lodging_free,
      cost: s.lodging_cost,
    }));

  const seed: SeedInputs = {
    milesByRegion,
    mpg,
    travelers,
    totalDays: Math.max(1, days.length),
    nights,
    foodPerDay: trip?.food_per_day ?? FOOD_PER_PERSON_DAY,
    activitiesPerDay: trip?.activities_per_day ?? ACTIVITIES_PER_PERSON_DAY,
  };

  const estimates = Object.fromEntries(
    CATEGORIES.map((c) => [c, seedEstimate(c, seed)]),
  ) as Record<ExpenseCategory, number>;
  const total = CATEGORIES.reduce((s, c) => s + estimates[c], 0);
  const totalMiles = Object.values(milesByRegion).reduce((a, b) => a + b, 0);

  // day-by-day series — powers the trend bars on the Budget tab
  const daily = {} as Record<ExpenseCategory, number[]>;
  for (const c of CATEGORIES) daily[c] = [];
  for (const day of orderedDays) {
    const route: DayRoute | undefined = routes[day.id];
    let gas = 0;
    for (const seg of route?.segments ?? []) {
      const from = stopById.get(seg.fromStopId);
      if (!from) continue;
      gas +=
        ((seg.distanceM / M_PER_MI) * GAS_PRICE_USD_PER_GAL[regionOf(from.lat)]) /
        Math.max(1, mpg);
    }
    const overnight = stops.find((s) => s.day_id === day.id && s.is_overnight);
    const lodging = overnight
      ? nightCost({
          region: regionOf(overnight.lat),
          bigCity: BIG_CITY_PATTERN.test(overnight.name),
          free: overnight.lodging_free,
          cost: overnight.lodging_cost,
        })
      : 0;
    daily.gas.push(gas);
    daily.lodging.push(lodging);
    daily.food.push(seed.foodPerDay * travelers);
    daily.activities.push(seed.activitiesPerDay * travelers);
  }

  return { seed, estimates, total, totalMiles, daily };
}
