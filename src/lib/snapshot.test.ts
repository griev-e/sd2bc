import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSnapshot,
  getSnapshotStatus,
  leanSnapshot,
  loadSnapshot,
  normalizeSnapshot,
  resetSnapshotForTests,
  saveSnapshot,
  type Snapshot,
} from "./snapshot";
import type { Day, DayRoute, Stop } from "./types";

const LEGACY_KEY = "coastline-snapshot-v1";

// vitest runs in a node environment with no web storage — stub minimal ones.
class MemStorage {
  store = new Map<string, string>();
  /** Set to reject every write, the way a full quota does. */
  full = false;
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.full) throw new Error("QuotaExceededError");
    this.store.set(k, String(v));
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
}

/**
 * A just-enough IndexedDB: async request/transaction events on a real timer,
 * which is the part the production code actually has to get right.
 */
function fakeIndexedDB(opts: { failWrites?: boolean } = {}) {
  const data = new Map<string, unknown>();
  const storeNames = new Set<string>();

  const objectStore = () => ({
    get(key: string) {
      const req: Record<string, unknown> = {};
      setTimeout(() => {
        req.result = data.get(key);
        (req.onsuccess as (() => void) | undefined)?.();
      }, 0);
      return req;
    },
    put(value: unknown, key: string) {
      if (!opts.failWrites) data.set(key, value);
    },
    delete(key: string) {
      data.delete(key);
    },
  });

  const db = {
    objectStoreNames: { contains: (n: string) => storeNames.has(n) },
    createObjectStore: (n: string) => storeNames.add(n),
    transaction: () => {
      const tx: Record<string, unknown> = { objectStore };
      setTimeout(() => {
        if (opts.failWrites) (tx.onerror as (() => void) | undefined)?.();
        else (tx.oncomplete as (() => void) | undefined)?.();
      }, 0);
      return tx;
    },
  };

  return {
    api: {
      open: () => {
        const req: Record<string, unknown> = { result: db };
        setTimeout(() => {
          if (storeNames.size === 0) (req.onupgradeneeded as (() => void) | undefined)?.();
          (req.onsuccess as (() => void) | undefined)?.();
        }, 0);
        return req;
      },
    },
    data,
  };
}

function makeDay(id: string, seq: number): Day {
  return {
    id,
    trip_id: "trip-1",
    seq,
    date: "2026-07-27",
    title: "",
    notes: "",
    emoji: null,
    start_time: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeStop(id: string, dayId: string): Stop {
  return {
    id,
    trip_id: "trip-1",
    day_id: dayId,
    seq: 1,
    name: id,
    lat: 32.7,
    lng: -117.2,
    kind: "stop",
    is_overnight: false,
    notes: "",
    address: null,
    lodging_url: null,
    lodging_free: false,
    lodging_cost: null,
    start_time: null,
    duration_min: null,
    created_by: null,
    updated_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const ROUTE: DayRoute = {
  dayId: "d1",
  coordinates: [
    [-117.2, 32.7],
    [-117.3, 32.8],
    [-117.4, 32.9],
  ],
  segments: [{ fromStopId: "s1", toStopId: "s2", distanceM: 1000, durationS: 60 }],
  distanceM: 1000,
  durationS: 60,
};

function makeSnapshot(): Snapshot {
  return {
    profiles: [],
    trip: null,
    days: [makeDay("d1", 1)],
    stops: [makeStop("s1", "d1"), makeStop("s2", "d1")],
    viaPoints: [],
    packing: [],
    gameEvents: [],
    analyses: [],
    routes: { d1: ROUTE },
  };
}

let storage: MemStorage;

beforeEach(() => {
  resetSnapshotForTests();
  storage = new MemStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("leanSnapshot", () => {
  it("drops route geometry but keeps the numbers the app reads", () => {
    const lean = leanSnapshot(makeSnapshot());
    expect(lean.routes.d1.coordinates).toEqual([]);
    // distances, drive times and segments are what the itinerary and budget
    // actually read — those must survive the trim
    expect(lean.routes.d1.distanceM).toBe(1000);
    expect(lean.routes.d1.durationS).toBe(60);
    expect(lean.routes.d1.segments).toHaveLength(1);
    expect(lean.stops).toHaveLength(2);
  });

  it("does not mutate the original", () => {
    const snap = makeSnapshot();
    leanSnapshot(snap);
    expect(snap.routes.d1.coordinates).toHaveLength(3);
  });
});

describe("normalizeSnapshot", () => {
  it("rejects anything that isn't a trip", () => {
    expect(normalizeSnapshot(null)).toBeNull();
    expect(normalizeSnapshot("nope")).toBeNull();
    expect(normalizeSnapshot({})).toBeNull();
    expect(normalizeSnapshot({ days: [] })).toBeNull(); // no stops array
  });

  it("fills in fields added after a snapshot was written", () => {
    const snap = normalizeSnapshot({ days: [], stops: [] });
    expect(snap).not.toBeNull();
    expect(snap!.analyses).toEqual([]);
    expect(snap!.gameEvents).toEqual([]);
    expect(snap!.routes).toEqual({});
    expect(snap!.trip).toBeNull();
  });
});

describe("saveSnapshot / loadSnapshot with IndexedDB", () => {
  it("stores the FULL snapshot, geometry included", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB().api);

    expect(await saveSnapshot(makeSnapshot())).toBe("idb");
    expect(getSnapshotStatus().store).toBe("idb");
    expect(getSnapshotStatus().error).toBeNull();
    expect(getSnapshotStatus().savedAt).toBeGreaterThan(0);

    const loaded = await loadSnapshot();
    // the whole point of the move: route lines survive, so the map still draws
    expect(loaded!.routes.d1.coordinates).toHaveLength(3);
    expect(loaded!.days).toHaveLength(1);
  });

  it("retires the legacy localStorage copy once IndexedDB has it", async () => {
    storage.setItem(LEGACY_KEY, JSON.stringify(makeSnapshot()));
    vi.stubGlobal("indexedDB", fakeIndexedDB().api);

    await saveSnapshot(makeSnapshot());
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("reads the legacy localStorage copy when IndexedDB is empty", async () => {
    storage.setItem(LEGACY_KEY, JSON.stringify(makeSnapshot()));
    vi.stubGlobal("indexedDB", fakeIndexedDB().api);

    const loaded = await loadSnapshot();
    expect(loaded!.days).toHaveLength(1);
  });

  it("falls back to a lean localStorage copy when IndexedDB writes fail", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB({ failWrites: true }).api);

    expect(await saveSnapshot(makeSnapshot())).toBe("local");
    expect(getSnapshotStatus().store).toBe("local");
    const stored = JSON.parse(storage.getItem(LEGACY_KEY)!) as Snapshot;
    expect(stored.routes.d1.coordinates).toEqual([]);
    expect(stored.routes.d1.distanceM).toBe(1000);
  });

  it("clears both stores on sign-out", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB().api);
    await saveSnapshot(makeSnapshot());

    await clearSnapshot();
    expect(await loadSnapshot()).toBeNull();
    expect(getSnapshotStatus().store).toBe("none");
    expect(getSnapshotStatus().savedAt).toBeNull();
  });
});

describe("saveSnapshot without IndexedDB", () => {
  // node has no `indexedDB`, so these exercise the private-mode path for real

  it("keeps a lean copy in localStorage", async () => {
    expect(await saveSnapshot(makeSnapshot())).toBe("local");
    const stored = JSON.parse(storage.getItem(LEGACY_KEY)!) as Snapshot;
    expect(stored.routes.d1.coordinates).toEqual([]);
    expect(stored.stops).toHaveLength(2);

    const loaded = await loadSnapshot();
    expect(loaded!.stops).toHaveLength(2);
  });

  it("reports the failure instead of swallowing it when the quota is gone", async () => {
    storage.full = true;

    expect(await saveSnapshot(makeSnapshot())).toBe("none");
    const st = getSnapshotStatus();
    expect(st.store).toBe("none");
    expect(st.error).toBeTruthy();
  });

  it("drops a stale copy rather than leave one pretending to be current", async () => {
    await saveSnapshot(makeSnapshot());
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();

    storage.full = true;
    await saveSnapshot(makeSnapshot());
    expect(storage.getItem(LEGACY_KEY)).toBeNull();
  });
});
