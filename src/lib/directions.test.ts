import { describe, expect, it } from "vitest";
import { directionsOptions } from "./directions";
import type { LngLat } from "./geo";

// [lng, lat] pairs; formatted output is "lat,lng" to 5 decimals.
const SD: LngLat = [-117.16108, 32.71571];
const LA: LngLat = [-118.24368, 34.05223];
const SF: LngLat = [-122.41942, 37.77493];
const PDX: LngLat = [-122.67621, 45.52306];

describe("directionsOptions", () => {
  it("returns nothing when there is nothing to navigate", () => {
    expect(directionsOptions([])).toEqual([]);
    expect(directionsOptions([SD])).toEqual([]);
  });

  it("offers Apple, Google, and Waze links", () => {
    const opts = directionsOptions([SD, LA]);
    expect(opts.map((o) => o.provider)).toEqual(["apple", "google", "waze"]);
    for (const o of opts) expect(o.url).toMatch(/^https:\/\//);
  });

  it("Google routes origin → waypoints → destination in order", () => {
    const [, google] = directionsOptions([SD, LA, SF, PDX]);
    const url = new URL(google.url);
    expect(url.searchParams.get("origin")).toBe("32.71571,-117.16108");
    expect(url.searchParams.get("destination")).toBe("45.52306,-122.67621");
    expect(url.searchParams.get("waypoints")).toBe("34.05223,-118.24368|37.77493,-122.41942");
    expect(url.searchParams.get("travelmode")).toBe("driving");
  });

  it("Apple chains intermediate stops onto the destination with +to:", () => {
    const [apple] = directionsOptions([SD, LA, PDX]);
    expect(apple.url).toContain("saddr=32.71571%2C-117.16108");
    expect(apple.url).toContain("daddr=34.05223,-118.24368+to:45.52306,-122.67621");
    expect(apple.url).toContain("dirflg=d");
  });

  it("Waze navigates to the final destination only", () => {
    const opts = directionsOptions([SD, LA, PDX]);
    const waze = opts.find((o) => o.provider === "waze")!;
    expect(waze.url).toBe("https://waze.com/ul?ll=45.52306,-122.67621&navigate=yes");
  });

  it("thins intermediate waypoints to Google/Apple's ~9 cap", () => {
    // 1 origin + 20 middles + 1 destination
    const many: LngLat[] = Array.from({ length: 22 }, (_, i) => [-117 - i * 0.1, 32 + i * 0.1]);
    const [apple, google] = directionsOptions(many);
    const gWaypoints = new URL(google.url).searchParams.get("waypoints")!;
    expect(gWaypoints.split("|")).toHaveLength(9);
    // Apple: 9 thinned middles + 1 destination = 10 legs chained by +to:.
    const appleDaddr = apple.url.split("daddr=")[1];
    expect(appleDaddr.split("+to:")).toHaveLength(10);
  });
});
