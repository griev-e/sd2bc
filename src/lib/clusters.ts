import { haversineM } from "./geo";
import type { Stop } from "./types";

/** Stops within this distance of a cluster's anchor share one weather badge. */
export const CLUSTER_RADIUS_M = 25000; // 25 km — "same area" for a forecast

export interface StopCluster {
  /** The first stop of the cluster — its stable representative / key. */
  repStopId: string;
  lat: number;
  lng: number;
  stopIds: string[];
}

/**
 * Group a day's ordered stops into proximity clusters: consecutive stops
 * within {@link CLUSTER_RADIUS_M} of the cluster's anchor fold into it, so a
 * knot of nearby stops is represented once instead of repeating a near-identical
 * forecast on every row.
 */
export function clusterStops(dayStops: Stop[]): StopCluster[] {
  const clusters: StopCluster[] = [];
  for (const s of dayStops) {
    const last = clusters[clusters.length - 1];
    if (last && haversineM([last.lng, last.lat], [s.lng, s.lat]) <= CLUSTER_RADIUS_M) {
      last.stopIds.push(s.id);
    } else {
      clusters.push({ repStopId: s.id, lat: s.lat, lng: s.lng, stopIds: [s.id] });
    }
  }
  return clusters;
}

/** Weather cache key for a cluster on a given day. */
export function clusterKey(dayId: string, repStopId: string): string {
  return `${dayId}:${repStopId}`;
}
