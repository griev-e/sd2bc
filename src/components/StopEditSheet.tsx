"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import AttributionDot from "./Attribution";
import { StopKindIcon } from "./CategoryIcon";
import { IconLink, IconPin, IconX } from "./Icons";
import { KIND_COLOR } from "@/lib/colors";
import { fmtClock } from "@/lib/format";
import { geocode, reverseGeocode, type GeocodeResult } from "@/lib/geocode";
import { DAY_START_MIN, minutesToHHMM, useSchedule } from "@/lib/schedule";
import { stopsForDay, useTrip } from "@/lib/store";
import type { Stop, StopKind } from "@/lib/types";

/** Preset lengths of stay offered in the editor; null = a pass-through. */
const STAY_PRESETS: [number | null, string][] = [
  [null, "None"],
  [30, "30m"],
  [60, "1h"],
  [90, "1.5h"],
  [120, "2h"],
];
const PRESET_MINS = STAY_PRESETS.map(([m]) => m);

const KIND_META: { key: StopKind; label: string }[] = [
  { key: "stop", label: "Stop" },
  { key: "scenic", label: "Scenic" },
  { key: "food", label: "Food" },
  { key: "fuel", label: "Fuel" },
  { key: "activity", label: "Activity" },
  { key: "beach", label: "Beach" },
  { key: "lodging", label: "Lodging" },
];

export default function StopEditSheet({
  stop,
  open,
  onClose,
}: {
  stop: Stop | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open && stop !== null} onClose={onClose} title="Stop details">
      {stop && <StopForm key={stop.id} stopId={stop.id} onClose={onClose} />}
    </Sheet>
  );
}

/**
 * Reads the *live* stop from the store (not a passed snapshot) so type,
 * overnight, and lodging toggles reflect instantly. Text fields keep local
 * state and commit on blur / unmount.
 */
function StopForm({ stopId, onClose }: { stopId: string; onClose: () => void }) {
  const stop = useTrip((s) => s.stops.find((x) => x.id === stopId));
  const updateStop = useTrip((s) => s.updateStop);
  const deleteStop = useTrip((s) => s.deleteStop);

  // Is this the very first stop of the trip? Then its time is a *departure*
  // ("leave home at 8"), not an arrival, and it has no stay to plan.
  const isOrigin = useTrip((s) => {
    if (!stop) return false;
    const firstDay = [...s.days].sort((a, b) => a.seq - b.seq)[0];
    if (!firstDay) return false;
    return stopsForDay(s.stops, firstDay.id)[0]?.id === stop.id;
  });

  // Live ETA for this stop — used to prefill the time picker so pinning a time
  // starts from the estimate rather than a blank field.
  const schedule = useSchedule();
  const sched = stop ? schedule.get(stop.id) : undefined;
  const anchorSeed = sched?.arrivalMin ?? DAY_START_MIN;

  const [name, setName] = useState(stop?.name ?? "");
  const [notes, setNotes] = useState(stop?.notes ?? "");
  const [lodgingUrl, setLodgingUrl] = useState(stop?.lodging_url ?? "");
  const [lodgingCost, setLodgingCost] = useState(
    stop?.lodging_cost != null ? String(stop.lodging_cost) : "",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  function commitText() {
    if (!stop) return;
    const patch: Partial<Stop> = {};
    if (name.trim() && name !== stop.name) patch.name = name.trim();
    if (notes !== stop.notes) patch.notes = notes;

    const url = lodgingUrl.trim();
    if (url !== (stop.lodging_url ?? "")) patch.lodging_url = url || null;

    const parsed = lodgingCost.trim() ? Math.round(Number(lodgingCost.replace(/[^0-9.]/g, ""))) : 0;
    const nextCost = parsed > 0 ? parsed : null;
    if (nextCost !== (stop.lodging_cost ?? null)) patch.lodging_cost = nextCost;

    if (Object.keys(patch).length > 0) void updateStop(stop.id, patch);
  }

  // The sheet can dismiss while an input still has focus (blur never fires) —
  // commit any pending text on unmount.
  const commitRef = useRef(commitText);
  useEffect(() => {
    commitRef.current = commitText;
  });
  useEffect(() => () => commitRef.current(), []);

  if (!stop) return null;

  const isLodging = stop.is_overnight || stop.kind === "lodging";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitText}
          className="field font-medium"
        />
        <AttributionDot userId={stop.updated_by ?? stop.created_by} size={18} />
      </div>

      <div>
        <p className="eyebrow mb-2 px-0.5">Type</p>
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {KIND_META.map((k) => {
            const active = stop.kind === k.key;
            const color = KIND_COLOR[k.key];
            return (
              <button
                key={k.key}
                onClick={() => void updateStop(stop.id, { kind: k.key })}
                className={`pressable flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium ${
                  active ? "font-semibold" : "border border-hairline text-fg-muted"
                }`}
                style={
                  active
                    ? { background: color.bg, color: color.fg, border: `1px solid ${color.fg}` }
                    : undefined
                }
              >
                <StopKindIcon kind={k.key} size={14} />
                {k.label}
              </button>
            );
          })}
        </div>
      </div>

      <AddressField stop={stop} updateStop={updateStop} />

      {/* Planned stay — pushes the next stop's ETA, independent of any pinned
          time. The origin has no stay (you just leave). */}
      {!isOrigin && <StaySection stop={stop} updateStop={updateStop} />}

      {/* Optional anchor — pins a time and re-seeds the ETA chain from here.
          Prefills from the live estimate so you adjust rather than override. */}
      <div>
        <p className="eyebrow mb-2 px-0.5">
          {isOrigin ? "Departure time" : "Arrival time"}
        </p>
        {stop.start_time ? (
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={stop.start_time}
              onChange={(e) =>
                void updateStop(stop.id, { start_time: e.target.value || null })
              }
              className="field flex-1"
              aria-label={isOrigin ? "Departure time" : "Arrival time"}
            />
            <button
              onClick={() => void updateStop(stop.id, { start_time: null })}
              aria-label="Clear time"
              className="btn-ghost pressable flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-xl"
            >
              <IconX size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() =>
              void updateStop(stop.id, { start_time: minutesToHHMM(anchorSeed) })
            }
            className="field pressable flex w-full items-center justify-between text-left"
          >
            <span className="text-fg-muted">
              {isOrigin ? "Set departure time" : "Pin an arrival time"}
            </span>
            <span className="tnum font-semibold text-accent">
              {fmtClock(anchorSeed)}
            </span>
          </button>
        )}
        <p className="mt-1.5 px-0.5 text-[11px] leading-4 text-fg-faint">
          {stop.start_time
            ? isOrigin
              ? "You leave at this time — every ETA downstream follows from here."
              : "Locked — the ETA bends to this time, and later stops shift with it."
            : isOrigin
              ? "Defaults to 9:00 AM. Set when you'll head out."
              : `Optional — otherwise we estimate ~${fmtClock(anchorSeed)}. Pin it for reservations or check-ins.`}
        </p>
      </div>

      <label className="card flex min-h-[52px] items-center justify-between rounded-2xl px-4 py-3">
        <span className="text-sm font-medium">Overnight stay</span>
        <input
          type="checkbox"
          className="check-pill"
          checked={stop.is_overnight}
          onChange={(e) =>
            void updateStop(stop.id, {
              is_overnight: e.target.checked,
              kind: e.target.checked ? "lodging" : stop.kind,
            })
          }
        />
      </label>

      {/* lodging details — only when this is a place we sleep */}
      {isLodging && (
        <div className="space-y-3">
          <label className="card flex min-h-[52px] items-center justify-between rounded-2xl px-4 py-3">
            <span>
              <span className="block text-sm font-medium">Free stay</span>
              <span className="text-xs text-fg-faint">Family or friends — $0 in the budget</span>
            </span>
            <input
              type="checkbox"
              className="check-pill"
              checked={stop.lodging_free}
              onChange={(e) => void updateStop(stop.id, { lodging_free: e.target.checked })}
            />
          </label>

          {!stop.lodging_free && (
            <div>
              <p className="eyebrow mb-2 px-0.5">Nightly cost</p>
              <input
                value={lodgingCost}
                onChange={(e) => setLodgingCost(e.target.value)}
                onBlur={commitText}
                placeholder="Leave blank for the regional estimate"
                inputMode="numeric"
                className="field"
              />
            </div>
          )}

          <div>
            <p className="eyebrow mb-2 px-0.5">Booking link</p>
            <div className="flex items-center gap-2">
              <input
                value={lodgingUrl}
                onChange={(e) => setLodgingUrl(e.target.value)}
                onBlur={commitText}
                placeholder="Paste an Expedia / hotel itinerary link"
                autoCapitalize="none"
                autoCorrect="off"
                className="field flex-1"
              />
              {stop.lodging_url && (
                <a
                  href={stop.lodging_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open booking link"
                  className="btn-ghost pressable flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-xl text-accent"
                >
                  <IconLink size={17} />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="eyebrow mb-2 px-0.5">Notes</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitText}
          placeholder="Reservations, ideas, links, who to call…"
          rows={7}
          className="field h-auto w-full resize-none py-3 leading-6"
        />
      </div>

      <button
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true);
            return;
          }
          void deleteStop(stop.id);
          onClose();
        }}
        className={`pressable h-12 w-full rounded-2xl text-sm font-semibold ${
          confirmDelete ? "bg-danger text-white" : "bg-danger/10 text-danger"
        }`}
      >
        {confirmDelete ? "Tap again to confirm" : "Remove stop"}
      </button>
    </div>
  );
}

/**
 * The stop's address, kept two-way in sync with its map pin.
 *
 * - **Type or paste** an address → debounced Nominatim search surfaces matching
 *   places (a pasted hotel address brings up the hotel). Picking a result
 *   writes the address *and* moves the stop's pin (lat/lng) to it.
 * - **Blank field** → we reverse-geocode the pin and show where it sits, so the
 *   address always reads consistent with the map. That fill stays local and is
 *   never auto-persisted: a plain view mustn't write to the shared row or spam
 *   the activity feed. It sticks only if you keep it (blur) or edit it.
 */
function AddressField({
  stop,
  updateStop,
}: {
  stop: Stop;
  updateStop: (id: string, patch: Partial<Stop>) => Promise<void>;
}) {
  const [value, setValue] = useState(stop.address ?? "");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  // Has the user actually engaged with the field? Guards against persisting a
  // reverse-geocoded fill that they only ever looked at.
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // monotonic request id — a slow early response must never overwrite a later
  // query's results (same guard as the add-stop search).
  const requestSeq = useRef(0);

  // Empty address? Read it back from wherever the pin currently sits. Only fires
  // when there's nothing stored, so it re-derives at most once per open of an
  // address-less stop — well within Nominatim etiquette.
  useEffect(() => {
    if ((stop.address ?? "") !== "" || touched.current) return;
    let cancelled = false;
    void reverseGeocode(stop.lat, stop.lng).then((r) => {
      if (cancelled || !r || touched.current) return;
      setValue((v) => (v === "" ? r.label : v));
    });
    return () => {
      cancelled = true;
    };
  }, [stop.address, stop.lat, stop.lng]);

  // The sheet can dismiss while the input still has focus (blur never fires) —
  // commit any pending text on unmount, and orphan any in-flight search.
  const commitRef = useRef<() => void>(() => {});
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      requestSeq.current++;
      commitRef.current();
    },
    [],
  );

  function onChange(v: string) {
    touched.current = true;
    setValue(v);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 3) {
      requestSeq.current++;
      setResults([]);
      setSearching(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const id = ++requestSeq.current;
      setSearching(true);
      try {
        const found = await geocode(v);
        if (id === requestSeq.current) setResults(found);
      } catch {
        if (id === requestSeq.current) setResults([]);
      } finally {
        if (id === requestSeq.current) setSearching(false);
      }
    }, 450);
  }

  // Picking a result is the one path that moves the pin — address and location
  // land together, so the two can never drift.
  function select(r: GeocodeResult) {
    touched.current = true;
    requestSeq.current++; // drop any in-flight search
    setValue(r.label);
    setResults([]);
    setOpen(false);
    void updateStop(stop.id, { address: r.label, lat: r.lat, lng: r.lng });
  }

  // Commit typed text on blur, but never a mere reverse-geocoded fill.
  function commit() {
    if (!touched.current) return;
    const next = value.trim();
    if (next === (stop.address ?? "")) return;
    void updateStop(stop.id, { address: next || null });
  }

  return (
    <div>
      <p className="eyebrow mb-2 px-0.5">Address</p>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={commit}
          placeholder="Search or paste an address…"
          autoCapitalize="words"
          autoCorrect="off"
          className="field flex-1"
        />
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            value.trim() || `${stop.lat},${stop.lng}`,
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in maps"
          className="btn-ghost pressable flex h-[46px] w-[46px] flex-shrink-0 items-center justify-center rounded-xl text-accent"
        >
          <IconPin size={17} />
        </a>
      </div>

      {open && (searching || results.length > 0) && (
        <div className="mt-2 space-y-1.5">
          {searching && results.length === 0 && (
            <div className="skeleton h-12 w-full" />
          )}
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              // pointer-down + preventDefault keeps the input from blurring
              // (which would tear this list down before the tap registers).
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => select(r)}
              className="card pressable flex w-full items-center gap-3 p-3 text-left"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <IconPin size={14} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {r.name}
                </span>
                <span className="block truncate text-xs text-fg-muted">
                  {r.detail}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="mt-1.5 px-0.5 text-[11px] leading-4 text-fg-faint">
        Pick a result to move the pin here. Left blank, it fills in from the
        pin&rsquo;s location.
      </p>
    </div>
  );
}

/**
 * How long we linger at a stop — feeds the next stop's ETA. Presets cover the
 * common cases; "Custom" opens an hours/minutes entry for anything else.
 */
function StaySection({
  stop,
  updateStop,
}: {
  stop: Stop;
  updateStop: (id: string, patch: Partial<Stop>) => Promise<void>;
}) {
  const isCustomValue =
    stop.duration_min != null && !PRESET_MINS.includes(stop.duration_min);
  const [customOpen, setCustomOpen] = useState(isCustomValue);
  const [h, setH] = useState(
    isCustomValue ? String(Math.floor(stop.duration_min! / 60)) : "",
  );
  const [m, setM] = useState(isCustomValue ? String(stop.duration_min! % 60) : "");

  function commit(hv: string, mv: string) {
    const total = (parseInt(hv || "0", 10) || 0) * 60 + (parseInt(mv || "0", 10) || 0);
    void updateStop(stop.id, { duration_min: total > 0 ? total : null });
  }

  return (
    <div>
      <p className="eyebrow mb-2 px-0.5">Time at this stop</p>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {STAY_PRESETS.map(([mins, label]) => {
          const active = !customOpen && (stop.duration_min ?? null) === mins;
          return (
            <button
              key={label}
              onClick={() => {
                setCustomOpen(false);
                void updateStop(stop.id, { duration_min: mins });
              }}
              className={`pressable flex-shrink-0 rounded-full px-3 py-2 text-xs font-semibold ${
                active
                  ? "bg-accent-soft text-accent ring-1 ring-accent"
                  : "border border-hairline text-fg-muted"
              }`}
            >
              {label}
            </button>
          );
        })}
        <button
          onClick={() => setCustomOpen(true)}
          className={`pressable flex-shrink-0 rounded-full px-3 py-2 text-xs font-semibold ${
            customOpen
              ? "bg-accent-soft text-accent ring-1 ring-accent"
              : "border border-hairline text-fg-muted"
          }`}
        >
          Custom
        </button>
      </div>
      {customOpen && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={h}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              setH(v);
              commit(v, m);
            }}
            inputMode="numeric"
            placeholder="0"
            aria-label="Hours"
            className="field w-16 text-center"
          />
          <span className="text-xs text-fg-muted">hr</span>
          <input
            value={m}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              setM(v);
              commit(h, v);
            }}
            inputMode="numeric"
            placeholder="0"
            aria-label="Minutes"
            className="field w-16 text-center"
          />
          <span className="text-xs text-fg-muted">min</span>
        </div>
      )}
      <p className="mt-1.5 px-0.5 text-[11px] leading-4 text-fg-faint">
        How long you&rsquo;ll stay — the next stop&rsquo;s ETA starts once you leave.
      </p>
    </div>
  );
}
