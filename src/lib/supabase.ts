"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

/** Browser-side Supabase singleton (session persisted in localStorage). */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return client;
}

/** username/password UI → internal email for Supabase Auth */
export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@coastline.app`;
}

/**
 * The user id of the session stored on this device, if any — read straight
 * from supabase-js's localStorage slot, no network.
 *
 * Why this exists: `getSession()` answers `null` BOTH for "signed out" and
 * for "session stored, but its access token expired and the refresh couldn't
 * reach the server". The client keeps the stored session on a network-failed
 * refresh (only a definitive server rejection clears it), so after an hour in
 * a dead zone the session is still on disk while `getSession()` reads null.
 * The auth guard uses this to tell the two apart — a road trip must open to
 * the offline itinerary, not the login screen. Every real sign-out path
 * clears this slot before emitting SIGNED_OUT, so it can't resurrect one.
 */
export function storedSessionUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    // supabase-js's default storage key: sb-<project-ref>-auth-token
    const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { user?: { id?: unknown } };
    return typeof stored.user?.id === "string" ? stored.user.id : null;
  } catch {
    return null;
  }
}
