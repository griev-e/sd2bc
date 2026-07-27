"use client";

/**
 * Where this phone actually is — the map's live blip.
 *
 * A thin, honest wrapper over `navigator.geolocation.watchPosition`: no
 * network, no storage of the position itself, nothing shared with the other
 * traveler. The fix lives in memory only, so closing the app forgets it.
 *
 * Three behaviors worth knowing about:
 *  - **It is off until asked.** Nothing here ever calls into geolocation on
 *    load; the first watch — and therefore the browser's permission prompt —
 *    only happens when the traveler turns it on (More → Location, or the map's
 *    locate button). What *is* stored is that one-bit choice, per device.
 *  - **Silent resume.** With the choice remembered and permission already
 *    granted, `resumeIfGranted()` restarts the watch on later loads without
 *    prompting, so the blip is simply there.
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
  /** Off — never asked, or switched back off. */
  | "idle"
  /** Watching: waiting on the permission answer, or on the first fix. */
  | "locating"
  /** Watching with a fix in hand. */
  | "live"
  /** The browser or the OS said no. */
  | "denied"
  /** No geolocation API, or an insecure context. */
  | "unavailable"
  /** Position unavailable / timed out, and we have nothing to show yet. */
  | "error";

/**
 * What the browser says about the permission, when it's willing to say. Drives
 * the copy in settings: "prompt" means a tap will ask, "denied" means a tap
 * can't — only the browser's own site settings can undo that.
 */
export type LocationPermission = "unknown" | "prompt" | "granted" | "denied";

interface LocationState {
  status: LocationStatus;
  fix: LocationFix | null;
  permission: LocationPermission;
  /** Start watching, prompting for permission if this is the first time. */
  start: () => void;
  /** Stop watching, drop the fix, and remember the choice on this device. */
  stop: () => void;
  /** Restart the watch only if it's switched on here and already granted. */
  resumeIfGranted: () => void;
  /** Re-read the browser's permission state (cheap, never prompts). */
  refreshPermission: () => void;
}

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // A fix from the last 10s is fine to reuse — driving, that's ~200m, and it
  // saves waking the GPS chip for the very first paint.
  maximumAge: 10_000,
  timeout: 25_000,
};

/** Device-local on/off, like the theme and vehicle picks. */
const PREF_KEY = "coastline-location";

export function locationEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PREF_KEY) === "on";
}

function setLocationPref(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) localStorage.setItem(PREF_KEY, "on");
  else localStorage.removeItem(PREF_KEY);
}

let watchId: number | null = null;
let visibilityHandler: (() => void) | null = null;

function supported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export const useLocation = create<LocationState>((set, get) => {
  function readPermission() {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((p) => {
        set({ permission: p.state as LocationPermission });
        // Revoked from the browser's own settings while we're watching: the
        // watch goes quiet rather than erroring, so react to the change.
        p.onchange = () => {
          set({ permission: p.state as LocationPermission });
          if (p.state === "denied") {
            endWatch();
            set({ status: "denied", fix: null });
          }
        };
      })
      .catch(() => {});
  }

  function beginWatch() {
    if (watchId !== null || !supported()) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        set({
          status: "live",
          permission: "granted",
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
          // The choice stays "on": the traveler asked for this, the browser
          // refused. Turning the pref off here would mean a later "allow" in
          // site settings silently did nothing.
          set({ status: "denied", permission: "denied", fix: null });
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
    permission: "unknown",

    start: () => {
      if (!supported()) {
        set({ status: "unavailable" });
        return;
      }
      setLocationPref(true);
      const status = get().status;
      if (status === "idle" || status === "denied" || status === "error") {
        set({ status: "locating" });
      }
      readPermission();
      watchVisibility();
      beginWatch();
    },

    stop: () => {
      endWatch();
      if (visibilityHandler && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", visibilityHandler);
        visibilityHandler = null;
      }
      setLocationPref(false);
      set({ status: "idle", fix: null });
    },

    resumeIfGranted: () => {
      if (!supported() || watchId !== null) return;
      if (!locationEnabled()) return; // never switched on here — never prompt
      readPermission();
      if (!navigator.permissions?.query) {
        // Older browsers can't tell us the state. The traveler already opted in
        // on this device, so honor that and let the browser decide.
        get().start();
        return;
      }
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((p) => {
          if (p.state === "granted") get().start();
          else if (p.state === "denied") set({ status: "denied", permission: "denied" });
        })
        .catch(() => {});
    },

    refreshPermission: readPermission,
  };
});
