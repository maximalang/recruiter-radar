"use client";

import { useEffect } from "react";

/** Native, one-shot choreography; SSR and failure modes remain fully readable. */
export default function StoryMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-story-experience]");
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-story-reveal]"));
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | undefined;
    const show = (target: HTMLElement) => { target.dataset.storyState = "visible"; observer?.unobserve(target); };
    const configure = () => {
      observer?.disconnect();
      if (preference.matches || !("IntersectionObserver" in window)) { targets.forEach(show); return; }
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) if (entry.isIntersecting) show(entry.target as HTMLElement);
      }, { threshold: 0.08, rootMargin: "0px 0px -5% 0px" });
      for (const target of targets) {
        if (target.dataset.storyState === "visible" || target.getBoundingClientRect().top < window.innerHeight) show(target);
        else { target.dataset.storyState = "pending"; observer.observe(target); }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element) {
        const target = event.target.closest<HTMLElement>("[data-story-reveal]");
        if (target) show(target);
      }
    };
    configure();
    preference.addEventListener("change", configure);
    root.addEventListener("focusin", onFocus);
    return () => { observer?.disconnect(); preference.removeEventListener("change", configure); root.removeEventListener("focusin", onFocus); targets.forEach(show); };
  }, []);
  return null;
}
