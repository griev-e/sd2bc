"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconWave } from "@/components/Icons";
import { supabase, usernameToEmail } from "@/lib/supabase";

/**
 * Sign-in only — the two Coastline accounts are pre-provisioned and the
 * signup edge function is capped, so there is no account-creation UI.
 */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: signInError } = await supabase().auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });
      if (signInError) throw new Error("Wrong username or password");
      router.replace("/map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* faint dawn wash — teal into coral, barely there */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 45% at 20% -8%, var(--accent-soft), transparent 62%)," +
            "radial-gradient(60% 38% at 92% 108%, var(--coral-soft), transparent 65%)",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-7 pb-16">
        <div className="mb-12 text-center">
          <IconWave size={30} strokeWidth={1.6} className="mx-auto text-accent" />
          <h1 className="display mt-4 text-[40px] leading-none tracking-[-0.02em]">
            coastline
          </h1>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            required
            className="field"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            autoComplete="current-password"
            required
            className="field"
          />
          {error && <p className="px-1 text-center text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="btn-primary pressable h-12 w-full rounded-xl font-semibold disabled:opacity-60"
          >
            {busy ? "…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
