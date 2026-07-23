"use client";

import { useEffect, useRef, useState } from "react";

import hpStyles from "./home-page-components.module.css";
import {
  LANDING_MOTION_EVENT,
  type LandingMotionDetail,
} from "./landing-motion/motion-preference";

const STAGES = [
  {
    name: "Соответствие",
    secondary: "Fit",
    description: "Ниша, роли и география совпадают с профилем агентства.",
    badge: "профиль",
    context: "fit",
  },
  {
    name: "Намерение",
    secondary: "Intent",
    description: "Найм подтверждён несколькими фактами, а не одной вакансией.",
    badge: "2+ факта",
    context: "intent",
  },
  {
    name: "Актуальность",
    secondary: "Urgency",
    description: "Изменение свежее: момент для обращения ещё не потерян.",
    badge: "сегодня",
    context: "urgency",
  },
  {
    name: "Доступность",
    secondary: "Reachability",
    description: "Есть законный корпоративный путь контакта.",
    badge: "корп. канал",
    context: "reachability",
  },
] as const;

const ROTATION_MS = 1_300;

export default function LandingMethodology() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [motionPaused, setMotionPaused] = useState(false);
  const [interactionStopped, setInteractionStopped] = useState(false);
  const interactionStoppedRef = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncFromDocument = () => {
      const preference = document.documentElement.dataset.landingMotion;
      setMotionPaused(
        media.matches || preference === "paused" || preference === "reduced",
      );
    };
    const onMotionChange = (event: Event) => {
      const detail = (event as CustomEvent<LandingMotionDetail>).detail;
      setMotionPaused(detail?.paused ?? media.matches);
    };
    syncFromDocument();
    media.addEventListener("change", syncFromDocument);
    window.addEventListener(LANDING_MOTION_EVENT, onMotionChange);
    return () => {
      media.removeEventListener("change", syncFromDocument);
      window.removeEventListener(LANDING_MOTION_EVENT, onMotionChange);
    };
  }, []);

  useEffect(() => {
    if (motionPaused || interactionStopped) return;
    const intervalId = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % STAGES.length);
    }, ROTATION_MS);
    return () => window.clearInterval(intervalId);
  }, [interactionStopped, motionPaused]);

  const stopAutomaticRotation = () => {
    if (interactionStoppedRef.current) return;
    interactionStoppedRef.current = true;
    setInteractionStopped(true);
  };
  const selectStage = (index: number) => {
    stopAutomaticRotation();
    setActiveIndex(index);
    window.dispatchEvent(
      new CustomEvent("landing:analytics", {
        detail: {
          name: "methodology_stage_selected",
          context: STAGES[index].context,
        },
      }),
    );
  };

  return (
    <article
      className={hpStyles.qualityMethodCard}
      data-testid="landing-methodology"
      onMouseEnter={stopAutomaticRotation}
      onFocus={stopAutomaticRotation}
      onPointerDown={stopAutomaticRotation}
      onKeyDown={stopAutomaticRotation}
    >
      <div className={hpStyles.qualityCardTopbar}>
        <span>Контур проверки</span>
        <span className={hpStyles.qualityDemoBadge}>4 шага · 1,3 с</span>
      </div>
      <div className={hpStyles.qualityMethodIntro}>
        <h3>Сигнал проходит четыре проверки</h3>
        <p>Высокий балл сам по себе ничего не доказывает. Выберите этап, чтобы увидеть его роль.</p>
      </div>
      <ol className={hpStyles.qualityChecks}>
        {STAGES.map((stage, index) => (
          <li key={stage.name} data-active={activeIndex === index}>
            <button
              type="button"
              aria-pressed={activeIndex === index}
              onClick={() => selectStage(index)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong>
                  {stage.name} <small>{stage.secondary}</small>
                </strong>
                <span>{stage.description}</span>
              </span>
              <em>{stage.badge}</em>
            </button>
          </li>
        ))}
      </ol>
      <div className={hpStyles.qualityOutcome}>
        <i aria-hidden="true" />
        <span><strong>Допущено в радар</strong> — факты и ограничения остаются в карточке.</span>
      </div>
      <span className={hpStyles.methodologyStatus} role="status" aria-live="polite">
        Этап {activeIndex + 1} из {STAGES.length}: {STAGES[activeIndex].name}
      </span>
    </article>
  );
}
