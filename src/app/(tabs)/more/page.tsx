"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AttributionDot from "@/components/Attribution";
import CountdownPill from "@/components/CountdownPill";
import { displayName, fmtDate } from "@/lib/format";
import { useTrip } from "@/lib/store";
import { supabase } from "@/lib/supabase";

export default function MorePage() {
  const router = useRouter();
  const trip = useTrip((s) => s.trip);
  const days = useTrip((s) => s.days);
  const profiles = useTrip((s) => s.profiles);
  const userId = useTrip((s) => s.userId);
  const activity = useTrip((s) => s.activity);
  const refreshActivity = useTrip((s) => s.refreshActivity);
  const teardown = useTrip((s) => s.teardown);

  const me = profiles.find((p) => p.id === userId);
  const partner = profiles.find((p) => p.id !== userId);

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
        {/* trip card */}
        <section className="card p-5">
          <p className="text-lg font-bold tracking-tight">{trip?.name ?? "Coastline"}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {trip && fmtDate(trip.start_date)}
            {days.length > 0 &&
              ` → ${fmtDate([...days].sort((a, b) => a.seq - b.seq)[days.length - 1].date)}`}
            {` · ${days.length} days`}
          </p>
        </section>

        {/* crew */}
        <section className="card p-5">
          <p className="eyebrow mb-3">Crew</p>
          <div className="space-y-3">
            {me && (
              <div className="flex items-center gap-3">
                <AttributionDot userId={me.id} size={28} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{displayName(me)}</p>
                  <p className="text-xs text-fg-faint">you</p>
                </div>
              </div>
            )}
            {partner ? (
              <div className="flex items-center gap-3">
                <AttributionDot userId={partner.id} size={28} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{displayName(partner)}</p>
                  <p className="text-xs text-fg-faint">co-pilot</p>
                </div>
              </div>
            ) : (
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

        {/* about the data */}
        <section className="card p-5">
          <p className="eyebrow mb-2">Data &amp; maps</p>
          <p className="text-xs leading-5 text-fg-muted">
            Maps © OpenFreeMap & OpenMapTiles, data © OpenStreetMap contributors.
            Routing by OSRM. Cost figures start as regional estimates and blend in
            your real spending as you log it.
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
