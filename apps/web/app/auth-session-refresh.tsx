"use client";

import { useEffect } from "react";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function AuthSessionRefresh() {
  useEffect(() => {
    const refresh = () => {
      void fetch("/api/auth/session/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
