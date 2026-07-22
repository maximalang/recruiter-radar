"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import hpStyles from "./home-page-components.module.css";

/**
 * Progressive enhancement for calm, one-shot section reveals.
 *
 * The server markup is always fully visible. JavaScript may lower the initial
 * opacity only to the readable 0.78 baseline and add a small translate before
 * the first intersection; it never owns whether the content can be read.
 */
export default function ScrollReveal({
  children,
  delay = 0,
  as: Tag = "div",
  className,
  style,
  id,
  stagger = false,
}: {
  children: ReactNode;
  delay?: number;
  as?: "div" | "section";
  className?: string;
  style?: CSSProperties;
  id?: string;
  stagger?: boolean;
}) {
  const elementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || typeof IntersectionObserver === "undefined") {
      element.dataset.revealed = "true";
      return;
    }

    element.dataset.revealReady = "true";
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      element.dataset.revealed = "true";
      observer.disconnect();
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={(node) => { elementRef.current = node; }}
      id={id}
      className={`${hpStyles.motionReveal}${className ? ` ${className}` : ""}`}
      data-landing-reveal="true"
      data-reveal-stagger={stagger ? "true" : undefined}
      style={{
        ...style,
        "--reveal-delay": `${delay}ms`,
      } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
