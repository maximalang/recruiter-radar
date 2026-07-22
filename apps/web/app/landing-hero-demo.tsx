"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import hpStyles from "./home-page-components.module.css";
import { RADAR_BLIP_EVENT, type RadarBlipDetail } from "./radar-canvas";

const HERO_TARGETS = ["signal", "evidence", "next-step", "fiur"] as const;
const FIUR = [
  ["Соответствие · Fit", 88],
  ["Намерение · Intent", 84],
  ["Актуальность · Urgency", 94],
  ["Доступность · Reachability", 82],
] as const;

export default function LandingHeroDemo() {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const scoreRafRef = useRef(0);
  const tiltRafRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [score, setScore] = useState(87);
  const [scoreRunning, setScoreRunning] = useState(false);
  const [activeTarget, setActiveTarget] = useState<(typeof HERO_TARGETS)[number] | null>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let played = false;
    const play = () => {
      if (played) return;
      played = true;
      setScore(0);
      setScoreRunning(true);
      const startedAt = performance.now();
      const duration = 760;
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        setScore(Math.round(87 * eased));
        if (progress < 1) {
          scoreRafRef.current = requestAnimationFrame(tick);
        } else {
          setScoreRunning(false);
        }
      };
      scoreRafRef.current = requestAnimationFrame(tick);
    };

    if (typeof IntersectionObserver === "undefined") {
      play();
      return () => cancelAnimationFrame(scoreRafRef.current);
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      play();
      observer.disconnect();
    }, { threshold: 0.35 });
    observer.observe(card);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(scoreRafRef.current);
    };
  }, []);

  useEffect(() => {
    const onBlip = (event: Event) => {
      const detail = (event as CustomEvent<RadarBlipDetail>).detail;
      const target = HERO_TARGETS[Math.abs(detail.index) % HERO_TARGETS.length];
      setActiveTarget(target);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setActiveTarget(null), 620);
    };
    window.addEventListener(RADAR_BLIP_EVENT, onBlip);
    return () => {
      window.removeEventListener(RADAR_BLIP_EVENT, onBlip);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card || event.pointerType === "touch") return;
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    cancelAnimationFrame(tiltRafRef.current);
    tiltRafRef.current = requestAnimationFrame(() => {
      card.style.transform = `perspective(1000px) rotateX(${-y * 3.2}deg) rotateY(${x * 3.2}deg) translate3d(${x * 3}px, ${y * 3}px, 0)`;
    });
  };

  const resetTilt = () => {
    const card = cardRef.current;
    if (!card) return;
    cancelAnimationFrame(tiltRafRef.current);
    card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) translate3d(0, 0, 0)";
  };

  return (
    <div
      ref={cardRef}
      className={hpStyles.heroProduct}
      aria-label="Как Recruiter Radar оценивает компанию"
      data-score-running={scoreRunning ? "true" : "false"}
      onPointerMove={onPointerMove}
      onPointerLeave={resetTilt}
    >
      <div className={hpStyles.heroProductTopbar}>
        <span className={hpStyles.heroProductLabel}>Обезличенный пример лида</span>
        <span className={hpStyles.heroProductLive}>Обновлено сегодня · уровень доверия A</span>
      </div>
      <div className={hpStyles.heroCompanyRow}>
        <div>
          <div className={hpStyles.heroCompanyName}>Производственная компания</div>
          <div className={hpStyles.heroCompanyMeta}>Москва и область · промышленность</div>
        </div>
        <div className={hpStyles.heroScore}><strong>{score}</strong><span>/100</span></div>
      </div>
      <div className={hpStyles.heroScoreTrack}>
        <span style={{ "--hero-score-progress": score / 87 } as CSSProperties} />
      </div>
      <div className={hpStyles.heroEvidenceRow}>
        <div data-hero-target="signal" data-active={activeTarget === "signal" ? "true" : undefined}><span>Сигнал найма</span><p>14 новых вакансий за 6 дней</p></div>
        <div data-hero-target="evidence" data-active={activeTarget === "evidence" ? "true" : undefined}><span>Доказательства</span><p>Карьерная страница + hh.ru</p></div>
        <div data-hero-target="next-step" data-active={activeTarget === "next-step" ? "true" : undefined}><span>Следующий шаг</span><p>Проверить HR-форму сегодня</p></div>
      </div>
      <div
        className={hpStyles.heroFiurLine}
        data-hero-target="fiur"
        data-active={activeTarget === "fiur" ? "true" : undefined}
        aria-label="FIUR: соответствие 88, намерение 84, актуальность 94, доступность 82"
      >
        {FIUR.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}
      </div>
    </div>
  );
}
