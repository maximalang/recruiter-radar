"use client";

import { useEffect } from "react";

// Registers the service worker that powers Web Push delivery (public/sw.js).
// Registration is best-effort: browsers without service-worker support or
// with a blocked scope keep using the other notification channels, so any
// failure is intentionally silent and never breaks the app shell.
export function PushReadinessBoot() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
