import { describe, expect, it } from "vitest";
import { routeCacheKey } from "./osrm";
import type { LngLat } from "./geo";

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
