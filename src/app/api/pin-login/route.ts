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

  // flat 600ms on every attempt keeps guessing slow without a rate-limit store
  await new Promise((r) => setTimeout(r, 600));
  if (!pinMatches(pin.trim(), expected.trim())) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
