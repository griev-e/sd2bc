"use client";

import { distToSegmentM, type LngLat } from "./geo";
import { supabase } from "./supabase";
import { dayRoutePoints, useTrip } from "./store";

/**
 * Drop an invisible shaping (via) point on a day's route at the tapped
 * location. Finds the nearest gap between route points, inserts there, and
 * renumbers the other shaping points in that gap. OSRM then re-routes
 * through it — no fake stops involved.
 */
export async function insertShapingPoint(dayId: string, lngLat: LngLat): Promise<void> {
  const s = useTrip.getState();
  const ordered = [...s.days].sort((a, b) => a.seq - b.seq);
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
  const ownerStopId = points[ownerIdx].stopId!;

  // Existing shaping points in this gap, in order; insertion position within them.
  const gapVias: string[] = [];
  for (let i = ownerIdx + 1; i < points.length && !points[i].stopId; i++) {
    gapVias.push(points[i].viaId!);
  }
  const position = best - ownerIdx; // 0 = right after the stop

  await s.addViaPoint(ownerStopId, lngLat[0], lngLat[1], position);

  // Renumber the rest of the gap so ordering stays stable.
  const db = supabase();
  const updates: Promise<{ error: unknown }>[] = [];
  let renumbered = false;
  gapVias.forEach((viaId, i) => {
    const newSeq = i < position ? i : i + 1;
    const current = useTrip.getState().viaPoints.find((v) => v.id === viaId);
    if (current && current.seq !== newSeq) {
      renumbered = true;
      useTrip.setState((st) => ({
        viaPoints: st.viaPoints.map((v) => (v.id === viaId ? { ...v, seq: newSeq } : v)),
      }));
      updates.push(Promise.resolve(db.from("via_points").update({ seq: newSeq }).eq("id", viaId)));
    }
  });
  // the setState calls above bypass the store's mutations, so kick the
  // recompute explicitly — the Realtime echo won't (values already match)
  if (renumbered) useTrip.getState().refreshRoutes();
  const results = await Promise.all(updates);
  // These writes bypass the store's rollback pattern, so on any failure the
  // local gap order and the DB could disagree — re-pull truth instead.
  if (results.some((r) => r.error)) void useTrip.getState().resync();
}
