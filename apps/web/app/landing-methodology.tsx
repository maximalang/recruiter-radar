"use client";

import { useEffect, useRef, useState } from "react";

import hpStyles from "./home-page-components.module.css";
import { useLandingMotion } from "./landing-motion/landing-motion-provider";

const STAGES = [
  {
    name: "Соответствие",
    secondary: "Fit",
    description: "Ниша, роли и география совпадают с профилем агентства.",
    badge: "профиль",
  },
  {
    name: "Намерение",
    secondary: "Intent",
    description: "Найм подтверждён несколькими фактами, а не одной вакансией.",
    badge: "2+ факта",
  },
  {
    name: "Актуальность",
    secondary: "Urgency",
    description: "Изменение свежее: момент для обращения ещё не потерян.",
    badge: "сегодня",
  },
  {
    name: "Доступность",
    secondary: "Reachability",
    description: "Есть законный корпоративный путь контакта.",
    badge: "корп. канал",
  },
] as const;

const ROTATION_MS = 1_300;

export default function LandingMethodology() {
  const motion = useLandingMotion();
  const containerRef = useRef<HTMLElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [inViewport, setInViewport] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [interactionStopped, setInteractionStopped] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const interactionStoppedRef = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setInViewport(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.4));
    }, { threshold: [0, 0.4, 0.75] });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncVisibility = () => setDocumentVisible(!document.hidden);
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  useEffect(() => {
    if (
      motion.paused ||
      motion.reduced ||
      interactionStopped ||
      !inViewport ||
      !documentVisible
    ) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % STAGES.length);
    }, ROTATION_MS);
    return () => window.clearInterval(intervalId);
  }, [
    documentVisible,
    inViewport,
    interactionStopped,
    motion.paused,
    motion.reduced,
  ]);

  const stopAutomaticRotation = () => {
    if (interactionStoppedRef.current) return;
    interactionStoppedRef.current = true;
    setInteractionStopped(true);
  };
  const selectStage = (index: number) => {
    stopAutomaticRotation();
    setActiveIndex(index);
    setAnnouncement(`Этап ${index + 1} из ${STAGES.length}: ${STAGES[index].name}`);
  };

  return (
    <article
      ref={containerRef}
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
        {announcement}
      </span>
    </article>
  );
}
