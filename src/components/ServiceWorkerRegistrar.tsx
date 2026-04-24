"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js on mount. Renders nothing.
 * Skips registration in development to avoid HMR churn.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        // Non-fatal: app still works without SW.
        console.warn("SW registration failed", err);
      });
  }, []);
  return null;
}
