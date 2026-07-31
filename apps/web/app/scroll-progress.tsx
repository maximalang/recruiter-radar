"use client";

import { useEffect, useRef } from "react";

import hpStyles from "./home-page-components.module.css";

/**
 * Compact return-to-top control. The former full-width progress line duplicated
 * the sticky navigation and added visual noise, so progress is now shown only
 * inside the control after the reader has moved far enough down the page.
 */
export default function ScrollProgress() {
  const ringRef = useRef<SVGCircleElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let rafId = 0;
    let scheduled = false;

    const update = () => {
      scheduled = false;
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop;
      const height = doc.scrollHeight - doc.clientHeight;
      const progress = height > 0 ? Math.min(1, Math.max(0, scrollTop / height)) : 0;
      const visible = scrollTop > 720;

      if (ringRef.current) {
        ringRef.current.style.strokeDashoffset = String(100 - progress * 100);
      }
      if (buttonRef.current) {
        buttonRef.current.dataset.visible = String(visible);
        buttonRef.current.setAttribute("aria-hidden", String(!visible));
        buttonRef.current.tabIndex = visible ? 0 : -1;
      }
    };

    const onScroll = () => {
      if (scheduled) return;
      scheduled = true;
      rafId = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const returnToTop = () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={hpStyles.scrollTopButton}
      onClick={returnToTop}
      aria-label="Вернуться наверх"
      aria-hidden="true"
      data-visible="false"
      tabIndex={-1}
    >
      <svg className={hpStyles.scrollTopRing} viewBox="0 0 44 44" aria-hidden="true">
        <circle className={hpStyles.scrollTopRingTrack} cx="22" cy="22" r="19" />
        <circle
          ref={ringRef}
          className={hpStyles.scrollTopRingValue}
          cx="22"
          cy="22"
          r="19"
          pathLength="100"
        />
      </svg>
      <svg className={hpStyles.scrollTopArrow} viewBox="0 0 20 20" aria-hidden="true">
        <path d="m5.5 11.5 4.5-4.5 4.5 4.5M10 7v7" />
      </svg>
    </button>
  );
}
