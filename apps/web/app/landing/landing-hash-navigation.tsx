"use client";

import { useEffect } from "react";

const ALIGN_DELAYS = [0, 80, 240, 640] as const;

function alignCurrentHash() {
  const rawHash = window.location.hash.slice(1);
  if (!rawHash) return;

  let targetId = rawHash;
  try {
    targetId = decodeURIComponent(rawHash);
  } catch {
    // Keep the literal hash when it is not valid percent-encoded text.
  }

  document.getElementById(targetId)?.scrollIntoView({ block: "start", behavior: "auto" });
}

export default function LandingHashNavigation() {
  useEffect(() => {
    const timeouts = new Set<number>();

    const scheduleAlignment = () => {
      for (const timeout of timeouts) window.clearTimeout(timeout);
      timeouts.clear();

      for (const delay of ALIGN_DELAYS) {
        const timeout = window.setTimeout(() => {
          alignCurrentHash();
          timeouts.delete(timeout);
        }, delay);
        timeouts.add(timeout);
      }
    };

    scheduleAlignment();
    window.addEventListener("hashchange", scheduleAlignment);

    return () => {
      window.removeEventListener("hashchange", scheduleAlignment);
      for (const timeout of timeouts) window.clearTimeout(timeout);
    };
  }, []);

  return null;
}
