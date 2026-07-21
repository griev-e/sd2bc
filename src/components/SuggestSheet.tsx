"use client";

import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import { StopKindIcon } from "./CategoryIcon";
import {
  SUGGESTION_CATEGORIES,
  suggestAlongRoute,
  type Suggestion,
  type SuggestionCategory,
} from "@/lib/overpass";
import { KIND_COLOR } from "@/lib/colors";
import { fmtDuration, fmtMiles } from "@/lib/format";
import { useTrip } from "@/lib/store";
import { useSuggestionPreview } from "@/lib/suggestionPreview";
import type { StopKind } from "@/lib/types";

const KIND_FOR_CATEGORY: Record<SuggestionCategory, StopKind> = {
  food: "food",
  gas: "fuel",
  scenic: "scenic",
  attractions: "activity",
  lodging: "lodging",
  beach: "beach",
};

const TYPE_LABEL: Record<string, string> = {
  museum: "Museum",
  aquarium: "Aquarium",
  zoo: "Zoo",
  camp_site: "Campground",
  guest_house: "Guest house",
  motel: "Motel",
  hotel: "Hotel",
};

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Seed the new stop's notes with the useful OSM metadata the card can't show —
 * otherwise cuisine/stars/website are simply thrown away on "Add to day".
 */
function enrichmentNotes(s: Suggestion): string | undefined {
  const bits: string[] = [];
  if (s.tags.cuisine) {
    bits.push(s.tags.cuisine.split(";").slice(0, 3).map(titleCase).join(", "));
  }
  const stars = parseInt(s.tags.stars ?? "", 10);
  if (stars > 0) bits.push(`${Math.min(stars, 5)}★`);
  if (s.tags.brand) bits.push(s.tags.brand);
  if (s.tags.website) bits.push(s.tags.website);
  if (s.tags.wikipedia) bits.push(`Wikipedia: ${s.tags.wikipedia}`);
  return bits.length > 0 ? `From OpenStreetMap: ${bits.join(" · ")}` : undefined;
}

/** One-line descriptor pulled from OSM tags: cuisine, stars, type, or brand. */
function detailFor(s: Suggestion): string | null {
  const t = s.tags;
  if (t.cuisine) return t.cuisine.split(";").slice(0, 2).map(titleCase).join(" · ");
  const stars = parseInt(t.stars ?? "", 10);
  if (stars > 0) return "★".repeat(Math.min(stars, 5));
  const type = TYPE_LABEL[t.tourism ?? ""];
  if (type) return type;
  if (t.brand) return t.brand;
  return null;
}

export default function SuggestSheet({
  dayId,
  open,
  onClose,
}: {
  dayId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const days = useTrip((s) => s.days);
  const [category, setCategory] = useState<SuggestionCategory>("food");
  const day = days.find((d) => d.id === dayId);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={day ? `Near Day ${day.seq}'s route` : "Suggestions"}
    >
      <div className="no-scrollbar -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1">
        {SUGGESTION_CATEGORIES.map((c) => {
          const color = KIND_COLOR[KIND_FOR_CATEGORY[c.key]];
          const active = category === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`pressable flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${
                active ? "" : "border border-hairline text-fg-muted"
              }`}
              style={
                active
                  ? { background: color.bg, color: color.fg, border: `1px solid ${color.fg}` }
                  : undefined
              }
            >
              <StopKindIcon kind={KIND_FOR_CATEGORY[c.key]} size={13} strokeWidth={2} />
              {c.label}
            </button>
          );
        })}
      </div>
      {/* keyed remount per day+category → results state resets without effects */}
      <Results key={`${dayId}-${category}`} dayId={dayId} category={category} />
    </Sheet>
  );
}

function Results({
  dayId,
  category,
}: {
  dayId: string | null;
  category: SuggestionCategory;
}) {
  const routes = useTrip((s) => s.routes);
  const addStop = useTrip((s) => s.addStop);
  const setPins = useSuggestionPreview((s) => s.setPins);
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);

  const route = dayId ? routes[dayId] : undefined;
  const hasRoute = !!route && route.coordinates.length >= 2;

  // mirror the results onto the map as preview pins while the sheet is up;
  // this component unmounts with the sheet, which clears them
  useEffect(() => {
    setPins(results ?? []);
    return () => setPins([]);
  }, [results, setPins]);

  useEffect(() => {
    if (!hasRoute || !route) return;
    let cancelled = false;
    suggestAlongRoute(route.coordinates, category)
      .then((r) => !cancelled && setResults(r))
      .catch(
        () =>
          !cancelled &&
          setError("OpenStreetMap is being slow right now — give it another go."),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRoute, category, dayId, attempt]);

  if (!hasRoute) {
    return (
      <p className="py-8 text-center text-sm text-fg-muted">
        Pick a day with a driving route first.
      </p>
    );
  }
  if (error) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-fg-muted">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setResults(null);
            setAttempt((a) => a + 1);
          }}
          className="btn-primary pressable mt-4 h-10 rounded-xl px-6 text-sm font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }
  if (results === null) {
    return (
      <div>
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-36 w-40 flex-shrink-0" />
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-fg-faint">
          Asking OpenStreetMap — usually a few seconds, sometimes ~30.
        </p>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-fg-muted">
        Nothing close to the route — try another category.
      </p>
    );
  }

  return (
    <>
      <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2">
        {results.map((s) => {
          const isAdded = added.has(s.id);
          const detail = detailFor(s);
          return (
            <div key={s.id} className="card flex w-44 flex-shrink-0 snap-start flex-col p-3.5">
              <div
                className="mb-2.5 flex h-14 items-center justify-center rounded-xl"
                style={{
                  background: KIND_COLOR[KIND_FOR_CATEGORY[s.category]].bg,
                  color: KIND_COLOR[KIND_FOR_CATEGORY[s.category]].fg,
                }}
              >
                <StopKindIcon kind={KIND_FOR_CATEGORY[s.category]} size={22} />
              </div>
              <p className="line-clamp-2 text-sm font-semibold leading-tight tracking-tight">
                {s.notable && (
                  <span title="Has a Wikipedia entry" className="mr-1">
                    ⭐
                  </span>
                )}
                {s.name}
              </p>
              {detail && (
                <p className="mt-0.5 line-clamp-1 text-[11px] font-medium text-fg-muted">
                  {detail}
                </p>
              )}
              <p className="tnum mb-2.5 mt-1 text-[11px] text-fg-muted">
                {fmtMiles(s.offRouteM)} off route
                {s.detourS > 90 && ` · +${fmtDuration(s.detourS)}`}
              </p>
              <button
                disabled={isAdded || !dayId}
                onClick={() => {
                  if (!dayId) return;
                  void addStop(dayId, {
                    name: s.name,
                    lat: s.lat,
                    lng: s.lng,
                    kind: KIND_FOR_CATEGORY[s.category],
                    notes: enrichmentNotes(s),
                  });
                  setAdded(new Set(added).add(s.id));
                }}
                className={`pressable mt-auto h-9 rounded-xl text-xs font-semibold ${
                  isAdded ? "bg-accent-soft text-accent" : "btn-primary"
                }`}
              >
                {isAdded ? "Added ✓" : "Add to day"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[10px] text-fg-faint">
        Suggestions © OpenStreetMap contributors
      </p>
    </>
  );
}
