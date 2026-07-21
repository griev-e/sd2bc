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
  | { error: string; status: 401 | 403 };

export async function verifyTraveler(req: Request): Promise<TravelerAuth> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) return { error: "Sign in to use this.", status: 401 };

  // Anon key + the caller's JWT: auth.getUser validates the token, and any
  // follow-up query runs under the caller's own RLS.
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return { error: "Sign in to use this.", status: 401 };

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) return { error: "This account isn't part of the trip.", status: 403 };

  return { userId: data.user.id };
}
