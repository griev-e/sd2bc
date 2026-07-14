"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import { supabase } from "@/lib/supabase";
import { useTrip } from "@/lib/store";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const init = useTrip((s) => s.init);
  const loaded = useTrip((s) => s.loaded);

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
