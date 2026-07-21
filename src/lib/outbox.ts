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

let flushing = false;

/**
 * Replay queued ops in FIFO order. Stops (keeping the rest) on the first
 * network failure; DROPS an op the server actively rejects (RLS, constraint —
 * e.g. a game claim that lost the race while we were offline) since it can
 * never succeed. Inserts replay as upserts so a half-flushed queue is safe to
 * run again.
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
      try {
        if (op.op === "insert") {
          ({ error } = await db.from(op.table).upsert(op.values));
        } else if (op.op === "update") {
          ({ error } = await db.from(op.table).update(op.values).eq("id", op.id));
        } else {
          ({ error } = await db.from(op.table).delete().eq("id", op.id));
        }
      } catch (err) {
        error = err;
      }
      if (error && isNetworkError(error)) {
        // still offline — keep this op and everything after it
        saveOutbox(queue.slice(done));
        return { flushed: done, remaining: queue.length - done };
      }
      // success, or a server-side rejection that will never succeed — move on
      done++;
    }
    saveOutbox([]);
    return { flushed: done, remaining: 0 };
  } finally {
    flushing = false;
  }
}
