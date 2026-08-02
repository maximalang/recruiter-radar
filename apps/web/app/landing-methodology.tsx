"use client";

import { useState } from "react";

import hpStyles from "./home-page-components.module.css";

const STAGES = [
  {
    name: "Соответствие",
    secondary: "Fit",
    description: "Ниша, роли и география совпадают с профилем агентства.",
    badge: "ваш профиль",
  },
  {
    name: "Намерение",
    secondary: "Intent",
    description: "Активный найм подтверждён фактами, а не одним заголовком вакансии.",
    badge: "сила сигнала",
  },
  {
    name: "Актуальность",
    secondary: "Urgency",
    description: "Изменение достаточно свежее, чтобы обращение не было запоздалым.",
    badge: "момент",
  },
  {
    name: "Доступность",
    secondary: "Reachability",
    description: "Есть законный корпоративный путь контакта без покупки персональных баз.",
    badge: "корп. канал",
  },
] as const;

export default function LandingMethodology() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const selectStage = (index: number) => {
    setActiveIndex(index);
    setAnnouncement(`Проверка ${index + 1} из ${STAGES.length}: ${STAGES[index].name}`);
  };

  return (
    <article
      className={hpStyles.qualityMethodCard}
      data-testid="landing-methodology"
    >
      <div className={hpStyles.qualityCardTopbar}>
        <span>Контур проверки</span>
        <span className={hpStyles.qualityDemoBadge}>4 проверки · без чёрного ящика</span>
      </div>
      <div className={hpStyles.qualityMethodIntro}>
        <h3>Баллы всегда можно объяснить</h3>
        <p>Выберите проверку: радар показывает, из чего сложился приоритет и где всё ещё нужна ручная оценка.</p>
      </div>
      <ol className={hpStyles.qualityChecks}>
        {STAGES.map((stage, index) => (
          <li key={stage.name} data-active={activeIndex === index ? "true" : undefined}>
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
        <span><strong>В радаре остаются факты и ограничения</strong> — решение об обращении принимает ваша команда.</span>
      </div>
      <span className={hpStyles.methodologyStatus} role="status" aria-live="polite">
        {announcement}
      </span>
    </article>
  );
}
