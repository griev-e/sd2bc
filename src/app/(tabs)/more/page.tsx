"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import AttributionDot from "@/components/Attribution";
import CountdownPill from "@/components/CountdownPill";
import { IconCamera } from "@/components/Icons";
import { displayName } from "@/lib/format";
import { buildItineraryIcs } from "@/lib/ics";
import {
  getVehiclePref,
  serverVehiclePref,
  setVehiclePref,
  VEHICLES,
  vehicleSubscribe,
} from "@/lib/journey";
import { getSchedule } from "@/lib/schedule";
import { useTrip } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import {
  ACCENTS,
  getAccentPref,
  getThemePref,
  serverAccentPref,
  serverThemePref,
  setAccentPref,
  setThemePref,
  themeSubscribe,
  type ThemePref,
} from "@/lib/theme";

export default function MorePage() {
  const router = useRouter();
  const profiles = useTrip((s) => s.profiles);
  const userId = useTrip((s) => s.userId);
  const activity = useTrip((s) => s.activity);
  const refreshActivity = useTrip((s) => s.refreshActivity);
  const teardown = useTrip((s) => s.teardown);

  const me = profiles.find((p) => p.id === userId);
  const partner = profiles.find((p) => p.id !== userId);

  // Itinerary → .ics, built fully client-side; opens in the share/download
  // flow so it lands in Apple/Google Calendar next to real reservations.
  function exportIcs() {
    const { trip, days, stops, routes } = useTrip.getState();
    if (!trip) return;
    const ics = buildItineraryIcs(trip, days, stops, getSchedule(days, stops, routes));
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "coastline-itinerary.ics";
    a.click();
    URL.revokeObjectURL(url);
  }
  const theme = useSyncExternalStore(themeSubscribe, getThemePref, serverThemePref);
  const accent = useSyncExternalStore(themeSubscribe, getAccentPref, serverAccentPref);
  const vehicle = useSyncExternalStore(vehicleSubscribe, getVehiclePref, serverVehiclePref);

  useEffect(() => {
    void refreshActivity();
  }, [refreshActivity]);

  async function signOut() {
    await supabase().auth.signOut();
    teardown();
    router.replace("/login");
  }

  return (
    <div className="min-h-dvh pb-32">
      <header className="pt-safe sticky top-0 z-30">
        <div className="glass border-x-0 border-t-0 px-5 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Settings</p>
              <h1 className="display mt-0.5 text-[22px] tracking-tight">More</h1>
            </div>
            <CountdownPill />
          </div>
        </div>
      </header>

      <div className="space-y-4 px-4 pt-4">
        {/* your profile */}
        {me && <ProfileCard profile={me} />}

        {/* appearance */}
        <section className="card p-5">
          <p className="eyebrow mb-3">Appearance</p>
          <div className="flex gap-1.5">
            {(
              [
                ["system", "Auto"],
                ["light", "Light"],
                ["dark", "Dark"],
              ] as [ThemePref, string][]
            ).map(([pref, label]) => (
              <button
                key={pref}
                onClick={() => setThemePref(pref)}
                className={`pressable flex-1 rounded-xl py-2.5 text-xs font-semibold ${
                  theme === pref ? "btn-primary" : "border border-hairline text-fg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="eyebrow mb-3 mt-5">Theme color</p>
          <div className="flex items-center justify-between px-1">
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                onClick={() => setAccentPref(a.key)}
                aria-label={a.label}
                title={a.label}
                className="pressable flex h-11 w-11 items-center justify-center rounded-full"
                style={
                  accent === a.key
                    ? { boxShadow: "0 0 0 2px var(--bg-elevated), 0 0 0 4px var(--fg-muted)" }
                    : undefined
                }
              >
                <span
                  className="block h-8 w-8 rounded-full"
                  style={{ background: a.swatch }}
                />
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-center text-[11px] text-fg-faint">
            {ACCENTS.find((a) => a.key === accent)?.label}
          </p>
        </section>

        {/* map marker — the vehicle that rides the route */}
        <section className="card p-5">
          <p className="eyebrow mb-1">Map marker</p>
          <p className="mb-3 text-xs leading-5 text-fg-muted">
            The icon that rides the route on the map — parked at San Diego until
            departure day, then tracking the drive by the clock. Tap ▶ on the map
            to watch the whole loop play out. Set per phone.
          </p>
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
            {VEHICLES.map((v) => (
              <button
                key={v.key}
                onClick={() => setVehiclePref(v.key)}
                aria-label={v.label}
                title={v.label}
                className="pressable flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-2xl"
                style={
                  vehicle === v.key
                    ? {
                        background: "var(--accent-soft)",
                        boxShadow: "0 0 0 2px var(--bg-elevated), 0 0 0 4px var(--accent)",
                      }
                    : { background: "var(--glass)" }
                }
              >
                {v.emoji}
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-center text-[11px] text-fg-faint">
            {VEHICLES.find((v) => v.key === vehicle)?.label}
          </p>
        </section>

        {/* crew */}
        <section className="card p-5">
          <p className="eyebrow mb-3">Crew</p>
          <div className="space-y-3">
            {[me, partner].filter(Boolean).map((p) => (
              <div key={p!.id} className="flex items-center gap-3">
                <AttributionDot userId={p!.id} size={30} />
                <p className="text-sm font-medium">{displayName(p!)}</p>
              </div>
            ))}
            {!partner && (
              <p className="rounded-2xl bg-accent-soft p-3 text-xs leading-5 text-fg-muted">
                Your co-pilot&apos;s seat is ready — she just needs to sign in on
                her phone and everything syncs live.
              </p>
            )}
          </div>
        </section>

        {/* recent activity */}
        <section className="card p-5">
          <p className="eyebrow mb-3">Recent activity</p>
          {activity.length === 0 ? (
            <p className="text-xs text-fg-faint">Nothing yet.</p>
          ) : (
            <div className="space-y-2.5">
              {activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5">
                  <AttributionDot userId={a.actor} size={16} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-4 text-fg-muted">
                      <span className="font-semibold text-fg">
                        {displayName(profiles.find((p) => p.id === a.actor)) ?? "someone"}
                      </span>{" "}
                      {a.summary}
                    </p>
                    <p className="text-[10px] text-fg-faint">
                      {new Date(a.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* itinerary export */}
        <section className="card p-5">
          <p className="eyebrow mb-2">Itinerary</p>
          <p className="text-xs leading-5 text-fg-muted">
            One all-day calendar event per trip day, with the stop list and
            live ETAs in the notes.
          </p>
          <button
            onClick={exportIcs}
            className="btn-ghost pressable mt-3 h-11 w-full rounded-xl text-sm font-semibold"
          >
            Export to calendar (.ics)
          </button>
        </section>

        {/* about the data */}
        <section className="card p-5">
          <p className="eyebrow mb-2">Data &amp; maps</p>
          <p className="text-xs leading-5 text-fg-muted">
            Maps © OpenFreeMap & OpenMapTiles, data © OpenStreetMap contributors.
            Routing by OSRM. Cost figures are regional estimates that sharpen as
            the route and overnight stays take shape.
          </p>
        </section>

        <button
          onClick={() => void signOut()}
          className="btn-ghost pressable h-12 w-full rounded-xl text-sm font-semibold !text-danger"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

/** Edit your own display name + photo; syncs live to the other phone. */
function ProfileCard({ profile }: { profile: { id: string; username: string; display_name: string | null; color: string; avatar_url: string | null } }) {
  const updateProfile = useTrip((s) => s.updateProfile);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile.display_name ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function commitName() {
    const next = name.trim();
    if (next && next !== (profile.display_name ?? "")) {
      void updateProfile({ display_name: next });
    }
  }

  async function pickPhoto(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      // downscale to a 256px square so uploads are tiny and load fast
      const bmp = await createImageBitmap(file);
      const side = Math.min(bmp.width, bmp.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(
        bmp,
        (bmp.width - side) / 2,
        (bmp.height - side) / 2,
        side,
        side,
        0,
        0,
        256,
        256,
      );
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/jpeg", 0.85),
      );
      if (!blob) throw new Error("no blob");

      const db = supabase();
      const path = `${profile.id}.jpg`;
      const { error } = await db.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (error) throw error;
      const { data } = db.storage.from("avatars").getPublicUrl(path);
      // cache-buster so the new photo shows immediately everywhere
      await updateProfile({ avatar_url: `${data.publicUrl}?v=${Date.now()}` });
    } catch {
      setUploadError("Couldn't upload that photo — try another one.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="card p-5">
      <p className="eyebrow mb-3">Your profile</p>
      <div className="flex items-center gap-4">
        <button
          onClick={() => fileRef.current?.click()}
          aria-label="Change profile photo"
          className="pressable relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full"
          style={{ background: profile.color }}
        >
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xl font-bold uppercase text-white">
              {(profile.display_name ?? profile.username).slice(0, 1)}
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 flex h-5 items-center justify-center bg-black/45 text-white">
            {uploading ? (
              <span className="text-[9px] font-semibold">…</span>
            ) : (
              <IconCamera size={11} strokeWidth={2.2} />
            )}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            placeholder="display name"
            className="field"
            aria-label="Display name"
          />
          <p className="mt-1.5 px-1 text-[11px] text-fg-faint">@{profile.username}</p>
        </div>
      </div>
      {uploadError && <p className="mt-2 text-xs text-danger">{uploadError}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickPhoto(f);
          e.target.value = "";
        }}
      />
    </section>
  );
}
