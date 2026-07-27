"use client";

import { distToSegmentM, type LngLat } from "./geo";
import { dayRoutePoints, useTrip } from "./store";
import { bySeq } from "./types";

/**
 * Drop an invisible shaping (via) point on a day's route at the tapped
 * location. Finds the nearest gap between route points and inserts there;
 * the store renumbers the rest of that gap in the same optimistic write and
 * kicks a route recompute, so the day's drive time in the itinerary follows
 * within one debounce. OSRM then re-routes through it — no fake stops
 * involved.
 */
export async function insertShapingPoint(dayId: string, lngLat: LngLat): Promise<void> {
  const s = useTrip.getState();
  const ordered = [...s.days].sort(bySeq);
  const idx = ordered.findIndex((d) => d.id === dayId);
  if (idx === -1) return;

  const points = dayRoutePoints(ordered[idx], idx > 0 ? ordered[idx - 1] : null, s.stops, s.viaPoints);
  if (points.length < 2) return;

  // Nearest consecutive pair = the gap the tap belongs to.
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distToSegmentM(lngLat, points[i].lngLat, points[i + 1].lngLat);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }

  // Owning stop = last real stop at or before the gap start.
  let ownerIdx = best;
  while (ownerIdx >= 0 && !points[ownerIdx].stopId) ownerIdx--;
  if (ownerIdx < 0) return;

  // Position within that stop's existing shaping points — 0 = right after it.
  await s.addViaPoint(points[ownerIdx].stopId!, lngLat[0], lngLat[1], best - ownerIdx);
}
