"use client";

import { useEffect, useRef } from "react";

import {
  LANDING_MOTION_EVENT,
  type LandingMotionDetail,
} from "./landing-motion/motion-preference";

export default function LandingHeroInteractions() {
  const markerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const hero = markerRef.current?.closest<HTMLElement>("[data-landing-hero]");
    const tiltTarget = hero?.querySelector<HTMLElement>("[data-hero-tilt]");
    if (!hero || !tiltTarget) return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let paused = document.documentElement.dataset.landingMotion === "paused";
    let reduced = media.matches;
    let rafId = 0;

    if (!reduced && !paused) {
      hero.querySelectorAll<HTMLElement>("[data-hero-step]").forEach((element, index) => {
        element.animate(
          [
            { opacity: 0.88, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 520,
            delay: index * 70,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "none",
          },
        );
      });
    }

    const resetTilt = () => {
      window.cancelAnimationFrame(rafId);
      tiltTarget.style.removeProperty("--hero-tilt-x");
      tiltTarget.style.removeProperty("--hero-tilt-y");
      tiltTarget.style.removeProperty("--hero-shift-x");
      tiltTarget.style.removeProperty("--hero-shift-y");
      tiltTarget.style.willChange = "auto";
    };
    const onPointerEnter = () => {
      if (!reduced && !paused) tiltTarget.style.willChange = "transform";
    };
    const onPointerMove = (event: PointerEvent) => {
      if (reduced || paused || event.pointerType === "touch") return;
      const rect = tiltTarget.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        tiltTarget.style.setProperty("--hero-tilt-x", `${(-y * 1.1).toFixed(2)}deg`);
        tiltTarget.style.setProperty("--hero-tilt-y", `${(x * 1.1).toFixed(2)}deg`);
        tiltTarget.style.setProperty("--hero-shift-x", `${(x * 2).toFixed(2)}px`);
        tiltTarget.style.setProperty("--hero-shift-y", `${(y * 2).toFixed(2)}px`);
      });
    };
    const onMotionChange = (event: Event) => {
      const detail = (event as CustomEvent<LandingMotionDetail>).detail;
      paused = detail?.paused ?? false;
      reduced = detail?.reduced ?? media.matches;
      if (paused || reduced) resetTilt();
    };

    tiltTarget.addEventListener("pointerenter", onPointerEnter);
    tiltTarget.addEventListener("pointermove", onPointerMove);
    tiltTarget.addEventListener("pointerleave", resetTilt);
    window.addEventListener(LANDING_MOTION_EVENT, onMotionChange);
    return () => {
      resetTilt();
      tiltTarget.removeEventListener("pointerenter", onPointerEnter);
      tiltTarget.removeEventListener("pointermove", onPointerMove);
      tiltTarget.removeEventListener("pointerleave", resetTilt);
      window.removeEventListener(LANDING_MOTION_EVENT, onMotionChange);
    };
  }, []);

  return <span ref={markerRef} hidden />;
}
