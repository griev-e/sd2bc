import { describe, expect, it } from "vitest";
import { directionsOptions } from "./directions";
import type { LngLat } from "./geo";

// [lng, lat] pairs; formatted output is "lat,lng" to 5 decimals.
const SD: LngLat = [-117.16108, 32.71571];
const LA: LngLat = [-118.24368, 34.05223];
const SF: LngLat = [-122.41942, 37.77493];
const PDX: LngLat = [-122.67621, 45.52306];

function byProvider(points: LngLat[]) {
  const opts = directionsOptions(points);
  return {
    apple: opts.find((o) => o.provider === "apple")!,
    google: opts.find((o) => o.provider === "google")!,
    waze: opts.find((o) => o.provider === "waze")!,
  };
}

describe("directionsOptions", () => {
  it("returns nothing when there is nothing to navigate", () => {
    expect(directionsOptions([])).toEqual([]);
    expect(directionsOptions([SD])).toEqual([]);
  });

  it("offers Google first — it's the only one that follows the whole day", () => {
    const opts = directionsOptions([SD, LA]);
    expect(opts.map((o) => o.provider)).toEqual(["google", "apple", "waze"]);
    for (const o of opts) expect(o.url).toMatch(/^https:\/\//);
  });

  it("Google routes origin → waypoints → destination in order", () => {
    const { google } = byProvider([SD, LA, SF, PDX]);
    const url = new URL(google.url);
    expect(url.searchParams.get("origin")).toBe("32.71571,-117.16108");
    expect(url.searchParams.get("destination")).toBe("45.52306,-122.67621");
    expect(url.searchParams.get("waypoints")).toBe("34.05223,-118.24368|37.77493,-122.41942");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(google.multiStop).toBe(true);
    expect(google.targetIndex).toBe(3);
  });

  it("Apple takes a single destination — the next stop, not the last", () => {
    // Apple's Map Links reference defines daddr as one destination point, and
    // no documented parameter adds waypoints. Sending the day's END here would
    // silently skip every stop in between, so the next stop is the target.
    const { apple } = byProvider([SD, LA, PDX]);
    const url = new URL(apple.url);
    expect(url.searchParams.get("daddr")).toBe("34.05223,-118.24368");
    expect(url.searchParams.get("dirflg")).toBe("d");
    expect(apple.multiStop).toBe(false);
    expect(apple.targetIndex).toBe(1);
  });

  it("Apple never emits the +to: chain that Apple can't parse", () => {
    // The old link chained daddr with Google's CLASSIC syntax. Apple doesn't
    // parse it, and `+` decodes to a space, so Apple geocoded the whole run-on
    // string as one address and navigated somewhere nobody chose.
    const { apple } = byProvider([SD, LA, SF, PDX]);
    expect(apple.url).not.toContain("to:");
    expect(apple.url).not.toContain("+");
    // exactly one destination, and it parses as a clean "lat,lng"
    const daddr = new URL(apple.url).searchParams.get("daddr")!;
    expect(daddr.split(",")).toHaveLength(2);
    expect(Number.isNaN(Number(daddr.split(",")[0]))).toBe(false);
  });

  it("Apple routes from wherever the phone is, not a pinned start", () => {
    const { apple } = byProvider([SD, LA]);
    expect(new URL(apple.url).searchParams.get("saddr")).toBeNull();
  });

  it("Waze navigates to the next stop from where you are", () => {
    const { waze } = byProvider([SD, LA, PDX]);
    expect(waze.url).toBe("https://waze.com/ul?ll=34.05223,-118.24368&navigate=yes");
    expect(waze.multiStop).toBe(false);
    expect(waze.targetIndex).toBe(1);
  });

  it("agrees on the destination when there is only one leg", () => {
    // The Today panel passes exactly [origin, nextStop] — every app should
    // land on the same place, and targetIndex should point at it.
    const { apple, google, waze } = byProvider([SD, LA]);
    expect(google.targetIndex).toBe(1);
    expect(apple.targetIndex).toBe(1);
    expect(waze.targetIndex).toBe(1);
    expect(new URL(google.url).searchParams.get("destination")).toBe("34.05223,-118.24368");
    expect(new URL(google.url).searchParams.get("waypoints")).toBeNull();
    expect(new URL(apple.url).searchParams.get("daddr")).toBe("34.05223,-118.24368");
  });

  it("thins intermediate waypoints to Google's cap", () => {
    // 1 origin + 20 middles + 1 destination
    const many: LngLat[] = Array.from({ length: 22 }, (_, i) => [-117 - i * 0.1, 32 + i * 0.1]);
    const { google } = byProvider(many);
    const waypoints = new URL(google.url).searchParams.get("waypoints")!;
    expect(waypoints.split("|")).toHaveLength(9);
    // first and last of the day still bookend the link
    expect(new URL(google.url).searchParams.get("origin")).toBe("32.00000,-117.00000");
    expect(google.targetIndex).toBe(21);
  });

  it("builds the real Day 3 link correctly", () => {
    // The day that surfaced the bug: last night's stay in Stockton, then
    // bagels, the redwoods, and a Portland hotel.
    const day3: LngLat[] = [
      [-121.3648366, 38.000253],
      [-121.3211325, 38.0113264],
      [-124.0998982, 41.7741992],
      [-122.6609299, 45.5303388],
    ];
    const { apple, google } = byProvider(day3);
    const g = new URL(google.url);
    expect(g.searchParams.get("origin")).toBe("38.00025,-121.36484");
    // the redwoods must survive as a waypoint, not be skipped
    expect(g.searchParams.get("waypoints")).toBe("38.01133,-121.32113|41.77420,-124.09990");
    expect(g.searchParams.get("destination")).toBe("45.53034,-122.66093");
    // Apple goes to the bagels — the next real drive — not 600 miles up I-5
    expect(new URL(apple.url).searchParams.get("daddr")).toBe("38.01133,-121.32113");
  });
});
