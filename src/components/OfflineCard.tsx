"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fmtBytes } from "@/lib/format";
import type { LngLat } from "@/lib/geo";
import { useOfflineMaps } from "@/lib/offlineMaps";
import {
  getSnapshotStatus,
  serverSnapshotStatus,
  snapshotSubscribe,
} from "@/lib/snapshot";
import { useOrderedDays, useTrip } from "@/lib/store";

/**
 * Offline readiness, in one place and in plain language.
 *
 * Two separate things have to be true to open this app in a canyon: the trip
 * DATA has to be on the phone (the store's snapshot) and the MAP behind it has
 * to be too (the service worker's tile cache). The first happens by itself; the
 * second is a deliberate download, because it's someone else's free bandwidth.
 *
 * Both report their real state here rather than being assumed — a silent
 * failure is exactly the kind you discover with no signal.
 */
export default function OfflineCard() {
  const routes = useTrip((s) => s.routes);
  const orderedDays = useOrderedDays();
  const snapshot = useSyncExternalStore(
    snapshotSubscribe,
    getSnapshotStatus,
    serverSnapshotStatus,
  );

  const phase = useOfflineMaps((s) => s.phase);
  const done = useOfflineMaps((s) => s.done);
  const total = useOfflineMaps((s) => s.total);
  const error = useOfflineMaps((s) => s.error);
  const truncated = useOfflineMaps((s) => s.truncated);
  const usageBytes = useOfflineMaps((s) => s.usageBytes);
  const download = useOfflineMaps((s) => s.download);
  const cancel = useOfflineMaps((s) => s.cancel);
  const clear = useOfflineMaps((s) => s.clear);
  const refreshUsage = useOfflineMaps((s) => s.refreshUsage);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  // The drawn route, day by day — exactly the corridor worth caching.
  const lines = useMemo(
    () =>
      orderedDays
        .map((d) => routes[d.id]?.coordinates as LngLat[] | undefined)
        .filter((c): c is LngLat[] => Array.isArray(c) && c.length > 1),
    [orderedDays, routes],
  );

  const busy = phase === "planning" || phase === "downloading";
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const dataDetail = (() => {
    if (snapshot.error) return snapshot.error;
    if (snapshot.store === "idb") return "The whole trip is saved on this phone.";
    if (snapshot.store === "local") {
      return "Saved on this phone. Route lines will redraw when you're back online.";
    }
    return "Saving…";
  })();

  return (
    <section className="card p-5">
      <p className="eyebrow mb-2">Offline</p>
      <p className="text-xs leading-5 text-fg-muted">
        Big Sur, the far Oregon coast and the run north of Vancouver have long
        stretches with no signal. Downloading the map means the road is still
        there when the bars aren&apos;t.
      </p>

      {/* trip data — automatic, but say so out loud rather than assume */}
      <div className="hairline-t mt-4 flex items-start gap-2 pt-3.5">
        <span
          className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ background: snapshot.error ? "var(--danger)" : "var(--accent)" }}
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold">Trip data</p>
          <p
            className={`mt-0.5 text-[11px] leading-4 ${
              snapshot.error ? "text-danger" : "text-fg-faint"
            }`}
          >
            {dataDetail}
          </p>
        </div>
      </div>

      {/* map tiles — an explicit tap, because it's a free public service */}
      <div className="hairline-t mt-3 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold">Map</p>
            <p className="mt-0.5 text-[11px] leading-4 text-fg-faint">
              {phase === "done"
                ? `Downloaded along the whole route.${
                    truncated ? " Fine detail is trimmed at the sharpest zoom." : ""
                  }`
                : usageBytes != null
                  ? `${fmtBytes(usageBytes)} stored on this phone.`
                  : "Not downloaded yet."}
            </p>
          </div>
          {usageBytes != null && usageBytes > 0 && !busy && (
            <button
              onClick={() => void clear()}
              className="pressable flex-shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-fg-faint"
            >
              Clear
            </button>
          )}
        </div>

        {busy && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-fg/10">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${pct}%`, background: "var(--accent-gradient)" }}
              />
            </div>
            <p className="tnum mt-1.5 text-center text-[11px] text-fg-muted">
              {phase === "planning"
                ? "Working out what to download…"
                : `${done} / ${total} · ${pct}%`}
            </p>
          </div>
        )}

        {error && <p className="mt-2 text-[11px] leading-4 text-danger">{error}</p>}

        <button
          onClick={() => (busy ? cancel() : void download(lines))}
          disabled={!busy && lines.length === 0}
          className={`pressable mt-3 h-11 w-full rounded-xl text-sm font-semibold disabled:opacity-40 ${
            busy ? "btn-ghost" : "btn-primary"
          }`}
        >
          {busy
            ? "Cancel"
            : phase === "done"
              ? "Download again"
              : "Download maps for this trip"}
        </button>
        <p className="mt-2 text-center text-[11px] leading-4 text-fg-faint">
          {lines.length === 0
            ? "Add stops and let the route compute first."
            : "Uses free OpenFreeMap tiles — a few hundred MB, on Wi-Fi ideally. Satellite view still needs a signal."}
        </p>
      </div>
    </section>
  );
}
