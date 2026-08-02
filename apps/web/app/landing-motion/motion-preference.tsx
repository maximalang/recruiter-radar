"use client";

import hpStyles from "../home-page-components.module.css";
import {
  LANDING_MOTION_EVENT,
  LANDING_MOTION_STORAGE_KEY,
  useLandingMotion,
  type LandingMotionDetail,
} from "./landing-motion-provider";

export {
  LANDING_MOTION_EVENT,
  LANDING_MOTION_STORAGE_KEY,
  type LandingMotionDetail,
};

export default function LandingMotionPreference() {
  const motion = useLandingMotion();
  const label = motion.reduced
    ? "Движение сокращено настройками системы"
    : motion.paused
      ? "Возобновить движение"
      : "Поставить движение на паузу";

  return (
    <button
      type="button"
      className={hpStyles.motionControl}
      aria-label={label}
      aria-pressed={motion.paused}
      disabled={motion.reduced}
      onClick={motion.toggle}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        {motion.paused ? (
          <path d="M7 5.5 13.5 10 7 14.5V5.5Z" />
        ) : (
          <>
            <path d="M6.5 5.5v9" />
            <path d="M13.5 5.5v9" />
          </>
        )}
      </svg>
      <span className={hpStyles.motionControlText}>
        {motion.reduced ? "Системная пауза" : motion.paused ? "Продолжить" : "Пауза"}
      </span>
    </button>
  );
}
