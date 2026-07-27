import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPABASE_URL } from "./config";
import { storedSessionUserId, usernameToEmail } from "./supabase";

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

// supabase-js's default storage slot: sb-<project-ref>-auth-token
const KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

describe("storedSessionUserId", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemStorage());
    vi.stubGlobal("window", {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the user id from the stored session", () => {
    // the dead-zone case: a session is on disk even though its access token
    // has expired and getSession() reads null — the guard must still find it
    localStorage.setItem(
      KEY,
      JSON.stringify({ access_token: "expired", user: { id: "user-1" } }),
    );
    expect(storedSessionUserId()).toBe("user-1");
  });

  it("answers null when no session is stored (signed out)", () => {
    expect(storedSessionUserId()).toBeNull();
  });

  it("answers null for malformed or shape-shifted storage", () => {
    localStorage.setItem(KEY, "not json {");
    expect(storedSessionUserId()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ user: { id: 42 } }));
    expect(storedSessionUserId()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({}));
    expect(storedSessionUserId()).toBeNull();
  });
});

describe("usernameToEmail", () => {
  it("normalizes to the internal domain", () => {
    expect(usernameToEmail("  Kevin ")).toBe("kevin@coastline.app");
  });
});
