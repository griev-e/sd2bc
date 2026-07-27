import { describe, expect, it } from "vitest";
import {
  combinedBoard,
  EMPTY_RANKING,
  expectedDuels,
  filterRanking,
  fmtScore,
  insertCode,
  insertNear,
  normalizeRanking,
  parseRanking,
  PLATE_RANKING_KEY,
  plateScores,
  rankedCodes,
  rankingKeyFor,
  removeCode,
  type PlateRanking,
} from "./plateRank";
import type { GameEvent } from "./types";

function doc(
  value: unknown,
  by: string | null,
  at: string,
  over: Partial<GameEvent> = {},
): GameEvent {
  return {
    id: crypto.randomUUID(),
    game: "plates",
    kind: "score",
    key: PLATE_RANKING_KEY,
    value: value as Record<string, unknown>,
    created_by: by,
    created_at: at,
    ...over,
  };
}

describe("normalizeRanking", () => {
  it("returns empty buckets for garbage", () => {
    expect(normalizeRanking(null)).toEqual(EMPTY_RANKING);
    expect(normalizeRanking("nope")).toEqual(EMPTY_RANKING);
    expect(normalizeRanking({ loved: "CA", fine: 3 })).toEqual(EMPTY_RANKING);
  });

  it("drops non-string members and keeps order", () => {
    const r = normalizeRanking({ loved: ["CA", 7, "OR"], fine: [], nope: [null, "TX"] });
    expect(r).toEqual({ loved: ["CA", "OR"], fine: [], nope: ["TX"] });
  });

  it("dedupes across buckets, favoring the better bucket", () => {
    const r = normalizeRanking({ loved: ["CA"], fine: ["CA", "TX"], nope: ["TX"] });
    expect(r).toEqual({ loved: ["CA"], fine: ["TX"], nope: [] });
  });
});

describe("parseRanking", () => {
  it("returns empty for a missing user or no documents", () => {
    expect(parseRanking([], "u1")).toEqual(EMPTY_RANKING);
    expect(parseRanking([doc({ loved: ["CA"] }, "u1", "2026-07-27T00:00:00Z")], null)).toEqual(
      EMPTY_RANKING,
    );
  });

  it("takes the latest document by that user only (events oldest-first)", () => {
    const events = [
      doc({ loved: ["CA"] }, "u1", "2026-07-27T00:00:00Z"),
      doc({ loved: ["WY"] }, "u2", "2026-07-27T00:01:00Z"),
      doc({ loved: ["OR", "CA"] }, "u1", "2026-07-27T00:02:00Z"),
    ];
    expect(parseRanking(events, "u1").loved).toEqual(["OR", "CA"]);
    expect(parseRanking(events, "u2").loved).toEqual(["WY"]);
  });

  it("ignores claims and other keys", () => {
    const events = [
      doc({ loved: ["CA"] }, "u1", "2026-07-27T00:00:00Z", { kind: "claim", key: "CA" }),
      doc({ loved: ["CA"] }, "u1", "2026-07-27T00:01:00Z", { key: "other" }),
    ];
    expect(parseRanking(events, "u1")).toEqual(EMPTY_RANKING);
  });

  it("reads owner-keyed documents written by the other traveler (proxy rating)", () => {
    // u1's phone entered u2's take: created_by u1, owner in the key
    const events = [doc({ loved: ["CA"] }, "u1", "2026-07-27T00:00:00Z", { key: rankingKeyFor("u2") })];
    expect(parseRanking(events, "u2").loved).toEqual(["CA"]);
    expect(parseRanking(events, "u1")).toEqual(EMPTY_RANKING);
  });

  it("lets a newer owner-keyed document supersede a legacy one, and vice versa", () => {
    const legacyThenProxy = [
      doc({ loved: ["CA"] }, "u2", "2026-07-27T00:00:00Z"), // legacy: bare key, owner = author
      doc({ loved: ["OR"] }, "u1", "2026-07-27T00:01:00Z", { key: rankingKeyFor("u2") }),
    ];
    expect(parseRanking(legacyThenProxy, "u2").loved).toEqual(["OR"]);
    expect(parseRanking([...legacyThenProxy].reverse(), "u2").loved).toEqual(["CA"]);
  });
});

describe("insert / remove / filter", () => {
  const base: PlateRanking = { loved: ["CA", "OR"], fine: ["TX"], nope: [] };

  it("inserts at a clamped index", () => {
    expect(insertCode(base, "loved", "WA", 1).loved).toEqual(["CA", "WA", "OR"]);
    expect(insertCode(base, "loved", "WA", 99).loved).toEqual(["CA", "OR", "WA"]);
    expect(insertCode(base, "nope", "WA", 0).nope).toEqual(["WA"]);
  });

  it("re-rating moves a code instead of duplicating it", () => {
    const r = insertCode(base, "fine", "CA", 0);
    expect(r.loved).toEqual(["OR"]);
    expect(r.fine).toEqual(["CA", "TX"]);
    expect(rankedCodes(r).size).toBe(3);
  });

  it("removeCode and filterRanking drop without reordering", () => {
    expect(removeCode(base, "OR").loved).toEqual(["CA"]);
    const kept = filterRanking(base, (c) => c !== "TX");
    expect(kept).toEqual({ loved: ["CA", "OR"], fine: [], nope: [] });
  });
});

describe("insertNear", () => {
  // stored doc has a hidden (released-claim) code "XX" between visible ones
  const full: PlateRanking = { loved: ["CA", "XX", "OR"], fine: [], nope: [] };

  it("lands right before the visible loser it beat", () => {
    expect(insertNear(full, "loved", "WA", "OR", "CA").loved).toEqual(["CA", "XX", "WA", "OR"]);
  });

  it("falls back to after the visible winner when the loser is gone", () => {
    expect(insertNear(full, "loved", "WA", "ZZ", "CA").loved).toEqual(["CA", "WA", "XX", "OR"]);
  });

  it("appends when there are no anchors, and never duplicates on re-rate", () => {
    expect(insertNear(full, "loved", "WA", null, null).loved).toEqual(["CA", "XX", "OR", "WA"]);
    const r = insertNear(full, "fine", "CA", null, null);
    expect(r.loved).toEqual(["XX", "OR"]);
    expect(r.fine).toEqual(["CA"]);
  });
});

describe("plateScores", () => {
  it("puts a lone loved plate at 8.5, fine at 5.5, nope at 2.5", () => {
    expect(plateScores({ loved: ["CA"], fine: [], nope: [] }).get("CA")?.score).toBe(8.5);
    expect(plateScores({ loved: [], fine: ["CA"], nope: [] }).get("CA")?.score).toBe(5.5);
    expect(plateScores({ loved: [], fine: [], nope: ["CA"] }).get("CA")?.score).toBe(2.5);
  });

  it("is strictly decreasing down the full ranking", () => {
    const r: PlateRanking = { loved: ["A", "B", "C"], fine: ["D", "E"], nope: ["F"] };
    const m = plateScores(r);
    const scores = ["A", "B", "C", "D", "E", "F"].map((c) => m.get(c)!.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
  });

  it("ranks across buckets and stays inside each band", () => {
    const r: PlateRanking = { loved: ["A", "B"], fine: ["C"], nope: ["D"] };
    const m = plateScores(r);
    expect(m.get("A")).toMatchObject({ rank: 1, total: 4, sentiment: "loved" });
    expect(m.get("D")).toMatchObject({ rank: 4, total: 4, sentiment: "nope" });
    expect(m.get("A")!.score).toBeLessThanOrEqual(10);
    expect(m.get("B")!.score).toBeGreaterThanOrEqual(7);
    expect(m.get("D")!.score).toBeGreaterThanOrEqual(1);
  });

  it("the favorite approaches 10 as the loved bucket grows", () => {
    const m = plateScores({
      loved: Array.from({ length: 20 }, (_, i) => `P${i}`),
      fine: [],
      nope: [],
    });
    expect(m.get("P0")!.score).toBeGreaterThan(9.8);
    expect(m.get("P19")!.score).toBeLessThan(7.2);
  });

  it("fmtScore always shows one decimal", () => {
    expect(fmtScore(8.5)).toBe("8.5");
    expect(fmtScore(10)).toBe("10.0");
  });
});

describe("expectedDuels", () => {
  it("is 0 for an empty bucket and log-ish after", () => {
    expect(expectedDuels(0)).toBe(0);
    expect(expectedDuels(1)).toBe(1);
    expect(expectedDuels(3)).toBe(2);
    expect(expectedDuels(7)).toBe(3);
    expect(expectedDuels(8)).toBe(4);
  });
});

describe("combinedBoard", () => {
  const mine: PlateRanking = { loved: ["CA", "OR"], fine: ["TX"], nope: [] };
  const theirs: PlateRanking = { loved: ["OR"], fine: [], nope: ["TX"] };

  it("averages the scores that exist and sorts descending", () => {
    const board = combinedBoard(["CA", "OR", "TX", "WY"], [mine, theirs]);
    expect(board.map((r) => r.code)).toEqual(["CA", "OR", "TX", "WY"]);
    // CA is mine-only: its average is just my score (9.25 → 9.3)
    expect(board[0].avg).toBe(board[0].scores[0]!.score);
    expect(board[0].scores[1]).toBeNull();
    // OR: (7.75 → 7.8 mine) + 8.5 theirs, averaged then rounded once more
    expect(board[1].avg).toBeCloseTo(8.2, 5);
  });

  it("puts unrated plates last, alphabetically", () => {
    const board = combinedBoard(["ZZ", "AA", "CA"], [mine, EMPTY_RANKING]);
    expect(board.map((r) => r.code)).toEqual(["CA", "AA", "ZZ"]);
    expect(board[1].avg).toBeNull();
  });

  it("breaks average ties toward the plate more people rated", () => {
    // A rated 8.5 by both; B rated 8.5 by one person only
    const a: PlateRanking = { loved: ["A"], fine: [], nope: [] };
    const b: PlateRanking = { loved: ["A"], fine: [], nope: [] };
    const solo: PlateRanking = { loved: ["B"], fine: [], nope: [] };
    const board = combinedBoard(["A", "B"], [a, b]);
    expect(board[0].code).toBe("A");
    const board2 = combinedBoard(["A", "B"], [a, solo]);
    expect(board2.map((r) => r.avg)).toEqual([8.5, 8.5]);
    expect(board2[0].code).toBe("A");
  });
});
