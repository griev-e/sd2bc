/*
  Slippy-map tile math for the offline map download.

  Everything here is pure so the expensive question — "which tiles does this
  3,000-mile loop actually touch, and how many is that?" — can be answered and
  tested without a network or a map.

  Why a zoom ceiling matters: vector tiles OVERZOOM. MapLibre happily renders a
  z11 tile at z16, just with coarser geometry. So caching z5–z11 gives a map
  that stays usable at every zoom in a dead zone, for a fraction of the tiles
  z16 coverage would need (each extra zoom level is 4× the tiles).
*/

import type { LngLat } from "./geo";

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** Zooms worth keeping: continental overview through "which exit is that". */
export const DEFAULT_MIN_ZOOM = 5;
export const DEFAULT_MAX_ZOOM = 11;
/**
 * Tiles of slack around the route. One ring means a full tile of map either
 * side of the line, so a detour or a pan doesn't immediately hit grey.
 */
export const DEFAULT_PADDING = 1;
/**
 * Hard ceiling on a download. OpenFreeMap is free and unmetered by trust — a
 * runaway request loop is exactly the thing that gets that taken away.
 */
export const MAX_TILES = 6000;

/** Web-Mercator tile containing this coordinate, as floats. */
export function tileXY(lngLat: LngLat, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const [lng, lat] = lngLat;
  // clamp to Mercator's valid band — the poles are infinitely far away
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/** The integer tile a coordinate falls in. */
export function tileAt(lngLat: LngLat, z: number): Tile {
  const { x, y } = tileXY(lngLat, z);
  const n = 2 ** z;
  return {
    z,
    x: Math.min(n - 1, Math.max(0, Math.floor(x))),
    y: Math.min(n - 1, Math.max(0, Math.floor(y))),
  };
}

export function tileKey(t: Tile): string {
  return `${t.z}/${t.x}/${t.y}`;
}

/**
 * Every tile a polyline passes through at one zoom, plus `padding` rings.
 *
 * OSRM's full-overview geometry is dense enough that consecutive vertices
 * almost always land in the same or an adjacent tile, but "almost" isn't a
 * guarantee — a long straight freeway run can skip several. So any gap wider
 * than one tile is walked in sub-tile steps rather than assumed away, which is
 * what stops a hole appearing in the middle of the I-5.
 */
export function tilesForLine(line: LngLat[], z: number, padding = DEFAULT_PADDING): Tile[] {
  if (line.length === 0) return [];
  const n = 2 ** z;
  const hit = new Set<string>();
  const out: Tile[] = [];

  const mark = (tx: number, ty: number) => {
    for (let dx = -padding; dx <= padding; dx++) {
      for (let dy = -padding; dy <= padding; dy++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const key = `${z}/${x}/${y}`;
        if (hit.has(key)) continue;
        hit.add(key);
        out.push({ z, x, y });
      }
    }
  };

  let prev = tileXY(line[0], z);
  mark(Math.floor(prev.x), Math.floor(prev.y));

  for (let i = 1; i < line.length; i++) {
    const cur = tileXY(line[i], z);
    const span = Math.max(Math.abs(cur.x - prev.x), Math.abs(cur.y - prev.y));
    // > 1 tile of travel in one hop: subdivide so nothing in between is skipped
    const steps = Math.ceil(span);
    if (steps > 1) {
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        mark(
          Math.floor(prev.x + (cur.x - prev.x) * t),
          Math.floor(prev.y + (cur.y - prev.y) * t),
        );
      }
    }
    mark(Math.floor(cur.x), Math.floor(cur.y));
    prev = cur;
  }

  return out;
}

export interface TilePlan {
  tiles: Tile[];
  /** Tile count per zoom level, for the "what am I about to download" line. */
  perZoom: Record<number, number>;
  /** True when MAX_TILES clipped the plan — coarse zooms are kept first. */
  truncated: boolean;
}

/**
 * Plan the whole download across a zoom range.
 *
 * Zooms are collected coarse-first so that if the cap bites, what survives is
 * the wide-area coverage — a blurry map of the entire loop beats a crisp map of
 * the first two days and grey for the rest.
 */
export function planTiles(
  lines: LngLat[][],
  opts: {
    minZoom?: number;
    maxZoom?: number;
    padding?: number;
    maxTiles?: number;
  } = {},
): TilePlan {
  const minZoom = opts.minZoom ?? DEFAULT_MIN_ZOOM;
  const maxZoom = opts.maxZoom ?? DEFAULT_MAX_ZOOM;
  const padding = opts.padding ?? DEFAULT_PADDING;
  const maxTiles = opts.maxTiles ?? MAX_TILES;

  const seen = new Set<string>();
  const tiles: Tile[] = [];
  const perZoom: Record<number, number> = {};
  let truncated = false;

  for (let z = minZoom; z <= maxZoom; z++) {
    for (const line of lines) {
      for (const tile of tilesForLine(line, z, padding)) {
        const key = tileKey(tile);
        if (seen.has(key)) continue;
        if (tiles.length >= maxTiles) {
          truncated = true;
          return { tiles, perZoom, truncated };
        }
        seen.add(key);
        tiles.push(tile);
        perZoom[z] = (perZoom[z] ?? 0) + 1;
      }
    }
  }

  return { tiles, perZoom, truncated };
}

/** Fill a `{z}/{x}/{y}` tile template. */
export function tileUrl(template: string, t: Tile): string {
  return template
    .replace("{z}", String(t.z))
    .replace("{x}", String(t.x))
    .replace("{y}", String(t.y));
}

/* ---- style assets -------------------------------------------------------- */

/*
  A style is more than tiles: without the sprite the map has no icons, and
  without glyphs it has no labels — a nameless grey map is not much use for
  navigating. These pull the extra URLs out of a style document so the download
  can warm them too.
*/

export interface MapStyleDoc {
  sources?: Record<string, { url?: string; tiles?: string[] }>;
  sprite?: string;
  glyphs?: string;
  layers?: { layout?: Record<string, unknown> }[];
}

/** TileJSON URLs to resolve, and tile templates already given inline. */
export function tileSourceRefs(style: MapStyleDoc): {
  tileJsonUrls: string[];
  templates: string[];
} {
  const tileJsonUrls: string[] = [];
  const templates: string[] = [];
  for (const source of Object.values(style.sources ?? {})) {
    if (Array.isArray(source?.tiles)) templates.push(...source.tiles);
    else if (typeof source?.url === "string") tileJsonUrls.push(source.url);
  }
  return { tileJsonUrls, templates };
}

/** Both pixel densities of the sprite sheet — phones want the @2x one. */
export function spriteUrls(sprite: string | undefined): string[] {
  if (!sprite) return [];
  return [`${sprite}.json`, `${sprite}.png`, `${sprite}@2x.json`, `${sprite}@2x.png`];
}

/** Every distinct font stack the style's layers actually ask for. */
export function fontStacks(style: MapStyleDoc): string[] {
  const stacks = new Set<string>();
  for (const layer of style.layers ?? []) {
    const font = layer?.layout?.["text-font"];
    if (Array.isArray(font) && font.every((f) => typeof f === "string")) {
      stacks.add((font as string[]).join(","));
    }
  }
  return [...stacks];
}

/**
 * Glyph PBFs for the given font stacks. Only the Latin ranges: 0–255 covers
 * English and the accented characters in place names up the coast, 256–511
 * catches the rest of Latin Extended. The full Unicode range would be hundreds
 * of requests per font for characters this map will never draw.
 */
export const GLYPH_RANGES = ["0-255", "256-511"];

export function glyphUrls(
  glyphs: string | undefined,
  stacks: string[],
  ranges: string[] = GLYPH_RANGES,
): string[] {
  if (!glyphs) return [];
  const out: string[] = [];
  for (const stack of stacks) {
    for (const range of ranges) {
      out.push(
        glyphs
          .replace("{fontstack}", encodeURIComponent(stack))
          .replace("{range}", range),
      );
    }
  }
  return out;
}
