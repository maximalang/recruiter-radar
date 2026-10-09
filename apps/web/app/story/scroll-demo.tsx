"use client";

import { useEffect, useRef, useState } from "react";
import HeroProductPreview from "./demo/hero-product-preview";
import styles from "./story.module.css";

/** Preserve the native teaser interaction; defer enhancement/entrance to scroll. */
export default function ScrollDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reveal = () => { setActive(true); setArmed(false); };
    if (reduced.matches || !("IntersectionObserver" in window)) { reveal(); return; }
    setArmed(true);
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { reveal(); observer.disconnect(); }
    }, { threshold: 0.01, rootMargin: "0px 0px -5% 0px" });
    observer.observe(target);
    const onPreference = () => { if (reduced.matches) { reveal(); observer.disconnect(); } };
    reduced.addEventListener("change", onPreference);
    return () => { observer.disconnect(); reduced.removeEventListener("change", onPreference); };
  }, []);

  return <div ref={ref} className={styles.demoScene} data-theme="inverse" data-demo-appearance={armed ? "pending" : active ? "visible" : "static"} onFocusCapture={() => { setActive(true); setArmed(false); }}><HeroProductPreview scrollActive={active} /></div>;
}
