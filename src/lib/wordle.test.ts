import { describe, expect, it } from "vitest";
import { WORDLE_WORDS } from "./gameData";
import {
  isWin,
  keyStates,
  MAX_GUESSES,
  pickWord,
  scoreGuess,
  WORD_LENGTH,
  type ScoredGuess,
} from "./wordle";

describe("WORDLE_WORDS bank", () => {
  it("is 50 unique five-letter uppercase words", () => {
    expect(WORDLE_WORDS).toHaveLength(50);
    expect(new Set(WORDLE_WORDS).size).toBe(50);
    for (const w of WORDLE_WORDS) {
      expect(w).toMatch(/^[A-Z]{5}$/);
      expect(w).toHaveLength(WORD_LENGTH);
    }
  });
});

describe("scoreGuess", () => {
  it("marks every tile correct for an exact match", () => {
    expect(scoreGuess("BEACH", "BEACH")).toEqual([
      "correct",
      "correct",
      "correct",
      "correct",
      "correct",
    ]);
    expect(isWin(scoreGuess("BEACH", "BEACH"))).toBe(true);
  });

  it("marks a fully-disjoint guess absent", () => {
    expect(scoreGuess("FJORD", "WHALE")).toEqual([
      "absent",
      "absent",
      "absent",
      "absent",
      "absent",
    ]);
  });

  it("marks misplaced letters present", () => {
    // OCEAN vs OTTER: O green, only one E present (misplaced), rest absent
    expect(scoreGuess("OCEAN", "OTTER")).toEqual([
      "correct", // O
      "absent", // C
      "present", // E
      "absent", // A
      "absent", // N
    ]);
  });

  it("does not over-light a repeated guess letter beyond the answer's count", () => {
    // SANDY has a single S, claimed green at index 0 — the trailing S in
    // SEALS must fall through to absent, not yellow.
    expect(scoreGuess("SEALS", "SANDY")).toEqual([
      "correct", // S
      "absent", // E
      "present", // A
      "absent", // L
      "absent", // S (no S left in the answer)
    ]);
  });

  it("splits repeats: one green, one yellow, extras grey", () => {
    // THREE has two E's; GEESE guesses three. One E greens (index 4), one
    // yellows (index 1), the middle E is grey.
    expect(scoreGuess("GEESE", "THREE")).toEqual([
      "absent", // G
      "present", // E
      "absent", // E (budget spent)
      "absent", // S
      "correct", // E
    ]);
  });

  it("is case-insensitive", () => {
    expect(scoreGuess("beach", "BEACH").every((s) => s === "correct")).toBe(true);
  });
});

describe("keyStates", () => {
  it("keeps the best state per letter — green never downgrades to grey", () => {
    const scored: ScoredGuess[] = [
      { guess: "OTTER", states: scoreGuess("OTTER", "OCEAN") },
      { guess: "OCEAN", states: scoreGuess("OCEAN", "OCEAN") },
    ];
    const keys = keyStates(scored);
    expect(keys.O).toBe("correct");
    expect(keys.E).toBe("correct"); // present in guess 1, correct in guess 2
    expect(keys.T).toBe("absent");
  });
});

describe("pickWord", () => {
  it("never returns a completed word until all are cleared", () => {
    const words = ["BEACH", "COAST", "OCEAN"];
    // rand=0 would pick index 0 of the filtered pool
    const picked = pickWord(words, ["BEACH"], () => 0);
    expect(picked).toBe("COAST");
  });

  it("excludes completed words case-insensitively", () => {
    const words = ["BEACH", "COAST"];
    expect(pickWord(words, ["beach", "coast"], () => 0)).toBe("BEACH"); // pool empty → full bank
  });

  it("falls back to the full bank once everything is solved", () => {
    const words = ["BEACH", "COAST"];
    const picked = pickWord(words, ["BEACH", "COAST"], () => 0.99);
    expect(words).toContain(picked);
  });

  it("exposes five guesses as the try budget", () => {
    expect(MAX_GUESSES).toBe(5);
  });
});
