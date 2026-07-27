"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { storedSessionUserId, supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        // A stored session with an expired token that can't refresh offline
        // reads as null here — still ours, so still /map (see supabase.ts).
        router.replace(data.session || storedSessionUserId() ? "/map" : "/login");
      });
  }, [router]);

  return (
    <div className="flex h-dvh items-center justify-center">
      <div className="skeleton h-10 w-10 rounded-full" />
    </div>
  );
}
