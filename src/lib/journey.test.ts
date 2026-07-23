import { describe, expect, it } from "vitest";
import {
  buildJourney,
  getVehiclePref,
  liveDistance,
  positionAtDistance,
  serverVehiclePref,
  VEHICLES,
  vehicleEmoji,
} from "./journey";
import type { Day, DayRoute, Stop } from "./types";
import type { StopSchedule } from "./schedule";

function makeDay(id: string, seq: number, date: string): Day {
  return {
    id,
    trip_id: "trip-1",
    seq,
    date,
    title: "",
    notes: "",
    emoji: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeStop(id: string, day_id: string, seq: number): Stop {
  return {
    id,
    trip_id: "trip-1",
    day_id,
    seq,
    name: id,
    lat: 0,
    lng: 0,
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
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function route(dayId: string, coordinates: [number, number][]): DayRoute {
  return { dayId, coordinates, segments: [], distanceM: 0, durationS: 0 };
}

// Two days, drawn as straight eastward segments that share their seam point.
const dayA = makeDay("A", 1, "2026-07-27");
const dayB = makeDay("B", 2, "2026-07-28");
const routes: Record<string, DayRoute> = {
  A: route("A", [
    [0, 0],
    [1, 0],
  ]),
  B: route("B", [
    [1, 0],
    [2, 0],
  ]),
};

describe("buildJourney", () => {
  it("concatenates day routes into one distance timeline with per-day legs", () => {
    const j = buildJourney([dayA, dayB], routes);
    expect(j.legs).toHaveLength(2);
    expect(j.legs[0].startDist).toBe(0);
    // shared seam adds no distance — day B starts exactly where A ended
    expect(j.legs[1].startDist).toBeCloseTo(j.legs[0].endDist, 6);
    expect(j.totalDist).toBeCloseTo(j.legs[1].endDist, 6);
    // ~111km per 1° at the equator, twice
    expect(j.totalDist).toBeGreaterThan(220000);
    expect(j.totalDist).toBeLessThan(224000);
  });

  it("gives a day with no drivable route a zero-length resting leg", () => {
    const j = buildJourney([dayA, makeDay("C", 2, "2026-07-28")], { A: routes.A });
    expect(j.legs[1].startDist).toBe(j.legs[1].endDist);
    expect(j.legs[1].startDist).toBeCloseTo(j.legs[0].endDist, 6);
  });
});

describe("positionAtDistance", () => {
  const j = buildJourney([dayA, dayB], routes);

  it("returns the origin at distance 0", () => {
    const p = positionAtDistance(j, 0)!;
    expect(p.lngLat[0]).toBeCloseTo(0, 6);
    expect(p.dayIndex).toBe(0);
    expect(p.progress).toBe(0);
  });

  it("interpolates within a segment", () => {
    const p = positionAtDistance(j, j.legs[0].endDist / 2)!;
    expect(p.lngLat[0]).toBeCloseTo(0.5, 4);
    expect(p.dayIndex).toBe(0);
  });

  it("lands on the finish and reports the last day at the end", () => {
    const p = positionAtDistance(j, j.totalDist)!;
    expect(p.lngLat[0]).toBeCloseTo(2, 4);
    expect(p.dayIndex).toBe(1);
    expect(p.progress).toBeCloseTo(1, 6);
  });

  it("clamps out-of-range distances", () => {
    expect(positionAtDistance(j, -50)!.lngLat[0]).toBeCloseTo(0, 6);
    expect(positionAtDistance(j, j.totalDist + 999999)!.lngLat[0]).toBeCloseTo(2, 4);
  });

  it("returns null for an empty journey", () => {
    expect(positionAtDistance(buildJourney([], {}), 100)).toBeNull();
  });
});

describe("liveDistance", () => {
  const j = buildJourney([dayA, dayB], routes);
  const days = [dayA, dayB];
  const stops = [
    makeStop("a1", "A", 1),
    makeStop("a2", "A", 2),
    makeStop("b1", "B", 1),
    makeStop("b2", "B", 2),
  ];
  const sched = (arrivalMin: number, departMin: number): StopSchedule => ({
    arrivalMin,
    departMin,
    anchored: false,
  });
  // Day A drives 9:00→10:00; Day B drives 9:00→10:00.
  const schedule = new Map<string, StopSchedule>([
    ["a1", sched(540, 540)],
    ["a2", sched(600, 600)],
    ["b1", sched(570, 570)],
    ["b2", sched(600, 600)],
  ]);

  it("parks at the origin before the trip starts", () => {
    expect(liveDistance(j, days, stops, schedule, new Date(2026, 6, 26, 12, 0))).toBe(0);
  });

  it("rests at the finish after the trip ends", () => {
    expect(liveDistance(j, days, stops, schedule, new Date(2026, 6, 30, 12, 0))).toBe(
      j.totalDist,
    );
  });

  it("eases across day one between its departure and arrival", () => {
    // 9:30 = halfway through the 9:00→10:00 window
    const d = liveDistance(j, days, stops, schedule, new Date(2026, 6, 27, 9, 30));
    expect(d).toBeCloseTo(j.legs[0].endDist / 2, 3);
  });

  it("holds at the day's start before its morning departure", () => {
    const d = liveDistance(j, days, stops, schedule, new Date(2026, 6, 27, 7, 0));
    expect(d).toBe(j.legs[0].startDist);
  });

  it("continues into the correct leg on a later day", () => {
    // Day B at 9:30 → halfway along B's leg, offset by A's whole length
    const d = liveDistance(j, days, stops, schedule, new Date(2026, 6, 28, 9, 30));
    const legB = j.legs[1];
    expect(d).toBeCloseTo(legB.startDist + (legB.endDist - legB.startDist) / 2, 3);
  });
});

describe("vehicle preference", () => {
  it("defaults to the van when unset", () => {
    expect(getVehiclePref()).toBe("van");
    expect(serverVehiclePref()).toBe("van");
  });

  it("resolves an emoji for every option and falls back safely", () => {
    for (const v of VEHICLES) expect(vehicleEmoji(v.key)).toBe(v.emoji);
    expect(vehicleEmoji("nope")).toBe(VEHICLES[0].emoji);
  });
});
