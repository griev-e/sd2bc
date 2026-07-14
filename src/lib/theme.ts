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

/* ---- accent color ------------------------------------------------------ */

export type AccentPref = "ocean" | "sunset" | "rose" | "orchid" | "moss";

export const ACCENTS: { key: AccentPref; label: string; swatch: string }[] = [
  { key: "ocean", label: "Sea glass", swatch: "linear-gradient(135deg,#0d9488,#0891b2)" },
  { key: "sunset", label: "Sunset", swatch: "linear-gradient(135deg,#ea580c,#e11d48)" },
  { key: "rose", label: "Rosé", swatch: "linear-gradient(135deg,#db2777,#f43f5e)" },
  { key: "orchid", label: "Orchid", swatch: "linear-gradient(135deg,#7c3aed,#c026d3)" },
  { key: "moss", label: "Moss", swatch: "linear-gradient(135deg,#059669,#65a30d)" },
];

const ACCENT_KEY = "coastline-accent";

export function getAccentPref(): AccentPref {
  if (typeof window === "undefined") return "ocean";
  const v = localStorage.getItem(ACCENT_KEY);
  return ACCENTS.some((a) => a.key === v) ? (v as AccentPref) : "ocean";
}

export function serverAccentPref(): AccentPref {
  return "ocean";
}

export function setAccentPref(pref: AccentPref) {
  if (pref === "ocean") {
    delete document.documentElement.dataset.accent;
    localStorage.removeItem(ACCENT_KEY);
  } else {
    document.documentElement.dataset.accent = pref;
    localStorage.setItem(ACCENT_KEY, pref);
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
