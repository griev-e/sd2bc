"use client";

import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import { StopKindIcon } from "./CategoryIcon";
import { geocode, type GeocodeResult } from "@/lib/geocode";
import { KIND_COLOR } from "@/lib/colors";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // monotonically increasing request id — a slow early response must never
  // overwrite the results of a later query
  const requestSeq = useRef(0);

  // focus for immediate typing, but preventScroll — plain autoFocus makes
  // the browser scroll the page behind the sheet to "reveal" the input
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      requestSeq.current++; // orphan any in-flight search on unmount
    },
    [],
  );

  function onChange(v: string) {
    setQuery(v);
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

  return (
    <>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search a place — “Hearst Castle”, “Olympia WA”…"
        className="field mb-3"
      />
      {searching && <div className="skeleton mb-2 h-14 w-full" />}
      {results.length > 0 && (
        <div className="card overflow-hidden">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => {
                if (!dayId) return;
                void addStop(dayId, { name: r.name, lat: r.lat, lng: r.lng, kind: r.kind });
                onClose();
              }}
              className={`flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-fg/5 ${
                i > 0 ? "hairline-t" : ""
              }`}
            >
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                style={{ background: KIND_COLOR[r.kind].bg, color: KIND_COLOR[r.kind].fg }}
              >
                <StopKindIcon kind={r.kind} size={16} strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="block truncate text-xs text-fg-muted">{r.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {query.length >= 3 && !searching && results.length === 0 && (
        <p className="py-6 text-center text-sm text-fg-muted">No places found.</p>
      )}
      <p className="mt-4 text-center text-[10px] text-fg-faint">
        Search © OpenStreetMap contributors
      </p>
    </>
  );
}
