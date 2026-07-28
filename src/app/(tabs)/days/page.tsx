"use client";

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import AddStopSheet from "@/components/AddStopSheet";
import { RollingText } from "@/components/AnimatedNumber";
import AttributionDot from "@/components/Attribution";
import CountdownPill from "@/components/CountdownPill";
import { StopKindIcon, WeatherIcon } from "@/components/CategoryIcon";
import { IconGrip, IconMoon, IconPin, IconPlus, IconSparkle, IconTrash } from "@/components/Icons";
import NavAppSheet from "@/components/NavAppSheet";
import Sheet from "@/components/Sheet";
import StopEditSheet from "@/components/StopEditSheet";
import SuggestSheet from "@/components/SuggestSheet";
import TodayPanel from "@/components/TodayPanel";
import { clusterKey, clusterStops } from "@/lib/clusters";
import { dayColor, KIND_COLOR } from "@/lib/colors";
import { directionsOptions } from "@/lib/directions";
import { DEFAULT_TANK_GAL, planFuel, type FuelWarning } from "@/lib/fuel";
import { FADE, riseIn, SPRING } from "@/lib/motion";
import { dayEmoji, NATURE_EMOJI } from "@/lib/emoji";
import {
  fmtClock,
  fmtDate,
  fmtDuration,
  fmtMiles,
  fmtStay,
  localDateISO,
} from "@/lib/format";
import type { LngLat } from "@/lib/geo";
import {
  DAY_START_MIN,
  dayDepartMin,
  minutesToHHMM,
  type StopSchedule,
  useSchedule,
} from "@/lib/schedule";
import { stopsForDay, useOrderedDays, useTrip } from "@/lib/store";
import { type ClusterWeather, useWeather, weatherKind } from "@/lib/weather";
import type { Day, DayRoute, Stop } from "@/lib/types";

export default function DaysPage() {
  const routes = useTrip((s) => s.routes);
  const routesPending = useTrip((s) => s.routesPending);
  const routeError = useTrip((s) => s.routeError);
  const refreshRoutes = useTrip((s) => s.refreshRoutes);
  const addDay = useTrip((s) => s.addDay);
  const trip = useTrip((s) => s.trip);
  const stops = useTrip((s) => s.stops);

  const orderedDays = useOrderedDays();
  const todayIso = localDateISO();

  // One walk of the whole trip's tank, shared by every day card below —
  // running out of gas is a trip-wide question, not a per-day one.
  const fuel = useMemo(
    () =>
      trip
        ? planFuel(
            orderedDays,
            stops,
            routes,
            Number(trip.mpg),
            Number(trip.tank_gal ?? DEFAULT_TANK_GAL),
          )
        : null,
    [trip, orderedDays, stops, routes],
  );

  const totals = useMemo(() => {
    let dist = 0;
    let dur = 0;
    for (const r of Object.values(routes)) {
      dist += r.distanceM;
      dur += r.durationS;
    }
    return { dist, dur };
  }, [routes]);

  const [editStop, setEditStop] = useState<Stop | null>(null);
  const [addForDay, setAddForDay] = useState<string | null>(null);
  const [suggestForDay, setSuggestForDay] = useState<string | null>(null);

  return (
    <div className="min-h-dvh pb-32">
      <header className="pt-safe sticky top-0 z-30">
        <div className="glass border-x-0 border-t-0 px-5 pb-3.5 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="display text-[22px] tracking-tight">Itinerary</h1>
            </div>
            <CountdownPill />
          </div>
          <div className="stat-strip mt-3">
            <Stat value={totals.dist > 0 ? fmtMiles(totals.dist) : "—"} label="total" />
            <Stat value={totals.dist > 0 ? fmtDuration(totals.dur) : "—"} label="driving" />
            <Stat
              value={String(orderedDays.length)}
              label={routesPending ? "days · updating…" : "days"}
            />
          </div>
          {/* Routing failed, so every mileage and drive time below is whatever
              it was before the last edit — say so rather than let a stale
              number read as current. */}
          {routeError && !routesPending && (
            <button
              onClick={refreshRoutes}
              className="pressable mt-2.5 w-full rounded-xl bg-danger/10 px-3 py-2 text-[11px] font-semibold text-danger"
            >
              Drive times couldn&apos;t update · Retry
            </button>
          )}
        </div>
      </header>

      <div className="space-y-3.5 px-4 pt-4">
        {/* what's happening right now, above the whole plan */}
        <TodayPanel />

        <AnimatePresence>
          {orderedDays.map((day, i) => (
            <DayCard
              key={day.id}
              day={day}
              prevDay={i > 0 ? orderedDays[i - 1] : null}
              index={i}
              total={orderedDays.length}
              route={routes[day.id]}
              isToday={day.date === todayIso}
              // Today's warnings are already on the panel directly above this
              // card — showing them twice, stacked, reads as two problems.
              fuelWarnings={day.date === todayIso ? [] : (fuel?.byDay[day.id] ?? [])}
              onEditStop={setEditStop}
              onAddStop={() => setAddForDay(day.id)}
              onSuggest={() => setSuggestForDay(day.id)}
            />
          ))}
        </AnimatePresence>

        <motion.button
          layout="position"
          transition={{ layout: SPRING }}
          onClick={() => void addDay()}
          className="btn-ghost pressable flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl text-sm font-semibold"
        >
          <IconPlus size={14} /> Add day {orderedDays.length + 1}
        </motion.button>
      </div>

      <StopEditSheet stop={editStop} open={editStop !== null} onClose={() => setEditStop(null)} />
      <AddStopSheet dayId={addForDay} open={addForDay !== null} onClose={() => setAddForDay(null)} />
      <SuggestSheet dayId={suggestForDay} open={suggestForDay !== null} onClose={() => setSuggestForDay(null)} />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      {/* rolls changed digits when routes recompute — see AnimatedNumber */}
      <p className="mono text-[13px] font-semibold leading-tight">
        <RollingText value={value} />
      </p>
      <p className="eyebrow mt-0.5">{label}</p>
    </div>
  );
}

function DayCard({
  day,
  prevDay,
  index,
  total,
  route,
  isToday,
  fuelWarnings,
  onEditStop,
  onAddStop,
  onSuggest,
}: {
  day: Day;
  /** The day before this one — its overnight stop is the morning origin. */
  prevDay: Day | null;
  index: number;
  total: number;
  route?: DayRoute;
  /** Today's card wears the accent edge so it's findable in a long list. */
  isToday: boolean;
  fuelWarnings: FuelWarning[];
  onEditStop: (s: Stop) => void;
  onAddStop: () => void;
  onSuggest: () => void;
}) {
  const router = useRouter();
  const stops = useTrip((s) => s.stops);
  const weather = useWeather((s) => s.byDay[day.id]);
  const reorderStops = useTrip((s) => s.reorderStops);
  const deleteDay = useTrip((s) => s.deleteDay);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [departOpen, setDepartOpen] = useState(false);
  const setSelectedDay = useTrip((s) => s.setSelectedDay);
  const setSelectedStop = useTrip((s) => s.setSelectedStop);

  const dayStops = useMemo(() => stopsForDay(stops, day.id), [stops, day.id]);
  const color = dayColor(index, total);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  // Live ETAs cascade from the departure time, drive durations, and each
  // stop's planned stay — shared with the stop editor.
  const schedule = useSchedule();

  // One weather badge per geographic cluster of stops — shown on the cluster's
  // representative (first) stop only.
  const byCluster = useWeather((s) => s.byCluster);
  const clusterWeather = useMemo(() => {
    const map = new Map<string, ClusterWeather>();
    for (const c of clusterStops(dayStops)) {
      const w = byCluster[clusterKey(day.id, c.repStopId)];
      if (w) map.set(c.repStopId, w);
    }
    return map;
  }, [dayStops, byCluster, day.id]);

  const segByFrom = useMemo(() => {
    const m = new Map<string, { distanceM: number; durationS: number }>();
    for (const seg of route?.segments ?? []) m.set(seg.fromStopId, seg);
    return m;
  }, [route]);

  const morningSeg = useMemo(() => {
    if (!route || dayStops.length === 0) return null;
    return route.segments.find((s) => s.toStopId === dayStops[0].id) ?? null;
  }, [route, dayStops]);

  // Hand this day's drive to a nav app: last night's stay (if any) through
  // every stop in order. One keyless universal link per app — see lib/directions.
  const navOptions = useMemo(() => {
    const points: LngLat[] = [];
    if (prevDay) {
      const prevStops = stopsForDay(stops, prevDay.id);
      const origin = prevStops[prevStops.length - 1];
      if (origin) points.push([origin.lng, origin.lat]);
    }
    for (const s of dayStops) points.push([s.lng, s.lat]);
    return directionsOptions(points);
  }, [prevDay, stops, dayStops]);

  // When the day's first stop has an ETA, back out when to leave last night's
  // stay to make it — the departure we never show as its own stop.
  const firstSched = dayStops[0] ? schedule.get(dayStops[0].id) : undefined;
  const leaveMin =
    morningSeg && firstSched
      ? ((firstSched.arrivalMin - morningSeg.durationS / 60) % 1440 + 1440) % 1440
      : undefined;

  // A pinned stop time outranks the day's own clock — when one is doing the
  // driving, say "Leave by" and let the sheet explain why the picker won't move
  // it. Otherwise this is simply when the day pulls out.
  const anchoredByStop = Boolean(firstSched?.anchored) && leaveMin !== undefined;
  const departMin = dayDepartMin(day, index === 0 ? dayStops[0] : undefined);
  /** Day one's clock lives on its origin stop, not on the day. */
  const originHasTime = index === 0 && dayStops[0]?.start_time != null;
  /** Something deliberately set this departure — worth the accent. */
  const departPinned = anchoredByStop || originHasTime || day.start_time != null;

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = dayStops.map((s) => s.id);
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    void reorderStops(day.id, arrayMove(ids, from, to));
  }

  const enter = riseIn(index);

  return (
    // layout="position" (not full layout): when a sibling day is added or
    // removed this card slides instead of snapping, while its own size
    // changes stay instant — full layout would scale-distort the text inside
    <motion.section
      layout="position"
      initial={enter.initial}
      animate={enter.animate}
      exit={{ opacity: 0, transition: FADE }}
      transition={{ ...enter.transition, layout: SPRING }}
      className="card p-4"
      // today is the card you're looking for in a fifteen-day list
      style={isToday ? { borderColor: "var(--accent)" } : undefined}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={() => setEmojiOpen(true)}
          aria-label={`Change Day ${day.seq} icon`}
          className="pressable hit-target flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border bg-bg-elevated text-lg leading-none"
          style={{ borderColor: color }}
        >
          {dayEmoji(day.id, day.emoji)}
        </button>
        <button
          className="flex flex-1 items-center justify-between text-left"
          onClick={() => {
            setSelectedDay(day.id);
            router.push("/map");
          }}
        >
          <div>
            <p className="text-sm font-semibold leading-tight tracking-tight">
              {day.title || `Day ${day.seq}`}
            </p>
            <p className="eyebrow mt-1 flex items-center gap-1.5">
              {fmtDate(day.date)}
              {weather && (
                <span className="flex items-center gap-1 normal-case text-fg-muted">
                  <WeatherIcon kind={weatherKind(weather.code)} size={12} strokeWidth={2} />
                  <span className="tnum tracking-normal">
                    {weather.tMaxF}°/{weather.tMinF}°
                  </span>
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            {route && route.distanceM > 0 ? (
              <>
                <p className="mono text-xs font-semibold text-fg-muted">
                  {fmtMiles(route.distanceM)}
                </p>
                <p className="mono mt-0.5 text-[10px] text-fg-faint">
                  {fmtDuration(route.durationS)}
                </p>
              </>
            ) : (
              <span className="text-xs text-fg-faint">—</span>
            )}
          </div>
        </button>
      </div>

      <div className="hairline-t mt-3.5" />

      {/* When the day pulls out — tap to set it. Every ETA below cascades
          from this one clock, so it belongs on the card, not buried. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[26px]">
        <button
          onClick={() => setDepartOpen(true)}
          aria-label={`Set departure time for day ${day.seq}`}
          className="pressable tnum rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
          style={
            departPinned
              ? { background: "var(--accent-soft)", color: "var(--accent)" }
              : { color: "var(--fg-muted)" }
          }
        >
          {anchoredByStop
            ? `Leave by ${fmtClock(leaveMin!)}`
            : `Depart ${fmtClock(departMin)}`}
        </button>
        {morningSeg && (
          <span className="tnum text-[11px] text-fg-faint">
            {fmtMiles(morningSeg.distanceM)} · {fmtDuration(morningSeg.durationS)}
            {" from last night's stay"}
          </span>
        )}
      </div>

      {dayStops.length === 0 && (
        <p className="mt-3 rounded-xl bg-fg/[0.03] px-3 py-2.5 text-center text-xs text-fg-faint">
          Nothing planned yet — add a stop or browse suggestions.
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={dayStops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="mt-1.5">
            {dayStops.map((stop, si) => (
              <SortableStop
                key={stop.id}
                stop={stop}
                isLast={si === dayStops.length - 1}
                sched={schedule.get(stop.id)}
                weather={clusterWeather.get(stop.id)}
                seg={si < dayStops.length - 1 ? segByFrom.get(stop.id) : undefined}
                onTap={() => {
                  setSelectedStop(stop.id);
                  onEditStop(stop);
                }}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {fuelWarnings.map((w) => (
        <p
          key={w.toStopId}
          className="mt-3 rounded-xl bg-coral-soft px-3 py-2 text-[11px] font-medium leading-4 text-coral"
        >
          ⛽{" "}
          {w.legAlone
            ? `${fmtMiles(w.sinceFuelM)} without a stop — that's more than one tank.`
            : `${fmtMiles(w.sinceFuelM)} since the last fuel stop by ${w.toStopName}.`}{" "}
          Mark a stop as Fuel to plan the fill-up.
        </p>
      ))}

      <div className="mt-3 flex gap-2">
        <button
          onClick={onAddStop}
          className="btn-ghost pressable flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold"
        >
          <IconPlus size={13} /> Add stop
        </button>
        <button
          onClick={onSuggest}
          className="pressable flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent-soft py-2.5 text-xs font-semibold text-accent"
        >
          <IconSparkle size={13} /> Suggest nearby
        </button>
        {navOptions.length > 0 && (
          <button
            onClick={() => setNavOpen(true)}
            aria-label={`Navigate day ${day.seq}`}
            className="btn-ghost pressable flex min-h-[38px] w-10 flex-shrink-0 items-center justify-center rounded-xl !text-fg-faint"
          >
            <IconPin size={14} />
          </button>
        )}
        <button
          onClick={() => {
            if (confirmDelete) void deleteDay(day.id);
            else {
              setConfirmDelete(true);
              setTimeout(() => setConfirmDelete(false), 2500);
            }
          }}
          aria-label={`Remove day ${day.seq}`}
          className={`pressable flex min-h-[38px] items-center justify-center rounded-xl text-xs font-semibold transition-colors ${
            confirmDelete
              ? "bg-danger px-3 text-white"
              : "btn-ghost w-10 flex-shrink-0 !text-fg-faint"
          }`}
        >
          <motion.span
            key={String(confirmDelete)}
            initial={{ opacity: 0 }}
            // arming gives a short sideways wiggle so the state change
            // registers without reading the label
            animate={confirmDelete ? { opacity: 1, x: [0, -3, 3, -2, 2, 0] } : { opacity: 1 }}
            transition={confirmDelete ? { duration: 0.35, ease: "easeOut" } : FADE}
            className="flex items-center"
          >
            {confirmDelete ? "Sure?" : <IconTrash size={14} />}
          </motion.span>
        </button>
      </div>

      <DayEmojiSheet day={day} open={emojiOpen} onClose={() => setEmojiOpen(false)} />
      <NavAppSheet
        title={`Navigate ${day.title || `Day ${day.seq}`}`}
        options={navOptions}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <DayDepartSheet
        day={day}
        departMin={departMin}
        anchoredByStop={anchoredByStop}
        anchorName={anchoredByStop || originHasTime ? dayStops[0]?.name : undefined}
        originHasTime={originHasTime}
        open={departOpen}
        onClose={() => setDepartOpen(false)}
      />
    </motion.section>
  );
}

/**
 * When this day pulls out.
 *
 * The whole day's ETAs cascade from one clock, and until now that clock was a
 * hardcoded 9:00 for every day after the first — so "Day 6 we're sleeping in"
 * had no way to be said except by pinning a time to a stop, which means
 * something different. A stop's own start_time still wins where one exists
 * (a check-in is a commitment; a departure is a preference), and the sheet says
 * so rather than silently ignoring the picker.
 */
function DayDepartSheet({
  day,
  departMin,
  anchoredByStop,
  anchorName,
  originHasTime,
  open,
  onClose,
}: {
  day: Day;
  departMin: number;
  anchoredByStop: boolean;
  anchorName?: string;
  /** Day one's departure lives on the origin stop, not the day. */
  originHasTime: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const updateDay = useTrip((s) => s.updateDay);
  const [draft, setDraft] = useState(day.start_time ?? minutesToHHMM(departMin));
  /** A stop's own time is running this day — the day-level clock is inert. */
  const overridden = originHasTime || anchoredByStop;

  // Re-seed when the sheet reopens on a day whose time changed elsewhere.
  const [lastKey, setLastKey] = useState(day.start_time);
  if (day.start_time !== lastKey) {
    setLastKey(day.start_time);
    setDraft(day.start_time ?? minutesToHHMM(departMin));
  }

  return (
    // A pinned stop time fully determines the day's departure, so offering a
    // picker there would be a control that silently does nothing. Say what's
    // driving the clock and where to change it instead.
    <Sheet open={open} onClose={onClose} title={`${day.title || `Day ${day.seq}`} departure`}>
      <div className="space-y-4">
        <p className="text-xs leading-5 text-fg-muted">
          {originHasTime
            ? `Day one leaves when its first stop says. ${anchorName ?? "The origin"} has a time of its own, and a pinned stop wins over a day's preference — clear it there to set the departure here.`
            : anchoredByStop
              ? `${anchorName ?? "The first stop"} has a pinned time, so this day's departure is worked backwards from it. Clear that stop's time to set the departure directly.`
              : "Every arrival below is estimated from this clock. Leave it unset to use the usual 9:00 AM start."}
        </p>

        {!overridden && (
          <>
            <input
              type="time"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Departure time"
              className="field tnum w-full text-center text-lg font-semibold"
            />

            <button
              disabled={!draft}
              onClick={() => {
                void updateDay(day.id, { start_time: draft });
                onClose();
              }}
              className="btn-primary pressable h-12 w-full rounded-xl font-semibold disabled:opacity-40"
            >
              Set departure
            </button>
          </>
        )}

        {day.start_time && (
          <button
            onClick={() => {
              void updateDay(day.id, { start_time: null });
              onClose();
            }}
            className="btn-ghost pressable h-11 w-full rounded-xl text-sm font-semibold"
          >
            {overridden
              ? "Clear this day's unused departure"
              : `Use the default (${fmtClock(DAY_START_MIN)})`}
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** Bottom sheet to pick or clear a day's badge emoji. */
function DayEmojiSheet({
  day,
  open,
  onClose,
}: {
  day: Day;
  open: boolean;
  onClose: () => void;
}) {
  const updateDay = useTrip((s) => s.updateDay);
  const [custom, setCustom] = useState("");

  return (
    <Sheet open={open} onClose={onClose} title={`${day.title || `Day ${day.seq}`} icon`}>
      <div className="grid grid-cols-6 gap-2">
        {NATURE_EMOJI.map((e) => (
          <button
            key={e}
            onClick={() => {
              void updateDay(day.id, { emoji: e });
              onClose();
            }}
            className={`pressable flex h-12 items-center justify-center rounded-xl text-2xl ${
              day.emoji === e ? "bg-accent-soft ring-1 ring-accent" : "bg-fg/[0.03]"
            }`}
          >
            {e}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <p className="eyebrow mb-2 px-0.5">Or type any emoji</p>
        <div className="flex gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="🌈"
            maxLength={8}
            className="field flex-1 text-center text-xl"
            aria-label="Custom emoji"
          />
          <button
            disabled={!custom.trim()}
            onClick={() => {
              void updateDay(day.id, { emoji: custom.trim() });
              setCustom("");
              onClose();
            }}
            className="btn-primary pressable rounded-xl px-5 text-sm font-semibold disabled:opacity-40"
          >
            Set
          </button>
        </div>
      </div>

      <button
        onClick={() => {
          void updateDay(day.id, { emoji: null });
          onClose();
        }}
        className="btn-ghost pressable mt-4 h-11 w-full rounded-xl text-sm font-semibold"
      >
        Reset to default
      </button>
    </Sheet>
  );
}

function SortableStop({
  stop,
  isLast,
  sched,
  weather,
  seg,
  onTap,
}: {
  stop: Stop;
  isLast: boolean;
  sched?: StopSchedule;
  weather?: ClusterWeather;
  seg?: { distanceM: number; durationS: number };
  onTap: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative ${isDragging ? "z-10 opacity-80" : ""}`}
    >
      {/* timeline rail */}
      {(!isLast || seg) && (
        <span
          className="absolute bottom-[-4px] left-[11px] top-9 w-px"
          style={{ background: "var(--hairline)" }}
        />
      )}

      <div
        // role/tabIndex/keydown instead of <button>: the row contains the
        // drag-handle button, and interactive elements must not nest
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTap();
          }
        }}
        className="flex min-h-[52px] items-center gap-3 rounded-xl py-1.5 pr-1 active:bg-fg/5"
        onClick={onTap}
      >
        <span
          className="relative z-[1] flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: KIND_COLOR[stop.kind].bg, color: KIND_COLOR[stop.kind].fg }}
        >
          <StopKindIcon kind={stop.kind} size={13} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium leading-tight tracking-tight">
            <span className="truncate">{stop.name}</span>
            {stop.is_overnight && (
              <IconMoon size={12} className="flex-shrink-0 text-fg-faint" />
            )}
          </p>
          <p className="tnum mt-0.5 text-[11px] text-fg-faint">
            {sched ? (
              sched.anchored ? (
                <span className="font-semibold text-accent">
                  {fmtClock(sched.arrivalMin)}
                  {stop.duration_min ? ` · ${fmtStay(stop.duration_min)}` : ""}
                </span>
              ) : (
                <span>
                  ~{fmtClock(sched.arrivalMin)}
                  {stop.duration_min ? ` · ${fmtStay(stop.duration_min)}` : ""}
                </span>
              )
            ) : (
              "no ETA yet"
            )}
            {stop.notes && " · note"}
          </p>
        </div>
        {weather && (
          <span className="flex flex-shrink-0 items-center gap-1 text-fg-muted">
            <WeatherIcon kind={weatherKind(weather.code)} size={14} strokeWidth={2} />
            <span className="tnum text-[11px] font-medium">{weather.tempF}°</span>
          </span>
        )}
        <AttributionDot userId={stop.updated_by ?? stop.created_by} size={14} />
        <button
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label="Reorder"
          className="flex w-11 cursor-grab touch-none items-center justify-center self-stretch text-fg-faint"
        >
          <IconGrip size={15} />
        </button>
      </div>
      {seg && (
        <p className="tnum pb-1 pl-9 text-[11px] leading-4 text-fg-faint">
          {fmtMiles(seg.distanceM)} · {fmtDuration(seg.durationS)}
        </p>
      )}
    </li>
  );
}
