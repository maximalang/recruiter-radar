"use client";

import { useEffect } from "react";

const REVEAL_SELECTOR = '[data-motion-reveal="section"]';
const ZONE_SELECTOR = "[data-v31-zone]";
/* Longest canonical reveal (520ms + 320ms delay) plus slack; after that the
 * zone settles to "shown" so hover transforms own the cards again. */
const SHOWN_DELAY_MS = 1200;

export default function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-landing-experience]");
    if (!root) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observerSupported = "IntersectionObserver" in window;

    /* Legacy audit contract (verify-landing-production): sections keep
     * flipping data-motion-state, but v3.1 removed the parent opacity /
     * translate — one canonical system animates the children. */
    const revealTargets = Array.from(root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
    revealTargets.forEach((target) => {
      target.dataset.motionState = reducedMotion || !observerSupported ? "visible" : "pending";
    });
    root.dataset.motionReady = "true";

    /* v3.1 R7: one 1px sentinel at the top of each zone; entry reveals the
     * zone children per the canonical ladder. Zones already visible at
     * enhancement time are never hidden again. No JS / reduced motion:
     * everything is shown immediately. */
    const zones = Array.from(root.querySelectorAll<HTMLElement>(ZONE_SELECTOR));
    const sentinels: HTMLElement[] = [];
    const timers: number[] = [];

    const settleZone = (zone: HTMLElement) => {
      timers.push(window.setTimeout(() => {
        zone.dataset.v31State = "shown";
      }, SHOWN_DELAY_MS));
    };

    zones.forEach((zone) => {
      if (reducedMotion || !observerSupported) {
        zone.dataset.v31State = "shown";
        return;
      }
      const rect = zone.getBoundingClientRect();
      if (rect.top <= window.innerHeight && rect.bottom >= 0) {
        zone.dataset.v31State = "visible";
        settleZone(zone);
        return;
      }
      zone.dataset.v31State = "pending";
      const sentinel = document.createElement("div");
      sentinel.setAttribute("aria-hidden", "true");
      sentinel.style.position = "absolute";
      sentinel.style.top = "0";
      sentinel.style.left = "0";
      sentinel.style.width = "1px";
      sentinel.style.height = "1px";
      sentinel.style.pointerEvents = "none";
      // Append (not prepend): the absolutely positioned 1px sentinel must not
      // become the zone's :first-child. Audit scripts and authored CSS key off
      // the real first content child (F-1c: the "Final CTA eyebrow" locator
      // `#conversion-final > div:first-child > span` matched the sentinel).
      zone.append(sentinel);
      sentinels.push(sentinel);
    });
    root.dataset.v31Motion = "ready";

    /* v3.1 §5.4 bounded parallax: hero wash ±2px pointer + ±4px scroll,
     * final wash ±1px + ±2px; fine pointers, width > 1024, no reduced
     * motion; rAF only while a parallax zone intersects; passive listeners. */
    const parallaxZones: Array<{ zone: HTMLElement; scale: number; scrollFactor: number; clamp: number }> = [];
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    if (finePointer && window.innerWidth > 1024 && !reducedMotion) {
      const heroZone = root.querySelector<HTMLElement>('[data-v31-zone="hero"]');
      const finalZone = root.querySelector<HTMLElement>('[data-v31-zone="final"]');
      if (heroZone) parallaxZones.push({ zone: heroZone, scale: 2, scrollFactor: 0.012, clamp: 4 });
      if (finalZone) parallaxZones.push({ zone: finalZone, scale: 1, scrollFactor: 0.008, clamp: 2 });
    }

    const pointer = { x: 0, y: 0 };
    const intersecting = new Set<HTMLElement>();
    let parallaxFrame = 0;

    const applyParallax = () => {
      for (const entry of parallaxZones) {
        if (!intersecting.has(entry.zone)) continue;
        const rect = entry.zone.getBoundingClientRect();
        const scrollShift = Math.max(-entry.clamp, Math.min(entry.clamp, -rect.top * entry.scrollFactor));
        entry.zone.style.setProperty("--v31-par-x", `${(pointer.x * entry.scale).toFixed(2)}px`);
        entry.zone.style.setProperty("--v31-par-y", `${(pointer.y * entry.scale + scrollShift).toFixed(2)}px`);
      }
    };

    const scheduleParallax = () => {
      if (parallaxFrame !== 0 || intersecting.size === 0) return;
      parallaxFrame = window.requestAnimationFrame(() => {
        parallaxFrame = 0;
        applyParallax();
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || parallaxZones.length === 0) return;
      pointer.x = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth - 0.5) * 2));
      pointer.y = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight - 0.5) * 2));
      for (const entry of parallaxZones) {
        if (intersecting.has(entry.zone)) entry.zone.dataset.parallax = "on";
      }
      scheduleParallax();
    };

    let parallaxObserver: IntersectionObserver | null = null;
    const zoneLeaves: Array<{ zone: HTMLElement; handler: () => void }> = [];
    if (parallaxZones.length > 0 && observerSupported) {
      parallaxObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const zone = entry.target as HTMLElement;
          if (entry.isIntersecting) intersecting.add(zone);
          else intersecting.delete(zone);
        }
        scheduleParallax();
      }, { threshold: 0 });
      for (const entry of parallaxZones) {
        parallaxObserver.observe(entry.zone);
        const handler = () => {
          entry.zone.dataset.parallax = "reset";
          entry.zone.style.setProperty("--v31-par-x", "0px");
          entry.zone.style.setProperty("--v31-par-y", "0px");
        };
        entry.zone.addEventListener("pointerleave", handler);
        zoneLeaves.push({ zone: entry.zone, handler });
      }
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("scroll", scheduleParallax, { passive: true });
      window.addEventListener("resize", scheduleParallax, { passive: true });
    }

    let zoneObserver: IntersectionObserver | null = null;
    let revealObserver: IntersectionObserver | null = null;
    if (!reducedMotion && observerSupported) {
      zoneObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const sentinel = entry.target as HTMLElement;
            const zone = sentinel.parentElement;
            if (!zone) continue;
            zone.dataset.v31State = "visible";
            settleZone(zone);
            zoneObserver?.unobserve(sentinel);
          }
        },
        {
          rootMargin: "0px 0px -10% 0px",
          // A single positive numeric threshold never fires for zones taller
          // than that fraction of the viewport; threshold 0 + isIntersecting
          // reveals any sentinel as soon as it enters the trimmed viewport.
          threshold: 0,
        },
      );
      sentinels.forEach((sentinel) => zoneObserver?.observe(sentinel));

      revealObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const target = entry.target as HTMLElement;
            target.dataset.motionState = "visible";
            revealObserver?.unobserve(target);
          }
        },
        {
          rootMargin: "0px 0px -10% 0px",
          threshold: 0,
        },
      );
      revealTargets.forEach((target) => revealObserver?.observe(target));
    }

    return () => {
      zoneObserver?.disconnect();
      revealObserver?.disconnect();
      parallaxObserver?.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
      if (parallaxFrame !== 0) window.cancelAnimationFrame(parallaxFrame);
      for (const { zone, handler } of zoneLeaves) zone.removeEventListener("pointerleave", handler);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", scheduleParallax);
      window.removeEventListener("resize", scheduleParallax);
      for (const sentinel of sentinels) sentinel.remove();
    };
  }, []);

  return null;
}
