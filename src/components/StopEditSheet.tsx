"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import AttributionDot from "./Attribution";
import { StopKindIcon } from "./CategoryIcon";
import { useTrip } from "@/lib/store";
import { fmtDate } from "@/lib/format";
import type { Stop, StopKind } from "@/lib/types";

export const KIND_META: { key: StopKind; label: string }[] = [
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
      {stop && <StopForm key={stop.id} stop={stop} onClose={onClose} />}
    </Sheet>
  );
}

/** Mounted fresh per stop (keyed), so field state initializes from props. */
function StopForm({ stop, onClose }: { stop: Stop; onClose: () => void }) {
  const days = useTrip((s) => s.days);
  const updateStop = useTrip((s) => s.updateStop);
  const deleteStop = useTrip((s) => s.deleteStop);
  const moveStopToDay = useTrip((s) => s.moveStopToDay);

  const [name, setName] = useState(stop.name);
  const [notes, setNotes] = useState(stop.notes);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const orderedDays = [...days].sort((a, b) => a.seq - b.seq);

  function commitText() {
    const patch: Partial<Stop> = {};
    if (name.trim() && name !== stop.name) patch.name = name.trim();
    if (notes !== stop.notes) patch.notes = notes;
    if (Object.keys(patch).length > 0) void updateStop(stop.id, patch);
  }

  // If the sheet is dismissed while an input still has focus, blur never
  // fires — commit any pending text on unmount instead.
  const commitRef = useRef(commitText);
  useEffect(() => {
    commitRef.current = commitText;
  });
  useEffect(() => () => commitRef.current(), []);

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
          {KIND_META.map((k) => (
            <button
              key={k.key}
              onClick={() => void updateStop(stop.id, { kind: k.key })}
              className={`pressable flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium ${
                stop.kind === k.key
                  ? "btn-primary"
                  : "border border-hairline text-fg-muted"
              }`}
            >
              <StopKindIcon kind={k.key} size={14} />
              {k.label}
            </button>
          ))}
        </div>
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

      <div>
        <p className="eyebrow mb-2 px-0.5">Day</p>
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {orderedDays.map((d) => (
            <button
              key={d.id}
              onClick={() => stop.day_id !== d.id && void moveStopToDay(stop.id, d.id)}
              className={`pressable flex-shrink-0 rounded-xl px-3 py-2 text-xs ${
                stop.day_id === d.id
                  ? "btn-primary"
                  : "border border-hairline text-fg-muted"
              }`}
            >
              <span className="tnum font-semibold">Day {d.seq}</span>
              <span className="ml-1 opacity-70">{fmtDate(d.date).slice(5)}</span>
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commitText}
        placeholder="Notes — reservations, ideas, links…"
        rows={3}
        className="field h-auto w-full py-3"
      />

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
