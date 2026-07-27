import { describe, expect, it } from "vitest";
import { CAR_CATALOG, CATALOG_YEAR, MIN_YEAR } from "./carData";
import {
  carLabel,
  carPriceKey,
  catalogMsrp,
  filterNames,
  makeNames,
  modelsForMake,
  parseSighting,
  pointsFor,
  scoreFor,
  sightingLabel,
  TIERS,
  tierOf,
  trimsForModel,
  yearOptions,
} from "./carPrice";

describe("CAR_CATALOG", () => {
  it("is sorted by make, with sorted models and cheapest-first trims", () => {
    const makes = CAR_CATALOG.map((m) => m.name);
    expect(makes).toEqual([...makes].sort((a, b) => a.localeCompare(b)));
    for (const make of CAR_CATALOG) {
      const models = make.models.map((m) => m.name);
      expect(models).toEqual([...models].sort((a, b) => a.localeCompare(b)));
      for (const model of make.models) {
        const prices = model.trims.map((t) => t.msrp);
        expect(prices).toEqual([...prices].sort((a, b) => a - b));
      }
    }
  });

  it("has a positive MSRP and a non-empty name for every trim", () => {
    for (const make of CAR_CATALOG) {
      for (const model of make.models) {
        expect(model.trims.length).toBeGreaterThan(0);
        for (const t of model.trims) {
          expect(t.name.length).toBeGreaterThan(0);
          expect(t.msrp).toBeGreaterThan(0);
        }
      }
    }
  });

  it("spans economy through hypercar", () => {
    const all = CAR_CATALOG.flatMap((mk) => mk.models.flatMap((md) => md.trims));
    const tiers = new Set(all.map((t) => tierOf(t.msrp).id));
    expect(tiers.has("economy")).toBe(true);
    expect(tiers.has("hyper")).toBe(true);
  });
});

describe("tierOf / pointsFor", () => {
  it("bands prices richest-first, inclusive of each floor", () => {
    expect(tierOf(1_000_000).id).toBe("hyper");
    expect(tierOf(999_999).id).toBe("exotic");
    expect(tierOf(250_000).id).toBe("exotic");
    expect(tierOf(100_000).id).toBe("luxury");
    expect(tierOf(60_000).id).toBe("premium");
    expect(tierOf(30_000).id).toBe("mainstream");
    expect(tierOf(29_999).id).toBe("economy");
    expect(tierOf(0).id).toBe("economy");
  });

  it("doubles points per tier so one exotic beats a lot of commuters", () => {
    expect(pointsFor(2_000_000)).toBe(32);
    expect(pointsFor(25_000)).toBe(1);
    expect(pointsFor(300_000)).toBeGreaterThan(pointsFor(80_000) * 3);
  });

  it("sums a player's sightings", () => {
    expect(scoreFor([{ msrp: 25_000 }, { msrp: 45_000 }, { msrp: 400_000 }])).toBe(
      1 + 2 + 16,
    );
    expect(scoreFor([])).toBe(0);
  });

  it("orders TIERS richest-first so the floor walk is well-defined", () => {
    const floors = TIERS.map((t) => t.floor);
    expect(floors).toEqual([...floors].sort((a, b) => b - a));
    expect(TIERS[TIERS.length - 1].floor).toBe(0);
  });
});

describe("catalog lookups", () => {
  it("finds a known trim's exact MSRP", () => {
    const rav4 = trimsForModel("Toyota", "RAV4").find((t) => t.name === "LE");
    expect(rav4).toBeDefined();
    expect(catalogMsrp(CATALOG_YEAR, "Toyota", "RAV4", "LE")).toBe(rav4!.msrp);
  });

  it("matches make/model/trim loosely — case, spacing and punctuation", () => {
    const exact = catalogMsrp(CATALOG_YEAR, "Land Rover", "Range Rover Sport", "SE");
    expect(exact).toBeGreaterThan(0);
    expect(catalogMsrp(CATALOG_YEAR, "  land-rover ", "range  rover sport", "se")).toBe(
      exact,
    );
  });

  it("falls back to the model's base trim when no trim is given", () => {
    const cheapest = trimsForModel("Porsche", "911")[0];
    expect(catalogMsrp(CATALOG_YEAR, "Porsche", "911", "")).toBe(cheapest.msrp);
  });

  it("returns null rather than guessing", () => {
    // wrong model year — the catalog only prices CATALOG_YEAR
    expect(catalogMsrp(2015, "Toyota", "RAV4", "LE")).toBeNull();
    // unknown make, unknown model, unknown trim
    expect(catalogMsrp(CATALOG_YEAR, "Delorean", "DMC-12", "")).toBeNull();
    expect(catalogMsrp(CATALOG_YEAR, "Toyota", "Supra Mk4", "")).toBeNull();
    expect(catalogMsrp(CATALOG_YEAR, "Toyota", "RAV4", "Nürburgring")).toBeNull();
  });

  it("cascades make → model → trim", () => {
    expect(makeNames()).toContain("Toyota");
    expect(modelsForMake("Toyota").map((m) => m.name)).toContain("RAV4");
    expect(trimsForModel("Toyota", "RAV4").map((t) => t.name)).toContain("Limited");
    // an unknown parent yields an empty list, never a throw
    expect(modelsForMake("Nope")).toEqual([]);
    expect(trimsForModel("Toyota", "Nope")).toEqual([]);
  });
});

describe("carPriceKey", () => {
  it("collapses spelling variants onto one cached answer", () => {
    expect(carPriceKey(2020, "Mazda", "MX-5 Miata", "Club")).toBe(
      carPriceKey(2020, " mazda ", "mx 5   miata", "CLUB"),
    );
  });

  it("keeps genuinely different cars apart", () => {
    expect(carPriceKey(2020, "Mazda", "MX-5", "")).not.toBe(
      carPriceKey(2021, "Mazda", "MX-5", ""),
    );
    expect(carPriceKey(2020, "Mazda", "MX-5", "Club")).not.toBe(
      carPriceKey(2020, "Mazda", "MX-5", "Sport"),
    );
  });
});

describe("filterNames", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(filterNames(makeNames(), "landrover")).toContain("Land Rover");
    expect(filterNames(["MX-5 Miata"], "mx5")).toEqual(["MX-5 Miata"]);
  });

  it("returns everything for an empty query", () => {
    const names = makeNames();
    expect(filterNames(names, "   ")).toEqual(names);
  });
});

describe("yearOptions", () => {
  it("runs newest-first from the catalog year", () => {
    const years = yearOptions(MIN_YEAR);
    expect(years[0]).toBe(CATALOG_YEAR);
    expect(years[years.length - 1]).toBe(MIN_YEAR);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });
});

describe("parseSighting", () => {
  it("reads a structured row", () => {
    const car = parseSighting({
      year: 2026,
      make: "Porsche",
      model: "911",
      trim: "Turbo S",
      msrp: 235_000,
      source: "catalog",
    });
    expect(car).toEqual({
      year: 2026,
      make: "Porsche",
      model: "911",
      trim: "Turbo S",
      msrp: 235_000,
      source: "catalog",
    });
    expect(sightingLabel(car!)).toBe("2026 Porsche 911 Turbo S");
  });

  it("still ranks legacy { name, price } rows", () => {
    const car = parseSighting({ name: "mystery hypercar", price: 2_000_000 });
    expect(car?.msrp).toBe(2_000_000);
    expect(car?.source).toBe("manual");
    // no structured fields — the free text stands in as the label
    expect(sightingLabel(car!)).toBe("mystery hypercar");
    expect(pointsFor(car!.msrp)).toBe(32);
  });

  it("rejects rows with no usable price or name", () => {
    expect(parseSighting({})).toBeNull();
    expect(parseSighting({ name: "Lambo", price: 0 })).toBeNull();
    expect(parseSighting({ msrp: 50_000 })).toBeNull();
    expect(parseSighting({ name: "   ", price: 100 })).toBeNull();
  });

  it("defaults an unrecognized source to manual", () => {
    expect(parseSighting({ make: "Kia", model: "EV6", msrp: 44_000 })?.source).toBe(
      "manual",
    );
    expect(
      parseSighting({ make: "Kia", model: "EV6", msrp: 44_000, source: "ai" })?.source,
    ).toBe("ai");
  });
});

describe("carLabel", () => {
  it("omits the parts that aren't there", () => {
    expect(carLabel({ year: 2026, make: "Kia", model: "EV9", trim: "Land" })).toBe(
      "2026 Kia EV9 Land",
    );
    expect(carLabel({ year: 2026, make: "Kia", model: "EV9" })).toBe("2026 Kia EV9");
    expect(carLabel({ year: 2026, make: "Kia", model: "EV9", trim: "  " })).toBe(
      "2026 Kia EV9",
    );
  });
});
