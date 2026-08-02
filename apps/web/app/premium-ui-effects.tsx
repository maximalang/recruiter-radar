"use client";

import { useEffect } from "react";

/**
 * Shared interaction layer for the visual system.
 *
 * Product pages consume pointer and coarse scroll state. No navigation,
 * analytics or product behavior is changed here.
 */
export function PremiumUiEffects() {
  useEffect(() => {
    const root = document.documentElement;
    let pointerFrame = 0;
    let scrollFrame = 0;

    const updatePointer = (event: PointerEvent) => {
      window.cancelAnimationFrame(pointerFrame);
      pointerFrame = window.requestAnimationFrame(() => {
        root.style.setProperty("--ui-pointer-x", `${event.clientX}px`);
        root.style.setProperty("--ui-pointer-y", `${event.clientY}px`);
      });
    };

    const updateScrollState = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        root.dataset.uiScrolled = String(window.scrollY > 24);
      });
    };

    root.dataset.uiReady = "true";
    updateScrollState();

    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState, { passive: true });

    return () => {
      window.cancelAnimationFrame(pointerFrame);
      window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      delete root.dataset.uiReady;
      delete root.dataset.uiScrolled;
    };
  }, []);

  return null;
}
