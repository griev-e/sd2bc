"use client";

/**
 * Theme preference: follow the phone ("system") or force light/dark.
 * Stored per device; applied via data-theme on <html>, which the token
 * system in globals.css already honors. An inline boot script in the
 * root layout applies it before first paint.
 */
export type ThemePref = "system" | "light" | "dark";

const KEY = "coastline-theme";

export function getThemePref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

const listeners = new Set<() => void>();

/** For useSyncExternalStore — re-renders subscribers when the pref changes. */
export function themeSubscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function serverThemePref(): ThemePref {
  return "system";
}

export function setThemePref(pref: ThemePref) {
  if (pref === "system") {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(KEY);
  } else {
    document.documentElement.dataset.theme = pref;
    localStorage.setItem(KEY, pref);
  }
  for (const l of listeners) l();
}

/** Is the app currently rendering dark, whatever the preference? */
export function effectiveDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
