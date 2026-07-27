import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LngLat } from "./geo";

/** Rows "in" the stubbed route_cache, keyed by cache key; upserts land here. */
const cacheRows = new Map<string, Record<string, unknown>>();
const upserts: Record<string, unknown>[] = [];

vi.mock("./supabase", () => ({
  supabase: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, key: string) => ({
          abortSignal: () => ({
            maybeSingle: () => Promise.resolve({ data: cacheRows.get(key) ?? null }),
          }),
        }),
        in: () => ({ abortSignal: () => Promise.resolve({ data: [] }) }),
      }),
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
  usernameToEmail: (u: string) => `${u}@coastline.app`,
}));

import { DRIVE_TIME_CALIBRATION, fetchRoute, routeCacheKey } from "./osrm";

describe("routeCacheKey", () => {
  it("is deterministic for the same points", () => {
    const points: LngLat[] = [
      [-117.1611, 32.7157],
      [-122.6765, 45.5231],
    ];
    expect(routeCacheKey(points)).toBe(routeCacheKey(points));
  });

  it("rounds coordinates to 5 decimals — near-identical points share a key", () => {
    const a: LngLat[] = [[-117.16110001, 32.71570001]];
    const b: LngLat[] = [[-117.16109999, 32.71569999]];
    expect(routeCacheKey(a)).toBe(routeCacheKey(b));
  });

  it("distinguishes points that differ beyond 5 decimals", () => {
    const a: LngLat[] = [[-117.16111, 32.71571]];
    const b: LngLat[] = [[-117.16121, 32.71581]];
    expect(routeCacheKey(a)).not.toBe(routeCacheKey(b));
  });

  it("is sensitive to waypoint order", () => {
    const a: LngLat[] = [
      [-117.1611, 32.7157],
      [-122.6765, 45.5231],
    ];
    const b: LngLat[] = [
      [-122.6765, 45.5231],
      [-117.1611, 32.7157],
    ];
    expect(routeCacheKey(a)).not.toBe(routeCacheKey(b));
  });

  it("is prefixed with a stable cache-version tag", () => {
    expect(routeCacheKey([[-117.1611, 32.7157]])).toMatch(/^osrm-v1-[0-9a-f]{16}$/);
  });
});

describe("drive-time calibration", () => {
  // fresh, unique waypoints per test — fetchRoute's module memory cache is
  // keyed by them, so reuse would leak one test's result into the next
  let seq = 0;
  function freshPoints(): LngLat[] {
    seq++;
    return [
      [-117.1 - seq * 0.01, 32.7],
      [-119.7 - seq * 0.01, 34.42],
    ];
  }

  const osrmAnswer = {
    code: "Ok",
    routes: [
      {
        geometry: { coordinates: [[-117.1, 32.7], [-119.7, 34.42]] },
        legs: [{ distance: 250_000, duration: 10_000 }],
        distance: 250_000,
        duration: 10_000,
      },
    ],
  };

  beforeEach(() => {
    cacheRows.clear();
    upserts.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(osrmAnswer) }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scales durations from the network, leaves distances alone", async () => {
    const route = await fetchRoute(freshPoints());
    expect(route.duration).toBeCloseTo(10_000 * DRIVE_TIME_CALIBRATION, 6);
    expect(route.legs[0].duration).toBeCloseTo(10_000 * DRIVE_TIME_CALIBRATION, 6);
    expect(route.distance).toBe(250_000);
    expect(route.legs[0].distance).toBe(250_000);
  });

  it("writes RAW durations to the shared cache — calibration is read-side only", async () => {
    await fetchRoute(freshPoints());
    expect(upserts).toHaveLength(1);
    // the invariant that keeps both phones and future re-calibrations honest:
    // route_cache always holds what OSRM actually said
    expect(upserts[0].duration_s).toBe(10_000);
    expect((upserts[0].legs as { duration: number }[])[0].duration).toBe(10_000);
  });

  it("scales cached rows identically, so cache hits agree with fresh fetches", async () => {
    const points = freshPoints();
    cacheRows.set(routeCacheKey(points), {
      key: routeCacheKey(points),
      geometry: [points[0], points[1]],
      legs: [{ distance: 250_000, duration: 10_000 }],
      distance_m: 250_000,
      duration_s: 10_000,
    });
    const route = await fetchRoute(points);
    expect(route.duration).toBeCloseTo(10_000 * DRIVE_TIME_CALIBRATION, 6);
    expect(route.distance).toBe(250_000);
    // served from the cache — the network was never touched
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
