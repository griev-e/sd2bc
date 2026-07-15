import { describe, expect, it } from "vitest";
import { getSchedule, hhmmToMinutes, minutesToHHMM } from "./schedule";
import type { Day, DayRoute, Stop } from "./types";

describe("hhmmToMinutes / minutesToHHMM", () => {
  it("round-trips an ordinary time", () => {
    expect(hhmmToMinutes("14:30")).toBe(870);
    expect(minutesToHHMM(870)).toBe("14:30");
  });

  it("wraps minutes past midnight forward", () => {
    expect(minutesToHHMM(1450)).toBe("00:10");
  });

  it("wraps negative minutes backward", () => {
    expect(minutesToHHMM(-10)).toBe("23:50");
  });
});

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

function makeStop(
  id: string,
  day_id: string,
  seq: number,
  overrides: Partial<Stop> = {},
): Stop {
  return {
    id,
    trip_id: "trip-1",
    day_id,
    seq,
    name: id,
    lat: 32.7,
    lng: -117.1,
    kind: "stop",
    is_overnight: false,
    notes: "",
    lodging_url: null,
    lodging_free: false,
    lodging_cost: null,
    start_time: null,
    duration_min: null,
    created_by: null,
    updated_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRoute(dayId: string, segments: DayRoute["segments"]): DayRoute {
  return { dayId, coordinates: [], segments, distanceM: 0, durationS: 0 };
}

describe("getSchedule", () => {
  it("anchors day one's origin to its own start_time as a departure, not an arrival", () => {
    const dayA = makeDay("dayA", 1, "2026-07-27");
    const dayB = makeDay("dayB", 2, "2026-07-28");
    const origin = makeStop("origin", "dayA", 1, { start_time: "08:00" });
    const stopA2 = makeStop("stopA2", "dayA", 2, { duration_min: 30 });
    const stopB1 = makeStop("stopB1", "dayB", 1);

    const routes: Record<string, DayRoute> = {
      dayA: makeRoute("dayA", [
        { fromStopId: "origin", toStopId: "stopA2", distanceM: 0, durationS: 3600 },
      ]),
      dayB: makeRoute("dayB", [
        { fromStopId: "stopA2", toStopId: "stopB1", distanceM: 0, durationS: 1800 },
      ]),
    };

    const schedule = getSchedule([dayA, dayB], [origin, stopA2, stopB1], routes);

    expect(schedule.get("origin")).toEqual({ arrivalMin: 480, departMin: 480, anchored: true });
    // 480 (dep) + 60 min drive = 540 arrival; + 30 min stay = 570 departure
    expect(schedule.get("stopA2")).toEqual({ arrivalMin: 540, departMin: 570, anchored: false });
    // day 2 starts at DAY_START_MIN (9:00 = 540) + 30 min drive = 570
    expect(schedule.get("stopB1")).toEqual({ arrivalMin: 570, departMin: 570, anchored: false });
  });

  it("re-anchors the chain when a later stop has its own start_time", () => {
    const dayA = makeDay("dayA", 1, "2026-07-27");
    const origin = makeStop("origin", "dayA", 1);
    const reservation = makeStop("reservation", "dayA", 2, { start_time: "18:00" });

    const routes: Record<string, DayRoute> = {
      dayA: makeRoute("dayA", [
        { fromStopId: "origin", toStopId: "reservation", distanceM: 0, durationS: 3600 },
      ]),
    };

    const schedule = getSchedule([dayA], [origin, reservation], routes);
    // Drive-derived arrival would be 9:00 + 60min = 10:00, but the stop's own
    // start_time bends the estimate to the reservation instead.
    expect(schedule.get("reservation")).toEqual({
      arrivalMin: hhmmToMinutes("18:00"),
      departMin: hhmmToMinutes("18:00"),
      anchored: true,
    });
  });

  it("skips days with no stops without throwing", () => {
    const dayA = makeDay("dayA", 1, "2026-07-27");
    const schedule = getSchedule([dayA], [], {});
    expect(schedule.size).toBe(0);
  });

  it("memoizes by reference: unchanged inputs return the same Map instance", () => {
    const dayA = makeDay("dayA", 1, "2026-07-27");
    const origin = makeStop("origin", "dayA", 1);
    const days = [dayA];
    const stops = [origin];
    const routes: Record<string, DayRoute> = {};

    const first = getSchedule(days, stops, routes);
    const second = getSchedule(days, stops, routes);
    expect(second).toBe(first);

    const third = getSchedule([...days], stops, routes);
    expect(third).not.toBe(first);
  });
});
