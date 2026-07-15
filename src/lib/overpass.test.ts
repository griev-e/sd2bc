import { describe, expect, it } from "vitest";
import { rankCandidates, scoreCandidate } from "./overpass";
import type { LngLat } from "./geo";

function candidate(overrides: {
  id: string;
  name: string;
  lat: number;
  lng: number;
  facts?: number;
  tags?: Record<string, string>;
}) {
  return {
    facts: 0,
    tags: {},
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("caps the raw fact count at 25", () => {
    expect(scoreCandidate(candidate({ id: "1", name: "a", lat: 0, lng: 0, facts: 40 }), "food")).toBe(25);
    expect(scoreCandidate(candidate({ id: "1", name: "a", lat: 0, lng: 0, facts: 10 }), "food")).toBe(10);
  });

  it("adds a flat bonus for a Wikipedia/Wikidata link", () => {
    const withWiki = scoreCandidate(
      candidate({ id: "1", name: "a", lat: 0, lng: 0, facts: 5, tags: { wikipedia: "x" } }),
      "attractions",
    );
    expect(withWiki).toBe(25); // 5 facts + 20 bonus
  });

  it("weights star ratings, capped at 5 stars", () => {
    const score = scoreCandidate(
      candidate({ id: "1", name: "a", lat: 0, lng: 0, tags: { stars: "4.5" } }),
      "lodging",
    );
    expect(score).toBeCloseTo(3 * 4.5, 6);

    const cappedScore = scoreCandidate(
      candidate({ id: "1", name: "a", lat: 0, lng: 0, tags: { stars: "8" } }),
      "lodging",
    );
    expect(cappedScore).toBe(3 * 5);
  });

  it("rewards a branded gas station but penalizes a branded restaurant", () => {
    const gas = scoreCandidate(
      candidate({ id: "1", name: "a", lat: 0, lng: 0, tags: { brand: "Shell" } }),
      "gas",
    );
    const food = scoreCandidate(
      candidate({ id: "1", name: "a", lat: 0, lng: 0, tags: { brand: "BigChain" } }),
      "food",
    );
    const scenic = scoreCandidate(
      candidate({ id: "1", name: "a", lat: 0, lng: 0, tags: { brand: "Whatever" } }),
      "scenic",
    );
    expect(gas).toBe(6);
    expect(food).toBe(-6);
    expect(scenic).toBe(0);
  });
});

describe("rankCandidates", () => {
  it("excludes candidates farther than the radius (with its small tolerance) from the route", () => {
    const sampled: LngLat[] = [
      [0, 0],
      [0, 1],
    ];
    const onRoute = candidate({ id: "near", name: "Near", lat: 0.5, lng: 0, facts: 5 });
    const offRoute = candidate({ id: "far", name: "Far", lat: 0.5, lng: 5, facts: 5 });

    const result = rankCandidates([onRoute, offRoute], sampled, "food", 2500);
    const ids = result.map((r) => r.id);
    expect(ids).toContain("near");
    expect(ids).not.toContain("far");
  });

  it("dedupes by id, keeping the highest-scored entry", () => {
    const sampled: LngLat[] = [
      [0, 0],
      [0, 1],
    ];
    const strong = candidate({ id: "1", name: "Best Cafe", lat: 0.5, lng: 0, facts: 25 });
    const weak = candidate({ id: "1", name: "Other Name", lat: 0.5, lng: 0, facts: 1 });

    const result = rankCandidates([weak, strong], sampled, "food", 2500);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Best Cafe");
  });

  it("dedupes by name even when ids differ", () => {
    const sampled: LngLat[] = [
      [0, 0],
      [0, 1],
    ];
    const a = candidate({ id: "1", name: "Same Diner", lat: 0.4, lng: 0, facts: 25 });
    const b = candidate({ id: "2", name: "Same Diner", lat: 0.6, lng: 0, facts: 1 });

    const result = rankCandidates([a, b], sampled, "food", 2500);
    expect(result).toHaveLength(1);
  });

  it("presents results in drive order along the corridor, not score order", () => {
    // 7 points => 6 segments, matching the 6 spread buckets 1:1.
    const sampled: LngLat[] = Array.from({ length: 7 }, (_, i) => [0, i] as LngLat);
    // One strong candidate per segment, placed in reverse drive order but
    // with scores that would sort the opposite way if score-ordered.
    const candidates = Array.from({ length: 6 }, (_, seg) =>
      candidate({
        id: `seg-${seg}`,
        name: `Place ${seg}`,
        lat: seg + 0.5,
        lng: 0,
        facts: seg, // segment 5 scores highest, segment 0 lowest
      }),
    );

    const result = rankCandidates(candidates, sampled, "food", 50000);
    expect(result.map((r) => r.id)).toEqual([
      "seg-0",
      "seg-1",
      "seg-2",
      "seg-3",
      "seg-4",
      "seg-5",
    ]);
  });

  it("caps total results at 25 even with more eligible candidates", () => {
    const sampled: LngLat[] = Array.from({ length: 7 }, (_, i) => [0, i] as LngLat);
    const candidates = Array.from({ length: 40 }, (_, i) =>
      candidate({
        id: `c-${i}`,
        name: `Place ${i}`,
        lat: (i % 6) + 0.5,
        lng: 0,
        facts: i,
      }),
    );

    const result = rankCandidates(candidates, sampled, "food", 50000);
    expect(result.length).toBeLessThanOrEqual(25);
  });

  it("marks a Wikipedia/Wikidata-linked place as notable", () => {
    const sampled: LngLat[] = [
      [0, 0],
      [0, 1],
    ];
    const notable = candidate({
      id: "1",
      name: "Landmark",
      lat: 0.5,
      lng: 0,
      tags: { wikidata: "Q123" },
    });
    const result = rankCandidates([notable], sampled, "attractions", 2500);
    expect(result[0].notable).toBe(true);
  });
});
