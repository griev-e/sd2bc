"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import { localDateISO } from "@/lib/format";
import { FADE, SPRING } from "@/lib/motion";
import { getSchedule } from "@/lib/schedule";
import { supabase } from "@/lib/supabase";
import { useTrip } from "@/lib/store";
import { useWeather } from "@/lib/weather";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const init = useTrip((s) => s.init);
  const loaded = useTrip((s) => s.loaded);
  const loadError = useTrip((s) => s.loadError);
  const userId = useTrip((s) => s.userId);
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const routes = useTrip((s) => s.routes);
  const syncWeather = useWeather((s) => s.sync);
  const toast = useTrip((s) => s.toast);
  const dismissToast = useTrip((s) => s.dismissToast);

  // Today mode: once per app open, if the trip is underway, land focused on
  // today's day instead of the whole loop. Never stomps a user's selection.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (!loaded || autoSelected.current) return;
    autoSelected.current = true;
    const s = useTrip.getState();
    if (s.selectedDayId) return;
    const today = s.days.find((d) => d.date === localDateISO(new Date()));
    if (today) s.setSelectedDay(today.id);
  }, [loaded]);

  // failed/queued writes surface here; each toast clears itself
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, 3200);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);

  // forecasts refresh whenever the plan changes (cached ½ hour internally);
  // each cluster is sampled at its estimated arrival hour
  useEffect(() => {
    if (!loaded) return;
    const schedule = getSchedule(days, stops, routes);
    const arrivalMin: Record<string, number> = {};
    for (const [stopId, s] of schedule) arrivalMin[stopId] = s.arrivalMin;
    syncWeather(days, stops, arrivalMin);
  }, [loaded, days, stops, routes, syncWeather]);

  useEffect(() => {
    const db = supabase();
    db.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setReady(true);
      void init(data.session.user.id);
    });
    const { data: sub } = db.auth.onAuthStateChange((_evt, session) => {
      if (!session) router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [router, init]);

  // One AnimatePresence over the three shell states (error / skeleton / app)
  // so the loading skeletons fade into the real page instead of snapping.
  return (
    <AnimatePresence mode="wait">
      {ready && !loaded && loadError ? (
        // Initial load failed with nothing cached to fall back on — say so and
        // offer a retry instead of skeletons that never resolve.
        <motion.div
          key="load-error"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: FADE }}
          transition={FADE}
          className="flex h-dvh flex-col items-center justify-center gap-4 px-8 text-center"
        >
          <p className="text-sm font-semibold">Couldn&apos;t load the trip</p>
          <p className="text-xs leading-5 text-fg-muted">
            Looks like the connection dropped. Check your signal and try again.
          </p>
          <button
            onClick={() => userId && void init(userId)}
            className="btn-primary pressable h-11 rounded-xl px-8 text-sm font-semibold"
          >
            Retry
          </button>
        </motion.div>
      ) : !ready || !loaded ? (
        <motion.div
          key="skeleton"
          exit={{ opacity: 0, transition: FADE }}
          className="flex h-dvh flex-col gap-3 px-5 pt-20"
        >
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-40 w-full" />
          <div className="skeleton h-40 w-full" />
        </motion.div>
      ) : (
        // opacity only — a transform here would become the containing block for
        // the pages' position:fixed elements (map, FABs) and break their anchoring
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={FADE}
          className="mx-auto min-h-dvh max-w-md"
        >
          {/* re-keyed per tab so switching tabs fades in instead of hard-cutting;
              opacity only, for the same containing-block reason as above */}
          <motion.div
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={FADE}
          >
            {children}
          </motion.div>
          <BottomNav />
          {/* write-status toast — the one place a failed or offline-queued save speaks up */}
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: FADE }}
                transition={SPRING}
                className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+10px)] z-[60] flex justify-center px-6"
              >
                <p
                  role="status"
                  className="glass-strong pointer-events-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-fg-muted"
                  onClick={dismissToast}
                >
                  {toast.kind === "offline" ? (
                    // cloud with a slash — queued locally, not lost
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M7.7 18H17a4 4 0 0 0 .9-7.9A5.5 5.5 0 0 0 8 8.6 4.5 4.5 0 0 0 5 16.7M4 20 20 4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    // alert circle — the save was rejected
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="9" stroke="var(--danger)" strokeWidth="1.8" />
                      <path
                        d="M12 7.5v5.2m0 3.3v.1"
                        stroke="var(--danger)"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                  {toast.text}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
