"use client";

import { useEffect } from "react";

const REVEAL_SELECTOR = '[data-motion-reveal="section"]';

export default function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-landing-experience]");
    if (!root) return;

    const revealTargets = Array.from(root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
    if (revealTargets.length === 0) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observerSupported = "IntersectionObserver" in window;

    revealTargets.forEach((target) => {
      target.dataset.motionState = reducedMotion || !observerSupported ? "visible" : "pending";
    });
    root.dataset.motionReady = "true";

    if (reducedMotion || !observerSupported) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          target.dataset.motionState = "visible";
          observer.unobserve(target);
        }
      },
      {
        rootMargin: "0px 0px -10% 0px",
        threshold: 0.12,
      },
    );

    revealTargets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return null;
}
