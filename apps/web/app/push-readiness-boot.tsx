"use client";

import { useEffect } from "react";

// Loopback and IP-literal origins are development/CI servers running on
// self-signed certificates. Chromium refuses service-worker script fetches
// there and emits a console error that page code cannot catch, so boot-time
// registration is limited to real domains (production). The WebPushOptIn
// widget still registers the worker explicitly when the user opts in.
function isRegistrableHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (hostname.includes(":")) return false; // bracketed IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false; // IPv4 literal
  return true;
}

// Registers the service worker that powers Web Push delivery (public/sw.js).
// Registration is best-effort: browsers without service-worker support or
// with a blocked scope keep using the other notification channels, so any
// failure is intentionally silent and never breaks the app shell.
export function PushReadinessBoot() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return;
    if (!isRegistrableHost(window.location.hostname)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
