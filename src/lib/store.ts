"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { supabase } from "./supabase";
import { localDateISO } from "./format";
import { fetchRoute, primeRouteCache } from "./osrm";
import {
  enqueueOutbox,
  flushOutbox,
  isNetworkError,
  outboxSize,
  type OutboxOp,
} from "./outbox";
import type { LngLat } from "./geo";
import type {
  ActivityEntry,
  AnalysisInsight,
  Day,
  DayRoute,
  GameEvent,
  PackingItem,
  Profile,
  RouteSegment,
  Stop,
  Trip,
  TripAnalysis,
  ViaPoint,
} from "./types";

type Tables =
  | "days"
  | "stops"
  | "via_points"
  | "packing_items"
  | "trips"
  | "game_events"
  | "profiles"
  | "trip_analyses";

interface TripState {
  loaded: boolean;
  /** Set when the initial load failed and no offline snapshot could cover it. */
  loadError: string | null;
  userId: string | null;
  profiles: Profile[];
  trip: Trip | null;
  days: Day[];
  stops: Stop[];
  viaPoints: ViaPoint[];
  packing: PackingItem[];
  activity: ActivityEntry[];
  gameEvents: GameEvent[];
  analyses: TripAnalysis[];

  routes: Record<string, DayRoute>;
  routesPending: boolean;
  routeError: string | null;

  /** One-line status for the last write that failed or was queued offline. */
  toast: { id: number; text: string; kind: "offline" | "error" } | null;

  // UI state shared between tabs
  selectedDayId: string | null;
  selectedStopId: string | null;

  init: (userId: string) => Promise<void>;
  teardown: () => void;

  /** Debounced route recompute — for callers outside the store (e.g. shaping). */
  refreshRoutes: () => void;
  /** Full refetch + reconcile — for callers that bypassed the mutations (shaping). */
  resync: () => Promise<void>;
  dismissToast: () => void;

  setSelectedDay: (dayId: string | null) => void;
  setSelectedStop: (stopId: string | null) => void;

  // stops
  addStop: (
    dayId: string,
    stop: { name: string; lat: number; lng: number; kind?: Stop["kind"]; notes?: string },
  ) => Promise<void>;
  updateStop: (id: string, patch: Partial<Stop>) => Promise<void>;
  deleteStop: (id: string) => Promise<void>;
  reorderStops: (dayId: string, orderedIds: string[]) => Promise<void>;

  // via (shaping) points
  addViaPoint: (afterStopId: string, lng: number, lat: number, seq: number) => Promise<void>;
  moveViaPoint: (id: string, lng: number, lat: number) => Promise<void>;
  deleteViaPoint: (id: string) => Promise<void>;

  // days
  updateDay: (id: string, patch: Partial<Day>) => Promise<void>;
  addDay: () => Promise<void>;
  deleteDay: (id: string) => Promise<void>;

  // trip settings
  updateTrip: (patch: Partial<Trip>) => Promise<void>;

  // profile (display name / photo)
  updateProfile: (patch: Partial<Pick<Profile, "display_name" | "avatar_url">>) => Promise<void>;

  // packing
  togglePacking: (id: string, checked: boolean) => Promise<void>;
  addPackingItem: (category: string, label: string, assigned_to: string | null) => Promise<void>;
  updatePackingItem: (id: string, patch: Partial<PackingItem>) => Promise<void>;
  deletePackingItem: (id: string) => Promise<void>;

  refreshActivity: () => Promise<void>;

  // AI trip analyzer cache
  saveAnalysis: (key: string, model: string, insights: AnalysisInsight[]) => Promise<void>;
  dismissInsight: (analysisId: string, insightId: string) => Promise<void>;

  // road games
  addGameEvent: (
    e: Pick<GameEvent, "game" | "kind"> & { key?: string | null; value?: Record<string, unknown> },
  ) => Promise<void>;
  deleteGameEvent: (id: string) => Promise<void>;
}

let channel: ReturnType<ReturnType<typeof supabase>["channel"]> | null = null;
// One shared init run — concurrent callers (StrictMode's double effect, a
// double-tapped retry) must not each fetch and race to build the channel.
let initPromise: Promise<void> | null = null;
let routeTimer: ReturnType<typeof setTimeout> | null = null;
let routeRun = 0;
// Realtime never replays missed events, so a dropped channel (backgrounded
// PWA, dead zone) means a full refetch on the next successful subscribe.
let channelWasDown = false;
let lastRefetchAt = 0;
let authSub: { unsubscribe: () => void } | null = null;
let visHandler: (() => void) | null = null;
let onlineHandler: (() => void) | null = null;
// Writes currently in flight — refetchAll waits for these so a full re-pull
// can't stomp state an optimistic write is about to confirm.
let pendingWrites = 0;
let toastSeq = 0;

/** Days in itinerary order (by seq). */
export function sortDays(days: Day[]): Day[] {
  return [...days].sort((a, b) => a.seq - b.seq);
}

/** Memoized `sortDays` over the live store — the app's most-repeated derive. */
export function useOrderedDays(): Day[] {
  const days = useTrip((s) => s.days);
  return useMemo(() => sortDays(days), [days]);
}

/** 'YYYY-MM-DD' + n days, timezone-proof. */
export function shiftDate(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  // format from local parts — toISOString() converts to UTC, which walks the
  // date back a day for devices at UTC+13/+14 even from a noon anchor
  return localDateISO(d);
}
function sortStops(stops: Stop[]): Stop[] {
  return [...stops].sort((a, b) => a.seq - b.seq);
}

/** Next seq for a new stop in a day: max(existing) + 1, never count + 1 — deletions leave gaps. */
export function nextStopSeq(stops: Stop[], dayId: string): number {
  return stops.reduce((m, x) => (x.day_id === dayId && x.seq > m ? x.seq : m), 0) + 1;
}

// Fields that feed dayRoutePoints() per table — only changes to these can
// move the drawn route, so anything else (notes, titles, overnight flags…)
// shouldn't kick off a recompute or flash the "routing…" pill.
const ROUTE_FIELDS: Partial<Record<Tables, string[]>> = {
  stops: ["day_id", "seq", "lat", "lng"],
  days: ["seq"],
  via_points: ["after_stop_id", "seq", "lat", "lng"],
};

/**
 * Does this Realtime event actually change route geometry? Our own writes
 * echo back from the channel with values identical to the optimistic local
 * state, so comparing against the existing row also swallows the redundant
 * recompute after every local mutation.
 */
export function routeGeometryChanged(
  table: Tables,
  evt: "INSERT" | "UPDATE" | "DELETE",
  row: Record<string, unknown>,
  list: { id: string }[],
): boolean {
  const fields = ROUTE_FIELDS[table];
  if (!fields) return false;
  const existing = list.find((r) => r.id === row.id) as
    | Record<string, unknown>
    | undefined;
  // DELETE payloads carry only the primary key — it matters iff we still
  // hold the row (i.e. this wasn't already applied optimistically).
  if (evt === "DELETE") return existing !== undefined;
  if (!existing) return true;
  return fields.some((f) => f in row && row[f] !== existing[f]);
}

/**
 * Offline snapshot: the last good load, persisted per device. When the trip
 * is opened in a dead zone the itinerary still shows (read-only in effect —
 * writes fail and roll back). Routes ride along so distances/ETAs survive.
 */
const SNAPSHOT_KEY = "coastline-snapshot-v1";
type Snapshot = Pick<
  TripState,
  | "profiles"
  | "trip"
  | "days"
  | "stops"
  | "viaPoints"
  | "packing"
  | "gameEvents"
  | "analyses"
  | "routes"
>;

function loadSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    if (!Array.isArray(snap.days) || !Array.isArray(snap.stops)) return null;
    // snapshots written before the analyzer shipped have no analyses field
    snap.analyses = Array.isArray(snap.analyses) ? snap.analyses : [];
    return snap;
  } catch {
    return null;
  }
}

/** Ordered point list for one day's route; null stopId = shaping point. */
export interface RoutePoint {
  lngLat: LngLat;
  stopId: string | null;
  viaId: string | null;
}

export function dayRoutePoints(
  day: Day,
  prevDay: Day | null,
  stops: Stop[],
  vias: ViaPoint[],
): RoutePoint[] {
  const viasByStop = new Map<string, ViaPoint[]>();
  for (const v of vias) {
    const list = viasByStop.get(v.after_stop_id);
    if (list) list.push(v);
    else viasByStop.set(v.after_stop_id, [v]);
  }
  const viasFor = (stopId: string): RoutePoint[] =>
    (viasByStop.get(stopId) ?? [])
      .sort((a, b) => a.seq - b.seq)
      .map((v) => ({ lngLat: [v.lng, v.lat] as LngLat, stopId: null, viaId: v.id }));

  const points: RoutePoint[] = [];
  const dayStops = sortStops(stops.filter((s) => s.day_id === day.id));

  if (prevDay) {
    const prevStops = sortStops(stops.filter((s) => s.day_id === prevDay.id));
    const last = prevStops[prevStops.length - 1];
    if (last) {
      points.push({ lngLat: [last.lng, last.lat], stopId: last.id, viaId: null });
      points.push(...viasFor(last.id));
    }
  }

  dayStops.forEach((s, i) => {
    points.push({ lngLat: [s.lng, s.lat], stopId: s.id, viaId: null });
    if (i < dayStops.length - 1) points.push(...viasFor(s.id));
  });

  return points;
}

export const useTrip = create<TripState>((set, get) => {
  function scheduleRoutes(delay = 500) {
    if (routeTimer) clearTimeout(routeTimer);
    routeTimer = setTimeout(() => void computeRoutes(), delay);
  }

  function showToast(text: string, kind: "offline" | "error") {
    set({ toast: { id: ++toastSeq, text, kind } });
  }

  /**
   * Run one persistence call. Every mutation goes through here so that
   * (a) refetchAll can wait for in-flight writes, and (b) a failure caused by
   * a dead connection — not a server rejection — keeps the optimistic state
   * and parks the op in the offline outbox instead of rolling back. Callers
   * roll back ONLY on "error".
   */
  async function runWrite(
    exec: () => PromiseLike<{ error: { message?: string } | null }>,
    offline?: OutboxOp | OutboxOp[],
  ): Promise<"ok" | "queued" | "error"> {
    pendingWrites++;
    try {
      let error: unknown = null;
      try {
        ({ error } = await exec());
      } catch (err) {
        error = err; // storage/auth helpers can throw instead of returning
      }
      if (!error) return "ok";
      if (offline && isNetworkError(error)) {
        enqueueOutbox(offline);
        showToast("Offline — saved on this phone, will sync.", "offline");
        return "queued";
      }
      showToast("Couldn't save that change.", "error");
      return "error";
    } finally {
      pendingWrites--;
    }
  }

  /** Wait (bounded) for the write path to go quiet before a full re-pull. */
  async function waitForWrites(maxMs = 4000) {
    const start = Date.now();
    while (pendingWrites > 0 && Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  async function computeDayRoute(day: Day, prevDay: Day | null, stops: Stop[], vias: ViaPoint[]): Promise<DayRoute> {
    const points = dayRoutePoints(day, prevDay, stops, vias);
    if (points.length < 2) {
      return { dayId: day.id, coordinates: [], segments: [], distanceM: 0, durationS: 0 };
    }
    const route = await fetchRoute(points.map((p) => p.lngLat));

    // Fold via-point legs into stop→stop segments.
    const segments: RouteSegment[] = [];
    let fromStop = points[0].stopId!;
    let dist = 0;
    let dur = 0;
    for (let leg = 0; leg < route.legs.length; leg++) {
      dist += route.legs[leg].distance;
      dur += route.legs[leg].duration;
      const target = points[leg + 1];
      if (target.stopId) {
        segments.push({
          fromStopId: fromStop,
          toStopId: target.stopId,
          distanceM: dist,
          durationS: dur,
        });
        fromStop = target.stopId;
        dist = 0;
        dur = 0;
      }
    }
    return {
      dayId: day.id,
      coordinates: route.coordinates,
      segments,
      distanceM: route.distance,
      durationS: route.duration,
    };
  }

  // All days route concurrently (capped so a cold cache doesn't hammer the
  // public OSRM server); each day's line appears as soon as it resolves.
  async function computeRoutes() {
    const { days, stops, viaPoints } = get();
    const run = ++routeRun;
    const ordered = sortDays(days);
    set({ routesPending: true, routeError: null });

    // One batched Supabase read warms the shared route cache for every day at
    // once — on a cold app start this replaces a round trip per day.
    await primeRouteCache(
      ordered.map((day, i) =>
        dayRoutePoints(day, i > 0 ? ordered[i - 1] : null, stops, viaPoints).map(
          (p) => p.lngLat,
        ),
      ),
    );
    if (run !== routeRun) return; // superseded while priming

    const next: Record<string, DayRoute> = {};
    let firstError: unknown = null;
    let cursor = 0;

    const worker = async () => {
      while (cursor < ordered.length && run === routeRun) {
        const i = cursor++;
        const day = ordered[i];
        try {
          const route = await computeDayRoute(day, i > 0 ? ordered[i - 1] : null, stops, viaPoints);
          if (run !== routeRun) return; // superseded by a newer edit
          next[day.id] = route;
          set({ routes: { ...get().routes, [day.id]: route } });
        } catch (err) {
          firstError ??= err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, ordered.length) }, worker));

    if (run !== routeRun) return;
    if (firstError) {
      set({
        routesPending: false,
        routeError: firstError instanceof Error ? firstError.message : "Routing failed",
      });
    } else {
      set({ routes: next, routesPending: false });
    }
  }

  /** One full read of every shared table; throws if any query failed. */
  async function fetchAllRows(): Promise<Omit<Snapshot, "routes">> {
    const db = supabase();
    const [profiles, trips, days, stops, vias, packing, games, analyses] = await Promise.all([
      db.from("profiles").select("*"),
      db.from("trips").select("*").limit(1),
      db.from("days").select("*"),
      db.from("stops").select("*"),
      db.from("via_points").select("*"),
      db.from("packing_items").select("*"),
      // newest first + a cap — the table is append-only and would otherwise
      // grow every load forever; 1000 events is far beyond a summer of games
      db.from("game_events").select("*").order("created_at", { ascending: false }).limit(1000),
      db.from("trip_analyses").select("*").order("created_at", { ascending: true }),
    ]);
    const failed = [profiles, trips, days, stops, vias, packing, games, analyses].find(
      (r) => r.error,
    );
    if (failed?.error) throw new Error(failed.error.message);
    return {
      profiles: (profiles.data as Profile[]) ?? [],
      trip: ((trips.data as Trip[]) ?? [])[0] ?? null,
      days: (days.data as Day[]) ?? [],
      stops: (stops.data as Stop[]) ?? [],
      viaPoints: (vias.data as ViaPoint[]) ?? [],
      packing: (packing.data as PackingItem[]) ?? [],
      // back to ascending — consumers assume chronological order
      gameEvents: (((games.data as GameEvent[]) ?? [])).slice().reverse(),
      analyses: (analyses.data as TripAnalysis[]) ?? [],
    };
  }

  /**
   * Re-pull everything and reconcile — after a Realtime drop or a return to
   * the foreground, local state may have silently missed events.
   */
  async function refetchAll() {
    // let in-flight optimistic writes settle, then replay anything queued
    // while offline BEFORE reading, so the read reflects our own edits
    await waitForWrites();
    if (outboxSize() > 0) await flushOutbox(supabase());
    try {
      const rows = await fetchAllRows();
      lastRefetchAt = Date.now();
      set({ ...rows, loaded: true, loadError: null });
      scheduleRoutes();
    } catch {
      // still offline — keep local state; the next reconnect retries
    }
  }

  function applyChange(table: Tables, evt: "INSERT" | "UPDATE" | "DELETE", row: Record<string, unknown>) {
    const id = row.id as string;
    const upsert = <T extends { id: string }>(list: T[]): T[] => {
      const idx = list.findIndex((r) => r.id === id);
      if (evt === "DELETE") return idx === -1 ? list : list.filter((r) => r.id !== id);
      if (idx === -1) return [...list, row as unknown as T];
      const copy = [...list];
      copy[idx] = { ...copy[idx], ...(row as unknown as T) };
      return copy;
    };

    const s = get();
    switch (table) {
      case "days":
        if (routeGeometryChanged(table, evt, row, s.days)) scheduleRoutes();
        set({ days: upsert(s.days) });
        break;
      case "stops":
        if (routeGeometryChanged(table, evt, row, s.stops)) scheduleRoutes();
        set({ stops: upsert(s.stops) });
        break;
      case "via_points":
        if (routeGeometryChanged(table, evt, row, s.viaPoints)) scheduleRoutes();
        set({ viaPoints: upsert(s.viaPoints) });
        break;
      case "packing_items":
        set({ packing: upsert(s.packing) });
        break;
      case "game_events":
        set({ gameEvents: upsert(s.gameEvents) });
        break;
      case "trip_analyses":
        set({ analyses: upsert(s.analyses) });
        break;
      case "profiles":
        set({ profiles: upsert(s.profiles) });
        break;
      case "trips":
        if (evt !== "DELETE") set({ trip: { ...(s.trip ?? {}), ...row } as Trip });
        break;
    }
  }

  return {
    loaded: false,
    loadError: null,
    userId: null,
    profiles: [],
    trip: null,
    days: [],
    stops: [],
    viaPoints: [],
    packing: [],
    activity: [],
    gameEvents: [],
    analyses: [],
    routes: {},
    routesPending: false,
    routeError: null,
    toast: null,
    selectedDayId: null,
    selectedStopId: null,

    init: (userId) => {
      if (get().loaded && get().userId === userId) return Promise.resolve();
      // Re-entrant calls (StrictMode's double effect, a double-tapped retry)
      // join the run already in flight — racing two would double the initial
      // fetch and leak a second Realtime channel with duplicate listeners.
      if (initPromise) return initPromise;

      const run = (async () => {
        const db = supabase();
        set({ userId, loadError: null });

        try {
          const rows = await fetchAllRows();
          if (get().userId !== userId) return; // signed out while loading
          lastRefetchAt = Date.now();
          set({ ...rows, loaded: true });
          scheduleRoutes(50);
          // edits queued while the app was last offline: replay, then re-pull
          if (outboxSize() > 0) void refetchAll();
        } catch (err) {
          if (get().userId !== userId) return;
          // Dead zone / flaky cell data: serve the last good load from this
          // device instead of a blank app. The first reconnect refetches.
          const snap = typeof window !== "undefined" ? loadSnapshot() : null;
          if (snap) {
            channelWasDown = true;
            set({ ...snap, loaded: true });
          } else {
            set({ loadError: err instanceof Error ? err.message : "Couldn't load the trip" });
            return;
          }
        }

        if (channel) return;
        // Claim the slot before any await so nothing else can build a second
        // channel while this one is still attaching auth.
        const ch = db.channel("coastline-sync");
        channel = ch;

        // Realtime checks RLS with the subscriber's JWT — attach it explicitly
        // so postgres_changes events aren't silently filtered out.
        const { data: sessionData } = await db.auth.getSession();
        if (sessionData.session) {
          await db.realtime.setAuth(sessionData.session.access_token);
        }
        if (channel !== ch) return; // torn down while auth was being attached

        // …and keep it fresh: the JWT rotates hourly, and a stale token makes
        // the socket silently drop events after expiry.
        authSub = db.auth.onAuthStateChange((evt, session) => {
          if (evt === "TOKEN_REFRESHED" && session) {
            void db.realtime.setAuth(session.access_token);
          }
        }).data.subscription;

        const tables: Tables[] = [
          "trips",
          "days",
          "stops",
          "via_points",
          "packing_items",
          "game_events",
          "profiles",
          "trip_analyses",
        ];
        for (const table of tables) {
          ch.on(
            "postgres_changes",
            { event: "*", schema: "public", table },
            (payload) => {
              const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<string, unknown>;
              applyChange(table, payload.eventType as "INSERT" | "UPDATE" | "DELETE", row);
            },
          );
        }
        ch.subscribe((status) => {
          // teardown's removeChannel reports CLOSED asynchronously — a stale
          // channel's status must not mark the *next* session's channel down
          if (channel !== ch) return;
          if (status === "SUBSCRIBED") {
            if (channelWasDown) {
              channelWasDown = false;
              void refetchAll();
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            channelWasDown = true;
          }
        });

        // iOS suspends the websocket when the PWA is backgrounded and never
        // replays what was missed — re-sync when the app comes back forward.
        visHandler = () => {
          if (
            document.visibilityState === "visible" &&
            get().loaded &&
            Date.now() - lastRefetchAt > 30_000
          ) {
            void refetchAll();
          }
        };
        document.addEventListener("visibilitychange", visHandler);

        // back online → flush the outbox and reconcile right away
        onlineHandler = () => {
          if (get().loaded) void refetchAll();
        };
        window.addEventListener("online", onlineHandler);
      })();

      initPromise = run.finally(() => {
        initPromise = null;
      });
      return initPromise;
    },

    teardown: () => {
      // an init still in flight will notice the cleared userId and bail; the
      // next sign-in must start its own run, not join the doomed one
      initPromise = null;
      if (channel) {
        supabase().removeChannel(channel);
        channel = null;
      }
      if (authSub) {
        authSub.unsubscribe();
        authSub = null;
      }
      if (visHandler) {
        document.removeEventListener("visibilitychange", visHandler);
        visHandler = null;
      }
      if (onlineHandler) {
        window.removeEventListener("online", onlineHandler);
        onlineHandler = null;
      }
      channelWasDown = false;
      // invalidate any in-flight route batch and pending debounce
      routeRun++;
      if (routeTimer) {
        clearTimeout(routeTimer);
        routeTimer = null;
      }
      // drop all entity state so nothing from this session flashes for the
      // next sign-in
      set({
        loaded: false,
        loadError: null,
        userId: null,
        profiles: [],
        trip: null,
        days: [],
        stops: [],
        viaPoints: [],
        packing: [],
        activity: [],
        gameEvents: [],
        analyses: [],
        routes: {},
        routesPending: false,
        routeError: null,
        toast: null,
        selectedDayId: null,
        selectedStopId: null,
      });
    },

    refreshRoutes: () => scheduleRoutes(),
    resync: () => refetchAll(),
    dismissToast: () => set({ toast: null }),

    setSelectedDay: (dayId) => set({ selectedDayId: dayId }),
    setSelectedStop: (stopId) => set({ selectedStopId: stopId }),

    addStop: async (dayId, stop) => {
      const s = get();
      if (!s.trip) return;
      const nextSeq = nextStopSeq(s.stops, dayId);
      const now = new Date().toISOString();
      const row: Stop = {
        id: crypto.randomUUID(),
        trip_id: s.trip.id,
        day_id: dayId,
        seq: nextSeq,
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng,
        kind: stop.kind ?? "stop",
        is_overnight: false,
        notes: "",
        address: null,
        lodging_url: null,
        lodging_free: false,
        lodging_cost: null,
        start_time: null,
        duration_min: null,
        created_by: s.userId,
        updated_by: s.userId,
        created_at: now,
        updated_at: now,
      };
      set({ stops: [...s.stops, row] });
      scheduleRoutes();
      const payload = {
        id: row.id,
        trip_id: row.trip_id,
        day_id: row.day_id,
        seq: row.seq,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        kind: row.kind,
        notes: row.notes,
        created_by: s.userId,
        updated_by: s.userId,
      };
      const result = await runWrite(
        () => supabase().from("stops").insert(payload),
        { table: "stops", op: "insert", values: payload },
      );
      if (result === "error") {
        set({ stops: get().stops.filter((x) => x.id !== row.id) });
        scheduleRoutes();
      }
    },

    updateStop: async (id, patch) => {
      const s = get();
      const prev = s.stops.find((x) => x.id === id);
      set({
        stops: s.stops.map((x) =>
          x.id === id ? { ...x, ...patch, updated_by: s.userId } : x,
        ),
      });
      const geometry = ROUTE_FIELDS.stops!.some((f) => f in patch);
      if (geometry) scheduleRoutes();
      const values = { ...patch, updated_by: s.userId };
      const result = await runWrite(
        () => supabase().from("stops").update(values).eq("id", id),
        { table: "stops", op: "update", id, values },
      );
      if (result === "error" && prev) {
        // Roll back ONLY the fields this patch touched — a second edit to
        // other fields may have landed while this one was in flight.
        const revert = Object.fromEntries(
          Object.keys(patch).map((k) => [k, prev[k as keyof Stop]]),
        ) as Partial<Stop>;
        set({
          stops: get().stops.map((x) =>
            x.id === id ? { ...x, ...revert, updated_by: prev.updated_by } : x,
          ),
        });
        if (geometry) scheduleRoutes();
      }
    },

    deleteStop: async (id) => {
      const s = get();
      const prevStop = s.stops.find((x) => x.id === id);
      const prevVias = s.viaPoints.filter((v) => v.after_stop_id === id);
      set({
        stops: s.stops.filter((x) => x.id !== id),
        viaPoints: s.viaPoints.filter((v) => v.after_stop_id !== id),
        selectedStopId: s.selectedStopId === id ? null : s.selectedStopId,
      });
      scheduleRoutes();
      const result = await runWrite(
        () => supabase().from("stops").delete().eq("id", id),
        { table: "stops", op: "delete", id },
      );
      if (result === "error" && prevStop) {
        set({
          stops: [...get().stops, prevStop],
          viaPoints: [...get().viaPoints, ...prevVias],
        });
        scheduleRoutes();
      }
    },

    reorderStops: async (dayId, orderedIds) => {
      const s = get();
      const prevStops = s.stops;
      const seqById = new Map(orderedIds.map((id, i) => [id, i + 1]));
      const updated = s.stops.map((x) => {
        const seq = x.day_id === dayId ? seqById.get(x.id) : undefined;
        return seq !== undefined ? { ...x, seq } : x;
      });
      set({ stops: updated });
      scheduleRoutes();
      // One UPDATE per row, in parallel. A partial upsert can't renumber
      // here: Postgres constraint-checks the INSERT tuple *before* taking
      // the ON CONFLICT UPDATE path, so rows missing NOT NULL columns
      // (trip_id, name, lat…) are rejected even though every row exists.
      const results = await Promise.all(
        orderedIds.map((id, i) => {
          const values = { seq: i + 1, updated_by: s.userId };
          return runWrite(
            () => supabase().from("stops").update(values).eq("id", id),
            { table: "stops", op: "update", id, values },
          );
        }),
      );
      if (results.includes("error")) {
        set({ stops: prevStops });
        scheduleRoutes();
      }
    },

    addViaPoint: async (afterStopId, lng, lat, seq) => {
      const s = get();
      if (!s.trip) return;
      const row: ViaPoint = {
        id: crypto.randomUUID(),
        trip_id: s.trip.id,
        after_stop_id: afterStopId,
        seq,
        lat,
        lng,
        created_by: s.userId,
        created_at: new Date().toISOString(),
      };
      set({ viaPoints: [...s.viaPoints, row] });
      scheduleRoutes();
      const payload = {
        id: row.id,
        trip_id: row.trip_id,
        after_stop_id: afterStopId,
        seq,
        lat,
        lng,
        created_by: s.userId,
      };
      const result = await runWrite(
        () => supabase().from("via_points").insert(payload),
        { table: "via_points", op: "insert", values: payload },
      );
      if (result === "error") {
        set({ viaPoints: get().viaPoints.filter((v) => v.id !== row.id) });
        scheduleRoutes();
      }
    },

    moveViaPoint: async (id, lng, lat) => {
      const prev = get().viaPoints.find((v) => v.id === id);
      set({
        viaPoints: get().viaPoints.map((v) => (v.id === id ? { ...v, lng, lat } : v)),
      });
      scheduleRoutes();
      const result = await runWrite(
        () => supabase().from("via_points").update({ lng, lat }).eq("id", id),
        { table: "via_points", op: "update", id, values: { lng, lat } },
      );
      if (result === "error" && prev) {
        set({ viaPoints: get().viaPoints.map((v) => (v.id === id ? prev : v)) });
        scheduleRoutes();
      }
    },

    deleteViaPoint: async (id) => {
      const prev = get().viaPoints.find((v) => v.id === id);
      set({ viaPoints: get().viaPoints.filter((v) => v.id !== id) });
      scheduleRoutes();
      const result = await runWrite(
        () => supabase().from("via_points").delete().eq("id", id),
        { table: "via_points", op: "delete", id },
      );
      if (result === "error" && prev) {
        set({ viaPoints: [...get().viaPoints, prev] });
        scheduleRoutes();
      }
    },

    updateDay: async (id, patch) => {
      const prev = get().days.find((d) => d.id === id);
      set({ days: get().days.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
      const result = await runWrite(
        () => supabase().from("days").update(patch).eq("id", id),
        { table: "days", op: "update", id, values: patch as Record<string, unknown> },
      );
      if (result === "error" && prev) {
        set({ days: get().days.map((d) => (d.id === id ? prev : d)) });
      }
    },

    addDay: async () => {
      const s = get();
      if (!s.trip) return;
      const ordered = sortDays(s.days);
      const last = ordered[ordered.length - 1];
      const now = new Date().toISOString();
      const row: Day = {
        id: crypto.randomUUID(),
        trip_id: s.trip.id,
        seq: (last?.seq ?? 0) + 1,
        date: last ? shiftDate(last.date, 1) : s.trip.start_date,
        title: "",
        notes: "",
        emoji: null,
        created_at: now,
        updated_at: now,
      };
      set({ days: [...s.days, row] });
      const payload = {
        id: row.id,
        trip_id: row.trip_id,
        seq: row.seq,
        date: row.date,
        title: "",
      };
      const result = await runWrite(
        () => supabase().from("days").insert(payload),
        { table: "days", op: "insert", values: payload },
      );
      if (result === "error") set({ days: get().days.filter((d) => d.id !== row.id) });
    },

    deleteDay: async (id) => {
      const s = get();
      const ordered = sortDays(s.days);
      if (!ordered.some((d) => d.id === id)) return;
      const start = s.trip?.start_date ?? ordered[0].date;
      const stopIds = s.stops.filter((x) => x.day_id === id).map((x) => x.id);
      const stopIdSet = new Set(stopIds);

      // days stay consecutive from the trip start after a removal
      const remaining = ordered
        .filter((d) => d.id !== id)
        .map((d, i) => ({ ...d, seq: i + 1, date: shiftDate(start, i) }));
      set({
        days: remaining,
        stops: s.stops.filter((x) => x.day_id !== id),
        viaPoints: s.viaPoints.filter((v) => !stopIdSet.has(v.after_stop_id)),
        selectedDayId: s.selectedDayId === id ? null : s.selectedDayId,
      });
      scheduleRoutes();

      const db = supabase();
      // Multi-statement (delete vias → stops → day → renumber) — too
      // interdependent to queue offline op-by-op, so no outbox here: on any
      // failure re-pull truth rather than guess which parts landed.
      let failed = false;
      if (stopIds.length > 0) {
        failed =
          (await runWrite(() => db.from("via_points").delete().in("after_stop_id", stopIds))) !==
          "ok";
        if (!failed) {
          failed = (await runWrite(() => db.from("stops").delete().eq("day_id", id))) !== "ok";
        }
      }
      if (!failed) {
        failed = (await runWrite(() => db.from("days").delete().eq("id", id))) !== "ok";
      }
      if (!failed && remaining.length > 0) {
        // renumber every surviving day — one UPDATE per row, since a
        // partial upsert trips days' NOT NULL columns (trip_id) on the
        // INSERT half of ON CONFLICT even when every row already exists
        const results = await Promise.all(
          remaining.map((d) => {
            const values = { seq: d.seq, date: d.date };
            return runWrite(
              () => db.from("days").update(values).eq("id", d.id),
              { table: "days", op: "update", id: d.id, values },
            );
          }),
        );
        failed = results.includes("error");
      }
      if (failed) await refetchAll();
    },

    updateTrip: async (patch) => {
      const trip = get().trip;
      if (!trip) return;
      set({ trip: { ...trip, ...patch } });
      const result = await runWrite(
        () => supabase().from("trips").update(patch).eq("id", trip.id),
        { table: "trips", op: "update", id: trip.id, values: patch as Record<string, unknown> },
      );
      if (result === "error") set({ trip });
    },

    updateProfile: async (patch) => {
      const s = get();
      if (!s.userId) return;
      const prev = s.profiles.find((p) => p.id === s.userId);
      set({
        profiles: s.profiles.map((p) => (p.id === s.userId ? { ...p, ...patch } : p)),
      });
      const result = await runWrite(
        () => supabase().from("profiles").update(patch).eq("id", s.userId!),
        { table: "profiles", op: "update", id: s.userId, values: patch },
      );
      if (result === "error" && prev) {
        set({ profiles: get().profiles.map((p) => (p.id === s.userId ? prev : p)) });
      }
    },

    togglePacking: async (id, checked) => {
      const s = get();
      const prev = s.packing.find((p) => p.id === id);
      set({
        packing: s.packing.map((p) =>
          p.id === id ? { ...p, checked, checked_by: checked ? s.userId : null } : p,
        ),
      });
      const values = { checked, checked_by: checked ? s.userId : null, updated_by: s.userId };
      const result = await runWrite(
        () => supabase().from("packing_items").update(values).eq("id", id),
        { table: "packing_items", op: "update", id, values },
      );
      if (result === "error" && prev) {
        set({ packing: get().packing.map((p) => (p.id === id ? prev : p)) });
      }
    },

    addPackingItem: async (category, label, assigned_to) => {
      const s = get();
      if (!s.trip) return;
      const now = new Date().toISOString();
      const row: PackingItem = {
        id: crypto.randomUUID(),
        trip_id: s.trip.id,
        category,
        label,
        checked: false,
        checked_by: null,
        assigned_to,
        // max + 1, never count + 1 — deletions leave gaps
        seq: s.packing.reduce((m, p) => (p.category === category && p.seq > m ? p.seq : m), 0) + 1,
        created_by: s.userId,
        updated_by: s.userId,
        created_at: now,
        updated_at: now,
      };
      set({ packing: [...s.packing, row] });
      const payload = {
        id: row.id,
        trip_id: row.trip_id,
        category,
        label,
        assigned_to,
        seq: row.seq,
        created_by: s.userId,
        updated_by: s.userId,
      };
      const result = await runWrite(
        () => supabase().from("packing_items").insert(payload),
        { table: "packing_items", op: "insert", values: payload },
      );
      if (result === "error") set({ packing: get().packing.filter((p) => p.id !== row.id) });
    },

    updatePackingItem: async (id, patch) => {
      const s = get();
      const prev = s.packing.find((p) => p.id === id);
      set({ packing: s.packing.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
      const values = { ...patch, updated_by: s.userId };
      const result = await runWrite(
        () => supabase().from("packing_items").update(values).eq("id", id),
        { table: "packing_items", op: "update", id, values },
      );
      if (result === "error" && prev) {
        // field-level rollback — see updateStop
        const revert = Object.fromEntries(
          Object.keys(patch).map((k) => [k, prev[k as keyof PackingItem]]),
        ) as Partial<PackingItem>;
        set({
          packing: get().packing.map((p) =>
            p.id === id ? { ...p, ...revert, updated_by: prev.updated_by } : p,
          ),
        });
      }
    },

    deletePackingItem: async (id) => {
      const prev = get().packing.find((p) => p.id === id);
      set({ packing: get().packing.filter((p) => p.id !== id) });
      const result = await runWrite(
        () => supabase().from("packing_items").delete().eq("id", id),
        { table: "packing_items", op: "delete", id },
      );
      if (result === "error" && prev) set({ packing: [...get().packing, prev] });
    },

    addGameEvent: async (e) => {
      const s = get();
      const row: GameEvent = {
        id: crypto.randomUUID(),
        game: e.game,
        kind: e.kind,
        key: e.key ?? null,
        value: e.value ?? {},
        created_by: s.userId,
        created_at: new Date().toISOString(),
      };
      set({ gameEvents: [...s.gameEvents, row] });
      const payload = {
        id: row.id,
        game: row.game,
        kind: row.kind,
        key: row.key,
        value: row.value,
        created_by: s.userId,
      };
      // Offline claims queue and replay; one that lost the race while we were
      // away is rejected by the unique index at flush time and dropped there.
      const result = await runWrite(
        () => supabase().from("game_events").insert(payload),
        { table: "game_events", op: "insert", values: payload },
      );
      // e.g. a claim raced the other phone and lost the unique index
      if (result === "error") {
        set({ gameEvents: get().gameEvents.filter((x) => x.id !== row.id) });
      }
    },

    deleteGameEvent: async (id) => {
      const prev = get().gameEvents.find((x) => x.id === id);
      set({ gameEvents: get().gameEvents.filter((x) => x.id !== id) });
      const result = await runWrite(
        () => supabase().from("game_events").delete().eq("id", id),
        { table: "game_events", op: "delete", id },
      );
      if (result === "error" && prev) set({ gameEvents: [...get().gameEvents, prev] });
    },

    saveAnalysis: async (key, model, insights) => {
      const s = get();
      if (!s.trip) return;
      const now = new Date().toISOString();
      const row: TripAnalysis = {
        id: crypto.randomUUID(),
        trip_id: s.trip.id,
        key,
        model,
        insights,
        dismissed: [],
        created_by: s.userId,
        created_at: now,
        updated_at: now,
      };
      const prev = s.analyses;
      // one live analysis per trip — older rows are stale cache, drop them
      set({ analyses: [row] });
      // upsert on key: if the other phone raced us to the same trip state,
      // last write wins and Realtime reconciles both to one row. No outbox —
      // an analysis only ever exists right after a successful network call.
      const result = await runWrite(() =>
        supabase().from("trip_analyses").upsert(
          {
            id: row.id,
            trip_id: row.trip_id,
            key,
            model,
            insights,
            dismissed: [],
            created_by: s.userId,
          },
          { onConflict: "key" },
        ),
      );
      if (result !== "ok") {
        set({ analyses: prev });
        return;
      }
      const staleIds = prev.filter((a) => a.key !== key).map((a) => a.id);
      if (staleIds.length > 0) {
        // best effort — a failed prune just leaves dead cache rows behind
        void supabase().from("trip_analyses").delete().in("id", staleIds);
      }
    },

    dismissInsight: async (analysisId, insightId) => {
      const s = get();
      const prev = s.analyses.find((a) => a.id === analysisId);
      if (!prev || prev.dismissed.includes(insightId)) return;
      const dismissed = [...prev.dismissed, insightId];
      set({
        analyses: s.analyses.map((a) => (a.id === analysisId ? { ...a, dismissed } : a)),
      });
      const values = { dismissed, updated_at: new Date().toISOString() };
      const result = await runWrite(
        () => supabase().from("trip_analyses").update(values).eq("id", analysisId),
        { table: "trip_analyses", op: "update", id: analysisId, values },
      );
      if (result === "error") {
        set({
          analyses: get().analyses.map((a) => (a.id === analysisId ? prev : a)),
        });
      }
    },

    refreshActivity: async () => {
      const { data, error } = await supabase()
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      // a failed refresh (offline) keeps the last list rather than blanking it
      if (!error && data) set({ activity: data as ActivityEntry[] });
    },
  };
});

export function stopsForDay(stops: Stop[], dayId: string): Stop[] {
  return sortStops(stops.filter((s) => s.day_id === dayId));
}

// Persist the last good state per device (debounced) — init() falls back to
// this when the trip is opened without a connection, so a dead zone never
// blanks the itinerary.
if (typeof window !== "undefined") {
  let snapTimer: ReturnType<typeof setTimeout> | null = null;
  useTrip.subscribe((s) => {
    if (!s.loaded) return;
    if (snapTimer) clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      const { profiles, trip, days, stops, viaPoints, packing, gameEvents, analyses, routes } =
        useTrip.getState();
      const snap: Snapshot = {
        profiles,
        trip,
        days,
        stops,
        viaPoints,
        packing,
        gameEvents,
        analyses,
        routes,
      };
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
      } catch {
        // storage full or unavailable — the offline fallback just won't refresh
      }
    }, 1500);
  });
}
