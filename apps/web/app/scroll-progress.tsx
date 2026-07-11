"use client";

import { useEffect, useState } from "react";

/**
 * Thin progress bar at the very top of the viewport showing scroll position,
 * plus a "back to top" button that appears after scrolling. Both respect
 * prefers-reduced-motion (no transitions). No deps.
 */
export default function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop;
      const height = doc.scrollHeight - doc.clientHeight;
      const pct = height > 0 ? Math.min(100, (scrollTop / height) * 100) : 0;
      setProgress(pct);
      setShowTop(scrollTop > 600);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "3px",
          width: `${progress}%`,
          background: "linear-gradient(90deg, #1d4ed8, #3b82f6)",
          zIndex: 100,
          transition: "width 0.1s linear",
        }}
      />
      {showTop ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Наверх"
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            width: "44px",
            height: "44px",
            borderRadius: "50%",
            border: "1px solid var(--c-border, #e2e8f0)",
            background: "#fff",
            color: "var(--c-brand, #1d4ed8)",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.14)",
            cursor: "pointer",
            fontSize: "1.2rem",
            fontWeight: 700,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ↑
        </button>
      ) : null}
    </>
  );
}
