import { afterEach, describe, expect, it, vi } from "vitest";
import {
  daysUntil,
  displayName,
  fmtClock,
  fmtDate,
  fmtDuration,
  fmtMiles,
  fmtMoney,
  fmtStay,
  localDateISO,
} from "./format";

describe("fmtMiles", () => {
  it("shows one decimal under 100 miles", () => {
    expect(fmtMiles(1609.344 * 50)).toBe("50.0 mi");
  });

  it("rounds to a whole number at 100 miles and above", () => {
    expect(fmtMiles(1609.344 * 150)).toBe("150 mi");
    expect(fmtMiles(1609.344 * 100)).toBe("100 mi");
  });

  it("still shows one decimal just under the 100-mile cutoff", () => {
    expect(fmtMiles(1609.344 * 99.5)).toBe("99.5 mi");
  });
});

describe("fmtDuration", () => {
  it("shows just minutes under an hour", () => {
    expect(fmtDuration(300)).toBe("5 min");
  });

  it("shows hours and zero-padded minutes at an hour or more", () => {
    expect(fmtDuration(3661)).toBe("1h 01m");
    expect(fmtDuration(7200)).toBe("2h 00m");
  });
});

describe("fmtMoney", () => {
  it("shows no decimals for a whole dollar amount", () => {
    expect(fmtMoney(50)).toBe("$50");
  });

  it("shows cents for a sub-$100 fractional amount", () => {
    expect(fmtMoney(50.5)).toBe("$50.50");
  });

  it("drops decimals at $100 and above, rounding as usual", () => {
    expect(fmtMoney(150.4)).toBe("$150");
    expect(fmtMoney(150.6)).toBe("$151");
  });

  it("treats a near-integer amount under $100 as a whole dollar", () => {
    expect(fmtMoney(59.996)).toBe("$60");
  });
});

describe("fmtClock", () => {
  it("formats midnight and noon", () => {
    expect(fmtClock(0)).toBe("12:00 AM");
    expect(fmtClock(720)).toBe("12:00 PM");
  });

  it("formats an ordinary afternoon time", () => {
    expect(fmtClock(870)).toBe("2:30 PM");
  });

  it("wraps minutes past a day forward", () => {
    expect(fmtClock(1440)).toBe("12:00 AM");
  });

  it("wraps negative minutes backward", () => {
    expect(fmtClock(-1)).toBe("11:59 PM");
  });
});

describe("fmtStay", () => {
  it("shows just minutes under an hour", () => {
    expect(fmtStay(45)).toBe("45m");
  });

  it("shows a bare hour with no remainder", () => {
    expect(fmtStay(60)).toBe("1h");
  });

  it("shows hours and minutes", () => {
    expect(fmtStay(90)).toBe("1h 30m");
  });
});

describe("fmtDate", () => {
  it("parses the ISO date as local, not UTC", () => {
    expect(fmtDate("2026-01-01")).toBe("Thu, Jan 1");
    expect(fmtDate("2026-07-27")).toBe("Mon, Jul 27");
  });
});

describe("localDateISO", () => {
  it("formats a given date as YYYY-MM-DD", () => {
    expect(localDateISO(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDateISO(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("daysUntil", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts forward, backward, and same-day correctly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 9, 30));

    expect(daysUntil("2026-07-27")).toBe(12);
    expect(daysUntil("2026-07-01")).toBe(-14);
    expect(daysUntil("2026-07-15")).toBe(0);
  });
});

describe("displayName", () => {
  it("prefers the display name over the username", () => {
    expect(displayName({ display_name: "Kevin", username: "kevin" })).toBe("Kevin");
  });

  it("falls back to the username when no display name is set", () => {
    expect(displayName({ display_name: null, username: "kevin" })).toBe("kevin");
  });

  it("returns undefined for a missing profile", () => {
    expect(displayName(null)).toBeUndefined();
    expect(displayName(undefined)).toBeUndefined();
  });
});
