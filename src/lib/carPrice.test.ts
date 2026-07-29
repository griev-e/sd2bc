import { describe, expect, it } from "vitest";
import { CAR_CATALOG, CATALOG_YEAR, LEGACY_CATALOG, MIN_YEAR } from "./carData";
import {
  carLabel,
  carPriceKey,
  catalogMsrp,
  filterNames,
  HAUL_LEVELS,
  makeNames,
  modelsForMake,
  parseSighting,
  pointsFor,
  scoreFor,
  sightingLabel,
  teamHaul,
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

describe("LEGACY_CATALOG", () => {
  it("is sorted by make, with sorted models and cheapest-first trims", () => {
    const makes = LEGACY_CATALOG.map((m) => m.name);
    expect(makes).toEqual([...makes].sort((a, b) => a.localeCompare(b)));
    for (const make of LEGACY_CATALOG) {
      const models = make.models.map((m) => m.name);
      expect(models).toEqual([...models].sort((a, b) => a.localeCompare(b)));
      for (const model of make.models) {
        const prices = model.trims.map((t) => t.msrp);
        expect(prices).toEqual([...prices].sort((a, b) => a - b));
      }
    }
  });

  it("gives every trim a positive price and a sane year range", () => {
    for (const make of LEGACY_CATALOG) {
      for (const model of make.models) {
        expect(model.trims.length).toBeGreaterThan(0);
        for (const t of model.trims) {
          expect(t.name.length).toBeGreaterThan(0);
          expect(t.msrp).toBeGreaterThan(0);
          expect(t.from).toBeGreaterThanOrEqual(MIN_YEAR);
          expect(t.to).toBeGreaterThanOrEqual(t.from);
          // a "legacy" trim that claims to still be on sale this year would
          // shadow the current lineup's price
          expect(t.to).toBeLessThan(CATALOG_YEAR);
        }
      }
    }
  });
});

describe("year-scoped lookups", () => {
  it("prices the AMG GT trims that only ever existed on the old car", () => {
    // the sighting that started this: a first-gen AMG GT is a GT / GT C /
    // GT R, and none of those names appear on the current 43/55/63 car
    const trims2019 = trimsForModel("Mercedes-Benz", "AMG GT", 2019).map((t) => t.name);
    expect(trims2019).toContain("GT");
    expect(trims2019).toContain("GT C");
    expect(trims2019).toContain("GT R");
    // era-correct trims lead, this year's names trail behind them
    expect(trims2019.indexOf("GT R")).toBeLessThan(trims2019.indexOf("GT 63 Coupe"));

    expect(catalogMsrp(2019, "Mercedes-Benz", "AMG GT", "GT R")).toBe(162_000);
    expect(catalogMsrp(2019, "Mercedes-Benz", "AMG GT", "GT C")).toBe(145_000);
    // and the ones the spotter explicitly didn't mean stay on the current car
    expect(trimsForModel("Mercedes-Benz", "AMG GT").map((t) => t.name)).not.toContain(
      "GT R",
    );
  });

  it("respects each trim's model-year range", () => {
    // the GT R arrived for 2018 and the Black Series was a one-year car
    expect(catalogMsrp(2017, "Mercedes-Benz", "AMG GT", "GT R")).toBeNull();
    expect(catalogMsrp(2021, "Mercedes-Benz", "AMG GT", "GT Black Series")).toBe(325_000);
    expect(catalogMsrp(2020, "Mercedes-Benz", "AMG GT", "GT Black Series")).toBeNull();
  });

  it("unlocks departed nameplates and marques on an older year", () => {
    expect(modelsForMake("Dodge", 2005).map((m) => m.name)).toContain("Viper");
    expect(modelsForMake("Dodge").map((m) => m.name)).not.toContain("Viper");
    expect(makeNames(1999)).toContain("Pontiac");
    expect(makeNames()).not.toContain("Pontiac");
    // legacy makes are folded into the current list in sorted order
    expect(makeNames(1999)).toEqual([...makeNames(1999)].sort((a, b) => a.localeCompare(b)));
  });

  it("falls back to the cheapest trim on sale that year when none is given", () => {
    expect(catalogMsrp(2005, "Dodge", "Viper", "")).toBe(82_000);
    expect(catalogMsrp(1999, "Dodge", "Viper", "")).toBe(55_000);
  });

  it("still matches loosely and still refuses to guess", () => {
    expect(catalogMsrp(2004, " chevrolet ", "corvette", "c5 z06")).toBe(48_000);
    // a nameplate with no legacy entry gets no legacy price
    expect(catalogMsrp(2015, "Toyota", "RAV4", "LE")).toBeNull();
    // a year older than the table covers
    expect(catalogMsrp(1985, "Dodge", "Viper", "RT/10")).toBeNull();
    expect(trimsForModel("Dodge", "Nope", 2005)).toEqual([]);
  });
});

describe("teamHaul", () => {
  const cars = [
    { msrp: 25_000, by: "a" },
    { msrp: 45_000, by: "b" },
    { msrp: 62_000, by: "a" },
    { msrp: 400_000, by: "b" },
  ];

  it("pools both spotters' cars into one score", () => {
    const haul = teamHaul(cars);
    // 1 + 2 + 4 + 16 — nobody's half is tracked separately
    expect(haul.points).toBe(23);
    expect(haul.count).toBe(4);
  });

  it("reports tier coverage richest-first with the best car in each", () => {
    const haul = teamHaul(cars);
    expect(haul.tiers.map((t) => t.tier.id)).toEqual(TIERS.map((t) => t.id));
    expect(haul.collected).toBe(4);
    expect(haul.tiers.find((t) => t.tier.id === "exotic")?.best?.by).toBe("b");
    expect(haul.tiers.find((t) => t.tier.id === "hyper")?.best).toBeNull();
    expect(haul.tiers.find((t) => t.tier.id === "hyper")?.count).toBe(0);
  });

  it("keeps the best car when a tier holds several", () => {
    const haul = teamHaul([{ msrp: 31_000 }, { msrp: 55_000 }, { msrp: 40_000 }]);
    const mainstream = haul.tiers.find((t) => t.tier.id === "mainstream");
    expect(mainstream?.count).toBe(3);
    expect(mainstream?.best?.msrp).toBe(55_000);
  });

  it("climbs the level ladder and measures the gap to the next rung", () => {
    const empty = teamHaul([]);
    expect(empty.level).toEqual(HAUL_LEVELS[0]);
    expect(empty.progress).toBe(0);
    expect(empty.collected).toBe(0);

    const mid = teamHaul([{ msrp: 400_000 }, { msrp: 400_000 }]); // 32 pts
    expect(mid.level.at).toBe(20);
    expect(mid.next?.at).toBe(50);
    expect(mid.progress).toBeCloseTo((32 - 20) / (50 - 20));

    // 30 hypercars = 960 pts, past the last rung
    const topped = teamHaul(Array.from({ length: 30 }, () => ({ msrp: 2_000_000 })));
    expect(topped.level).toEqual(HAUL_LEVELS[HAUL_LEVELS.length - 1]);
    expect(topped.next).toBeNull();
    expect(topped.progress).toBe(1);
  });

  it("orders HAUL_LEVELS cheapest-first from zero, so every score has a level", () => {
    const ats = HAUL_LEVELS.map((l) => l.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(ats[0]).toBe(0);
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
