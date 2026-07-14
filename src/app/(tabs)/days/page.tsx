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
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import AddStopSheet from "@/components/AddStopSheet";
import AttributionDot from "@/components/Attribution";
import CountdownPill from "@/components/CountdownPill";
import { StopKindIcon, WeatherIcon } from "@/components/CategoryIcon";
import { IconGrip, IconMoon, IconPlus, IconSparkle } from "@/components/Icons";
import StopEditSheet from "@/components/StopEditSheet";
import SuggestSheet from "@/components/SuggestSheet";
import { dayColor, KIND_COLOR } from "@/lib/colors";
import { fmtClock, fmtDate, fmtDuration, fmtMiles } from "@/lib/format";
import { stopsForDay, useTrip } from "@/lib/store";
import { useWeather, weatherKind } from "@/lib/weather";
import type { Day, DayRoute, Stop } from "@/lib/types";

const DAY_START_MIN = 9 * 60; // depart 9:00 AM
const DWELL_MIN = 45; // default time spent at each stop

export default function DaysPage() {
  const days = useTrip((s) => s.days);
  const routes = useTrip((s) => s.routes);
  const routesPending = useTrip((s) => s.routesPending);

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
              <p className="eyebrow">SAN → YVR → SAN</p>
              <h1 className="display mt-0.5 text-[22px] tracking-tight">Itinerary</h1>
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
  const setSelectedDay = useTrip((s) => s.setSelectedDay);
  const setSelectedStop = useTrip((s) => s.setSelectedStop);

  const dayStops = stopsForDay(stops, day.id);
  const color = dayColor(index, total);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  // arrival clock estimate per stop (9:00 departure + drives + dwell)
  const arrivals = useMemo(() => {
    const map = new Map<string, number>();
    if (!route) return map;
    let t = DAY_START_MIN;
    for (const seg of route.segments) {
      t += seg.durationS / 60;
      map.set(seg.toStopId, t);
      t += DWELL_MIN;
    }
    return map;
  }, [route]);

  const segByFrom = useMemo(() => {
    const m = new Map<string, { distanceM: number; durationS: number }>();
    for (const seg of route?.segments ?? []) m.set(seg.fromStopId, seg);
    return m;
  }, [route]);

  const morningSeg = useMemo(() => {
    if (!route || dayStops.length === 0) return null;
    return route.segments.find((s) => s.toStopId === dayStops[0].id) ?? null;
  }, [route, dayStops]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = dayStops.map((s) => s.id);
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    void reorderStops(day.id, arrayMove(ids, from, to));
  }

  return (
    <section className="card p-4">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => {
          setSelectedDay(day.id);
          router.push("/map");
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="mono flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-bg-elevated text-[11px] font-semibold"
            style={{ color }}
          >
            {String(day.seq).padStart(2, "0")}
          </span>
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
        </div>
        <div className="text-right">
          {route && route.distanceM > 0 ? (
            <>
              <p className="mono text-xs font-semibold text-fg-muted">{fmtMiles(route.distanceM)}</p>
              <p className="mono mt-0.5 text-[10px] text-fg-faint">{fmtDuration(route.durationS)}</p>
            </>
          ) : (
            <span className="text-xs text-fg-faint">—</span>
          )}
        </div>
      </button>

      {(morningSeg || dayStops.length > 0) && <div className="hairline-t mt-3.5" />}

      {morningSeg && (
        <p className="tnum mt-2.5 pl-[26px] text-[11px] text-fg-faint">
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
                arrival={arrivals.get(stop.id)}
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
      </div>
    </section>
  );
}

function SortableStop({
  stop,
  isLast,
  arrival,
  seg,
  onTap,
}: {
  stop: Stop;
  isLast: boolean;
  arrival?: number;
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
            {arrival !== undefined ? `~${fmtClock(arrival)}` : "departure"}
            {stop.notes && " · note"}
          </p>
        </div>
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
