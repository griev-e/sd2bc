import { describe, expect, it } from "vitest";
import { CLUSTER_RADIUS_M, clusterKey, clusterStops } from "./clusters";
import type { Stop } from "./types";

function makeStop(id: string, lat: number, lng: number): Stop {
  return {
    id,
    trip_id: "trip-1",
    day_id: "day-1",
    seq: 0,
    name: id,
    lat,
    lng,
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
  };
}

describe("clusterStops", () => {
  it("returns one cluster per stop when nothing is nearby", () => {
    const stops = [makeStop("a", 32.7, -117.1), makeStop("b", 45.5, -122.6)];
    const clusters = clusterStops(stops);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].stopIds).toEqual(["a"]);
    expect(clusters[1].stopIds).toEqual(["b"]);
  });

  it("folds consecutive nearby stops into the same cluster, keyed by the first", () => {
    // ~0.05 degrees of latitude is well under CLUSTER_RADIUS_M (25 km)
    const stops = [
      makeStop("a", 32.7, -117.1),
      makeStop("b", 32.72, -117.1),
      makeStop("c", 32.74, -117.1),
    ];
    const clusters = clusterStops(stops);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].repStopId).toBe("a");
    expect(clusters[0].stopIds).toEqual(["a", "b", "c"]);
  });

  it("only compares against the running cluster anchor, not all prior stops", () => {
    // b is far from a (new cluster), c is close to b (folds into b's cluster)
    // even though c would be far from a.
    const stops = [
      makeStop("a", 32.7, -117.1),
      makeStop("b", 40.0, -117.1),
      makeStop("c", 40.02, -117.1),
    ];
    const clusters = clusterStops(stops);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].stopIds).toEqual(["a"]);
    expect(clusters[1].repStopId).toBe("b");
    expect(clusters[1].stopIds).toEqual(["b", "c"]);
  });

  it("opens a new cluster once a stop exceeds the radius", () => {
    const stops = [makeStop("a", 32.7, -117.1), makeStop("b", 33.5, -117.1)];
    const clusters = clusterStops(stops);
    const dist = Math.abs(33.5 - 32.7) * 111195; // rough meters per degree lat
    expect(dist).toBeGreaterThan(CLUSTER_RADIUS_M);
    expect(clusters).toHaveLength(2);
  });

  it("returns an empty array for no stops", () => {
    expect(clusterStops([])).toEqual([]);
  });
});

describe("clusterKey", () => {
  it("joins dayId and repStopId with a colon", () => {
    expect(clusterKey("day-1", "stop-1")).toBe("day-1:stop-1");
  });
});
