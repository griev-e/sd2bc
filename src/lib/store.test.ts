import { describe, expect, it } from "vitest";
import { dayRoutePoints, nextStopSeq, shiftDate } from "./store";
import type { Day, Stop, ViaPoint } from "./types";

function makeDay(id: string, seq: number): Day {
  return {
    id,
    trip_id: "trip-1",
    seq,
    date: "2026-07-27",
    title: "",
    notes: "",
    emoji: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
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

function makeVia(id: string, after_stop_id: string, seq: number, lat: number, lng: number): ViaPoint {
  return {
    id,
    trip_id: "trip-1",
    after_stop_id,
    seq,
    lat,
    lng,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("dayRoutePoints", () => {
  it("orders stops by seq and folds in via points between them", () => {
    const day = makeDay("day1", 1);
    const stopA = makeStop("stopA", "day1", 1, 32.7, -117.1);
    const stopB = makeStop("stopB", "day1", 2, 33.0, -117.2);
    const via1 = makeVia("via1", "stopA", 1, 32.8, -117.15);

    const points = dayRoutePoints(day, null, [stopB, stopA], [via1]);

    expect(points.map((p) => p.stopId ?? p.viaId)).toEqual(["stopA", "via1", "stopB"]);
  });

  it("drops shaping points trailing the day's last stop", () => {
    const day = makeDay("day1", 1);
    const stopA = makeStop("stopA", "day1", 1, 32.7, -117.1);
    const stopB = makeStop("stopB", "day1", 2, 33.0, -117.2);
    // A via "after" the last stop has nowhere to route to within this day.
    const trailingVia = makeVia("trailing", "stopB", 1, 33.1, -117.3);

    const points = dayRoutePoints(day, null, [stopA, stopB], [trailingVia]);

    expect(points.map((p) => p.stopId ?? p.viaId)).toEqual(["stopA", "stopB"]);
  });

  it("prepends the previous day's last stop (and its vias) as the route origin", () => {
    const prevDay = makeDay("day0", 0);
    const day = makeDay("day1", 1);
    const prevStop1 = makeStop("prev1", "day0", 1, 30.0, -117.0);
    const prevStop2 = makeStop("prev2", "day0", 2, 31.0, -117.0);
    const stopA = makeStop("stopA", "day1", 1, 32.7, -117.1);
    const viaAfterPrev = makeVia("viaPrev", "prev2", 1, 31.5, -117.05);

    const points = dayRoutePoints(day, prevDay, [prevStop1, prevStop2, stopA], [viaAfterPrev]);

    expect(points.map((p) => p.stopId ?? p.viaId)).toEqual(["prev2", "viaPrev", "stopA"]);
  });

  it("sorts multiple via points within a gap by their own seq", () => {
    const day = makeDay("day1", 1);
    const stopA = makeStop("stopA", "day1", 1, 32.7, -117.1);
    const stopB = makeStop("stopB", "day1", 2, 33.0, -117.2);
    const viaLater = makeVia("viaLater", "stopA", 2, 32.85, -117.16);
    const viaFirst = makeVia("viaFirst", "stopA", 1, 32.8, -117.15);

    const points = dayRoutePoints(day, null, [stopA, stopB], [viaLater, viaFirst]);

    expect(points.map((p) => p.stopId ?? p.viaId)).toEqual([
      "stopA",
      "viaFirst",
      "viaLater",
      "stopB",
    ]);
  });

  it("returns an empty list when the day has no stops", () => {
    const day = makeDay("day1", 1);
    expect(dayRoutePoints(day, null, [], [])).toEqual([]);
  });
});

describe("nextStopSeq", () => {
  it("is 1 for the first stop on a day", () => {
    expect(nextStopSeq([], "day1")).toBe(1);
  });

  it("is max(existing seq) + 1, not count + 1 — gaps from deletions don't collide", () => {
    const stops = [
      makeStop("a", "day1", 1, 0, 0),
      makeStop("b", "day1", 5, 0, 0), // stop with seq 2-4 deleted
    ];
    expect(nextStopSeq(stops, "day1")).toBe(6);
  });

  it("only considers stops on the given day", () => {
    const stops = [makeStop("a", "day1", 1, 0, 0), makeStop("b", "day2", 9, 0, 0)];
    expect(nextStopSeq(stops, "day1")).toBe(2);
  });
});

describe("shiftDate", () => {
  it("adds days across an ordinary boundary", () => {
    expect(shiftDate("2026-07-27", 1)).toBe("2026-07-28");
  });

  it("rolls over a month boundary", () => {
    expect(shiftDate("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("rolls over a year boundary", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("supports negative shifts", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is timezone-proof across a DST spring-forward boundary", () => {
    // US DST began 2026-03-08; a naive midnight-anchored Date can misbehave
    // across this boundary in a local timezone.
    expect(shiftDate("2026-03-07", 1)).toBe("2026-03-08");
    expect(shiftDate("2026-03-08", 1)).toBe("2026-03-09");
  });
});
