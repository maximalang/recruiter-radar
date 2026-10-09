"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { PlusGlyph } from "./brand-glyphs";
import panelStyles from "./conversion-panel.module.css";

/* v3.1 R4 (D2 §4): accordion with exactly one open item in every rendered
 * frame. Two-phase animation, R13d-smoothed: measured height H→0 in 340ms
 * while the old item stays the only open one, atomic swap in a single
 * commit, then 0→H in 340ms (height+opacity on the canonical easings —
 * --motion-duration-disclosure-slow mirrors these constants). Rapid commands
 * cancel the previous animation and the last intent wins; opening is
 * user-input-only. Without JS the native details plus the shared name
 * attribute give "at most one open". */
const CLOSE_MS = 340;
const OPEN_MS = 340;

function prefersReducedMotion(): boolean {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export default function LandingFaqList(props: {
  items: ReadonlyArray<{ question: string; answer: string }>;
}) {
  const [openIndex, setOpenIndex] = useState(0);
  const openIndexRef = useRef(0);
  const intentRef = useRef<number | null>(null);
  const pendingOpenRef = useRef<number | null>(null);
  const wrapRefs = useRef<Array<HTMLDivElement | null>>([]);
  const timersRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);

  openIndexRef.current = openIndex;

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const resetWrapStyles = useCallback(() => {
    for (const wrap of wrapRefs.current) {
      if (!wrap) continue;
      wrap.style.height = "";
      wrap.style.overflow = "";
      delete wrap.dataset.faqAnim;
    }
  }, []);

  const finishImmediately = useCallback((target: number) => {
    clearTimers();
    resetWrapStyles();
    pendingOpenRef.current = target;
    intentRef.current = target;
    openIndexRef.current = target;
    setOpenIndex(target);
  }, [clearTimers, resetWrapStyles]);

  const handleSummaryClick = useCallback((index: number) => (event: ReactMouseEvent<HTMLElement>) => {
    // The single open item never closes via its summary; Enter/Space arrive
    // here as click events, and focus stays on the activated summary.
    event.preventDefault();
    if (index === openIndexRef.current) return;

    clearTimers();
    resetWrapStyles();
    intentRef.current = index;

    const from = openIndexRef.current;
    const fromWrap = wrapRefs.current[from];
    if (prefersReducedMotion() || !fromWrap || typeof window.requestAnimationFrame !== "function") {
      pendingOpenRef.current = index;
      openIndexRef.current = index;
      setOpenIndex(index);
      return;
    }

    // Phase 1: close the current answer; measure its height once up front.
    const height = fromWrap.scrollHeight;
    fromWrap.style.overflow = "hidden";
    fromWrap.style.height = `${height}px`;
    void fromWrap.offsetHeight;
    fromWrap.dataset.faqAnim = "closing";
    fromWrap.style.height = "0px";

    const timer = window.setTimeout(() => {
      fromWrap.style.height = "";
      fromWrap.style.overflow = "";
      delete fromWrap.dataset.faqAnim;
      // Atomic swap: one commit flips old open=false / new open=true.
      pendingOpenRef.current = index;
      openIndexRef.current = index;
      setOpenIndex(index);
    }, CLOSE_MS);
    timersRef.current.push(timer);
  }, [clearTimers, resetWrapStyles]);

  // Phase 2: animate the freshly opened answer from 0 to its measured height,
  // then release the inline height back to auto.
  useEffect(() => {
    const target = pendingOpenRef.current;
    if (target === null) return;
    pendingOpenRef.current = null;
    const wrap = wrapRefs.current[target];
    if (!wrap) {
      intentRef.current = null;
      return;
    }
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== "function") {
      intentRef.current = null;
      return;
    }
    wrap.dataset.faqAnim = "opening-start";
    const height = wrap.scrollHeight;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      wrap.dataset.faqAnim = "opening";
      wrap.style.height = `${height}px`;
      const timer = window.setTimeout(() => {
        wrap.style.height = "";
        wrap.style.overflow = "";
        delete wrap.dataset.faqAnim;
        intentRef.current = null;
      }, OPEN_MS);
      timersRef.current.push(timer);
    });
  }, [openIndex]);

  // A resize during an animation cancels it and completes the pending intent
  // in the correct open state.
  useEffect(() => {
    const onResize = () => {
      if (intentRef.current === null) return;
      finishImmediately(intentRef.current);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [finishImmediately]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return (
    <div className={panelStyles.faqList} data-faq-list data-v31-content>
      {props.items.map((item, index) => (
        <details
          key={item.question}
          id={`landing-faq-item-${index + 1}`}
          name="rr-landing-faq"
          open={openIndex === index}
          data-faq-item
          data-v31-reveal="faq-item"
          data-analytics-event={LANDING_ANALYTICS_EVENT.faqOpened}
        >
          <summary aria-controls={`landing-faq-answer-${index + 1}`} onClick={handleSummaryClick(index)}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.question}
            <i aria-hidden="true"><PlusGlyph /></i>
          </summary>
          <div
            className={panelStyles.faqAnswer}
            id={`landing-faq-answer-${index + 1}`}
            ref={(element) => {
              wrapRefs.current[index] = element;
            }}
          >
            <p>{item.answer}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
