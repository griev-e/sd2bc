import { describe, expect, it } from "vitest";
import {
  AUTO_TAG_THRESHOLD,
  canonicalCategory,
  categoryMeta,
  detectAssignee,
  editDistance,
  nameAliases,
  normalize,
  OTHER_CATEGORY,
  PARTNER_ALIASES,
  parsePackingEntries,
  SELF_ALIASES,
  stem,
  suggestCategory,
  suggestRetags,
  tidyLabel,
  tokenize,
} from "./packingTags";

const cat = (label: string, items?: { label: string; category: string }[]) =>
  suggestCategory(label, items ? { items } : {}).category;

describe("normalize / tokenize / stem", () => {
  it("strips case, punctuation, accents and possessives", () => {
    expect(normalize("Kev's  Café—Mug!")).toBe("kev cafe mug");
  });

  it("drops counts so quantities don't dilute the match", () => {
    expect(normalize("2x wool socks")).toBe("wool socks");
    expect(normalize("socks x2")).toBe("socks");
    expect(normalize("3 towels")).toBe("towels");
  });

  it("singularizes consistently on both sides of the match", () => {
    expect(stem("socks")).toBe("sock");
    expect(stem("batteries")).toBe("battery");
    expect(stem("knives")).toBe("knife");
    expect(stem("glasses")).toBe("glass");
    expect(stem("gas")).toBe("gas");
  });

  it("drops stopwords but never everything", () => {
    expect(tokenize("a pair of extra wool socks")).toEqual(["wool", "sock"]);
    expect(tokenize("the extra")).toEqual(["the", "extra"]);
  });
});

describe("suggestCategory — lexicon", () => {
  it("tags the obvious road-trip items", () => {
    expect(cat("socks")).toBe("Clothes");
    expect(cat("toothbrush")).toBe("Toiletries");
    expect(cat("ibuprofen")).toBe("Health");
    expect(cat("phone charger")).toBe("Tech");
    expect(cat("sleeping bag")).toBe("Outdoors");
    expect(cat("trail mix")).toBe("Food");
    expect(cat("jumper cables")).toBe("Car");
    expect(cat("passport")).toBe("Docs");
    expect(cat("playing cards")).toBe("Fun");
  });

  it("matches phrases regardless of word order or filler", () => {
    expect(cat("bag for sleeping")).toBe("Outdoors");
    expect(cat("a big jug of water")).toBe("Food");
    expect(cat("kit for first aid")).toBe("Health");
  });

  it("lets a phrase beat the bare head noun", () => {
    expect(cat("bath towel")).toBe("Toiletries");
    expect(cat("beach towel")).toBe("Outdoors");
    expect(cat("olive oil")).toBe("Food");
    expect(cat("oil")).toBe("Car");
  });

  it("heads right on unknown compounds", () => {
    // "camera" is Tech and "charger" is Tech — but the head noun is what
    // decides when the modifier pulls the other way.
    expect(cat("beach sandals")).toBe("Clothes");
    expect(cat("camp toothpaste")).toBe("Toiletries");
  });

  it("survives phone-keyboard typos", () => {
    expect(cat("sunscren")).toBe("Toiletries");
    expect(cat("toothbursh")).toBe("Toiletries");
    expect(cat("slepping bag")).toBe("Outdoors");
  });

  it("gives up honestly on nonsense", () => {
    const s = suggestCategory("zzzqqq");
    expect(s.category).toBe(OTHER_CATEGORY);
    expect(s.confidence).toBe(0);
    expect(s.canonical).toBeNull();
  });

  it("is confident enough to auto-apply a clean hit", () => {
    expect(suggestCategory("sunscreen").confidence).toBeGreaterThanOrEqual(AUTO_TAG_THRESHOLD);
    expect(suggestCategory("phone charger").confidence).toBeGreaterThan(0.8);
  });

  it("offers runners-up when the call is close", () => {
    expect(suggestCategory("beach towel").alternatives).toContain("Toiletries");
  });
});

describe("suggestCategory — learning from the list", () => {
  const list = [
    { label: "Wool socks", category: "Clothing" },
    { label: "Rain shell", category: "Clothing" },
    { label: "Espresso maker", category: "Galley" },
    { label: "Headlamp", category: "Van gear" },
  ];

  it("files into the name the list already uses", () => {
    // "Clothing", not our canonical "Clothes".
    expect(cat("hiking socks", list)).toBe("Clothing");
  });

  it("learns categories the lexicon has never heard of", () => {
    expect(cat("espresso beans", list)).toBe("Galley");
    expect(suggestCategory("espresso beans", { items: list }).source).toBe("learned");
  });

  it("still invents a canonical category when the list has no home for it", () => {
    expect(cat("passport", list)).toBe("Docs");
  });

  it("maps a canonical hit onto an aliased existing name", () => {
    const s = suggestCategory("toothpaste", { items: [{ label: "Soap", category: "Bathroom" }] });
    expect(s.category).toBe("Bathroom");
    expect(s.canonical).toBe("Toiletries");
  });

  it("ignores what is filed under Other", () => {
    expect(cat("spare socks", [{ label: "Socks", category: OTHER_CATEGORY }])).toBe("Clothes");
  });
});

describe("canonicalCategory / categoryMeta", () => {
  it("recognizes hand-typed variants", () => {
    expect(canonicalCategory("Clothing")).toBe("Clothes");
    expect(canonicalCategory("Bathroom")).toBe("Toiletries");
    expect(canonicalCategory("Camp gear")).toBe("Outdoors");
    expect(canonicalCategory("Electronics")).toBe("Tech");
    expect(canonicalCategory("Ski waxing")).toBeNull();
  });

  it("falls back to the Other palette for unknown names", () => {
    expect(categoryMeta("Ski waxing")).toBe(categoryMeta(OTHER_CATEGORY));
    expect(categoryMeta("Clothing").emoji).toBe(categoryMeta("Clothes").emoji);
  });
});

describe("nameAliases", () => {
  it("covers the whole name, each word, and short forms", () => {
    expect(nameAliases("Kevin")).toEqual(["kevin", "kev", "kevi"]);
    expect(nameAliases("Mary Anne")).toContain("mary anne");
    expect(nameAliases("Mary Anne")).toContain("anne");
    expect(nameAliases(null)).toEqual([]);
  });
});

describe("detectAssignee", () => {
  const people = [
    { id: "u1", aliases: [...nameAliases("Kevin"), ...SELF_ALIASES] },
    { id: "u2", aliases: [...nameAliases("Hailey"), ...PARTNER_ALIASES] },
  ];

  it("accepts a nickname the profile never spelled out", () => {
    expect(detectAssignee("Kev's charger", people)).toMatchObject({
      assignedTo: "u1",
      label: "Charger",
    });
  });

  it("reads possessives, prefixes, suffixes and parentheticals", () => {
    expect(detectAssignee("Kev's passport", people)).toMatchObject({ assignedTo: "u1", label: "Passport" });
    expect(detectAssignee("hailey: sunscreen", people)).toMatchObject({ assignedTo: "u2", label: "Sunscreen" });
    expect(detectAssignee("Rain jacket (hailey)", people)).toMatchObject({ assignedTo: "u2", label: "Rain jacket" });
    expect(detectAssignee("Charger for kevin", people)).toMatchObject({ assignedTo: "u1", label: "Charger" });
    expect(detectAssignee("my jacket", people)).toMatchObject({ assignedTo: "u1", label: "Jacket" });
  });

  it("leaves shared items alone", () => {
    expect(detectAssignee("Cooler", people)).toEqual({ assignedTo: null, label: "Cooler", matched: false });
  });

  it("does not eat a name that is part of the item", () => {
    // Bare names only count with a marker, so this stays one shared item.
    expect(detectAssignee("Kevin mug", people).matched).toBe(false);
  });

  it("never strips the label down to nothing", () => {
    // The marker is the whole label — keep it rather than adding a blank row.
    expect(detectAssignee("(hailey)", people)).toEqual({
      assignedTo: "u2",
      label: "(hailey)",
      matched: true,
    });
  });
});

describe("parsePackingEntries", () => {
  it("splits a paste into items and tidies each one", () => {
    expect(parsePackingEntries("socks, toothbrush\n- headlamp\n2. trail mix")).toEqual([
      "Socks",
      "Toothbrush",
      "Headlamp",
      "Trail mix",
    ]);
  });

  it("keeps 'and' inside a single item", () => {
    expect(parsePackingEntries("salt and pepper")).toEqual(["Salt and pepper"]);
  });

  it("drops empties", () => {
    expect(parsePackingEntries("  ,,\n\n socks , ")).toEqual(["Socks"]);
  });
});

describe("suggestRetags", () => {
  it("proposes moving an item that is clearly in the wrong section", () => {
    const items = [
      { label: "Wool socks", category: "Clothes" },
      { label: "Toothpaste", category: "Clothes" },
    ];
    const proposals = suggestRetags(items);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ from: "Clothes", to: "Toiletries" });
  });

  it("does not propose a pure rename of an equivalent category", () => {
    expect(suggestRetags([{ label: "Wool socks", category: "Clothing" }])).toEqual([]);
  });

  it("leaves correctly filed and unrecognized items alone", () => {
    const items = [
      { label: "Sleeping bag", category: "Outdoors" },
      { label: "Lucky rock", category: "Other" },
    ];
    expect(suggestRetags(items)).toEqual([]);
  });

  it("sorts the most confident proposal first", () => {
    const items = [
      { label: "Passport", category: "Food" },
      { label: "Sleeping bag", category: "Food" },
    ];
    const proposals = suggestRetags(items);
    expect(proposals.map((p) => p.to)).toEqual(["Outdoors", "Docs"]);
  });
});

describe("editDistance", () => {
  it("measures within budget and bails out past it", () => {
    expect(editDistance("socks", "socks", 2)).toBe(0);
    expect(editDistance("sockz", "socks", 2)).toBe(1);
    expect(editDistance("banana", "socks", 2)).toBe(3);
  });
});

describe("tidyLabel", () => {
  it("capitalizes and collapses whitespace", () => {
    expect(tidyLabel("  wool   socks ")).toBe("Wool socks");
    expect(tidyLabel("iPhone charger")).toBe("iPhone charger");
  });
});
