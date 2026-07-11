"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Wrap a section so it fades + lifts into view on first scroll into the viewport.
 *
 * PROGRESSIVE ENHANCEMENT — content is ALWAYS visible without JS. The hidden
 * state (opacity:0 + translateY) is only applied AFTER hydration, in a
 * useEffect, and only when prefers-reduced-motion is OFF. This means:
 *   - SSR / no-JS / failed hydration → content renders normally (visible).
 *   - Reduced-motion users → content renders immediately, no transform.
 *   - Everyone else → the section starts hidden on mount, then reveals when it
 *     scrolls into view. Because the hidden state is set synchronously in the
 *     effect (before paint) there is no flash-of-visible for capable clients,
 *     while incapable clients never lose the content.
 *
 * Previous version rendered opacity:0 in SSR, so a slow/failed hydration on
 * mobile left everything below the hero permanently invisible — "не догрузилось".
 */
export default function ScrollReveal({
  children,
  delay = 0,
  as: Tag = "div",
  className,
  style,
  id,
}: {
  children: ReactNode;
  delay?: number;
  as?: "div" | "section";
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  // "idle" = visible (SSR default). "hidden" = set by JS, awaiting reveal.
  // "shown" = revealed / always-shown. Never start hidden on the server.
  const [phase, setPhase] = useState<"idle" | "hidden" | "shown">("idle");

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setPhase("shown");
      return;
    }
    const el = ref.current;
    if (!el) {
      setPhase("shown");
      return;
    }
    // If the section is already in viewport on mount, show it right away
    // (otherwise a tall hero pushes it just below fold and it would wait
    // for a scroll that never comes if the user doesn't move).
    const alreadyInView = el.getBoundingClientRect().top < window.innerHeight * 0.92;
    if (alreadyInView) {
      setPhase("shown");
      return;
    }
    // Hide now (post-hydration, pre-paint for this frame's commit) and reveal
    // on intersection. This keeps the no-JS path visible.
    setPhase("hidden");
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setPhase("shown");
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px 12% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const isHidden = phase === "hidden";

  return (
    <Tag
      ref={ref as never}
      id={id}
      className={className}
      style={{
        ...style,
        opacity: isHidden ? 0 : 1,
        transform: isHidden ? "translateY(22px)" : "none",
        transition: isHidden
          ? "none"
          : `opacity 0.6s ease ${delay}ms, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
      }}
    >
      {children}
    </Tag>
  );
}
