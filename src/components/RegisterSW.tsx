"use client";

import { useEffect } from "react";

/**
 * Registers the offline-shell service worker (public/sw.js). Production only —
 * a worker caching dev-server chunks makes `next dev` haunted.
 */
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // no SW = no offline shell, everything else still works
    });
  }, []);
  return null;
}
