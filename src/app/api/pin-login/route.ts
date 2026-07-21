import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { SUPABASE_URL } from "@/lib/config";

/**
 * Shared-PIN sign-in. The login screen picks a traveler and sends the PIN;
 * this route checks it against the PIN_CODE env var and, if it matches,
 * mints a one-shot magic-link token for that traveler's account which the
 * client redeems with verifyOtp. No passwords ever leave Supabase Auth.
 *
 * Required Vercel env vars:
 *   PIN_CODE             — the shared PIN
 *   SUPABASE_SECRET_KEY  — project secret key (or legacy service role key)
 */

const TRAVELERS: Record<string, string> = {
  kevin: "kevinnguyen313@coastline.app",
  hailey: "hlyphn@coastline.app",
};

/*
  Brute-force guard. The flat 600ms delay below slows a *serial* guesser, but
  serverless requests run in parallel, so a short numeric PIN also needs a
  hard budget: after this many failures inside the window, every attempt is
  refused until the window rolls over. Attempts live in the pin_attempts
  table (RLS on, no policies — only this route's service key touches it).
*/
const MAX_FAILURES_PER_WINDOW = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export function pinMatches(given: string, expected: string): boolean {
  // constant-time compare over equal-length buffers
  const a = Buffer.from(given.padEnd(64, "\0").slice(0, 64));
  const b = Buffer.from(expected.padEnd(64, "\0").slice(0, 64));
  return given.length === expected.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  let user: unknown, pin: unknown;
  try {
    ({ user, pin } = await req.json());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (typeof user !== "string" || typeof pin !== "string" || !TRAVELERS[user]) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const expected = process.env.PIN_CODE;
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || !secret) {
    return NextResponse.json(
      { error: "PIN sign-in isn't configured yet — use password sign-in." },
      { status: 503 },
    );
  }

  const admin = createClient(SUPABASE_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Refuse outright while the failure budget is spent. Fails OPEN on a DB
  // hiccup — locking the two travelers out over a blip is the worse failure.
  try {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await admin
      .from("pin_attempts")
      .select("*", { count: "exact", head: true })
      .eq("success", false)
      .gte("created_at", since);
    if ((count ?? 0) >= MAX_FAILURES_PER_WINDOW) {
      return NextResponse.json(
        { error: "Too many attempts — try again in an hour, or use a password." },
        { status: 429 },
      );
    }
  } catch {
    // fall through
  }

  // flat 600ms on every attempt keeps serial guessing slow
  await new Promise((r) => setTimeout(r, 600));
  const ok = pinMatches(pin.trim(), expected.trim());

  // Record the attempt (and opportunistically prune old rows) before
  // answering — best effort, a logging failure must not block sign-in.
  try {
    await admin.from("pin_attempts").insert({ success: ok });
    await admin
      .from("pin_attempts")
      .delete()
      .lt("created_at", new Date(Date.now() - PRUNE_AFTER_MS).toISOString());
  } catch {
    // ignore
  }

  if (!ok) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TRAVELERS[user],
  });
  if (error || !data?.properties?.hashed_token) {
    return NextResponse.json(
      { error: "Couldn't start a session — try again." },
      { status: 502 },
    );
  }
  return NextResponse.json({ token_hash: data.properties.hashed_token });
}
