import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { haversineM, type LngLat } from "./geo";
import type { Day, Stop, Trip, ViaPoint } from "./types";

/**
 * Integration cover for the shaping-point path: tapping a route line has to
 * move the drive time the itinerary shows, and it has to move it to the RIGHT
 * value even when the network is slow. Supabase and OSRM are stubbed; the
 * store and lib/shaping are the real thing.
 */

/** Resolves the pending Supabase writes; set per-test to hold them open. */
let releaseWrites: (() => void) | null = null;

vi.mock("./supabase", () => {
  const settle = () =>
    releaseWrites
      ? new Promise<{ error: null }>((resolve) => {
          const prev = releaseWrites!;
          releaseWrites = () => {
            prev();
            resolve({ error: null });
          };
        })
      : Promise.resolve({ error: null });
  return {
    supabase: () => ({
      from: () => ({
        insert: settle,
        update: () => ({ eq: settle }),
        delete: () => ({ eq: settle }),
      }),
    }),
    usernameToEmail: (u: string) => `${u}@coastline.app`,
  };
});

/** Errors the stub router throws instead of answering, oldest first. */
const routeFailures: Error[] = [];
let routeCalls = 0;

// A straight-line "router": distance is the sum of the great-circle legs, so
// any detour off the direct line measurably lengthens the drive.
vi.mock("./osrm", async (importActual) => {
  const actual = await importActual<typeof import("./osrm")>();
  return {
    ...actual,
    primeRouteCache: () => Promise.resolve(),
    fetchRoute: (points: LngLat[]) => {
      routeCalls++;
      const fail = routeFailures.shift();
      if (fail) return Promise.reject(fail);
      const legs = points.slice(0, -1).map((p, i) => {
        const distance = haversineM(p, points[i + 1]);
        return { distance, duration: distance / 20 };
      });
      return Promise.resolve({
        coordinates: points,
        legs,
        distance: legs.reduce((t, l) => t + l.distance, 0),
        duration: legs.reduce((t, l) => t + l.duration, 0),
      });
    },
  };
});

const { NoRouteError } = await import("./osrm");
const { dayRoutePoints, useTrip } = await import("./store");
const { insertShapingPoint } = await import("./shaping");

function makeDay(id: string, seq: number): Day {
  return {
    id,
    trip_id: "trip-1",
    seq,
    date: "2026-07-27",
    title: "",
    notes: "",
    emoji: null,
    start_time: null,
    created_at: "",
    updated_at: "",
  };
}

function makeStop(id: string, day_id: string, seq: number, lat: number, lng: number): Stop {
  return {
    id,
    trip_id: "trip-1",
    day_id,
    seq,
    name: id,
    lat,
    lng,
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
  };
}

function makeVia(id: string, after_stop_id: string, seq: number, lat: number, lng: number): ViaPoint {
  return {
    id,
    trip_id: "trip-1",
    after_stop_id,
    seq,
    lat,
    lng,
    created_by: null,
    created_at: "",
  };
}

/** Run the debounced route recompute to completion, retry window included. */
async function settleRoutes() {
  await vi.advanceTimersByTimeAsync(600);
  await vi.advanceTimersByTimeAsync(1400);
}

/** The day's waypoints in the order OSRM would be asked for them. */
function waypointOrder(dayId: string): string[] {
  const s = useTrip.getState();
  const ordered = [...s.days].sort((a, b) => a.seq - b.seq);
  const i = ordered.findIndex((d) => d.id === dayId);
  return dayRoutePoints(
    ordered[i],
    i > 0 ? ordered[i - 1] : null,
    s.stops,
    s.viaPoints,
  ).map((p) => p.stopId ?? p.viaId!);
}

describe("insertShapingPoint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    releaseWrites = null;
    routeFailures.length = 0;
    routeCalls = 0;
    useTrip.setState({
      loaded: true,
      userId: "user-1",
      trip: { id: "trip-1" } as Trip,
      days: [makeDay("day1", 1), makeDay("day2", 2)],
      stops: [
        makeStop("a", "day1", 1, 32.0, -117.0),
        makeStop("b", "day1", 2, 36.0, -117.0),
        makeStop("c", "day2", 1, 40.0, -117.0),
      ],
      viaPoints: [],
      routes: {},
      routeError: null,
    });
  });

  afterEach(() => {
    useTrip.getState().teardown();
    vi.useRealTimers();
  });

  it("lengthens the day's drive time once the detour is routed", async () => {
    useTrip.getState().refreshRoutes();
    await settleRoutes();
    const before = useTrip.getState().routes["day1"].durationS;

    // well east of the straight a→b line
    await insertShapingPoint("day1", [-115.0, 34.0]);
    await settleRoutes();

    const after = useTrip.getState().routes["day1"];
    expect(after.durationS).toBeGreaterThan(before);
    // the itinerary reads its per-stop drive times off the segments, which
    // fold the via legs back into one a→b hop
    expect(after.segments).toHaveLength(1);
    expect(after.segments[0]).toMatchObject({ fromStopId: "a", toStopId: "b" });
    expect(after.segments[0].durationS).toBe(after.durationS);
  });

  it("credits a detour on the morning leg to the day that drives it", async () => {
    useTrip.getState().refreshRoutes();
    await settleRoutes();
    const before = useTrip.getState().routes;
    const day1Before = before["day1"].durationS;
    const day2Before = before["day2"].durationS;

    // day 2 starts at day 1's last stop, so this bends day 2's morning leg
    await insertShapingPoint("day2", [-115.0, 38.0]);
    await settleRoutes();

    const after = useTrip.getState().routes;
    expect(after["day2"].durationS).toBeGreaterThan(day2Before);
    expect(after["day1"].durationS).toBe(day1Before); // day 1 is untouched
  });

  it("orders the new point within its gap before the write lands", async () => {
    // A shaping point already sits mid-gap; the tap goes between it and stop a.
    useTrip.setState({ viaPoints: [makeVia("v0", "a", 0, 35.0, -116.0)] });
    releaseWrites = () => {};

    // not awaited: the optimistic update runs synchronously, the writes hang
    const pending = insertShapingPoint("day1", [-116.0, 33.0]);

    const order = waypointOrder("day1");
    expect(order[0]).toBe("a");
    expect(order[order.length - 1]).toBe("b");
    // the new point must already sort ahead of v0 — a recompute that fires
    // before the writes settle would otherwise route the detour backwards
    expect(order[2]).toBe("v0");
    expect(order).toHaveLength(4);

    releaseWrites?.();
    releaseWrites = null;
    await pending;
    expect(waypointOrder("day1")).toEqual(order);
  });

  it("re-indexes a gap left with holes by an earlier delete", async () => {
    useTrip.setState({
      viaPoints: [makeVia("v0", "a", 3, 34.0, -116.0), makeVia("v1", "a", 9, 35.0, -116.0)],
    });

    await insertShapingPoint("day1", [-116.0, 35.5]); // between v1 and b
    await settleRoutes();

    const seqs = useTrip
      .getState()
      .viaPoints.filter((v) => v.after_stop_id === "a")
      .map((v) => v.seq)
      .sort((x, y) => x - y);
    expect(seqs).toEqual([0, 1, 2]);
    expect(waypointOrder("day1")).toEqual(["a", "v0", "v1", expect.any(String), "b"]);
  });

  it("rolls the whole insert back when a write is rejected", async () => {
    const existing = makeVia("v0", "a", 0, 35.0, -116.0);
    useTrip.setState({ viaPoints: [existing] });
    releaseWrites = null;

    // reject every write for this test
    const supa = await import("./supabase");
    const spy = vi.spyOn(supa, "supabase").mockReturnValue({
      from: () => ({
        insert: () => Promise.resolve({ error: { message: "nope" } }),
        update: () => ({ eq: () => Promise.resolve({ error: { message: "nope" } }) }),
      }),
    } as unknown as ReturnType<typeof supa.supabase>);

    await insertShapingPoint("day1", [-116.0, 33.0]);

    expect(useTrip.getState().viaPoints).toEqual([existing]);
    spy.mockRestore();
  });

  it("retries once past a flaky router so the new time still lands", async () => {
    useTrip.getState().refreshRoutes();
    await settleRoutes();
    const before = useTrip.getState().routes["day1"].durationS;

    // day 1's recompute trips over the public server; day 2's goes through
    routeFailures.push(new Error("Failed to fetch"));
    await insertShapingPoint("day1", [-115.0, 34.0]);
    await settleRoutes();

    const s = useTrip.getState();
    expect(s.routes["day1"].durationS).toBeGreaterThan(before);
    expect(s.routeError).toBeNull();
  });

  it("gives up immediately when the router says there is no route", async () => {
    useTrip.getState().refreshRoutes();
    await settleRoutes();
    routeCalls = 0;

    routeFailures.push(new NoRouteError("OSRM: NoRoute"));
    await insertShapingPoint("day1", [-115.0, 34.0]);
    await settleRoutes();

    // one attempt for each day, none of them repeated — a NoRoute answer is
    // deterministic, so a retry would just spend a free service's budget
    expect(routeCalls).toBe(2);
    expect(useTrip.getState().routeError).toBe("OSRM: NoRoute");
  });
});
