import { describe, expect, it } from "vitest";
import { computeBudget, M_PER_MI } from "./budget";
import { GAS_PRICE_USD_PER_GAL, LODGING_PER_NIGHT, BIG_CITY_BUMP } from "./costs";
import type { Day, DayRoute, Stop, Trip } from "./types";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    name: "SD → Vancouver",
    start_date: "2026-07-27",
    mpg: 25,
    travelers: 2,
    food_per_day: null,
    activities_per_day: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeDay(overrides: Partial<Day> = {}): Day {
  return {
    id: "day-1",
    trip_id: "trip-1",
    seq: 1,
    date: "2026-07-27",
    title: "",
    notes: "",
    emoji: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeStop(overrides: Partial<Stop> = {}): Stop {
  return {
    id: "stop-1",
    trip_id: "trip-1",
    day_id: "day-1",
    seq: 1,
    name: "La Jolla",
    lat: 32.85,
    lng: -117.27,
    kind: "stop",
    is_overnight: false,
    notes: "",
    address: null,
    lodging_url: null,
    lodging_free: false,
    lodging_cost: null,
    start_time: null,
    duration_min: null,
    created_by: null,
    updated_by: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("computeBudget", () => {
  const days = [makeDay(), makeDay({ id: "day-2", seq: 2, date: "2026-07-28" })];
  const stops = [
    makeStop(), // CA, day 1
    makeStop({ id: "stop-2", seq: 2, name: "Santa Barbara", lat: 34.42, is_overnight: true }),
    makeStop({ id: "stop-3", day_id: "day-2", name: "Newport OR", lat: 44.6 }),
  ];
  const routes: Record<string, DayRoute> = {
    "day-1": {
      dayId: "day-1",
      coordinates: [],
      segments: [
        { fromStopId: "stop-1", toStopId: "stop-2", distanceM: 250 * M_PER_MI, durationS: 4 * 3600 },
      ],
      distanceM: 250 * M_PER_MI,
      durationS: 4 * 3600,
    },
  };

  it("prices gas from per-region miles at the trip's mpg", () => {
    const { estimates, totalMiles } = computeBudget(makeTrip(), days, stops, routes);
    expect(totalMiles).toBeCloseTo(250);
    expect(estimates.gas).toBeCloseTo((250 / 25) * GAS_PRICE_USD_PER_GAL.CA);
  });

  it("prices nights: regional estimate + big-city bump, $0 free, explicit cost wins", () => {
    const base = computeBudget(makeTrip(), days, stops, routes);
    // Santa Barbara is a CA big-city name: 195 + 50
    expect(base.estimates.lodging).toBe(LODGING_PER_NIGHT.CA + BIG_CITY_BUMP);

    const free = stops.map((s) => (s.id === "stop-2" ? { ...s, lodging_free: true } : s));
    expect(computeBudget(makeTrip(), days, free, routes).estimates.lodging).toBe(0);

    const priced = stops.map((s) => (s.id === "stop-2" ? { ...s, lodging_cost: 180 } : s));
    expect(computeBudget(makeTrip(), days, priced, routes).estimates.lodging).toBe(180);
  });

  it("scales food and activities by travelers × days, honoring trip overrides", () => {
    const { estimates } = computeBudget(makeTrip({ food_per_day: 80 }), days, stops, routes);
    expect(estimates.food).toBe(80 * 2 * 2);
  });

  it("builds one daily entry per day, in seq order, with zero-lodging gaps", () => {
    const { daily } = computeBudget(makeTrip(), days, stops, routes);
    expect(daily.gas).toHaveLength(2);
    expect(daily.gas[1]).toBe(0); // day 2 has no route yet
    expect(daily.lodging[0]).toBe(LODGING_PER_NIGHT.CA + BIG_CITY_BUMP);
    expect(daily.lodging[1]).toBe(0); // no overnight marked
  });

  it("survives a null trip and an empty plan with defaults", () => {
    const { estimates, total, seed } = computeBudget(null, [], [], {});
    expect(seed.mpg).toBe(28);
    expect(estimates.gas).toBe(0);
    expect(total).toBeGreaterThan(0); // food/activities still seed from 1 day
  });
});
