"use client";

import { useRef, useState } from "react";
import Sheet from "./Sheet";
import { IconPin } from "./Icons";
import { geocode, type GeocodeResult } from "@/lib/geocode";
import { useTrip } from "@/lib/store";

/** Search OpenStreetMap by name and add the result to a day. */
export default function AddStopSheet({
  dayId,
  open,
  onClose,
}: {
  dayId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a stop">
      {/* mounts fresh each time the sheet opens, so the search resets itself */}
      <SearchContent dayId={dayId} onClose={onClose} />
    </Sheet>
  );
}

function SearchContent({
  dayId,
  onClose,
}: {
  dayId: string | null;
  onClose: () => void;
}) {
  const addStop = useTrip((s) => s.addStop);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(v: string) {
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await geocode(v));
      } finally {
        setSearching(false);
      }
    }, 450);
  }

  return (
    <>
      <input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search a place — “Hearst Castle”, “Olympia WA”…"
        autoFocus
        className="field mb-3"
      />
      {searching && <div className="skeleton mb-2 h-14 w-full" />}
      <div className="space-y-2">
        {results.map((r, i) => (
          <button
            key={i}
            onClick={() => {
              if (!dayId) return;
              void addStop(dayId, { name: r.name, lat: r.lat, lng: r.lng });
              onClose();
            }}
            className="card pressable flex w-full items-center gap-3 p-3.5 text-left"
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <IconPin size={16} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{r.name}</span>
              <span className="block truncate text-xs text-fg-muted">{r.detail}</span>
            </span>
          </button>
        ))}
      </div>
      {query.length >= 3 && !searching && results.length === 0 && (
        <p className="py-6 text-center text-sm text-fg-muted">No places found.</p>
      )}
      <p className="mt-4 text-center text-[10px] text-fg-faint">
        Search © OpenStreetMap contributors
      </p>
    </>
  );
}
