"use client";

import { useEffect } from "react";

const LANDING_SELECTOR = 'main[data-deploy-anchor="recruiter-radar-landing-v4"]';
const LANDING_SCENES = [
  ["hero", "section[data-landing-hero]"],
  ["noise", "section[data-landing-hero] + section"],
  ["preview", "#preview"],
  ["how-it-works", "#how-it-works"],
  ["quality", "#quality"],
  ["pricing", "#pricing"],
  ["faq", "#faq"],
] as const;

/**
 * Shared interaction layer for the visual system.
 *
 * Product pages only consume pointer and coarse scroll state. The public
 * landing additionally exposes a cinematic scene id and continuous progress
 * variables used by landing-cinematic.css. No navigation, analytics or product
 * behavior is changed here.
 */
export function PremiumUiEffects() {
  useEffect(() => {
    const root = document.documentElement;
    const landing = document.querySelector<HTMLElement>(LANDING_SELECTOR);
    const scenes = landing
      ? LANDING_SCENES.flatMap(([id, selector]) => {
          const element = landing.querySelector<HTMLElement>(selector);
          return element ? [{ id, element }] : [];
        })
      : [];

    let pointerFrame = 0;
    let scrollFrame = 0;

    const updatePointer = (event: PointerEvent) => {
      window.cancelAnimationFrame(pointerFrame);
      pointerFrame = window.requestAnimationFrame(() => {
        root.style.setProperty("--ui-pointer-x", `${event.clientX}px`);
        root.style.setProperty("--ui-pointer-y", `${event.clientY}px`);
      });
    };

    const updateLandingState = () => {
      if (!landing || scenes.length === 0) return;

      const viewportCenter = window.innerHeight * 0.5;
      let activeScene = scenes[0];
      let activeDistance = Number.POSITIVE_INFINITY;

      for (const scene of scenes) {
        const rect = scene.element.getBoundingClientRect();
        const sceneCenter = rect.top + Math.min(rect.height, window.innerHeight) * 0.5;
        const distance = Math.abs(sceneCenter - viewportCenter);
        if (distance < activeDistance) {
          activeDistance = distance;
          activeScene = scene;
        }
      }

      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      const rotation = progress * 430 - 34;

      root.dataset.landingScene = activeScene.id;
      root.style.setProperty("--rr-scene-progress", progress.toFixed(4));
      root.style.setProperty("--rr-scene-rotation", `${rotation.toFixed(2)}deg`);
    };

    const updateScrollState = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        root.dataset.uiScrolled = String(window.scrollY > 24);
        updateLandingState();
      });
    };

    root.dataset.uiReady = "true";
    if (landing) root.dataset.landingReady = "true";
    updateScrollState();

    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState, { passive: true });

    return () => {
      window.cancelAnimationFrame(pointerFrame);
      window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
      delete root.dataset.uiReady;
      delete root.dataset.uiScrolled;
      if (landing) {
        delete root.dataset.landingReady;
        delete root.dataset.landingScene;
        root.style.removeProperty("--rr-scene-progress");
        root.style.removeProperty("--rr-scene-rotation");
      }
    };
  }, []);

  return null;
}
