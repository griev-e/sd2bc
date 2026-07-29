import { describe, expect, it } from "vitest";
import { M_PER_MI } from "./budget";
import { getSchedule } from "./schedule";
import { buildToday, NOW_GRACE_MIN } from "./today";
import type { Day, DayRoute, Stop } from "./types";

const TODAY = "2026-07-28";
const TOMORROW = "2026-07-29";

function makeDay(id: string, seq: number, date: string, overrides: Partial<Day> = {}): Day {
  return {
    id,
    trip_id: "trip-1",
    seq,
    date,
    title: "",
    notes: "",
    emoji: null,
    start_time: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStop(id: string, dayId: string, seq: number, overrides: Partial<Stop> = {}): Stop {
  return {
    id,
    trip_id: "trip-1",
    day_id: dayId,
    seq,
    name: id,
    lat: 36,
    lng: -121,
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
    ...overrides,
  };
}

function makeRoute(dayId: string, legs: [string, string, number][]): DayRoute {
  const segments = legs.map(([from, to, mi]) => ({
    fromStopId: from,
    toStopId: to,
    distanceM: mi * M_PER_MI,
    durationS: mi * 60, // 60 mph, keeps the arithmetic readable
  }));
  return {
    dayId,
    coordinates: [],
    segments,
    distanceM: segments.reduce((s, x) => s + x.distanceM, 0),
    durationS: segments.reduce((s, x) => s + x.durationS, 0),
  };
}

/** Local-time clock on the trip's second day. */
function at(hhmm: string, date = TODAY): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
}

/**
 * Day 1 yesterday, day 2 today: origin → lunch (1h drive) → hotel (1h drive).
 * Day 2 departs at the 9:00 default, so lunch lands 10:00 and the hotel 11:00.
 */
function scenario(dayOverrides: Partial<Day> = {}) {
  const d1 = makeDay("d1", 1, "2026-07-27");
  const d2 = makeDay("d2", 2, TODAY, dayOverrides);
  const stops = [
    makeStop("home", "d1", 1),
    makeStop("night1", "d1", 2, { is_overnight: true }),
    makeStop("lunch", "d2", 1),
    makeStop("hotel", "d2", 2, { is_overnight: true }),
  ];
  const routes: Record<string, DayRoute> = {
    d1: makeRoute("d1", [["home", "night1", 60]]),
    d2: makeRoute("d2", [
      ["night1", "lunch", 60],
      ["lunch", "hotel", 60],
    ]),
  };
  const days = [d1, d2];
  return { days, stops, routes, schedule: getSchedule(days, stops, routes) };
}

describe("buildToday", () => {
  it("returns null when the clock isn't on a trip day", () => {
    const { days, stops, routes, schedule } = scenario();
    expect(buildToday(days, stops, routes, schedule, at("09:00", "2026-08-15"))).toBeNull();
  });

  it("places us on the right day of the trip", () => {
    const { days, stops, routes, schedule } = scenario();
    const view = buildToday(days, stops, routes, schedule, at("09:30"))!;
    expect(view.day.id).toBe("d2");
    expect(view.dayIndex).toBe(1);
    expect(view.totalDays).toBe(2);
  });

  it("knows we haven't left yet, and when we should", () => {
    const { days, stops, routes, schedule } = scenario();
    const early = buildToday(days, stops, routes, schedule, at("07:00"))!;
    expect(early.beforeDeparture).toBe(true);
    expect(early.departMin).toBe(540); // 9:00 default

    const rolling = buildToday(days, stops, routes, schedule, at("09:30"))!;
    expect(rolling.beforeDeparture).toBe(false);
  });

  it("honours the day's own departure time", () => {
    const { days, stops, routes, schedule } = scenario({ start_time: "11:00" });
    const view = buildToday(days, stops, routes, schedule, at("09:30"))!;
    expect(view.departMin).toBe(660);
    expect(view.beforeDeparture).toBe(true);
  });

  it("points at the next stop still ahead of the clock", () => {
    const { days, stops, routes, schedule } = scenario();

    // before anything: lunch is next
    expect(buildToday(days, stops, routes, schedule, at("09:15"))!.next?.id).toBe("lunch");
    // well past lunch's 10:00 slot: the hotel is next
    expect(buildToday(days, stops, routes, schedule, at("10:30"))!.next?.id).toBe("hotel");
  });

  it("keeps the current stop up while you're actually at it", () => {
    const { days, stops, routes, schedule } = scenario();
    // lunch departs at 10:00; the grace window keeps it current just after
    const inGrace = at(`10:${String(NOW_GRACE_MIN - 5).padStart(2, "0")}`);
    expect(buildToday(days, stops, routes, schedule, inGrace)!.next?.id).toBe("lunch");
  });

  it("counts down the miles left, not the miles planned", () => {
    const { days, stops, routes, schedule } = scenario();

    const morning = buildToday(days, stops, routes, schedule, at("09:15"))!;
    expect(morning.totalM / M_PER_MI).toBeCloseTo(120, 5);
    expect(morning.remainingM / M_PER_MI).toBeCloseTo(120, 5);

    // past lunch, only the hotel leg is left
    const afternoon = buildToday(days, stops, routes, schedule, at("10:30"))!;
    expect(afternoon.totalM / M_PER_MI).toBeCloseTo(120, 5);
    expect(afternoon.remainingM / M_PER_MI).toBeCloseTo(60, 5);
    expect(afternoon.remainingS).toBeCloseTo(3600, 5);
  });

  it("reports the day finished once every stop is behind us", () => {
    const { days, stops, routes, schedule } = scenario();
    const night = buildToday(days, stops, routes, schedule, at("22:00"))!;
    expect(night.done).toBe(true);
    expect(night.next).toBeNull();
    expect(night.upcoming).toEqual([]);
    expect(night.remainingM).toBe(0);
  });

  it("surfaces tonight's stay", () => {
    const { days, stops, routes, schedule } = scenario();
    expect(buildToday(days, stops, routes, schedule, at("09:15"))!.overnight?.id).toBe("hotel");
  });

  it("treats a stop with no ETA yet as still ahead", () => {
    // Today is day two and its route hasn't computed, so none of its stops
    // have an arrival time. Late in the evening they must still read as ahead
    // rather than silently collapsing the panel to "day done".
    const days = [makeDay("d1", 1, "2026-07-27"), makeDay("d2", 2, TODAY)];
    const stops = [makeStop("a", "d2", 1), makeStop("b", "d2", 2)];
    const view = buildToday(days, stops, {}, getSchedule(days, stops, {}), at("18:00"))!;
    expect(view.upcoming.map((s) => s.id)).toEqual(["a", "b"]);
    expect(view.done).toBe(false);
    expect(view.remainingM).toBe(0); // no route, so nothing to count
  });

  it("keeps day one's origin honest — its departure is a real clock", () => {
    // getSchedule pins the origin even with no route, so by evening it's behind
    // us and only the un-scheduled stops remain ahead.
    const days = [makeDay("d1", 1, TODAY)];
    const stops = [makeStop("a", "d1", 1), makeStop("b", "d1", 2)];
    const view = buildToday(days, stops, {}, getSchedule(days, stops, {}), at("18:00"))!;
    expect(view.upcoming.map((s) => s.id)).toEqual(["b"]);
  });

  it("is not 'done' on a day with no stops at all", () => {
    const days = [makeDay("d1", 1, TODAY)];
    const view = buildToday(days, [], {}, getSchedule(days, [], {}), at("18:00"))!;
    expect(view.done).toBe(false);
    expect(view.next).toBeNull();
  });

  it("finds a rest date to be no trip day at all", () => {
    // days jump from today to the day after tomorrow
    const days = [makeDay("d1", 1, "2026-07-27"), makeDay("d2", 2, "2026-07-30")];
    const schedule = getSchedule(days, [], {});
    expect(buildToday(days, [], {}, schedule, at("12:00", TOMORROW))).toBeNull();
  });
});
