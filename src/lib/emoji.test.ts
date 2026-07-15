import { describe, expect, it } from "vitest";
import { dayEmoji, defaultDayEmoji, NATURE_EMOJI } from "./emoji";

describe("defaultDayEmoji", () => {
  it("is deterministic for the same day id", () => {
    expect(defaultDayEmoji("day-123")).toBe(defaultDayEmoji("day-123"));
  });

  it("always returns something from the curated list", () => {
    expect(NATURE_EMOJI).toContain(defaultDayEmoji("day-abc"));
    expect(NATURE_EMOJI).toContain(defaultDayEmoji("another-day-id"));
  });
});

describe("dayEmoji", () => {
  it("prefers a custom emoji when set", () => {
    expect(dayEmoji("day-1", "🚀")).toBe("🚀");
  });

  it("trims whitespace around a custom emoji", () => {
    expect(dayEmoji("day-1", "  🚀  ")).toBe("🚀");
  });

  it("falls back to the deterministic default when custom is null or blank", () => {
    expect(dayEmoji("day-1", null)).toBe(defaultDayEmoji("day-1"));
    expect(dayEmoji("day-1", "   ")).toBe(defaultDayEmoji("day-1"));
  });
});
