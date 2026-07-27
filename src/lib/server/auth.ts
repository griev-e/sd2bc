import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

/*
  Server-side traveler check for the API routes that spend money or relay to
  rate-limited public services (/api/analyze, /api/overpass). The client sends
  its Supabase access token as a Bearer header; we verify it against Supabase
  Auth and then confirm the account is one of the two traveler profiles — RLS
  on `profiles` is traveler-gated, so a stray account reads zero rows.
*/

export type TravelerAuth =
  | { userId: string }
  | { error: string; status: 401 | 403 | 503 };

/**
 * fetch with a hard 8s ceiling, for every server-side Supabase client. A
 * stalled connection (accepted, no bytes) otherwise hangs the route until the
 * platform kills it — bypassing the routes' JSON error contracts entirely.
 * 8s is an order of magnitude above a normal round trip; rejections land in
 * the existing error paths.
 */
export const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000),
  });

export async function verifyTraveler(req: Request): Promise<TravelerAuth> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) return { error: "Sign in to use this.", status: 401 };

  // Anon key + the caller's JWT: auth.getUser validates the token, and any
  // follow-up query runs under the caller's own RLS.
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: boundedFetch },
  });

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return { error: "Sign in to use this.", status: 401 };

  const { data: profile, error: profileErr } = await db
    .from("profiles")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();
  // A failed lookup is not the same as an empty one: telling a valid traveler
  // "this account isn't part of the trip" over a Supabase blip is wrong twice
  // — wrong message, and it reads as permanent. 503 says retry.
  if (profileErr) {
    return { error: "Couldn't verify your session — try again.", status: 503 };
  }
  if (!profile) return { error: "This account isn't part of the trip.", status: 403 };

  return { userId: data.user.id };
}
