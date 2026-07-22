"use client";

import { useEffect, useRef, useState } from "react";

import hpStyles from "./home-page-components.module.css";

const STORY_STAGES = [
  { label: "01 · Профиль", title: "Параметры агентства", copy: "Специализация, целевые роли, отрасль и география задают рамку будущей выдачи.", status: "Профиль собран", facts: ["Инженерный подбор", "Производство", "Москва + область", "Исключения применены"] },
  { label: "02 · Сигнал", title: "Изменение в найме", copy: "Радар фиксирует hiring burst и сохраняет первичный источник рядом с фактом.", status: "Сигнал найден", facts: ["14 вакансий", "6 дней", "Карьерная страница", "hh.ru"] },
  { label: "03 · Проверка", title: "Проверка доказательств", copy: "Источник связывается с компанией, контекстом момента и проходит Порог доверия.", status: "Порог доверия пройден", facts: ["Компания подтверждена", "2 источника", "Контекст свежий", "Уровень A"] },
  { label: "04 · Рекомендация", title: "Готовый следующий шаг", copy: "В выдачу попадает причина, доказательства, ограничение и безопасный корпоративный контакт.", status: "Рекомендация готова", facts: ["Почему сейчас", "Факты и даты", "Корпоративный контакт", "Следующий шаг"] },
] as const;

export function ProductScrollytelling() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const interactedRef = useRef(false);
  const [active, setActive] = useState(0);
  const [enhanced, setEnhanced] = useState(false);
  const stage = STORY_STAGES[active];

  useEffect(() => {
    setEnhanced(true);
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined" || window.matchMedia("(max-width: 900px)").matches) return;
    const buttons = Array.from(root.querySelectorAll<HTMLElement>("[data-story-stage]"));
    const observer = new IntersectionObserver((entries) => {
      if (interactedRef.current) return;
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      setActive(Number((visible.target as HTMLElement).dataset.storyStage ?? 0));
    }, { rootMargin: "-30% 0px -45%", threshold: [0.15, 0.5, 0.85] });
    buttons.forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className={hpStyles.productStory} data-enhanced={enhanced ? "true" : "false"}>
      <div className={hpStyles.storyStages}>
        <span className={hpStyles.storyProgress} aria-hidden="true"><i style={{ height: `${((active + 1) / STORY_STAGES.length) * 100}%` }} /></span>
        {STORY_STAGES.map((item, index) => (
          <button
            key={item.label}
            type="button"
            className={hpStyles.storyStage}
            data-story-stage={index}
            aria-pressed={active === index}
            onClick={() => {
              interactedRef.current = true;
              setActive(index);
            }}
          >
            <span>{item.label}</span>
            <strong>{item.title}</strong>
            <small>{item.copy}</small>
          </button>
        ))}
      </div>
      <div className={hpStyles.storyPanel} aria-live="polite">
        <div className={hpStyles.storyPanelTopbar}><span>Private Intelligence Desk</span><em>{stage.status}</em></div>
        <div className={hpStyles.storyPanelSignal}>
          <span>{stage.label}</span>
          <h3>{stage.title}</h3>
          <p>{stage.copy}</p>
        </div>
        <ul>{stage.facts.map((fact, index) => <li key={fact}><span>{String(index + 1).padStart(2, "0")}</span>{fact}</li>)}</ul>
        <p className={hpStyles.storyPanelStatus} role="status">{stage.status}{active === 2 ? " · Порог доверия" : ""}</p>
      </div>
    </div>
  );
}

const SOURCE_LAYERS = [
  { role: "origin", label: "01 · Создаёт сигнал", badge: "допущены", title: "Источники клиентской выдачи", copy: "hh.ru, Работа России и прямые карьерные страницы. Только они могут стать основанием для лида — после проверки уверенности.", status: "Сигнал найден" },
  { role: "verification", label: "02 · Подтверждает компанию", badge: "не создаёт лид", title: "Компания и путь контакта", copy: "Сайт компании и ЕГРЮЛ/ФНС уточняют юрлицо, домен и безопасный корпоративный канал. Отдельно лид не создают.", status: "Компания подтверждена" },
  { role: "context", label: "03 · Усиливает контекст", badge: "только контекст", title: "Почему сейчас", copy: "Корпоративные события, официальные публикации и отраслевой контекст объясняют момент обращения, но не заменяют доказательство найма.", status: "Контекст добавлен" },
] as const;

export function SourceLayerExplorer() {
  const [active, setActive] = useState(0);
  const [enhanced, setEnhanced] = useState(false);
  useEffect(() => setEnhanced(true), []);

  return (
    <div className={hpStyles.sourceExplorer} data-enhanced={enhanced ? "true" : "false"}>
      <ol className={hpStyles.sourceLayers} style={{ "--source-progress": active / (SOURCE_LAYERS.length - 1) } as React.CSSProperties}>
        {SOURCE_LAYERS.map((layer, index) => (
          <li key={layer.role} className={hpStyles.sourceLayer} data-source-role={layer.role} data-active={active === index ? "true" : "false"}>
            <button type="button" aria-pressed={active === index} onClick={() => setActive(index)}>
              <span className={hpStyles.sourceLayerMeta}><span>{layer.label}</span><em>{layer.badge}</em></span>
              <strong>{layer.title}</strong>
              <small>{layer.copy}</small>
            </button>
          </li>
        ))}
      </ol>
      <p className={hpStyles.sourceStatus} role="status"><i aria-hidden="true" />{SOURCE_LAYERS[active].status}</p>
    </div>
  );
}
