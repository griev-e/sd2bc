import { describe, expect, it } from "vitest";
import type { LngLat } from "./geo";
import {
  DEFAULT_MAX_ZOOM,
  DEFAULT_MIN_ZOOM,
  fontStacks,
  glyphUrls,
  planTiles,
  spriteUrls,
  tileAt,
  tileKey,
  tileSourceRefs,
  tileUrl,
  tilesForLine,
  tileXY,
  type MapStyleDoc,
} from "./tiles";

const SAN_DIEGO: LngLat = [-117.1611, 32.7157];
const VANCOUVER: LngLat = [-123.1207, 49.2827];

describe("tileXY / tileAt", () => {
  it("puts the origin at the middle of the world", () => {
    expect(tileXY([0, 0], 1)).toEqual({ x: 1, y: 1 });
    expect(tileAt([0, 0], 1)).toEqual({ z: 1, x: 1, y: 1 });
  });

  it("agrees with the standard slippy-map formula", () => {
    // z=10, San Diego — computed from the OSM wiki formula
    expect(tileAt(SAN_DIEGO, 10)).toEqual({ z: 10, x: 178, y: 413 });
    expect(tileAt(VANCOUVER, 10)).toEqual({ z: 10, x: 161, y: 350 });
  });

  it("clamps past the Mercator limit instead of going infinite", () => {
    const north = tileAt([0, 89.9], 4);
    expect(Number.isFinite(north.y)).toBe(true);
    expect(north.y).toBe(0);
    const south = tileAt([0, -89.9], 4);
    expect(south.y).toBe(15); // 2^4 - 1
  });

  it("never returns an out-of-range tile", () => {
    const t = tileAt([180, 0], 3);
    expect(t.x).toBeLessThanOrEqual(7);
    expect(t.x).toBeGreaterThanOrEqual(0);
  });
});

describe("tilesForLine", () => {
  it("covers a single point plus its padding ring", () => {
    expect(tilesForLine([SAN_DIEGO], 10, 0)).toHaveLength(1);
    expect(tilesForLine([SAN_DIEGO], 10, 1)).toHaveLength(9); // 3×3
    expect(tilesForLine([SAN_DIEGO], 10, 2)).toHaveLength(25); // 5×5
  });

  it("returns nothing for an empty line", () => {
    expect(tilesForLine([], 10)).toEqual([]);
  });

  it("never repeats a tile", () => {
    const line: LngLat[] = Array.from({ length: 50 }, (_, i) => [
      -117.16 + i * 0.001,
      32.71,
    ]);
    const tiles = tilesForLine(line, 10, 1);
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
  });

  it("fills the gap when two points skip several tiles", () => {
    // San Diego straight to Vancouver in one hop — no vertices in between
    const sparse = tilesForLine([SAN_DIEGO, VANCOUVER], 8, 0);
    const keys = new Set(sparse.map(tileKey));

    // both ends are in
    expect(keys.has(tileKey(tileAt(SAN_DIEGO, 8)))).toBe(true);
    expect(keys.has(tileKey(tileAt(VANCOUVER, 8)))).toBe(true);

    // and so is the middle — a hole here is grey map on the drive
    const a = tileXY(SAN_DIEGO, 8);
    const b = tileXY(VANCOUVER, 8);
    const mid = { x: Math.floor((a.x + b.x) / 2), y: Math.floor((a.y + b.y) / 2) };
    expect(keys.has(`8/${mid.x}/${mid.y}`)).toBe(true);

    // the run is contiguous in y — no gaps anywhere along it
    const ys = [...new Set(sparse.map((t) => t.y))].sort((p, q) => p - q);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBe(1);
  });

  it("scales with zoom — four times the tiles per level, roughly", () => {
    const line: LngLat[] = [SAN_DIEGO, VANCOUVER];
    const z6 = tilesForLine(line, 6, 0).length;
    const z8 = tilesForLine(line, 8, 0).length;
    expect(z8).toBeGreaterThan(z6);
  });
});

describe("planTiles", () => {
  const route: LngLat[][] = [[SAN_DIEGO, VANCOUVER]];

  it("collects every zoom in the range", () => {
    const plan = planTiles(route, { minZoom: 5, maxZoom: 7, padding: 0 });
    expect(Object.keys(plan.perZoom).map(Number).sort()).toEqual([5, 6, 7]);
    expect(plan.truncated).toBe(false);
    expect(plan.tiles.length).toBe(Object.values(plan.perZoom).reduce((a, b) => a + b, 0));
  });

  it("dedupes across the whole plan", () => {
    const plan = planTiles([[SAN_DIEGO, VANCOUVER], [SAN_DIEGO, VANCOUVER]], {
      minZoom: 5,
      maxZoom: 7,
      padding: 1,
    });
    expect(new Set(plan.tiles.map(tileKey)).size).toBe(plan.tiles.length);
  });

  it("keeps the coarse zooms when the cap bites", () => {
    const plan = planTiles(route, { minZoom: 5, maxZoom: 12, maxTiles: 40 });
    expect(plan.truncated).toBe(true);
    expect(plan.tiles).toHaveLength(40);
    // a blurry map of the whole loop beats a sharp map of the first day
    expect(Math.min(...plan.tiles.map((t) => t.z))).toBe(5);
    expect(Math.max(...plan.tiles.map((t) => t.z))).toBeLessThan(12);
  });

  it("stays inside a sane budget for a real west-coast loop", () => {
    // a coarse stand-in for the actual route: down the coast and back up
    const loop: LngLat[] = [];
    for (let lat = 32.7; lat <= 49.3; lat += 0.05) loop.push([-121 - (lat - 32.7) * 0.1, lat]);
    const plan = planTiles([loop, [...loop].reverse()], {
      minZoom: DEFAULT_MIN_ZOOM,
      maxZoom: DEFAULT_MAX_ZOOM,
    });
    expect(plan.tiles.length).toBeGreaterThan(500);
    expect(plan.tiles.length).toBeLessThanOrEqual(6000);
  });

  it("handles a trip with no routes yet", () => {
    const plan = planTiles([]);
    expect(plan.tiles).toEqual([]);
    expect(plan.truncated).toBe(false);
  });
});

describe("tileUrl", () => {
  it("fills the template", () => {
    expect(tileUrl("https://x.example/{z}/{x}/{y}.pbf", { z: 10, x: 178, y: 413 })).toBe(
      "https://x.example/10/178/413.pbf",
    );
  });
});

describe("style assets", () => {
  const style: MapStyleDoc = {
    sources: {
      openmaptiles: { url: "https://tiles.example/planet.json" },
      hillshade: { tiles: ["https://tiles.example/hill/{z}/{x}/{y}.png"] },
    },
    sprite: "https://tiles.example/sprites/positron",
    glyphs: "https://tiles.example/fonts/{fontstack}/{range}.pbf",
    layers: [
      { layout: { "text-font": ["Noto Sans Regular"] } },
      { layout: { "text-font": ["Noto Sans Italic"] } },
      { layout: { "text-font": ["Noto Sans Regular"] } }, // dupe
      {}, // no layout at all
    ],
  };

  it("separates TileJSON references from inline templates", () => {
    const refs = tileSourceRefs(style);
    expect(refs.tileJsonUrls).toEqual(["https://tiles.example/planet.json"]);
    expect(refs.templates).toEqual(["https://tiles.example/hill/{z}/{x}/{y}.png"]);
  });

  it("survives a style with no sources", () => {
    expect(tileSourceRefs({})).toEqual({ tileJsonUrls: [], templates: [] });
  });

  it("takes both pixel densities of the sprite", () => {
    expect(spriteUrls(style.sprite)).toEqual([
      "https://tiles.example/sprites/positron.json",
      "https://tiles.example/sprites/positron.png",
      "https://tiles.example/sprites/positron@2x.json",
      "https://tiles.example/sprites/positron@2x.png",
    ]);
    expect(spriteUrls(undefined)).toEqual([]);
  });

  it("collects each font stack once", () => {
    expect(fontStacks(style)).toEqual(["Noto Sans Regular", "Noto Sans Italic"]);
    expect(fontStacks({})).toEqual([]);
  });

  it("builds one glyph URL per stack and range", () => {
    const urls = glyphUrls(style.glyphs, ["Noto Sans Regular"], ["0-255"]);
    expect(urls).toEqual(["https://tiles.example/fonts/Noto%20Sans%20Regular/0-255.pbf"]);
  });

  it("covers the Latin ranges by default", () => {
    expect(glyphUrls(style.glyphs, ["A"])).toHaveLength(2);
    expect(glyphUrls(undefined, ["A"])).toEqual([]);
  });
});
