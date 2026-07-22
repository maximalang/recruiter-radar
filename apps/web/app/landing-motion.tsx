"use client";

import { useEffect } from "react";

/** Small DOM controller for optional effects that do not own page content. */
export default function LandingMotion() {
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const cleanups: Array<() => void> = [];

    const form = document.querySelector<HTMLFormElement>("[data-preview-form]");
    if (form) {
      const onSubmit = () => {
        form.dataset.submitting = "true";
        const button = form.querySelector<HTMLButtonElement>("button[type='submit'][data-loading-label]");
        if (button) button.textContent = button.dataset.loadingLabel ?? button.textContent;
      };
      form.addEventListener("submit", onSubmit);
      cleanups.push(() => form.removeEventListener("submit", onSubmit));
    }

    const leadCards = Array.from(document.querySelectorAll<HTMLDetailsElement>("[data-lead-card='true']"));
    for (const card of leadCards) {
      const sync = () => { card.dataset.metersActive = card.open ? "true" : "false"; };
      sync();
      card.addEventListener("toggle", sync);
      cleanups.push(() => card.removeEventListener("toggle", sync));
    }

    const results = document.querySelector<HTMLElement>("[data-preview-results]");
    if (results) {
      if (reducedMotion || typeof IntersectionObserver === "undefined") {
        results.dataset.resultsReady = "true";
      } else {
        const observer = new IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          results.dataset.resultsReady = "true";
          observer.disconnect();
        }, { threshold: 0.12 });
        observer.observe(results);
        cleanups.push(() => observer.disconnect());
      }
    }

    const pricing = document.querySelector<HTMLElement>("[data-landing-pricing]");
    if (pricing && finePointer && !reducedMotion) {
      const onPointerMove = (event: PointerEvent) => {
        const rect = pricing.getBoundingClientRect();
        pricing.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
        pricing.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
        pricing.dataset.spotlight = "true";
      };
      const onPointerLeave = () => { delete pricing.dataset.spotlight; };
      pricing.addEventListener("pointermove", onPointerMove);
      pricing.addEventListener("pointerleave", onPointerLeave);
      cleanups.push(() => {
        pricing.removeEventListener("pointermove", onPointerMove);
        pricing.removeEventListener("pointerleave", onPointerLeave);
      });
    }

    const grid = document.querySelector<HTMLElement>("[data-ambient-grid]");
    if (grid && !reducedMotion && finePointer) {
      let raf = 0;
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          grid.style.setProperty("--grid-offset", `${Math.min(24, window.scrollY * 0.018)}px`);
          raf = 0;
        });
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => {
        window.removeEventListener("scroll", onScroll);
        cancelAnimationFrame(raf);
      });
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  return null;
}
