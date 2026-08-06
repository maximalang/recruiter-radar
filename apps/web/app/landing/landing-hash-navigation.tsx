"use client";

import { useEffect } from "react";

const ASYNC_TARGET = "#preview-results";
const OBSERVER_TIMEOUT_MS = 8000;

function alignReadyResults() {
  if (window.location.hash !== ASYNC_TARGET) return false;
  const target = document.querySelector<HTMLElement>("#preview-results[data-preview-results-ready]");
  if (!target) return false;
  target.scrollIntoView({ block: "start" });
  return true;
}

export default function LandingHashNavigation() {
  useEffect(() => {
    let observer: MutationObserver | null = null;
    let timeoutId: number | null = null;
    let aligned = false;

    const cleanup = () => {
      observer?.disconnect();
      observer = null;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = null;
    };

    const watchAsyncTarget = () => {
      cleanup();
      aligned = false;
      if (window.location.hash !== ASYNC_TARGET) return;

      const alignOnce = () => {
        if (aligned || !alignReadyResults()) return false;
        aligned = true;
        cleanup();
        return true;
      };

      if (alignOnce()) return;
      observer = new MutationObserver(() => alignOnce());
      observer.observe(document.body, { childList: true, subtree: true });
      timeoutId = window.setTimeout(cleanup, OBSERVER_TIMEOUT_MS);
    };

    watchAsyncTarget();
    window.addEventListener("hashchange", watchAsyncTarget);
    return () => {
      window.removeEventListener("hashchange", watchAsyncTarget);
      cleanup();
    };
  }, []);

  return null;
}
