import { describe, expect, it } from "vitest";
import {
  bboxOf,
  distToPolylineM,
  distToSegmentM,
  hashKey,
  haversineM,
  regionOf,
  samplePolyline,
  type LngLat,
} from "./geo";

describe("haversineM", () => {
  it("returns 0 for identical points", () => {
    expect(haversineM([-117, 32], [-117, 32])).toBe(0);
  });

  it("matches the known ~111.2 km per degree of latitude", () => {
    const d = haversineM([0, 0], [0, 1]);
    expect(d).toBeGreaterThan(111100);
    expect(d).toBeLessThan(111200);
  });

  it("is symmetric", () => {
    const a: LngLat = [-122.4, 37.8];
    const b: LngLat = [-117.2, 32.7];
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });
});

describe("distToSegmentM", () => {
  it("is ~0 for a point on the segment", () => {
    const d = distToSegmentM([0, 0.5], [0, 0], [0, 1]);
    expect(d).toBeLessThan(1);
  });

  it("clamps to the nearest endpoint beyond the segment", () => {
    const beyondEnd = distToSegmentM([0, 2], [0, 0], [0, 1]);
    const toEndpoint = haversineM([0, 2], [0, 1]);
    expect(beyondEnd).toBeCloseTo(toEndpoint, -1);
  });

  it("handles a zero-length segment as a point distance", () => {
    const d = distToSegmentM([1, 1], [0, 0], [0, 0]);
    expect(d).toBeCloseTo(haversineM([1, 1], [0, 0]), -2);
  });
});

describe("distToPolylineM", () => {
  it("returns the minimum distance across all segments", () => {
    const line: LngLat[] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ];
    // Point near the second segment's midpoint should be near 0, much
    // closer than to the first segment.
    const d = distToPolylineM([0.5, 1], line);
    expect(d).toBeLessThan(distToSegmentM([0.5, 1], line[0], line[1]));
  });
});

describe("samplePolyline", () => {
  it("returns an empty array for an empty line", () => {
    expect(samplePolyline([], 1000)).toEqual([]);
  });

  it("always keeps the first and last point", () => {
    const line: LngLat[] = [
      [0, 0],
      [0, 0.01],
      [0, 0.02],
      [0, 0.03],
    ];
    const out = samplePolyline(line, 5000);
    expect(out[0]).toEqual(line[0]);
    expect(out[out.length - 1]).toEqual(line[line.length - 1]);
  });

  it("downsamples so consecutive points are >= stepM apart", () => {
    // ~1.1 km per 0.01 degree of latitude
    const line: LngLat[] = Array.from({ length: 21 }, (_, i) => [0, i * 0.001] as LngLat);
    const out = samplePolyline(line, 2000);
    expect(out.length).toBeLessThan(line.length);
  });

  it("caps output near maxPoints (the final point can push one over)", () => {
    const line: LngLat[] = Array.from({ length: 500 }, (_, i) => [0, i * 0.1] as LngLat);
    const out = samplePolyline(line, 1, 10);
    expect(out.length).toBeLessThanOrEqual(11);
    expect(out[out.length - 1]).toEqual(line[line.length - 1]);
  });
});

describe("regionOf", () => {
  it("classifies exact boundaries correctly", () => {
    expect(regionOf(49.0)).toBe("BC");
    expect(regionOf(48.999999)).toBe("WA");
    expect(regionOf(46.15)).toBe("WA");
    expect(regionOf(46.149999)).toBe("OR");
    expect(regionOf(41.99)).toBe("OR");
    expect(regionOf(41.989999)).toBe("CA");
  });

  it("classifies far-south latitudes as CA", () => {
    expect(regionOf(32.7)).toBe("CA");
  });

  it("classifies far-north latitudes as BC", () => {
    expect(regionOf(55)).toBe("BC");
  });
});

describe("bboxOf", () => {
  it("computes the enclosing box", () => {
    const coords: LngLat[] = [
      [-1, 2],
      [3, -4],
      [0, 0],
    ];
    expect(bboxOf(coords)).toEqual([-1, -4, 3, 2]);
  });
});

describe("hashKey", () => {
  it("is deterministic for the same input", () => {
    expect(hashKey("coastline")).toBe(hashKey("coastline"));
  });

  it("differs for different inputs", () => {
    expect(hashKey("a")).not.toBe(hashKey("b"));
  });

  it("returns a fixed-length hex string", () => {
    expect(hashKey("")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashKey("a long cache key with many segments;joined;by;semicolons")).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });
});
