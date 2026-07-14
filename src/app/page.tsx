"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        router.replace(data.session ? "/map" : "/login");
      });
  }, [router]);

  return (
    <div className="flex h-dvh items-center justify-center">
      <div className="skeleton h-10 w-10 rounded-full" />
    </div>
  );
}
