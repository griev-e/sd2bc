import { fmtClock } from "./format";
import type { StopSchedule } from "./schedule";
import type { Day, Stop, Trip } from "./types";

/*
  Itinerary → iCalendar, built entirely client-side (no server, no library).
  One all-day event per trip day; the stop list with live ETAs rides in the
  description so the plan reads well in any calendar app.
*/

/** Escape per RFC 5545 §3.3.11 (TEXT): backslash, semicolon, comma, newline. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold long content lines at 74 octets with CRLF + space continuation. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

/** "2026-07-27" → "20260727"; +1 day for the exclusive all-day DTEND. */
function icsDate(iso: string, plusDays = 0): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12); // noon anchor — timezone-proof
  date.setDate(date.getDate() + plusDays);
  return (
    `${date.getFullYear()}` +
    `${String(date.getMonth() + 1).padStart(2, "0")}` +
    `${String(date.getDate()).padStart(2, "0")}`
  );
}

export function buildItineraryIcs(
  trip: Trip,
  days: Day[],
  stops: Stop[],
  schedule: Map<string, StopSchedule>,
): string {
  const ordered = [...days].sort((a, b) => a.seq - b.seq);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//coastline//trip//EN",
    "CALSCALE:GREGORIAN",
    fold(`X-WR-CALNAME:${escapeText(trip.name)}`),
  ];

  for (const day of ordered) {
    const dayStops = stops
      .filter((s) => s.day_id === day.id)
      .sort((a, b) => a.seq - b.seq);
    const first = dayStops[0]?.name;
    const last = dayStops[dayStops.length - 1]?.name;
    const summary =
      day.title ||
      (first && last && first !== last ? `${first} → ${last}` : (first ?? "Open day"));

    const desc = dayStops
      .map((s) => {
        const sched = schedule.get(s.id);
        const eta = sched ? `~${fmtClock(sched.arrivalMin)} · ` : "";
        return `${eta}${s.name}${s.is_overnight ? " (overnight)" : ""}`;
      })
      .join("\n");

    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:${day.id}@coastline`),
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(day.date)}`,
      `DTEND;VALUE=DATE:${icsDate(day.date, 1)}`,
      fold(`SUMMARY:${escapeText(`Day ${day.seq} · ${summary}`)}`),
      ...(desc ? [fold(`DESCRIPTION:${escapeText(desc)}`)] : []),
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
