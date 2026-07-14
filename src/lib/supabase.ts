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
