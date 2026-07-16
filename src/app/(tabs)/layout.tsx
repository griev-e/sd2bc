"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import { FADE } from "@/lib/motion";
import { getSchedule } from "@/lib/schedule";
import { supabase } from "@/lib/supabase";
import { useTrip } from "@/lib/store";
import { useWeather } from "@/lib/weather";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const init = useTrip((s) => s.init);
  const loaded = useTrip((s) => s.loaded);
  const loadError = useTrip((s) => s.loadError);
  const userId = useTrip((s) => s.userId);
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const routes = useTrip((s) => s.routes);
  const syncWeather = useWeather((s) => s.sync);

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

  // Initial load failed with nothing cached to fall back on — say so and
  // offer a retry instead of skeletons that never resolve.
  if (ready && !loaded && loadError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
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
      </div>
    );
  }

  if (!ready || !loaded) {
    return (
      <div className="flex h-dvh flex-col gap-3 px-5 pt-20">
        <div className="skeleton h-24 w-full" />
        <div className="skeleton h-40 w-full" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }

  return (
    // opacity only — a transform here would become the containing block for
    // the pages' position:fixed elements (map, FABs) and break their anchoring
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="mx-auto min-h-dvh max-w-md"
    >
      {children}
      <BottomNav />
    </motion.div>
  );
}
