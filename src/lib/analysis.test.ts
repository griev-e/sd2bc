import { describe, expect, it } from "vitest";
import {
  analysisKey,
  buildAnalysisPayload,
  type AnalyzeEstimates,
} from "./analysis";
import type { Day, DayRoute, Stop, Trip, ViaPoint } from "./types";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    name: "SD → Vancouver",
    start_date: "2026-07-27",
    mpg: 28,
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

const NO_ESTIMATES: AnalyzeEstimates = {
  gas: 0,
  lodging: 0,
  food: 0,
  activities: 0,
  totalMiles: 0,
};

describe("analysisKey", () => {
  const trip = makeTrip();
  const days = [makeDay()];
  const stops = [makeStop()];
  const vias: ViaPoint[] = [];

  it("is stable for identical inputs", () => {
    expect(analysisKey(trip, days, stops, vias)).toBe(analysisKey(trip, days, stops, vias));
  });

  it("ignores fields that can't change the analysis (notes, titles)", () => {
    const renamedDay = [makeDay({ title: "Coast day", notes: "bring towels" })];
    expect(analysisKey(trip, renamedDay, stops, vias)).toBe(
      analysisKey(trip, days, stops, vias),
    );
  });

  it("changes when a stop moves, reorders, or becomes an overnight", () => {
    const base = analysisKey(trip, days, stops, vias);
    expect(analysisKey(trip, days, [makeStop({ lat: 33.0 })], vias)).not.toBe(base);
    expect(analysisKey(trip, days, [makeStop({ seq: 2 })], vias)).not.toBe(base);
    expect(analysisKey(trip, days, [makeStop({ is_overnight: true })], vias)).not.toBe(base);
  });

  it("changes when budget knobs change", () => {
    const base = analysisKey(trip, days, stops, vias);
    expect(analysisKey(makeTrip({ mpg: 30 }), days, stops, vias)).not.toBe(base);
    expect(analysisKey(makeTrip({ food_per_day: 80 }), days, stops, vias)).not.toBe(base);
  });

  it("changes when a via point bends the route", () => {
    const via: ViaPoint = {
      id: "via-1",
      trip_id: "trip-1",
      after_stop_id: "stop-1",
      seq: 1,
      lat: 33.1,
      lng: -117.3,
      created_by: null,
      created_at: "",
    };
    expect(analysisKey(trip, days, stops, [via])).not.toBe(
      analysisKey(trip, days, stops, vias),
    );
  });
});

describe("buildAnalysisPayload", () => {
  const trip = makeTrip();
  const days = [
    makeDay(),
    makeDay({ id: "day-2", seq: 2, date: "2026-07-28" }),
  ];
  const stops = [
    makeStop(),
    makeStop({ id: "stop-2", seq: 2, name: "Santa Barbara", lat: 34.42, lng: -119.7, is_overnight: true }),
    makeStop({ id: "stop-3", day_id: "day-2", seq: 1, name: "Big Sur", lat: 36.27, lng: -121.81 }),
  ];
  const routes: Record<string, DayRoute> = {
    "day-1": {
      dayId: "day-1",
      coordinates: [],
      segments: [
        { fromStopId: "stop-1", toStopId: "stop-2", distanceM: 350 * 1609.344, durationS: 5.5 * 3600 },
      ],
      distanceM: 350 * 1609.344,
      durationS: 5.5 * 3600,
    },
  };

  const payload = buildAnalysisPayload(trip, days, stops, routes, {
    gas: 480,
    lodging: 1800,
    food: 1200,
    activities: 500,
    totalMiles: 2600,
  });

  it("orders days by seq and carries drive totals in display units", () => {
    expect(payload.days.map((d) => d.seq)).toEqual([1, 2]);
    expect(payload.days[0].drive_miles).toBe(350);
    expect(payload.days[0].drive_min).toBe(330);
    expect(payload.days[1].drive_miles).toBe(0); // no route yet
  });

  it("names both ends of every leg", () => {
    expect(payload.days[0].legs).toEqual([
      { from: "La Jolla", to: "Santa Barbara", miles: 350, min: 330 },
    ]);
  });

  it("marks overnights and prices the night the way the forecast does", () => {
    const sb = payload.days[0].stops.find((s) => s.name === "Santa Barbara")!;
    expect(sb.overnight).toBe(true);
    // Santa Barbara is a big-city name in CA: 195 + 50
    expect(sb.night_estimate).toBe(245);
    expect(payload.days[0].has_overnight).toBe(true);
    expect(payload.days[1].has_overnight).toBe(false);
  });

  it("carries the budget forecast and trip settings", () => {
    expect(payload.budget).toEqual({
      total_miles: 2600,
      est_gas: 480,
      est_lodging: 1800,
      est_food: 1200,
      est_activities: 500,
      nights_planned: 1,
      nights_free: 0,
    });
    expect(payload.trip.total_days).toBe(2);
    expect(payload.trip.food_per_person_day).toBe(60);
  });

  it("survives an empty plan without routes", () => {
    const empty = buildAnalysisPayload(trip, [], [], {}, NO_ESTIMATES);
    expect(empty.days).toEqual([]);
    expect(empty.trip.total_days).toBe(1);
  });
});
