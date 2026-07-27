import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueOutbox,
  flushOutbox,
  isNetworkError,
  isTransientStatus,
  loadOutbox,
  outboxSize,
  type OutboxOp,
} from "./outbox";

// vitest runs in a node environment with no localStorage — stub a minimal one
class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, String(v));
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
}

interface Call {
  table: string;
  kind: "upsert" | "update" | "delete";
  values?: Record<string, unknown>;
  id?: string;
}

/** Fake postgrest client: hand back an error per-call via the handler. */
function makeDb(
  handler: (call: Call) => { error: unknown; status?: number },
): SupabaseClient {
  return {
    from: (table: string) => ({
      upsert: async (values: Record<string, unknown>) =>
        handler({ table, kind: "upsert", values }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => handler({ table, kind: "update", values, id }),
      }),
      delete: () => ({
        eq: async (_col: string, id: string) => handler({ table, kind: "delete", id }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const OPS: OutboxOp[] = [
  { table: "stops", op: "insert", values: { id: "s1", name: "A" } },
  { table: "stops", op: "update", id: "s1", values: { name: "B" } },
  { table: "via_points", op: "delete", id: "v1" },
];

describe("outbox", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies dead-connection failures as network errors, server rejections not", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError({ message: "TypeError: fetch failed" })).toBe(true);
    expect(isNetworkError({ message: "Load failed" })).toBe(true); // Safari
    expect(isNetworkError({ message: "The operation timed out" })).toBe(true);
    expect(isNetworkError({ message: "duplicate key value violates unique constraint" })).toBe(
      false,
    );
    expect(isNetworkError({ message: "new row violates row-level security policy" })).toBe(false);
  });

  it("enqueues and reloads ops in order", () => {
    enqueueOutbox(OPS[0]);
    enqueueOutbox([OPS[1], OPS[2]]);
    expect(outboxSize()).toBe(3);
    expect(loadOutbox()).toEqual(OPS);
  });

  it("flushes FIFO — inserts replay as upserts — and clears the queue", async () => {
    enqueueOutbox(OPS);
    const calls: Call[] = [];
    const result = await flushOutbox(
      makeDb((c) => {
        calls.push(c);
        return { error: null };
      }),
    );
    expect(result).toEqual({ flushed: 3, remaining: 0 });
    expect(outboxSize()).toBe(0);
    expect(calls.map((c) => c.kind)).toEqual(["upsert", "update", "delete"]);
    expect(calls[1].id).toBe("s1");
  });

  it("stops on a network failure and keeps that op and everything after it", async () => {
    enqueueOutbox(OPS);
    let n = 0;
    const result = await flushOutbox(
      makeDb(() => (++n === 2 ? { error: { message: "fetch failed" } } : { error: null })),
    );
    expect(result).toEqual({ flushed: 1, remaining: 2 });
    expect(loadOutbox()).toEqual(OPS.slice(1));
  });

  it("keeps an op enqueued while the flush is running", async () => {
    enqueueOutbox(OPS);
    // a write fails offline mid-flush and parks itself behind our snapshot
    const late: OutboxOp = {
      table: "packing_items",
      op: "update",
      id: "p1",
      values: { checked: true },
    };
    let n = 0;
    const result = await flushOutbox(
      makeDb(() => {
        if (++n === 2) enqueueOutbox(late);
        return { error: null };
      }),
    );
    expect(result).toEqual({ flushed: 3, remaining: 1 });
    expect(loadOutbox()).toEqual([late]);
  });

  it("keeps both the unflushed tail and mid-flush enqueues on a network failure", async () => {
    enqueueOutbox(OPS);
    const late: OutboxOp = { table: "days", op: "update", id: "d1", values: { title: "x" } };
    let n = 0;
    const result = await flushOutbox(
      makeDb(() => {
        if (++n === 2) {
          enqueueOutbox(late);
          return { error: { message: "fetch failed" } };
        }
        return { error: null };
      }),
    );
    // op 1 flushed; op 2 (failed), op 3, and the late arrival all survive
    expect(result).toEqual({ flushed: 1, remaining: 3 });
    expect(loadOutbox()).toEqual([OPS[1], OPS[2], late]);
  });

  it("drops an op the server actively rejects and carries on", async () => {
    enqueueOutbox(OPS);
    let n = 0;
    const result = await flushOutbox(
      makeDb(() =>
        ++n === 1
          ? { error: { message: "duplicate key value" }, status: 409 }
          : { error: null },
      ),
    );
    // the rejected op can never succeed — it's gone, the rest flushed
    expect(result).toEqual({ flushed: 3, remaining: 0 });
    expect(outboxSize()).toBe(0);
  });

  it("keeps the queue when the JWT expired before the token refresh landed", async () => {
    // the reconnect-after-dead-zone race: coverage returns, flush fires, but
    // the hourly token hasn't refreshed yet — PostgREST answers 401
    enqueueOutbox(OPS);
    const result = await flushOutbox(
      makeDb(() => ({ error: { message: "JWT expired" }, status: 401 })),
    );
    expect(result).toEqual({ flushed: 0, remaining: 3 });
    expect(loadOutbox()).toEqual(OPS);
  });

  it("keeps the queue when the anon-key fallback trips RLS", async () => {
    // with no refreshable session, supabase-js sends the anon key; under RLS
    // that reads as a policy violation — a message the regex alone would
    // classify as a permanent rejection and silently drop
    enqueueOutbox(OPS);
    const result = await flushOutbox(
      makeDb(() => ({
        error: { message: "new row violates row-level security policy" },
        status: 403,
      })),
    );
    expect(result).toEqual({ flushed: 0, remaining: 3 });
    expect(loadOutbox()).toEqual(OPS);
  });

  it("consumes the queue one op at a time, not in a single save at the end", async () => {
    // an app killed mid-flush must replay at most the in-flight op on next
    // launch — the already-applied head must be gone from storage already
    enqueueOutbox(OPS);
    const seen: number[] = [];
    await flushOutbox(
      makeDb(() => {
        seen.push(outboxSize());
        return { error: null };
      }),
    );
    expect(seen).toEqual([3, 2, 1]);
    expect(outboxSize()).toBe(0);
  });
});

describe("isTransientStatus", () => {
  it("marks retry-later statuses transient, definitive rejections not", () => {
    for (const s of [0, 401, 403, 408, 429, 500, 502, 503]) {
      expect(isTransientStatus(s)).toBe(true);
    }
    for (const s of [400, 404, 409, 422]) {
      expect(isTransientStatus(s)).toBe(false);
    }
    expect(isTransientStatus(undefined)).toBe(false);
  });
});
