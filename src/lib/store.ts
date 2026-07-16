"use client";

import { create } from "zustand";
import { supabase } from "./supabase";
import { fetchRoute, primeRouteCache } from "./osrm";
import type { LngLat } from "./geo";
import type {
  ActivityEntry,
  Day,
  DayRoute,
  GameEvent,
  PackingItem,
  Profile,
  RouteSegment,
  Stop,
  Trip,
  ViaPoint,
} from "./types";

type Tables =
  | "days"
  | "stops"
  | "via_points"
  | "packing_items"
  | "trips"
  | "game_events"
  | "profiles";

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

  routes: Record<string, DayRoute>;
  routesPending: boolean;
  routeError: string | null;

  // UI state shared between tabs
  selectedDayId: string | null;
  selectedStopId: string | null;

  init: (userId: string) => Promise<void>;
  teardown: () => void;

  /** Debounced route recompute — for callers outside the store (e.g. shaping). */
  refreshRoutes: () => void;

  setSelectedDay: (dayId: string | null) => void;
  setSelectedStop: (stopId: string | null) => void;

  // stops
  addStop: (
    dayId: string,
    stop: { name: string; lat: number; lng: number; kind?: Stop["kind"] },
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

function sortDays(days: Day[]): Day[] {
  return [...days].sort((a, b) => a.seq - b.seq);
}

/** 'YYYY-MM-DD' + n days, timezone-proof. */
export function shiftDate(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
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
  "profiles" | "trip" | "days" | "stops" | "viaPoints" | "packing" | "gameEvents" | "routes"
>;

function loadSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Snapshot;
    return Array.isArray(snap.days) && Array.isArray(snap.stops) ? snap : null;
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
    const [profiles, trips, days, stops, vias, packing, games] = await Promise.all([
      db.from("profiles").select("*"),
      db.from("trips").select("*").limit(1),
      db.from("days").select("*"),
      db.from("stops").select("*"),
      db.from("via_points").select("*"),
      db.from("packing_items").select("*"),
      db.from("game_events").select("*").order("created_at", { ascending: true }),
    ]);
    const failed = [profiles, trips, days, stops, vias, packing, games].find((r) => r.error);
    if (failed?.error) throw new Error(failed.error.message);
    return {
      profiles: (profiles.data as Profile[]) ?? [],
      trip: ((trips.data as Trip[]) ?? [])[0] ?? null,
      days: (days.data as Day[]) ?? [],
      stops: (stops.data as Stop[]) ?? [],
      viaPoints: (vias.data as ViaPoint[]) ?? [],
      packing: (packing.data as PackingItem[]) ?? [],
      gameEvents: (games.data as GameEvent[]) ?? [],
    };
  }

  /**
   * Re-pull everything and reconcile — after a Realtime drop or a return to
   * the foreground, local state may have silently missed events.
   */
  async function refetchAll() {
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
    routes: {},
    routesPending: false,
    routeError: null,
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
        routes: {},
        routesPending: false,
        routeError: null,
        selectedDayId: null,
        selectedStopId: null,
      });
    },

    refreshRoutes: () => scheduleRoutes(),

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
      const { error } = await supabase().from("stops").insert({
        id: row.id,
        trip_id: row.trip_id,
        day_id: row.day_id,
        seq: row.seq,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        kind: row.kind,
        created_by: s.userId,
        updated_by: s.userId,
      });
      if (error) {
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
      const geometry = ["day_id", "seq", "lat", "lng"].some((f) => f in patch);
      if (geometry) scheduleRoutes();
      const { error } = await supabase()
        .from("stops")
        .update({ ...patch, updated_by: s.userId })
        .eq("id", id);
      if (error && prev) {
        set({ stops: get().stops.map((x) => (x.id === id ? prev : x)) });
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
      const { error } = await supabase().from("stops").delete().eq("id", id);
      if (error && prevStop) {
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
        orderedIds.map((id, i) =>
          supabase()
            .from("stops")
            .update({ seq: i + 1, updated_by: s.userId })
            .eq("id", id),
        ),
      );
      if (results.some((r) => r.error)) {
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
      const { error } = await supabase().from("via_points").insert({
        id: row.id,
        trip_id: row.trip_id,
        after_stop_id: afterStopId,
        seq,
        lat,
        lng,
        created_by: s.userId,
      });
      if (error) {
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
      const { error } = await supabase().from("via_points").update({ lng, lat }).eq("id", id);
      if (error && prev) {
        set({ viaPoints: get().viaPoints.map((v) => (v.id === id ? prev : v)) });
        scheduleRoutes();
      }
    },

    deleteViaPoint: async (id) => {
      const prev = get().viaPoints.find((v) => v.id === id);
      set({ viaPoints: get().viaPoints.filter((v) => v.id !== id) });
      scheduleRoutes();
      const { error } = await supabase().from("via_points").delete().eq("id", id);
      if (error && prev) {
        set({ viaPoints: [...get().viaPoints, prev] });
        scheduleRoutes();
      }
    },

    updateDay: async (id, patch) => {
      const prev = get().days.find((d) => d.id === id);
      set({ days: get().days.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
      const { error } = await supabase().from("days").update(patch).eq("id", id);
      if (error && prev) {
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
      const { error } = await supabase().from("days").insert({
        id: row.id,
        trip_id: row.trip_id,
        seq: row.seq,
        date: row.date,
        title: "",
      });
      if (error) set({ days: get().days.filter((d) => d.id !== row.id) });
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
      let error: unknown = null;
      if (stopIds.length > 0) {
        ({ error } = await db.from("via_points").delete().in("after_stop_id", stopIds));
        if (!error) ({ error } = await db.from("stops").delete().eq("day_id", id));
      }
      if (!error) ({ error } = await db.from("days").delete().eq("id", id));
      if (!error && remaining.length > 0) {
        // renumber every surviving day — one UPDATE per row, since a
        // partial upsert trips days' NOT NULL columns (trip_id) on the
        // INSERT half of ON CONFLICT even when every row already exists
        const results = await Promise.all(
          remaining.map((d) =>
            db.from("days").update({ seq: d.seq, date: d.date }).eq("id", d.id),
          ),
        );
        error = results.find((r) => r.error)?.error ?? null;
      }
      // multi-statement delete — on any failure re-pull truth rather than
      // trying to guess which parts landed
      if (error) await refetchAll();
    },

    updateTrip: async (patch) => {
      const trip = get().trip;
      if (!trip) return;
      set({ trip: { ...trip, ...patch } });
      const { error } = await supabase().from("trips").update(patch).eq("id", trip.id);
      if (error) set({ trip });
    },

    updateProfile: async (patch) => {
      const s = get();
      if (!s.userId) return;
      const prev = s.profiles.find((p) => p.id === s.userId);
      set({
        profiles: s.profiles.map((p) => (p.id === s.userId ? { ...p, ...patch } : p)),
      });
      const { error } = await supabase().from("profiles").update(patch).eq("id", s.userId);
      if (error && prev) {
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
      const { error } = await supabase()
        .from("packing_items")
        .update({ checked, checked_by: checked ? s.userId : null, updated_by: s.userId })
        .eq("id", id);
      if (error && prev) {
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
      const { error } = await supabase().from("packing_items").insert({
        id: row.id,
        trip_id: row.trip_id,
        category,
        label,
        assigned_to,
        seq: row.seq,
        created_by: s.userId,
        updated_by: s.userId,
      });
      if (error) set({ packing: get().packing.filter((p) => p.id !== row.id) });
    },

    updatePackingItem: async (id, patch) => {
      const s = get();
      const prev = s.packing.find((p) => p.id === id);
      set({ packing: s.packing.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
      const { error } = await supabase()
        .from("packing_items")
        .update({ ...patch, updated_by: s.userId })
        .eq("id", id);
      if (error && prev) {
        set({ packing: get().packing.map((p) => (p.id === id ? prev : p)) });
      }
    },

    deletePackingItem: async (id) => {
      const prev = get().packing.find((p) => p.id === id);
      set({ packing: get().packing.filter((p) => p.id !== id) });
      const { error } = await supabase().from("packing_items").delete().eq("id", id);
      if (error && prev) set({ packing: [...get().packing, prev] });
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
      const { error } = await supabase().from("game_events").insert({
        id: row.id,
        game: row.game,
        kind: row.kind,
        key: row.key,
        value: row.value,
        created_by: s.userId,
      });
      // e.g. a claim raced the other phone and lost the unique index
      if (error) set({ gameEvents: get().gameEvents.filter((x) => x.id !== row.id) });
    },

    deleteGameEvent: async (id) => {
      const prev = get().gameEvents.find((x) => x.id === id);
      set({ gameEvents: get().gameEvents.filter((x) => x.id !== id) });
      const { error } = await supabase().from("game_events").delete().eq("id", id);
      if (error && prev) set({ gameEvents: [...get().gameEvents, prev] });
    },

    refreshActivity: async () => {
      const { data } = await supabase()
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      set({ activity: (data as ActivityEntry[]) ?? [] });
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
      const { profiles, trip, days, stops, viaPoints, packing, gameEvents, routes } =
        useTrip.getState();
      const snap: Snapshot = { profiles, trip, days, stops, viaPoints, packing, gameEvents, routes };
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
      } catch {
        // storage full or unavailable — the offline fallback just won't refresh
      }
    }, 1500);
  });
}
