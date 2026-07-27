"use client";

/**
 * Where this phone actually is — the map's live blip.
 *
 * A thin, honest wrapper over `navigator.geolocation.watchPosition`: no
 * network, no storage, nothing shared with the other traveler. The fix lives in
 * memory only, so closing the app forgets it.
 *
 * Two behaviors worth knowing about:
 *  - **Silent resume.** Once permission has been granted, `resumeIfGranted()`
 *    restarts the watch on the next load without prompting, so the blip is
 *    simply there. It never *asks* — only an explicit tap does that.
 *  - **Backgrounding stops the watch.** A GPS watch left running while the app
 *    is hidden is a battery leak on a road trip; it restarts on foreground.
 */

import { create } from "zustand";
import type { LngLat } from "./geo";

export interface LocationFix {
  lngLat: LngLat;
  /** Radius of the 68%-confidence circle, in meters. */
  accuracyM: number;
  /** Degrees clockwise from true north, when the device reports it. */
  headingDeg: number | null;
  speedMps: number | null;
  /** epoch ms of the reading. */
  at: number;
}

export type LocationStatus =
  /** Never asked — the blip is off. */
  | "idle"
  /** Watching, waiting on the first fix. */
  | "locating"
  /** Watching with a fix in hand. */
  | "live"
  /** The user (or the OS) said no. */
  | "denied"
  /** No geolocation API, or an insecure context. */
  | "unavailable"
  /** Position unavailable / timed out, and we have nothing to show yet. */
  | "error";

interface LocationState {
  status: LocationStatus;
  fix: LocationFix | null;
  /** Start watching, prompting for permission if this is the first time. */
  start: () => void;
  /** Stop watching and drop the fix. */
  stop: () => void;
  /** Restart the watch only if permission was already granted. */
  resumeIfGranted: () => void;
}

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // A fix from the last 10s is fine to reuse — driving, that's ~200m, and it
  // saves waking the GPS chip for the very first paint.
  maximumAge: 10_000,
  timeout: 25_000,
};

let watchId: number | null = null;
let visibilityHandler: (() => void) | null = null;

function supported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export const useLocation = create<LocationState>((set, get) => {
  function beginWatch() {
    if (watchId !== null || !supported()) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        set({
          status: "live",
          fix: {
            lngLat: [pos.coords.longitude, pos.coords.latitude],
            accuracyM: pos.coords.accuracy ?? 0,
            headingDeg: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
            speedMps: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
            at: pos.timestamp,
          },
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          endWatch();
          set({ status: "denied", fix: null });
          return;
        }
        // A timeout or a momentary dropout with a fix already on screen is not
        // worth reporting — the blip just goes stale for a moment.
        if (!get().fix) set({ status: "error" });
      },
      OPTIONS,
    );
  }

  function endWatch() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function watchVisibility() {
    if (visibilityHandler || typeof document === "undefined") return;
    visibilityHandler = () => {
      if (get().status === "idle") return; // turned off — stay off
      if (document.visibilityState === "hidden") endWatch();
      else beginWatch();
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  }

  return {
    status: "idle",
    fix: null,

    start: () => {
      if (!supported()) {
        set({ status: "unavailable" });
        return;
      }
      if (get().status === "idle" || get().status === "denied" || get().status === "error") {
        set({ status: "locating" });
      }
      watchVisibility();
      beginWatch();
    },

    stop: () => {
      endWatch();
      if (visibilityHandler && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", visibilityHandler);
        visibilityHandler = null;
      }
      set({ status: "idle", fix: null });
    },

    resumeIfGranted: () => {
      if (!supported() || watchId !== null) return;
      // Permissions API is the only way to know we're already allowed without
      // triggering a prompt. Where it's missing (older Safari), stay off until
      // the traveler taps — a surprise prompt on load is worse than no blip.
      navigator.permissions
        ?.query({ name: "geolocation" as PermissionName })
        .then((p) => {
          if (p.state === "granted") get().start();
        })
        .catch(() => {});
    },
  };
});
