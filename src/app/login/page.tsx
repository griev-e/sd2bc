"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconWave } from "@/components/Icons";
import { TRAVELER_BUTTON } from "@/lib/colors";
import { riseIn } from "@/lib/motion";
import { supabase, usernameToEmail } from "@/lib/supabase";

/**
 * Sign-in: pick your name, enter the shared PIN. The PIN field is a plain
 * numeric input (never type="password") so iOS won't offer passkeys or
 * password autofill — it's masked with -webkit-text-security instead.
 * A password fallback stays available in case the PIN isn't configured.
 */

const TRAVELERS = [
  { key: "kevin", label: "kevin", ...TRAVELER_BUTTON.kevin },
  { key: "hailey", label: "hailey", ...TRAVELER_BUTTON.hailey },
];

export default function LoginPage() {
  const router = useRouter();
  const [who, setWho] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!who || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: who, pin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong");
      const { error: otpError } = await supabase().auth.verifyOtp({
        type: "magiclink",
        token_hash: json.token_hash,
      });
      if (otpError) throw new Error("Couldn't start a session — try again.");
      router.replace("/map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPin("");
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

        {/* keyed by step — moving between picker / PIN / password rises in */}
        <motion.div key={passwordMode ? "password" : who === null ? "who" : "pin"} {...riseIn()}>
        {passwordMode ? (
          <PasswordForm onBack={() => setPasswordMode(false)} />
        ) : who === null ? (
          <div className="space-y-3">
            <p className="eyebrow mb-4 text-center">Who&apos;s this?</p>
            {TRAVELERS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setWho(t.key);
                  setError(null);
                }}
                className="pressable h-16 w-full rounded-2xl text-lg font-semibold tracking-tight"
                style={{
                  background: t.bg,
                  color: t.ink,
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 18px -6px ${t.bg}`,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={submitPin} className="space-y-3">
            <p className="eyebrow mb-4 text-center">
              Hey {who} — what&apos;s the PIN?
            </p>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="••••"
              /* deliberately NOT type="password": no passkey / manager popups */
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              name="coastline-pin"
              autoFocus
              className="field pin-field text-center"
              aria-label="PIN"
            />
            {error && <p className="px-1 text-center text-sm text-danger">{error}</p>}
            <button
              type="submit"
              disabled={busy || pin.length < 4}
              className="btn-primary pressable h-12 w-full rounded-xl font-semibold disabled:opacity-60"
            >
              {busy ? "…" : "Let's go"}
            </button>
            <button
              type="button"
              onClick={() => {
                setWho(null);
                setPin("");
                setError(null);
              }}
              className="pressable h-10 w-full text-center text-sm font-medium text-fg-muted"
            >
              ← not {who}
            </button>
          </form>
        )}
        </motion.div>

        {!passwordMode && (
          <button
            type="button"
            onClick={() => setPasswordMode(true)}
            className="mt-8 text-center text-xs text-fg-faint underline-offset-2 hover:underline"
          >
            use a password instead
          </button>
        )}
      </div>
    </div>
  );
}

/** Fallback for when the PIN isn't configured (or just preferred). */
function PasswordForm({ onBack }: { onBack: () => void }) {
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
      <button
        type="button"
        onClick={onBack}
        className="pressable h-10 w-full text-center text-sm font-medium text-fg-muted"
      >
        ← back to PIN
      </button>
    </form>
  );
}
