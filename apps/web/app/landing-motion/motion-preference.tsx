"use client";

import { useEffect, useState } from "react";

import hpStyles from "../home-page-components.module.css";

export const LANDING_MOTION_EVENT = "landing:motionchange";
export const LANDING_MOTION_STORAGE_KEY = "landing-motion-preference";

export type LandingMotionDetail = {
  paused: boolean;
  reduced: boolean;
};

function publishMotionPreference(detail: LandingMotionDetail) {
  const state = detail.reduced ? "reduced" : detail.paused ? "paused" : "running";
  document.documentElement.dataset.landingMotion = state;
  window.dispatchEvent(new CustomEvent<LandingMotionDetail>(LANDING_MOTION_EVENT, { detail }));
}

export default function LandingMotionPreference() {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    const sync = () => {
      const nextReduced = media.matches;
      const storedPaused =
        window.sessionStorage.getItem(LANDING_MOTION_STORAGE_KEY) === "paused";
      setReduced(nextReduced);
      setPaused(nextReduced || storedPaused);
      publishMotionPreference({ paused: nextReduced || storedPaused, reduced: nextReduced });
    };

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const label = reduced
    ? "Движение сокращено настройками системы"
    : paused
      ? "Возобновить движение"
      : "Поставить движение на паузу";

  const toggle = () => {
    if (reduced) return;
    const nextPaused = !paused;
    window.sessionStorage.setItem(
      LANDING_MOTION_STORAGE_KEY,
      nextPaused ? "paused" : "running",
    );
    setPaused(nextPaused);
    publishMotionPreference({ paused: nextPaused, reduced: false });
    window.dispatchEvent(
      new CustomEvent("landing:analytics", {
        detail: {
          name: nextPaused ? "motion_paused" : "motion_resumed",
          context: "motion_control",
        },
      }),
    );
  };

  return (
    <button
      type="button"
      className={hpStyles.motionControl}
      aria-label={label}
      aria-pressed={paused}
      disabled={reduced}
      onClick={toggle}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        {paused ? (
          <path d="M7 5.5 13.5 10 7 14.5V5.5Z" />
        ) : (
          <>
            <path d="M6.5 5.5v9" />
            <path d="M13.5 5.5v9" />
          </>
        )}
      </svg>
      <span className={hpStyles.motionControlText}>
        {reduced ? "Системная пауза" : paused ? "Продолжить" : "Пауза"}
      </span>
    </button>
  );
}
