import { describe, expect, it } from "vitest";
import { weatherKind } from "./weather";

describe("weatherKind", () => {
  it("maps clear and partly-cloudy codes", () => {
    expect(weatherKind(0)).toBe("sun");
    expect(weatherKind(1)).toBe("partly");
    expect(weatherKind(2)).toBe("partly");
    expect(weatherKind(3)).toBe("cloud");
  });

  it("maps fog codes", () => {
    expect(weatherKind(45)).toBe("fog");
    expect(weatherKind(48)).toBe("fog");
  });

  it("maps drizzle codes", () => {
    expect(weatherKind(51)).toBe("drizzle");
    expect(weatherKind(57)).toBe("drizzle");
  });

  it("maps rain codes, including rain showers", () => {
    expect(weatherKind(61)).toBe("rain");
    expect(weatherKind(67)).toBe("rain");
    expect(weatherKind(80)).toBe("rain");
    expect(weatherKind(82)).toBe("rain");
  });

  it("maps snow codes, including snow showers", () => {
    expect(weatherKind(71)).toBe("snow");
    expect(weatherKind(77)).toBe("snow");
    expect(weatherKind(85)).toBe("snow");
    expect(weatherKind(86)).toBe("snow");
  });

  it("maps thunderstorm codes", () => {
    expect(weatherKind(95)).toBe("storm");
    expect(weatherKind(99)).toBe("storm");
  });

  it("falls back to cloud for unrecognized codes", () => {
    expect(weatherKind(4)).toBe("cloud");
    expect(weatherKind(58)).toBe("cloud");
  });
});
