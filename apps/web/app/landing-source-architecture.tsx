"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import hpStyles from "./home-page-components.module.css";

const SOURCE_LAYERS = [
  {
    role: "origin",
    label: "01 · Сигнал",
    badge: "проверяемый факт",
    title: "Находим реальное изменение в найме",
    description: "Новые роли, ускорение публикаций и изменения на карьерных страницах становятся кандидатом в радар.",
    result: "Пользователь видит не просто вакансию, а конкретное изменение, которое создаёт повод для контакта.",
  },
  {
    role: "verification",
    label: "02 · Проверка",
    badge: "несколько источников",
    title: "Подтверждаем компанию и силу сигнала",
    description: "Радар сопоставляет факты, свежесть, профиль агентства и данные самой компании.",
    result: "Слабые и противоречивые сигналы не поднимаются в верх выдачи без объяснения ограничений.",
  },
  {
    role: "context",
    label: "03 · Действие",
    badge: "готово для BD",
    title: "Формируем понятный следующий шаг",
    description: "В карточке остаются причина приоритета, доказательства и корпоративный путь контакта.",
    result: "Команда получает короткий порядок действий, а решение об обращении всегда остаётся за человеком.",
  },
] as const;

export default function LandingSourceArchitecture() {
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number, focus = false) => {
    const normalized = Math.max(0, Math.min(SOURCE_LAYERS.length - 1, index));
    setActiveIndex(normalized);
    if (focus) buttonRefs.current[normalized]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % SOURCE_LAYERS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + SOURCE_LAYERS.length) % SOURCE_LAYERS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SOURCE_LAYERS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    select(nextIndex, true);
  };

  return (
    <aside className={hpStyles.sourceArchitecture} aria-labelledby="source-architecture-title">
      <div className={hpStyles.sourceArchitectureHeader}>
        <div>
          <span className={hpStyles.sourceArchitectureEyebrow}>От факта к действию</span>
          <h3 id="source-architecture-title">Почему рекомендация заслуживает внимания</h3>
        </div>
        <p>Компания не попадает в приоритет по одной вакансии: радар отделяет сигнал, проверку и следующий шаг.</p>
      </div>

      <ol
        className={`${hpStyles.sourceLayers} ${hpStyles.sourceLayersInteractive}`}
        data-testid="source-flow"
        data-active-layer={activeIndex + 1}
        style={{
          "--source-flow-progress": `${((activeIndex + 1) / SOURCE_LAYERS.length) * 100}%`,
        } as CSSProperties}
      >
        {SOURCE_LAYERS.map((layer, index) => (
          <li
            key={layer.role}
            className={hpStyles.sourceLayer}
            data-source-role={layer.role}
            data-active={activeIndex === index ? "true" : undefined}
          >
            <button
              ref={(node) => {
                buttonRefs.current[index] = node;
              }}
              type="button"
              className={hpStyles.sourceLayerButton}
              aria-pressed={activeIndex === index}
              onMouseEnter={() => select(index)}
              onFocus={() => select(index)}
              onClick={() => select(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span className={hpStyles.sourceLayerMeta}>
                <span>{layer.label}</span>
                <em>{layer.badge}</em>
              </span>
              <strong className={hpStyles.sourceLayerTitle}>{layer.title}</strong>
              <span className={hpStyles.sourceLayerDescription}>{layer.description}</span>
              <span className={hpStyles.sourceLayerResult} hidden={activeIndex !== index}>
                {layer.result}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
