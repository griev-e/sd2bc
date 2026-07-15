import { describe, expect, it } from "vitest";
import {
  BIG_CITY_BUMP,
  BIG_CITY_PATTERN,
  CATEGORIES,
  GAS_PRICE_USD_PER_GAL,
  LODGING_PER_NIGHT,
  MISC_PER_DAY,
  nightCost,
  seedEstimate,
  type SeedInputs,
} from "./costs";

describe("CATEGORIES", () => {
  it("excludes misc from the budget breakdown", () => {
    expect(CATEGORIES).not.toContain("misc");
    expect(CATEGORIES).toEqual(["gas", "lodging", "food", "activities"]);
  });
});

describe("BIG_CITY_PATTERN", () => {
  it("matches known big cities case-insensitively", () => {
    expect(BIG_CITY_PATTERN.test("San Francisco")).toBe(true);
    expect(BIG_CITY_PATTERN.test("seattle")).toBe(true);
    expect(BIG_CITY_PATTERN.test("VANCOUVER")).toBe(true);
    expect(BIG_CITY_PATTERN.test("Santa Barbara")).toBe(true);
  });

  it("does not match other towns", () => {
    expect(BIG_CITY_PATTERN.test("Eureka")).toBe(false);
  });
});

describe("nightCost", () => {
  it("is $0 for a free night regardless of region or cost", () => {
    expect(nightCost({ region: "CA", bigCity: true, free: true, cost: 500 })).toBe(0);
  });

  it("uses an explicit known cost over the regional estimate", () => {
    expect(nightCost({ region: "CA", bigCity: false, cost: 250 })).toBe(250);
  });

  it("ignores a zero or negative explicit cost and falls back to the estimate", () => {
    expect(nightCost({ region: "OR", bigCity: false, cost: 0 })).toBe(LODGING_PER_NIGHT.OR);
    expect(nightCost({ region: "OR", bigCity: false, cost: -10 })).toBe(LODGING_PER_NIGHT.OR);
  });

  it("falls back to the regional estimate with no cost given", () => {
    expect(nightCost({ region: "WA", bigCity: false })).toBe(LODGING_PER_NIGHT.WA);
  });

  it("adds the big-city bump on top of the regional estimate", () => {
    expect(nightCost({ region: "WA", bigCity: true })).toBe(
      LODGING_PER_NIGHT.WA + BIG_CITY_BUMP,
    );
  });
});

function baseInputs(overrides: Partial<SeedInputs> = {}): SeedInputs {
  return {
    milesByRegion: { CA: 0, OR: 0, WA: 0, BC: 0 },
    mpg: 30,
    travelers: 2,
    totalDays: 10,
    nights: [],
    foodPerDay: 60,
    activitiesPerDay: 25,
    ...overrides,
  };
}

describe("seedEstimate — gas", () => {
  it("sums per-region gas cost at the regional price", () => {
    const inputs = baseInputs({ milesByRegion: { CA: 300, OR: 200, WA: 0, BC: 0 }, mpg: 25 });
    const expected =
      (300 / 25) * GAS_PRICE_USD_PER_GAL.CA + (200 / 25) * GAS_PRICE_USD_PER_GAL.OR;
    expect(seedEstimate("gas", inputs)).toBeCloseTo(expected, 6);
  });

  it("returns 0 when mpg is zero or negative", () => {
    expect(seedEstimate("gas", baseInputs({ mpg: 0 }))).toBe(0);
    expect(seedEstimate("gas", baseInputs({ mpg: -5 }))).toBe(0);
  });
});

describe("seedEstimate — lodging", () => {
  it("sums nightCost across all nights", () => {
    const inputs = baseInputs({
      nights: [
        { region: "CA", bigCity: false },
        { region: "BC", bigCity: true },
        { region: "OR", bigCity: false, free: true },
      ],
    });
    const expected =
      LODGING_PER_NIGHT.CA + (LODGING_PER_NIGHT.BC + BIG_CITY_BUMP) + 0;
    expect(seedEstimate("lodging", inputs)).toBe(expected);
  });

  it("is 0 with no nights", () => {
    expect(seedEstimate("lodging", baseInputs())).toBe(0);
  });
});

describe("seedEstimate — food & activities", () => {
  it("multiplies per-person-per-day rate by travelers and days", () => {
    const inputs = baseInputs({ foodPerDay: 60, activitiesPerDay: 25, travelers: 2, totalDays: 10 });
    expect(seedEstimate("food", inputs)).toBe(60 * 2 * 10);
    expect(seedEstimate("activities", inputs)).toBe(25 * 2 * 10);
  });

  it("honors a trip-level override rate", () => {
    const inputs = baseInputs({ foodPerDay: 80, travelers: 1, totalDays: 5 });
    expect(seedEstimate("food", inputs)).toBe(80 * 1 * 5);
  });
});

describe("seedEstimate — misc", () => {
  it("is MISC_PER_DAY * totalDays, independent of travelers", () => {
    const inputs = baseInputs({ totalDays: 10, travelers: 5 });
    expect(seedEstimate("misc", inputs)).toBe(MISC_PER_DAY * 10);
  });
});
