"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import hpStyles from "./home-page-components.module.css";

const SOURCE_LAYERS = [
  {
    role: "origin",
    label: "01 · Создаёт сигнал",
    badge: "допущены",
    title: "Источники клиентской выдачи",
    description: "hh.ru, Работа России и прямые карьерные страницы могут стать основанием для лида после проверки уверенности.",
    result: "Роль: фиксирует проверяемый факт найма, с которого начинается кандидат в радар.",
  },
  {
    role: "verification",
    label: "02 · Подтверждает",
    badge: "не создаёт лид",
    title: "Компания и путь контакта",
    description: "Сайт компании и ЕГРЮЛ/ФНС уточняют юрлицо, домен и безопасный корпоративный канал.",
    result: "Роль: подтверждает компанию и законный путь контакта, но отдельно лид не создаёт.",
  },
  {
    role: "context",
    label: "03 · Усиливает",
    badge: "только контекст",
    title: "Почему сейчас",
    description: "Корпоративные события, официальные публикации и отраслевой контекст объясняют момент обращения.",
    result: "Роль: усиливает объяснение «почему сейчас», не заменяя доказательство найма.",
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
          <span className={hpStyles.sourceArchitectureEyebrow}>Контур данных</span>
          <h3 id="source-architecture-title">Каждый источник отвечает за свою часть доказательства</h3>
        </div>
        <p>Сначала радар находит сигнал найма, затем подтверждает компанию и только после добавляет контекст.</p>
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

      <details className={hpStyles.sourceGateDisclosure} data-animated-details>
        <summary>
          <span>Что пока не попадает в клиентскую выдачу</span>
          <em>исключены из production-выдачи</em>
        </summary>
        <p>SuperJob, Хабр Карьера, страницы компаний LinkedIn, технологические и региональные доски вакансий исключены из production-выдачи, пока не пройдут проверки уверенности, качества данных и правомерности доступа.</p>
      </details>
    </aside>
  );
}
