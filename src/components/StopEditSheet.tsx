"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import AttributionDot from "./Attribution";
import { StopKindIcon } from "./CategoryIcon";
import { IconLink } from "./Icons";
import { KIND_COLOR } from "@/lib/colors";
import { useTrip } from "@/lib/store";
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
