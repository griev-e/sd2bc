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
import { fmtDuration, fmtMiles } from "@/lib/format";
import { useTrip } from "@/lib/store";
import type { StopKind } from "@/lib/types";

const KIND_FOR_CATEGORY: Record<SuggestionCategory, StopKind> = {
  food: "food",
  gas: "fuel",
  scenic: "scenic",
  attractions: "activity",
  lodging: "lodging",
  beach: "beach",
};

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
        {SUGGESTION_CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`pressable flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium ${
              category === c.key ? "btn-primary" : "border border-hairline text-fg-muted"
            }`}
          >
            <StopKindIcon kind={KIND_FOR_CATEGORY[c.key]} size={13} strokeWidth={2} />
            {c.label}
          </button>
        ))}
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
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const route = dayId ? routes[dayId] : undefined;
  const hasRoute = !!route && route.coordinates.length >= 2;

  useEffect(() => {
    if (!hasRoute || !route) return;
    let cancelled = false;
    suggestAlongRoute(route.coordinates, category)
      .then((r) => !cancelled && setResults(r))
      .catch(
        () =>
          !cancelled &&
          setError("Couldn't reach OpenStreetMap — try again in a minute."),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRoute, category, dayId]);

  if (!hasRoute) {
    return (
      <p className="py-8 text-center text-sm text-fg-muted">
        Pick a day with a driving route first.
      </p>
    );
  }
  if (error) {
    return <p className="py-8 text-center text-sm text-fg-muted">{error}</p>;
  }
  if (results === null) {
    return (
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-36 w-40 flex-shrink-0" />
        ))}
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
          return (
            <div key={s.id} className="card flex w-44 flex-shrink-0 snap-start flex-col p-3.5">
              <div className="mb-2.5 flex h-14 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <StopKindIcon kind={KIND_FOR_CATEGORY[s.category]} size={22} />
              </div>
              <p className="line-clamp-2 text-sm font-semibold leading-tight tracking-tight">
                {s.name}
              </p>
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
