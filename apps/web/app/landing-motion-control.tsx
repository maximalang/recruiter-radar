"use client";

import { useEffect, useState } from "react";

import hpStyles from "./home-page-components.module.css";

export const LANDING_MOTION_EVENT = "recruiter-radar:landing-motion";
export const LANDING_MOTION_STORAGE_KEY = "rr:landing-motion-paused";

export type LandingMotionDetail = { paused: boolean };

function applyMotionPreference(paused: boolean) {
  document.documentElement.dataset.landingMotion = paused ? "paused" : "running";
  window.dispatchEvent(new CustomEvent<LandingMotionDetail>(LANDING_MOTION_EVENT, { detail: { paused } }));
}

export default function LandingMotionControl() {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let storedPaused = false;
    try {
      storedPaused = window.sessionStorage.getItem(LANDING_MOTION_STORAGE_KEY) === "1";
    } catch {
      // A session preference is optional when storage is unavailable.
    }
    const initialPaused = prefersReduced || storedPaused;
    setReduced(prefersReduced);
    setPaused(initialPaused);
    applyMotionPreference(initialPaused);
  }, []);

  const toggle = () => {
    if (reduced) return;
    const nextPaused = !paused;
    setPaused(nextPaused);
    try {
      window.sessionStorage.setItem(LANDING_MOTION_STORAGE_KEY, nextPaused ? "1" : "0");
    } catch {
      // The in-page preference still applies when storage is unavailable.
    }
    applyMotionPreference(nextPaused);
  };

  const label = reduced
    ? "Анимация отключена настройками системы"
    : paused
      ? "Возобновить анимацию"
      : "Приостановить анимацию";

  return (
    <button
      type="button"
      className={hpStyles.motionControl}
      aria-label={label}
      aria-pressed={paused}
      disabled={reduced}
      onClick={toggle}
    >
      <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
      {reduced ? "Системная пауза" : paused ? "Продолжить" : "Пауза"}
    </button>
  );
}
