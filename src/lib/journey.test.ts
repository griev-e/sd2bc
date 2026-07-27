import { describe, expect, it } from "vitest";
import {
  buildJourney,
  getVehiclePref,
  liveDistance,
  nearestOnJourney,
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

describe("nearestOnJourney", () => {
  const j = buildJourney([dayA, dayB], routes);

  it("snaps a point beside the line to its distance along the loop", () => {
    // half a degree east, a touch north of the line = halfway along day A
    const near = nearestOnJourney(j, [0.5, 0.01])!;
    expect(near.dist).toBeCloseTo(j.legs[0].endDist / 2, -2);
    expect(near.offRouteM).toBeLessThan(1200);
    expect(near.lngLat[0]).toBeCloseTo(0.5, 3);
  });

  it("reports how far off-route the query sits", () => {
    const near = nearestOnJourney(j, [0.5, 1])!;
    expect(near.offRouteM).toBeGreaterThan(110000);
  });

  it("clamps to the ends rather than extrapolating", () => {
    expect(nearestOnJourney(j, [-5, 0])!.dist).toBe(0);
    expect(nearestOnJourney(j, [9, 0])!.dist).toBeCloseTo(j.totalDist, 6);
  });

  it("picks the nearer pass when the route doubles back", () => {
    // out along y=0 and back along y=1: a point just under the return leg
    // must snap to the return leg, not to the outbound one it started from
    const loop = buildJourney([dayA, dayB], {
      A: route("A", [
        [0, 0],
        [2, 0],
      ]),
      B: route("B", [
        [2, 0],
        [2, 1],
        [0, 1],
      ]),
    });
    const near = nearestOnJourney(loop, [1, 0.98])!;
    expect(near.dist).toBeGreaterThan(loop.legs[0].endDist);
    expect(near.offRouteM).toBeLessThan(2500);
  });

  it("has nothing to say about an empty journey", () => {
    expect(nearestOnJourney(buildJourney([], {}), [0, 0])).toBeNull();
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

// The itinerary-aware path: a day whose route carries stop→stop segments gets
// per-stop anchors, so the marker drives each leg on its own clock and waits
// out planned stays instead of sweeping the day's whole distance uniformly.
describe("liveDistance with per-stop anchors", () => {
  // One day: A(0°) → B(1°) → C(2°), equal distances.
  const day1 = makeDay("A", 1, "2026-07-27");
  const segRoute: DayRoute = {
    dayId: "A",
    coordinates: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    segments: [
      { fromStopId: "s1", toStopId: "s2", distanceM: 111000, durationS: 7200 },
      { fromStopId: "s2", toStopId: "s3", distanceM: 111000, durationS: 7200 },
    ],
    distanceM: 222000,
    durationS: 14400,
  };
  const j = buildJourney([day1], { A: segRoute });
  const days = [day1];
  const stops = [makeStop("s1", "A", 1), makeStop("s2", "A", 2), makeStop("s3", "A", 3)];
  const sched = (arrivalMin: number, departMin: number): StopSchedule => ({
    arrivalMin,
    departMin,
    anchored: false,
  });
  // Depart 9:00, reach B at 11:00, sit there until 14:00, reach C at 16:00.
  const withStay = new Map<string, StopSchedule>([
    ["s1", sched(540, 540)],
    ["s2", sched(660, 840)],
    ["s3", sched(960, 960)],
  ]);
  const at = (h: number, m = 0, s = withStay) =>
    liveDistance(j, days, stops, s, new Date(2026, 6, 27, h, m)) / j.totalDist;

  it("pins each stop to its share of the day's driving", () => {
    expect(j.legs[0].anchors.map((a) => a.stopId)).toEqual(["s1", "s2", "s3"]);
    expect(j.legs[0].anchors[0].dist).toBe(0);
    expect(j.legs[0].anchors[1].dist).toBeCloseTo(j.totalDist / 2, -1);
    expect(j.legs[0].anchors[2].dist).toBeCloseTo(j.totalDist, 6);
  });

  it("sits still for the whole of a planned stay", () => {
    // arrival at B, and every hour of the three-hour stop, is the same place
    expect(at(11)).toBeCloseTo(0.5, 2);
    expect(at(12)).toBeCloseTo(0.5, 2);
    expect(at(13, 30)).toBeCloseTo(0.5, 2);
    // and it leaves the moment the stay is over
    expect(at(15)).toBeCloseTo(0.75, 2);
  });

  it("drives each segment on that segment's own clock", () => {
    expect(at(10)).toBeCloseTo(0.25, 2); // halfway to B
    expect(at(16)).toBeCloseTo(1, 2); // arrived at C
  });

  it("honors a slow leg followed by a fast one", () => {
    // same road, but B is reached at 15:00 and C an hour later
    const lopsided = new Map<string, StopSchedule>([
      ["s1", sched(540, 540)],
      ["s2", sched(900, 900)],
      ["s3", sched(960, 960)],
    ]);
    expect(at(12, 0, lopsided)).toBeCloseTo(0.25, 2); // still crawling to B
    expect(at(15, 30, lopsided)).toBeCloseTo(0.75, 2); // flying to C
  });

  it("holds at the last stop once the day's driving is done", () => {
    expect(at(21)).toBeCloseTo(1, 6);
  });

  it("holds at the origin before the morning departure", () => {
    expect(at(6)).toBe(0);
  });

  it("jumps forward when a start_time anchors a stop earlier than the drive", () => {
    // B is pinned to 9:30 though the drive can't get there until 11:00
    const anchored = new Map<string, StopSchedule>([
      ["s1", sched(540, 540)],
      ["s2", sched(570, 570)],
      ["s3", sched(960, 960)],
    ]);
    expect(at(10, 0, anchored)).toBeGreaterThan(0.5);
  });

  it("falls back to the day-wide sweep when the route has no segments yet", () => {
    const bare = buildJourney([day1], {
      A: { ...segRoute, segments: [] },
    });
    expect(bare.legs[0].anchors).toEqual([]);
    const d = liveDistance(bare, days, stops, withStay, new Date(2026, 6, 27, 12, 30));
    // 9:00→16:00 swept linearly: 3.5h of 7h
    expect(d / bare.totalDist).toBeCloseTo(0.5, 2);
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
