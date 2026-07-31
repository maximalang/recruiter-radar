"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import hpStyles from "./home-page-components.module.css";

const STEPS = [
  {
    eyebrow: "01 · Профиль",
    title: "Задаёте свою специализацию",
    description: "Роли, отрасли, география и исключения определяют, какие компании подходят именно вашему агентству.",
    result: "Результат: одна настройка вместо ежедневного ручного поиска по десяткам источников.",
  },
  {
    eyebrow: "02 · Радар",
    title: "Проверяем изменения в найме",
    description: "Сигналы сопоставляются по свежести, силе, соответствию профилю и доступности корпоративного контакта.",
    result: "Результат: наверх поднимаются компании с объяснимым приоритетом, а не случайные вакансии.",
  },
  {
    eyebrow: "03 · Работа",
    title: "Доставляем короткий список действий",
    description: "В каждой карточке есть причина, факты, ограничения и безопасный путь для первого обращения.",
    result: "Результат: BD начинает утро с 3–7 компаний, которые уже разобраны и расставлены по приоритету.",
  },
] as const;

export default function LandingHowItWorks() {
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number, focus = false) => {
    const normalized = Math.max(0, Math.min(STEPS.length - 1, index));
    setActiveIndex(normalized);
    if (focus) buttonRefs.current[normalized]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % STEPS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + STEPS.length) % STEPS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = STEPS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    select(nextIndex, true);
  };

  return (
    <div
      className={`${hpStyles.steps} ${hpStyles.stepsInteractive}`}
      data-testid="how-it-works-flow"
      data-active-step={activeIndex + 1}
      style={{
        "--flow-progress": `${(activeIndex / (STEPS.length - 1)) * 100}%`,
      } as CSSProperties}
    >
      {STEPS.map((step, index) => (
        <article
          key={step.title}
          className={`${hpStyles.step} ${hpStyles.revealCard}`}
          data-active={activeIndex === index ? "true" : undefined}
        >
          <button
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            className={hpStyles.stepButton}
            aria-pressed={activeIndex === index}
            onMouseEnter={() => select(index)}
            onFocus={() => select(index)}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className={hpStyles.stepIndex}>{step.eyebrow}</span>
            <strong className={hpStyles.stepTitle}>{step.title}</strong>
            <span className={hpStyles.stepDescription}>{step.description}</span>
            <span className={hpStyles.stepResult} hidden={activeIndex !== index}>
              {step.result}
            </span>
          </button>
        </article>
      ))}
    </div>
  );
}
