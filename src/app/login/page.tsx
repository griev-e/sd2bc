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
      {/* ambient gradient mesh */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 55% at 15% -5%, var(--accent-soft), transparent 60%)," +
            "radial-gradient(70% 45% at 100% 30%, rgba(8,145,178,0.09), transparent 65%)," +
            "radial-gradient(80% 50% at 40% 115%, var(--accent-soft), transparent 60%)",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-12">
        {/* wordmark */}
        <div className="mb-10">
          <div className="mb-5 flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
              style={{ background: "var(--accent-gradient)" }}
            >
              <IconWave size={20} strokeWidth={2} />
            </span>
            <span className="text-lg font-bold tracking-tight">Coastline</span>
          </div>
          <h1 className="text-[34px] font-bold leading-[1.05] tracking-[-0.03em]">
            One coast.
            <br />
            <span className="text-gradient">Two of us.</span>
          </h1>
          <p className="mt-3 text-sm leading-6 text-fg-muted">
            San Diego → Vancouver → home. The route, the plan, the budget —
            live on both phones.
          </p>
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
          {error && <p className="px-1 text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="btn-primary pressable h-12 w-full rounded-xl font-semibold disabled:opacity-60"
          >
            {busy ? "…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-fg-faint">
          Private trip — two seats, both spoken for.
        </p>
      </div>

      <p className="eyebrow relative pb-8 text-center">est. july 27, 2026</p>
    </div>
  );
}
