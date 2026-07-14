"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import { computeSchedule } from "@/lib/schedule";
import { supabase } from "@/lib/supabase";
import { useTrip } from "@/lib/store";
import { useWeather } from "@/lib/weather";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const init = useTrip((s) => s.init);
  const loaded = useTrip((s) => s.loaded);
  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const routes = useTrip((s) => s.routes);
  const syncWeather = useWeather((s) => s.sync);

  // forecasts refresh whenever the plan changes (cached ½ hour internally);
  // each cluster is sampled at its estimated arrival hour
  useEffect(() => {
    if (!loaded) return;
    const ordered = [...days].sort((a, b) => a.seq - b.seq);
    const schedule = computeSchedule(ordered, stops, routes);
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
    <div className="mx-auto min-h-dvh max-w-md">
      {children}
      <BottomNav />
    </div>
  );
}
