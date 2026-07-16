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
import AttributionDot from "@/components/Attribution";
import CountdownPill from "@/components/CountdownPill";
import { StopKindIcon, WeatherIcon } from "@/components/CategoryIcon";
import { IconGrip, IconMoon, IconPlus, IconSparkle, IconTrash } from "@/components/Icons";
import Sheet from "@/components/Sheet";
import StopEditSheet from "@/components/StopEditSheet";
import SuggestSheet from "@/components/SuggestSheet";
import { clusterKey, clusterStops } from "@/lib/clusters";
import { dayColor, KIND_COLOR } from "@/lib/colors";
import { FADE, riseIn, SPRING } from "@/lib/motion";
import { dayEmoji, NATURE_EMOJI } from "@/lib/emoji";
import { fmtClock, fmtDate, fmtDuration, fmtMiles, fmtStay } from "@/lib/format";
import { type StopSchedule, useSchedule } from "@/lib/schedule";
import { stopsForDay, useTrip } from "@/lib/store";
import { type ClusterWeather, useWeather, weatherKind } from "@/lib/weather";
import type { Day, DayRoute, Stop } from "@/lib/types";

export default function DaysPage() {
  const days = useTrip((s) => s.days);
  const routes = useTrip((s) => s.routes);
  const routesPending = useTrip((s) => s.routesPending);
  const addDay = useTrip((s) => s.addDay);

  const orderedDays = useMemo(() => [...days].sort((a, b) => a.seq - b.seq), [days]);

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
        </div>
      </header>

      <div className="space-y-3.5 px-4 pt-4">
        <AnimatePresence>
          {orderedDays.map((day, i) => (
            <DayCard
              key={day.id}
              day={day}
              index={i}
              total={orderedDays.length}
              route={routes[day.id]}
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
      <p className="mono text-[13px] font-semibold leading-tight">{value}</p>
      <p className="eyebrow mt-0.5">{label}</p>
    </div>
  );
}

function DayCard({
  day,
  index,
  total,
  route,
  onEditStop,
  onAddStop,
  onSuggest,
}: {
  day: Day;
  index: number;
  total: number;
  route?: DayRoute;
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

  // When the day's first stop has an ETA, back out when to leave last night's
  // stay to make it — the departure we never show as its own stop.
  const firstSched = dayStops[0] ? schedule.get(dayStops[0].id) : undefined;
  const leaveMin =
    morningSeg && firstSched
      ? ((firstSched.arrivalMin - morningSeg.durationS / 60) % 1440 + 1440) % 1440
      : undefined;

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
    >
      <div className="flex items-center gap-3">
        <button
          onClick={() => setEmojiOpen(true)}
          aria-label={`Change Day ${day.seq} icon`}
          className="pressable flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border bg-bg-elevated text-lg leading-none"
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

      {(morningSeg || dayStops.length > 0) && <div className="hairline-t mt-3.5" />}

      {morningSeg && (
        <p className="tnum mt-2.5 pl-[26px] text-[11px] text-fg-faint">
          {leaveMin !== undefined && (
            <span
              className={firstSched?.anchored ? "font-semibold text-accent" : "text-fg-muted"}
            >
              {firstSched?.anchored ? "Leave by " : "Leave ~"}
              {fmtClock(leaveMin)}
              {" · "}
            </span>
          )}
          {fmtMiles(morningSeg.distanceM)} · {fmtDuration(morningSeg.durationS)}
          {" from last night's stay"}
        </p>
      )}

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
            animate={{ opacity: 1 }}
            transition={FADE}
            className="flex items-center"
          >
            {confirmDelete ? "Sure?" : <IconTrash size={14} />}
          </motion.span>
        </button>
      </div>

      <DayEmojiSheet day={day} open={emojiOpen} onClose={() => setEmojiOpen(false)} />
    </motion.section>
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
          className="flex h-10 w-8 cursor-grab touch-none items-center justify-center text-fg-faint"
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
