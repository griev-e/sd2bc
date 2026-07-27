"use client";

import { carPriceKey, catalogMsrp, type PriceSource } from "./carPrice";
import { supabase } from "./supabase";

/*
  Client half of the "$$$ Cars" price lookup. Same cache ladder as the OSRM
  routes: catalog → memory → Supabase `car_price_cache` → network. The only
  step that costs anything is the last one, and it writes its answer back to
  Supabase so the other phone (and every future sighting of the same car)
  never pays it again.
*/

export interface PriceResult {
  msrp: number;
  source: PriceSource;
  confidence: "high" | "medium" | "low";
  /** What the AI decided the car was; "" for catalog hits. */
  resolved: string;
  note: string;
}

/** The AI couldn't identify the car — the UI falls back to a manual entry. */
export class UnknownCarError extends Error {}

const memCache = new Map<string, PriceResult>();
const inflight = new Map<string, Promise<PriceResult>>();

interface CacheRow {
  msrp: number | string;
  confidence: string | null;
  note: string | null;
  make: string;
  model: string;
  trim: string | null;
  year: number;
}

function rowToResult(row: CacheRow): PriceResult {
  return {
    msrp: Number(row.msrp),
    source: "ai",
    confidence:
      row.confidence === "high" || row.confidence === "medium" ? row.confidence : "low",
    resolved: [row.year, row.make, row.model, row.trim].filter(Boolean).join(" "),
    note: row.note ?? "",
  };
}

/**
 * Price one car. Resolves instantly and for free whenever the catalog covers
 * it (the 2026 model year), and only reaches the AI route for the cases it
 * can't — which is exactly what the game's off-catalog sightings are.
 *
 * Throws `UnknownCarError` when nothing can price the car, so the caller can
 * ask the spotter to type a number instead.
 */
export async function resolveCarPrice(
  year: number,
  make: string,
  model: string,
  trim: string,
): Promise<PriceResult> {
  const exact = catalogMsrp(year, make, model, trim);
  if (exact !== null) {
    return { msrp: exact, source: "catalog", confidence: "high", resolved: "", note: "" };
  }

  const key = carPriceKey(year, make, model, trim);
  const cached = memCache.get(key);
  if (cached) return cached;
  // Two taps on the same car (or both phones at once) share one lookup.
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    const db = supabase();
    // A timed-out cache read resolves { data: null } (postgrest never rejects
    // on abort) — indistinguishable from a miss, so it falls through to the
    // route, which is correct if wasteful in the rare stalled case.
    const { data } = await db
      .from("car_price_cache")
      .select("msrp, confidence, note, make, model, trim, year")
      .eq("key", key)
      .abortSignal(AbortSignal.timeout(8_000))
      .maybeSingle();

    if (data) {
      const hit = rowToResult(data as CacheRow);
      memCache.set(key, hit);
      return hit;
    }

    const { data: sess } = await db.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error("You're signed out — sign in again first.");

    const res = await fetch("/api/car-price", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ year, make, model, trim }),
      // a hair over the route's own 30s budget, so a hung connection can't
      // pin the "checking price…" state forever
      signal: AbortSignal.timeout(32_000),
    });
    const json = (await res.json().catch(() => null)) as {
      error?: string;
      msrp?: number;
      confidence?: PriceResult["confidence"];
      resolved?: string;
      note?: string;
      model?: string;
    } | null;

    if (res.status === 404) {
      throw new UnknownCarError(json?.error ?? "Couldn't find a price for that car.");
    }
    if (!res.ok || typeof json?.msrp !== "number") {
      throw new Error(json?.error ?? "The price lookup failed — try again.");
    }

    const result: PriceResult = {
      msrp: json.msrp,
      source: "ai",
      confidence: json.confidence ?? "low",
      resolved: json.resolved ?? "",
      note: json.note ?? "",
    };
    memCache.set(key, result);

    // Fire-and-forget: share the answer with the other phone. RLS applies —
    // this is the authenticated client, same as every other write.
    db.from("car_price_cache")
      .upsert({
        key,
        year,
        make,
        model,
        trim,
        msrp: result.msrp,
        confidence: result.confidence,
        note: result.note,
        source_model: json.model ?? "",
        updated_at: new Date().toISOString(),
      })
      .then(() => {});

    return result;
  })();

  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}
