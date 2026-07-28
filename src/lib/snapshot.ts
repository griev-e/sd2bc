"use client";

/**
 * The offline snapshot — the last good load of the whole trip, kept on this
 * device so a dead zone shows the itinerary instead of a blank app.
 *
 * This used to live in localStorage as one JSON string, which quietly stopped
 * working as the trip filled in: a single day's drawn route serializes to
 * ~100–460 KB, so ten days of route geometry alone runs 2–4 MB — and browsers
 * measure the ~5 MB localStorage quota in UTF-16 code units, i.e. roughly
 * double the character count. The write was wrapped in a bare `catch {}`, so
 * blowing the quota looked exactly like success and the offline fallback was
 * silently stale (or missing) right when it mattered.
 *
 * So: IndexedDB is the store of record. It holds structured values (no
 * stringify pass), its budget is orders of magnitude larger, and its failures
 * are observable. localStorage stays as a fallback for browsers that won't give
 * us IndexedDB (Safari private mode, mostly) — but only for a LEAN snapshot
 * with route geometry stripped, which is the part that never fit.
 *
 * {@link getSnapshotStatus} exposes where the snapshot actually landed so the
 * More tab can say so out loud rather than let the traveler assume.
 */

import type {
  Day,
  DayRoute,
  GameEvent,
  PackingItem,
  Profile,
  Stop,
  Trip,
  TripAnalysis,
  ViaPoint,
} from "./types";

export interface Snapshot {
  profiles: Profile[];
  trip: Trip | null;
  days: Day[];
  stops: Stop[];
  viaPoints: ViaPoint[];
  packing: PackingItem[];
  gameEvents: GameEvent[];
  analyses: TripAnalysis[];
  routes: Record<string, DayRoute>;
}

/** Where the last save actually landed. */
export type SnapshotStore = "idb" | "local" | "none";

export interface SnapshotStatus {
  store: SnapshotStore;
  /** epoch ms of the last successful save, or null if none has landed. */
  savedAt: number | null;
  /** Set when the last save failed outright — nothing is cached offline. */
  error: string | null;
}

const DB_NAME = "coastline";
const STORE_NAME = "kv";
const RECORD_KEY = "snapshot-v1";
/** The pre-IndexedDB home. Read once for the handoff, then retired. */
const LEGACY_KEY = "coastline-snapshot-v1";
/** IndexedDB can hang indefinitely in some privacy modes — never block on it. */
const IDB_TIMEOUT_MS = 4000;

/* ---- status (device-local, useSyncExternalStore shape — mirrors theme.ts) -- */

let status: SnapshotStatus = { store: "none", savedAt: null, error: null };
const listeners = new Set<() => void>();

export function snapshotSubscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getSnapshotStatus(): SnapshotStatus {
  return status;
}

export function serverSnapshotStatus(): SnapshotStatus {
  return { store: "none", savedAt: null, error: null };
}

function setStatus(next: SnapshotStatus) {
  // Replace the object only on a real change: useSyncExternalStore compares by
  // reference and would loop forever on a fresh object every read.
  if (
    next.store === status.store &&
    next.savedAt === status.savedAt &&
    next.error === status.error
  ) {
    return;
  }
  status = next;
  for (const l of listeners) l();
}

/* ---- shaping ------------------------------------------------------------- */

/**
 * The snapshot minus the one field that doesn't fit: each day's drawn route
 * polyline. Distances, drive times and stop-to-stop segments survive, so the
 * itinerary, ETAs and budget all still read correctly offline — only the lines
 * on the map are missing, and those redraw from `route_cache` the moment
 * there's signal.
 */
export function leanSnapshot(snap: Snapshot): Snapshot {
  const routes: Record<string, DayRoute> = {};
  for (const [dayId, route] of Object.entries(snap.routes)) {
    routes[dayId] = { ...route, coordinates: [] };
  }
  return { ...snap, routes };
}

/** Accept only something that actually looks like a trip we can render. */
export function normalizeSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Snapshot>;
  if (!Array.isArray(s.days) || !Array.isArray(s.stops)) return null;
  return {
    profiles: Array.isArray(s.profiles) ? s.profiles : [],
    trip: s.trip ?? null,
    days: s.days,
    stops: s.stops,
    viaPoints: Array.isArray(s.viaPoints) ? s.viaPoints : [],
    packing: Array.isArray(s.packing) ? s.packing : [],
    gameEvents: Array.isArray(s.gameEvents) ? s.gameEvents : [],
    // snapshots written before a field shipped simply don't have it
    analyses: Array.isArray(s.analyses) ? s.analyses : [],
    routes: s.routes && typeof s.routes === "object" ? s.routes : {},
  };
}

/* ---- IndexedDB ----------------------------------------------------------- */

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), ms);
    work.then(finish, () => finish(fallback));
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  const attempt = withTimeout(
    new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === "undefined") return resolve(null);
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch {
        return resolve(null); // SecurityError in some privacy modes
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    }),
    IDB_TIMEOUT_MS,
    null,
  );
  // A failed open must not poison every later attempt — forget it so the next
  // save can try again (the browser may simply have been busy).
  dbPromise = attempt.then((db) => {
    if (!db) dbPromise = null;
    return db;
  });
  return dbPromise;
}

function idbGet(db: IDBDatabase): Promise<unknown> {
  return withTimeout(
    new Promise<unknown>((resolve) => {
      try {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(RECORD_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    }),
    IDB_TIMEOUT_MS,
    null,
  );
}

function idbPut(db: IDBDatabase, value: Snapshot): Promise<boolean> {
  return withTimeout(
    new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, RECORD_KEY);
        tx.oncomplete = () => resolve(true);
        // QuotaExceededError lands here rather than throwing synchronously
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    }),
    IDB_TIMEOUT_MS,
    false,
  );
}

function idbDelete(db: IDBDatabase): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(RECORD_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    }),
    IDB_TIMEOUT_MS,
    undefined,
  );
}

/* ---- localStorage fallback ----------------------------------------------- */

function readLocal(): unknown {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(snap: Snapshot): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(snap));
    return true;
  } catch {
    // Out of quota even for the lean copy — drop the stale one rather than
    // leave a snapshot from three days ago pretending to be current.
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* nothing left to try */
    }
    return false;
  }
}

function clearLocal() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

/* ---- public API ---------------------------------------------------------- */

/**
 * The last good load, or null. Reads IndexedDB first and falls back to the
 * legacy localStorage copy — which is also the upgrade path for a phone that
 * hasn't saved through the new store yet.
 */
export async function loadSnapshot(): Promise<Snapshot | null> {
  const db = await openDb();
  if (db) {
    const snap = normalizeSnapshot(await idbGet(db));
    if (snap) return snap;
  }
  return normalizeSnapshot(readLocal());
}

/**
 * Persist the snapshot, and report where it landed. IndexedDB first; a lean
 * copy in localStorage only when IndexedDB isn't available at all.
 */
export async function saveSnapshot(snap: Snapshot): Promise<SnapshotStore> {
  const db = await openDb();
  if (db && (await idbPut(db, snap))) {
    // IndexedDB now holds the whole thing — retire the cramped legacy copy so
    // the two can't disagree, and so it stops eating the localStorage budget.
    clearLocal();
    setStatus({ store: "idb", savedAt: Date.now(), error: null });
    return "idb";
  }
  if (writeLocal(leanSnapshot(snap))) {
    setStatus({ store: "local", savedAt: Date.now(), error: null });
    return "local";
  }
  setStatus({
    store: "none",
    savedAt: status.savedAt,
    error: "This phone won't store the trip for offline use.",
  });
  return "none";
}

/** Forget the device's copy entirely (sign-out). */
export async function clearSnapshot(): Promise<void> {
  clearLocal();
  const db = await openDb();
  if (db) await idbDelete(db);
  setStatus({ store: "none", savedAt: null, error: null });
}

/** Test seam — drops the memoized connection so each test opens fresh. */
export function resetSnapshotForTests() {
  dbPromise = null;
  status = { store: "none", savedAt: null, error: null };
  listeners.clear();
}
