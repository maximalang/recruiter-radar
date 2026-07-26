"use client";

import { useEffect, useRef } from "react";

const DETAILS_ANIMATION_MS = 220;

export default function LandingDetailsInteractions() {
  const markerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const root =
      markerRef.current?.closest<HTMLElement>("[data-landing-details-root]") ?? document;
    const animations = new WeakMap<HTMLDetailsElement, Animation>();

    const cleanup = (details: HTMLDetailsElement) => {
      details.style.removeProperty("height");
      details.style.removeProperty("overflow");
    };

    const onClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const summary = target.closest("summary");
      if (!(summary instanceof HTMLElement)) return;
      const details = summary?.parentElement;
      if (
        !(details instanceof HTMLDetailsElement) ||
        !details.matches("[data-animated-details]") ||
        summary !== details.querySelector(":scope > summary")
      ) {
        return;
      }

      const motionPreference = document.documentElement.dataset.landingMotion;
      const reduced =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        motionPreference === "paused" ||
        motionPreference === "reduced";
      if (reduced || typeof details.animate !== "function") return;

      event.preventDefault();
      const existing = animations.get(details);
      if (existing) {
        existing.cancel();
        animations.delete(details);
      }

      const opening = !details.open;
      const startHeight = details.offsetHeight;
      if (opening) details.open = true;
      const endHeight = opening ? details.scrollHeight : summary.offsetHeight;

      details.style.height = `${startHeight}px`;
      details.style.overflow = "hidden";
      const animation = details.animate(
        { height: [`${startHeight}px`, `${endHeight}px`] },
        {
          duration: DETAILS_ANIMATION_MS,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
      animations.set(details, animation);

      animation.onfinish = () => {
        if (!opening) details.open = false;
        cleanup(details);
        animations.delete(details);
      };
      animation.oncancel = () => cleanup(details);
    };

    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("click", onClick);
      root.querySelectorAll<HTMLDetailsElement>("[data-animated-details]").forEach((details) => {
        animations.get(details)?.cancel();
        cleanup(details);
      });
    };
  }, []);

  return <span ref={markerRef} hidden />;
}
