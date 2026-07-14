"use client";

import { daysUntil } from "@/lib/format";
import { useTrip } from "@/lib/store";

/** Quiet countdown: "T−13 days" → "Day 3 / 15" → done. */
export default function CountdownPill() {
  const trip = useTrip((s) => s.trip);
  const days = useTrip((s) => s.days);
  if (!trip) return null;

  const until = daysUntil(trip.start_date);
  const total = days.length;
  let label: string;
  if (until > 0) {
    label = until === 1 ? "tomorrow" : `T−${until} days`;
  } else {
    const dayNum = 1 - until;
    label = dayNum <= total ? `Day ${dayNum} / ${total}` : "trip complete";
  }

  return (
    <span className="glass tnum inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] font-medium text-fg-muted">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--accent-gradient)" }}
      />
      {label}
    </span>
  );
}
