"use client";

import { useEffect, useRef } from "react";

import hpStyles from "./home-page-components.module.css";

/**
 * Thin progress bar at the very top of the viewport showing scroll position,
 * plus a "back to top" button that appears after scrolling. Both respect
 * prefers-reduced-motion (no transitions). No deps.
 */
export default function ScrollProgress() {
  const progressRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLButtonElement | null>(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const update = () => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop;
      const height = doc.scrollHeight - doc.clientHeight;
      const pct = height > 0 ? Math.min(100, (scrollTop / height) * 100) : 0;
      progressRef.current?.style.setProperty("--scroll-progress", `${pct}%`);
      topRef.current?.style.setProperty("--scroll-progress", `${pct}%`);
      if (topRef.current) topRef.current.dataset.visible = scrollTop > 600 ? "true" : "false";
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        update();
        raf = 0;
      });
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div
        ref={progressRef}
        data-testid="landing-scroll-progress"
        aria-hidden="true"
        className={hpStyles.scrollProgress}
      />
      <button
        ref={topRef}
        type="button"
        data-visible="false"
        onClick={() => window.scrollTo({ top: 0, behavior: reducedMotionRef.current ? "auto" : "smooth" })}
        aria-label="Наверх"
        className={hpStyles.scrollTopButton}
      >
        <span aria-hidden="true">↑</span>
      </button>
    </>
  );
}
