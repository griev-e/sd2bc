"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import CountdownPill from "@/components/CountdownPill";
import { StopKindIcon, WeatherIcon } from "@/components/CategoryIcon";
import { IconSparkle, IconWave, IconX } from "@/components/Icons";
import StopEditSheet from "@/components/StopEditSheet";
import SuggestSheet from "@/components/SuggestSheet";
import Sheet from "@/components/Sheet";
import { dayColor, KIND_COLOR } from "@/lib/colors";
import { NOMINATIM_URL } from "@/lib/config";
import { fmtDuration, fmtMiles } from "@/lib/format";
import type { LngLat } from "@/lib/geo";
import { useTrip } from "@/lib/store";
import { useWeather, weatherKind, WEATHER_LABEL } from "@/lib/weather";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center">
      <div className="skeleton h-12 w-12 rounded-full" />
    </div>
  ),
});

export default function MapPage() {
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const routes = useTrip((s) => s.routes);
  const routesPending = useTrip((s) => s.routesPending);
  const routeError = useTrip((s) => s.routeError);
  const selectedDayId = useTrip((s) => s.selectedDayId);
  const selectedStopId = useTrip((s) => s.selectedStopId);
  const setSelectedDay = useTrip((s) => s.setSelectedDay);
  const setSelectedStop = useTrip((s) => s.setSelectedStop);
  const addStop = useTrip((s) => s.addStop);

  const [editOpen, setEditOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ lngLat: LngLat; name: string } | null>(null);
  const [pinDayId, setPinDayId] = useState<string | null>(null);

  const orderedDays = useMemo(() => [...days].sort((a, b) => a.seq - b.seq), [days]);
  const selectedStop = stops.find((s) => s.id === selectedStopId) ?? null;
  const stopWeather = useWeather((s) =>
    selectedStop ? s.byDay[selectedStop.day_id] : undefined,
  );

  // segment arriving at the selected stop
  const incoming = useMemo(() => {
    if (!selectedStop) return null;
    for (const r of Object.values(routes)) {
      const seg = r.segments.find((s) => s.toStopId === selectedStop.id);
      if (seg) return seg;
    }
    return null;
  }, [routes, selectedStop]);

  async function handleLongPress(lngLat: LngLat) {
    let name = "Dropped pin";
    try {
      const res = await fetch(
        `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${lngLat[1]}&lon=${lngLat[0]}&zoom=14`,
      );
      if (res.ok) {
        const json = await res.json();
        name = (json.name as string) || (json.display_name as string)?.split(",")[0] || name;
      }
    } catch {
      // keep default name
    }
    setPinDayId(selectedDayId ?? orderedDays[0]?.id ?? null);
    setPendingPin({ lngLat, name });
  }

  return (
    <div className="fixed inset-0">
      <MapView
        onSelectStop={() => setEditOpen(false)}
        onLongPress={handleLongPress}
      />

      {/* header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 pt-safe">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 pt-3">
          <div className="glass pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pl-3 pr-4">
            <IconWave size={15} strokeWidth={1.8} className="text-accent" />
            <span className="display text-[15px] leading-none">coastline</span>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            {routesPending && (
              <span className="glass rounded-full px-3 py-1.5 text-xs text-fg-muted">
                routing…
              </span>
            )}
            <CountdownPill />
          </div>
        </div>

        {/* day filter chips */}
        <div className="no-scrollbar pointer-events-auto mx-auto mt-2.5 flex max-w-md gap-1.5 overflow-x-auto px-4 pb-1">
          <button
            onClick={() => setSelectedDay(null)}
            className={`glass pressable flex-shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold ${
              selectedDayId === null ? "text-accent" : "text-fg-muted"
            }`}
          >
            All days
          </button>
          {orderedDays.map((d, i) => (
            <button
              key={d.id}
              onClick={() => setSelectedDay(selectedDayId === d.id ? null : d.id)}
              className={`glass pressable flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${
                selectedDayId === d.id ? "text-accent" : "text-fg-muted"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: dayColor(i, orderedDays.length) }}
              />
              <span className="tnum">{d.seq}</span>
            </button>
          ))}
        </div>
      </div>

      {routeError && (
        <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+110px)] z-10 flex justify-center px-4">
          <p className="glass rounded-full px-4 py-2 text-xs text-danger">{routeError}</p>
        </div>
      )}

      {/* suggest button */}
      <button
        onClick={() => setSuggestOpen(true)}
        className="glass-strong pressable absolute bottom-[calc(env(safe-area-inset-bottom)+92px)] right-4 z-10 flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold text-accent"
      >
        <IconSparkle size={15} strokeWidth={2} />
        Suggest
      </button>

      {/* selected stop card */}
      {selectedStop && !editOpen && (
        <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-10 mx-auto max-w-md px-4">
          <div className="glass-strong rise-in flex items-center gap-3 rounded-2xl p-4">
            <div
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
              style={{
                background: KIND_COLOR[selectedStop.kind].bg,
                color: KIND_COLOR[selectedStop.kind].fg,
              }}
            >
              <StopKindIcon kind={selectedStop.kind} size={19} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold leading-tight tracking-tight">
                {selectedStop.name}
              </p>
              <p className="tnum mt-0.5 text-xs text-fg-muted">
                Day {orderedDays.find((d) => d.id === selectedStop.day_id)?.seq}
                {incoming && (
                  <>
                    {" · "}
                    {fmtMiles(incoming.distanceM)} · {fmtDuration(incoming.durationS)} drive
                  </>
                )}
                {selectedStop.is_overnight && " · overnight"}
              </p>
              {stopWeather && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
                  <WeatherIcon
                    kind={weatherKind(stopWeather.code)}
                    size={13}
                    strokeWidth={2}
                    className="text-accent"
                  />
                  {WEATHER_LABEL[weatherKind(stopWeather.code)]}
                  <span className="tnum">
                    {stopWeather.tMaxF}° / {stopWeather.tMinF}°
                  </span>
                </p>
              )}
            </div>
            <button
              onClick={() => setEditOpen(true)}
              className="btn-primary pressable rounded-xl px-3.5 py-2.5 text-xs font-semibold"
            >
              Edit
            </button>
            <button
              onClick={() => setSelectedStop(null)}
              aria-label="Dismiss"
              className="pressable -mr-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-fg-faint"
            >
              <IconX size={12} />
            </button>
          </div>
        </div>
      )}

      <StopEditSheet
        stop={selectedStop}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />

      <SuggestSheet
        dayId={selectedDayId ?? orderedDays[0]?.id ?? null}
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
      />

      {/* long-press: add stop */}
      <Sheet
        open={pendingPin !== null}
        onClose={() => setPendingPin(null)}
        title="Add stop here?"
      >
        {pendingPin && (
          <div className="space-y-4">
            <input
              value={pendingPin.name}
              onChange={(e) => setPendingPin({ ...pendingPin, name: e.target.value })}
              className="field font-medium"
            />
            <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
              {orderedDays.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setPinDayId(d.id)}
                  className={`pressable flex-shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ${
                    pinDayId === d.id ? "btn-primary" : "border border-hairline text-fg-muted"
                  }`}
                >
                  Day {d.seq}
                </button>
              ))}
            </div>
            <button
              disabled={!pinDayId || !pendingPin.name.trim()}
              onClick={() => {
                if (!pinDayId) return;
                void addStop(pinDayId, {
                  name: pendingPin.name.trim(),
                  lat: pendingPin.lngLat[1],
                  lng: pendingPin.lngLat[0],
                });
                setPendingPin(null);
              }}
              className="btn-primary pressable h-12 w-full rounded-xl font-semibold disabled:opacity-50"
            >
              Add stop
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
