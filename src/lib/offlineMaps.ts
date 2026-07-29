"use client";

/**
 * "Download maps for this trip" — the other half of offline.
 *
 * The store already keeps the itinerary on the device, and the service worker
 * keeps the app shell openable, but the MAP behind them is fetched live. Big
 * Sur, the far Oregon coast and the run north of Vancouver are exactly where
 * there's no signal and exactly where you want to see the road.
 *
 * This walks the computed route, works out which tiles it touches
 * (lib/tiles.ts), and fetches them so the service worker's map cache picks them
 * up. Fetching through the SW rather than messaging it a list is deliberate:
 * cache-first means an already-stored tile costs nothing, so re-running this
 * resumes instead of re-downloading.
 *
 * Free-service etiquette, since OpenFreeMap asks for nothing in return:
 *  - explicit tap only, never automatic
 *  - a hard tile cap (see MAX_TILES) with coarse zooms kept first
 *  - small fixed concurrency, the same discipline the OSRM pool uses
 *  - anything already cached is skipped entirely
 */

import { create } from "zustand";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "./config";
import type { LngLat } from "./geo";
import {
  fontStacks,
  glyphUrls,
  planTiles,
  spriteUrls,
  tileSourceRefs,
  tileUrl,
  type MapStyleDoc,
} from "./tiles";

/** Polite parallelism — enough to finish on cell data, not a thundering herd. */
const CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 20_000;

export type DownloadPhase = "idle" | "planning" | "downloading" | "done" | "error";

interface OfflineMapsState {
  phase: DownloadPhase;
  done: number;
  total: number;
  /** Requests that came back unusable — a few is normal, all of them isn't. */
  failed: number;
  error: string | null;
  /** True when the tile cap clipped coverage at the sharpest zooms. */
  truncated: boolean;
  /** Bytes the whole origin is using, from the Storage API when it'll say. */
  usageBytes: number | null;
  quotaBytes: number | null;

  download: (lines: LngLat[][]) => Promise<void>;
  cancel: () => void;
  clear: () => Promise<void>;
  refreshUsage: () => Promise<void>;
}

let abort: AbortController | null = null;

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Every non-tile URL a style needs to render offline: the style document
 * itself, its TileJSON, the sprite sheet, and glyph ranges for its fonts.
 * Also hands back the tile templates the download will walk.
 */
async function resolveStyle(styleUrl: string): Promise<{
  assets: string[];
  templates: string[];
}> {
  const style = (await fetchJson(styleUrl)) as MapStyleDoc | null;
  if (!style) return { assets: [], templates: [] };

  const { tileJsonUrls, templates } = tileSourceRefs(style);
  const assets = [styleUrl, ...tileJsonUrls, ...spriteUrls(style.sprite)];
  assets.push(...glyphUrls(style.glyphs, fontStacks(style)));

  // A TileJSON doc holds the real {z}/{x}/{y} template for its source.
  for (const url of tileJsonUrls) {
    const doc = (await fetchJson(url)) as { tiles?: string[] } | null;
    if (Array.isArray(doc?.tiles)) templates.push(...doc.tiles);
  }

  return { assets, templates: [...new Set(templates)] };
}

/**
 * The cancel signal plus a per-request deadline. Without the deadline a single
 * stalled tile (mobile network handoff mid-download) holds one of six pool
 * slots until the browser gives up on its own, and the progress bar just stops.
 * `AbortSignal.any` is Safari 17.4+; older browsers keep the cancel button and
 * lose only the per-request timeout.
 */
function requestSignal(cancel: AbortSignal): AbortSignal {
  return typeof AbortSignal.any === "function"
    ? AbortSignal.any([cancel, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    : cancel;
}

/** Run `work` over `items` with a small fixed pool, stopping on abort. */
async function pool<T>(
  items: T[],
  concurrency: number,
  signal: AbortSignal,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length && !signal.aborted) {
      const item = items[cursor++];
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export const useOfflineMaps = create<OfflineMapsState>((set, get) => ({
  phase: "idle",
  done: 0,
  total: 0,
  failed: 0,
  error: null,
  truncated: false,
  usageBytes: null,
  quotaBytes: null,

  refreshUsage: async () => {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      set({ usageBytes: usage ?? null, quotaBytes: quota ?? null });
    } catch {
      // Firefox in some modes refuses — the card just won't show a size
    }
  },

  cancel: () => {
    abort?.abort();
    abort = null;
    set({ phase: "idle", done: 0, total: 0 });
  },

  clear: async () => {
    try {
      await caches.delete("coastline-map-v1");
    } catch {
      // nothing cached, or no Cache API — either way there's nothing to clear
    }
    set({ phase: "idle", done: 0, total: 0, failed: 0, truncated: false, error: null });
    await get().refreshUsage();
  },

  download: async (lines) => {
    if (get().phase === "planning" || get().phase === "downloading") return;

    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      set({ phase: "error", error: "This browser can't store maps offline." });
      return;
    }
    // Without a controlling worker nothing intercepts these fetches, so they'd
    // warm the HTTP cache at best and be evicted by morning. Say so plainly.
    if (!navigator.serviceWorker.controller) {
      set({
        phase: "error",
        error: "Close and reopen the app once, then try again.",
      });
      return;
    }
    if (lines.length === 0) {
      set({ phase: "error", error: "No route to download yet — add stops first." });
      return;
    }

    abort = new AbortController();
    const { signal } = abort;
    set({ phase: "planning", done: 0, total: 0, failed: 0, error: null, truncated: false });

    // Both themes, so a switch to dark in a dead zone isn't a blank screen.
    // They share one tile source, so this costs two small style docs.
    const styles = await Promise.all([resolveStyle(MAP_STYLE_LIGHT), resolveStyle(MAP_STYLE_DARK)]);
    if (signal.aborted) return;

    const assets = [...new Set(styles.flatMap((s) => s.assets))];
    const templates = [...new Set(styles.flatMap((s) => s.templates))];
    if (templates.length === 0) {
      set({ phase: "error", error: "Couldn't read the map style — try again with a signal." });
      return;
    }

    const plan = planTiles(lines);
    const urls = [...assets, ...plan.tiles.flatMap((t) => templates.map((tpl) => tileUrl(tpl, t)))];

    set({ phase: "downloading", total: urls.length, truncated: plan.truncated });

    let done = 0;
    let failed = 0;
    await pool(urls, CONCURRENCY, signal, async (url) => {
      try {
        // The SW answers from cache when it has it, so this is close to free
        // on a re-run. `signal` lets Cancel actually stop the queue.
        const res = await fetch(url, { signal: requestSignal(signal) });
        if (!res.ok) failed++;
      } catch {
        if (!signal.aborted) failed++;
      }
      done++;
      // repaint every so often rather than 6× a second for thousands of tiles
      if (done % 25 === 0 || done === urls.length) set({ done, failed });
    });

    if (signal.aborted) return;
    abort = null;

    // Everything failing means no signal, not a finished download — saying
    // "ready for the road" then would be a lie the traveler finds out in a canyon.
    if (failed >= urls.length) {
      set({
        phase: "error",
        done,
        failed,
        error: "Couldn't reach the map service — try again with a better signal.",
      });
      return;
    }

    set({ phase: "done", done, failed });
    await get().refreshUsage();
  },
}));
