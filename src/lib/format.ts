export function fmtMiles(meters: number): string {
  const mi = meters / 1609.344;
  return mi >= 100 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function fmtMoney(n: number): string {
  const wholeDollars = n >= 100 || Math.abs(n - Math.round(n)) < 0.005;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: wholeDollars ? 0 : 2,
    minimumFractionDigits: wholeDollars ? 0 : 2,
  });
}

/** "Mon, Jul 27" from an ISO date (parsed as local, not UTC). */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function localDateISO(d = new Date()): string {
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
    .getDate()
    .toString()
    .padStart(2, "0")}`;
}

/** Days from today until iso date (negative if past). */
export function daysUntil(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** "9:41 AM" for minutes-since-midnight. */
export function fmtClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/** "2:30 PM" from a stored "14:30". */
export function fmtTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return fmtClock(h * 60 + m);
}

/** "1h 30m" / "45m" for a planned length of stay. */
export function fmtStay(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Preferred short name for a traveler: display name, else username. */
export function displayName(
  p: { display_name: string | null; username: string } | null | undefined,
): string | undefined {
  return p ? p.display_name || p.username : undefined;
}
