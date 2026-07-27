"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/*
  Offline write outbox. When a mutation fails because the connection is dead
  (not because the server rejected it), the store keeps its optimistic state
  and parks the operation here instead of rolling back. The queue is replayed
  in order on the next reconnect (online event, Realtime resubscribe, or any
  full refetch) — conflict policy stays last-write-wins, same as Realtime.
*/

export type OutboxOp =
  | { table: string; op: "insert"; values: Record<string, unknown> }
  | { table: string; op: "update"; id: string; values: Record<string, unknown> }
  | { table: string; op: "delete"; id: string };

const KEY = "coastline-outbox-v1";

/** A failure caused by the network being unreachable, not by the server. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown })?.message === "string"
        ? ((err as { message: string }).message)
        : "";
  return /failed to fetch|fetch failed|network|load failed|connection|timed? ?out/i.test(
    message,
  );
}

export function loadOutbox(): OutboxOp[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as OutboxOp[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveOutbox(ops: OutboxOp[]) {
  if (typeof localStorage === "undefined") return;
  try {
    if (ops.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(ops));
  } catch {
    // storage full — the writes just won't survive a page reload
  }
}

export function enqueueOutbox(ops: OutboxOp | OutboxOp[]): void {
  const list = loadOutbox();
  saveOutbox([...list, ...(Array.isArray(ops) ? ops : [ops])]);
}

export function outboxSize(): number {
  return loadOutbox().length;
}

/**
 * An HTTP status that means "try again later", never "this write is invalid":
 * fetch-level failure (0 — what postgrest-js reports when the request never
 * reached a server), auth not yet refreshed (401 expired JWT, 403 from the
 * anon-key fallback supabase-js uses when it can't produce a session — under
 * RLS that reads as a policy violation even though the write is fine), 408
 * timeout, 429 rate limit, and any 5xx. Genuine rejections (400/404/409/422 —
 * e.g. a game claim that lost the unique-index race) are NOT transient.
 */
export function isTransientStatus(status: number | undefined): boolean {
  if (typeof status !== "number") return false;
  return (
    status === 0 ||
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

let flushing = false;

/**
 * Replay queued ops in FIFO order. Stops (keeping this op and the rest) on a
 * network failure or a transient server error — an expired JWT right after a
 * dead zone, a rate limit, a 5xx — since those succeed on a later retry.
 * DROPS only an op the server definitively rejects (constraint, bad request —
 * e.g. a game claim that lost the race while we were offline) since it can
 * never succeed. Inserts replay as upserts so a half-flushed queue is safe to
 * run again.
 *
 * Storage is consumed one op at a time as each lands, never saved from a
 * snapshot at the end: (a) an op enqueued by a write failing DURING this
 * flush's awaits appends behind the head and must survive the flush, and
 * (b) an app killed mid-flush must replay at most the one in-flight op on
 * next launch — not re-apply the whole queue's stale values hours later over
 * the other phone's newer edits.
 */
export async function flushOutbox(
  db: SupabaseClient,
): Promise<{ flushed: number; remaining: number }> {
  if (flushing) return { flushed: 0, remaining: outboxSize() };
  flushing = true;
  try {
    const queue = loadOutbox();
    let done = 0;
    for (const op of queue) {
      let error: unknown = null;
      let status: number | undefined;
      try {
        let res: { error: unknown; status?: number };
        if (op.op === "insert") {
          res = await db.from(op.table).upsert(op.values);
        } else if (op.op === "update") {
          res = await db.from(op.table).update(op.values).eq("id", op.id);
        } else {
          res = await db.from(op.table).delete().eq("id", op.id);
        }
        error = res.error;
        status = res.status;
      } catch (err) {
        error = err;
      }
      if (error && (isNetworkError(error) || isTransientStatus(status))) {
        // Unreachable, mid-refresh, or having a moment — keep everything
        // from this op on. Storage already holds exactly the unflushed
        // remainder (heads were consumed as they landed) plus any mid-flush
        // enqueues, so there is nothing to save here.
        return { flushed: done, remaining: outboxSize() };
      }
      // Success, or a rejection that can never succeed: consume the head.
      saveOutbox(loadOutbox().slice(1));
      done++;
    }
    return { flushed: done, remaining: outboxSize() };
  } finally {
    flushing = false;
  }
}
