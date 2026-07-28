import { describe, expect, it } from "vitest";
import { M_PER_MI } from "./budget";
import {
  DEFAULT_TANK_GAL,
  FUEL_RESERVE,
  dayHasFuelStop,
  planFuel,
  usableRangeM,
} from "./fuel";
import type { Day, DayRoute, Stop, StopKind } from "./types";

function makeDay(id: string, seq: number): Day {
  return {
    id,
    trip_id: "trip-1",
    seq,
    date: `2026-07-${String(26 + seq).padStart(2, "0")}`,
    title: "",
    notes: "",
    emoji: null,
    start_time: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeStop(id: string, dayId: string, seq: number, kind: StopKind = "stop"): Stop {
  return {
    id,
    trip_id: "trip-1",
    day_id: dayId,
    seq,
    name: id,
    lat: 36,
    lng: -121,
    kind,
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

/** A day route from a list of [fromStopId, toStopId, miles] legs. */
function makeRoute(dayId: string, legs: [string, string, number][]): DayRoute {
  const segments = legs.map(([from, to, mi]) => ({
    fromStopId: from,
    toStopId: to,
    distanceM: mi * M_PER_MI,
    durationS: mi * 60,
  }));
  return {
    dayId,
    coordinates: [],
    segments,
    distanceM: segments.reduce((s, x) => s + x.distanceM, 0),
    durationS: segments.reduce((s, x) => s + x.durationS, 0),
  };
}

const MPG = 30;
const TANK = 10;
// 30 mpg × 10 gal × 0.85 = 255 usable miles
const RANGE_MI = MPG * TANK * FUEL_RESERVE;

describe("usableRangeM", () => {
  it("holds back a reserve rather than promising a dry tank", () => {
    expect(usableRangeM(MPG, TANK) / M_PER_MI).toBeCloseTo(255, 5);
    expect(RANGE_MI).toBeLessThan(MPG * TANK);
  });

  it("is zero for nonsense inputs rather than negative", () => {
    expect(usableRangeM(0, TANK)).toBe(0);
    expect(usableRangeM(MPG, 0)).toBe(0);
    expect(usableRangeM(-5, -5)).toBe(0);
  });
});

describe("planFuel", () => {
  it("says nothing when the day fits inside a tank", () => {
    const day = makeDay("d1", 1);
    const stops = [makeStop("a", "d1", 1), makeStop("b", "d1", 2)];
    const routes = { d1: makeRoute("d1", [["a", "b", 200]]) };

    const plan = planFuel([day], stops, routes, MPG, TANK);
    expect(plan.warnings).toEqual([]);
    expect(plan.byDay).toEqual({});
  });

  it("flags the stop we'd arrive at on fumes", () => {
    const day = makeDay("d1", 1);
    const stops = [makeStop("a", "d1", 1), makeStop("b", "d1", 2), makeStop("c", "d1", 3)];
    const routes = {
      d1: makeRoute("d1", [
        ["a", "b", 150],
        ["b", "c", 150], // 300 cumulative > 255
      ]),
    };

    const plan = planFuel([day], stops, routes, MPG, TANK);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].toStopId).toBe("c");
    expect(plan.warnings[0].sinceFuelM / M_PER_MI).toBeCloseTo(300, 5);
    // 150 miles on its own is fine — it's the run that isn't
    expect(plan.warnings[0].legAlone).toBe(false);
    expect(plan.byDay.d1).toHaveLength(1);
  });

  it("resets at a planned fuel stop", () => {
    const day = makeDay("d1", 1);
    const stops = [
      makeStop("a", "d1", 1),
      makeStop("gas", "d1", 2, "fuel"),
      makeStop("c", "d1", 3),
    ];
    const routes = {
      d1: makeRoute("d1", [
        ["a", "gas", 150],
        ["gas", "c", 150], // fresh tank — 150 is fine
      ]),
    };

    expect(planFuel([day], stops, routes, MPG, TANK).warnings).toEqual([]);
  });

  it("carries the tank across day boundaries — sleeping doesn't refuel you", () => {
    const d1 = makeDay("d1", 1);
    const d2 = makeDay("d2", 2);
    const stops = [makeStop("a", "d1", 1), makeStop("b", "d1", 2), makeStop("c", "d2", 1)];
    const routes = {
      d1: makeRoute("d1", [["a", "b", 150]]),
      d2: makeRoute("d2", [["b", "c", 150]]), // 300 since the start
    };

    const plan = planFuel([d1, d2], stops, routes, MPG, TANK);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].dayId).toBe("d2");
    expect(plan.warnings[0].toStopId).toBe("c");
  });

  it("reports one problem, not a cascade of them", () => {
    const day = makeDay("d1", 1);
    const stops = ["a", "b", "c", "d", "e"].map((id, i) => makeStop(id, "d1", i + 1));
    const routes = {
      d1: makeRoute("d1", [
        ["a", "b", 200],
        ["b", "c", 200], // 400 — warn, reset
        ["c", "d", 100],
        ["d", "e", 100], // 200 since reset — fine
      ]),
    };

    const plan = planFuel([day], stops, routes, MPG, TANK);
    expect(plan.warnings.map((w) => w.toStopId)).toEqual(["c"]);
  });

  it("marks a single leg longer than the whole tank", () => {
    const day = makeDay("d1", 1);
    const stops = [makeStop("a", "d1", 1), makeStop("b", "d1", 2)];
    const routes = { d1: makeRoute("d1", [["a", "b", 400]]) };

    const plan = planFuel([day], stops, routes, MPG, TANK);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].legAlone).toBe(true);
  });

  it("still warns when even the planned pump is out of reach", () => {
    const day = makeDay("d1", 1);
    const stops = [makeStop("a", "d1", 1), makeStop("gas", "d1", 2, "fuel")];
    const routes = { d1: makeRoute("d1", [["a", "gas", 400]]) };

    const plan = planFuel([day], stops, routes, MPG, TANK);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].toStopId).toBe("gas");
    expect(plan.warnings[0].legAlone).toBe(true);
  });

  it("stays quiet rather than warning about everything when MPG is nonsense", () => {
    const day = makeDay("d1", 1);
    const stops = [makeStop("a", "d1", 1), makeStop("b", "d1", 2)];
    const routes = { d1: makeRoute("d1", [["a", "b", 400]]) };

    expect(planFuel([day], stops, routes, 0, TANK).warnings).toEqual([]);
  });

  it("ignores days that have no route computed yet", () => {
    const plan = planFuel([makeDay("d1", 1)], [], {}, MPG, TANK);
    expect(plan.warnings).toEqual([]);
  });

  it("reports back the inputs it used", () => {
    const plan = planFuel([], [], {}, MPG, DEFAULT_TANK_GAL);
    expect(plan.mpg).toBe(MPG);
    expect(plan.tankGal).toBe(DEFAULT_TANK_GAL);
    expect(plan.usableRangeM).toBeCloseTo(usableRangeM(MPG, DEFAULT_TANK_GAL), 5);
  });
});

describe("dayHasFuelStop", () => {
  it("finds a planned fill-up on the day", () => {
    const day = makeDay("d1", 1);
    expect(dayHasFuelStop(day, [makeStop("a", "d1", 1)])).toBe(false);
    expect(dayHasFuelStop(day, [makeStop("gas", "d1", 1, "fuel")])).toBe(true);
    // another day's pump doesn't count
    expect(dayHasFuelStop(day, [makeStop("gas", "d2", 1, "fuel")])).toBe(false);
  });
});
