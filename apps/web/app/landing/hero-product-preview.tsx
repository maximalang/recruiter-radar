"use client";

import { useEffect, useState } from "react";

import sceneStyles from "./detection-scene.module.css";

type PageKey = "today" | "companies" | "radar" | "engineering" | "finance";
type Stage = 1 | 2 | 3 | 4;

const AUTO_ADVANCE_MS = 8_000;

const PAGES: ReadonlyArray<{ key: PageKey; label: string; group: "cabinet" | "watch" }> = [
  { key: "today", label: "Сегодня", group: "cabinet" },
  { key: "companies", label: "Компании", group: "cabinet" },
  { key: "radar", label: "Результат", group: "cabinet" },
  { key: "engineering", label: "Инженерный подбор", group: "watch" },
  { key: "finance", label: "Финансовый софт", group: "watch" },
];

/* Owner verdict 24.09 (pass 2): the demo reads as one logical product story —
 * настройка → проверка → результат → действие. Each stage keeps one title,
 * one intro line and three compact product facts; marketing asides, cadence
 * sublabels, the price promise and the timer hint are removed as noise. */
const STAGES: ReadonlyArray<{
  id: Stage;
  label: string;
  eyebrow: string;
  title: string;
  intro: string;
  rows: ReadonlyArray<[string, string]>;
}> = [
  {
    id: 1,
    label: "Ваш рынок",
    eyebrow: "Шаг 1 · Настройка",
    title: "Один профиль вместо десятков сохранённых поисков",
    intro: "Отрасль, роли, география и признаки спроса — настраиваются один раз.",
    rows: [
      ["Критерии", "Ниша, роли, география"],
      ["Настройка", "Один раз — дальше радар сам"],
      ["Результат", "Компании строго под ваш профиль"],
    ],
  },
  {
    id: 2,
    label: "42 источника",
    eyebrow: "Шаг 2 · Проверка",
    title: "Радар проверяет 42 открытых источника без вас",
    intro: "Повторы и шум отбрасываются — остаётся только повод.",
    rows: [
      ["Вакансии и найм", "Публичные карьерные сигналы"],
      ["Новости и реестры", "Изменения в компаниях"],
      ["Чистота", "Факт без источника — не повод"],
    ],
  },
  {
    id: 3,
    label: "10 компаний",
    eyebrow: "Шаг 3 · Результат",
    title: "10 компаний за 7 дней — каждая с причиной написать",
    intro: "Повод, факты, источник и уверенность — в одной карточке.",
    rows: [
      ["Почему сейчас", "Изменение, которое создаёт момент"],
      ["Чем подтверждено", "Независимые источники и даты"],
      ["Насколько уверены", "Что усиливает сигнал, что проверить"],
    ],
  },
  {
    id: 4,
    label: "Готовый черновик",
    eyebrow: "Шаг 4 · Действие",
    title: "Черновик готов — отправляете только вы",
    intro: "Сообщение опирается на подтверждённые факты. Никаких автоотправок.",
    rows: [
      ["Черновик", "Первое сообщение по фактам"],
      ["Контроль", "Отправка только вручную"],
      ["Итог", "Вы решаете, кому написать"],
    ],
  },
];

const PAGE_CONTENT: Record<Exclude<PageKey, "today">, {
  eyebrow: string;
  title: string;
  intro: string;
  rows: ReadonlyArray<[string, string]>;
}> = {
  companies: {
    eyebrow: "Компании",
    title: "Вся история — в одном месте",
    intro: "Сигналы, проверки и решения по каждой компании — в одной хронологии.",
    rows: [
      ["Хронология", "Все события и ваши решения рядом"],
      ["Связь изменений", "Динамика, а не отдельная новость"],
      ["Следующий шаг", "Причина вернуться и безопасное действие"],
    ],
  },
  radar: {
    eyebrow: "Результат",
    title: "Что вы получаете за неделю пилота",
    intro: "Приоритетные компании вашего рынка — с поводом, фактами и черновиком.",
    rows: [
      ["10 компаний", "Приоритет строго под профиль"],
      ["Повод и факты", "Источник и дата у каждого"],
      ["Черновик", "Готовое первое сообщение"],
    ],
  },
  engineering: {
    eyebrow: "Наблюдение",
    title: "Инженерный подбор",
    intro: "Рынки, где спрос виден через вакансии и производство.",
    rows: [
      ["Вакансии", "Рост команд, редкие роли"],
      ["Публикации", "Расширение, новые площадки"],
      ["СМИ", "Изменения раньше общих новостей"],
    ],
  },
  finance: {
    eyebrow: "Наблюдение",
    title: "Финансовый софт",
    intro: "Компании, где момент создают запуски, сделки и рост найма.",
    rows: [
      ["Вакансии", "Продажи, внедрение, разработка, ИБ"],
      ["Продукт", "Новые решения и интеграции"],
      ["Сделки", "Финансирование и партнёрства"],
    ],
  },
};

export default function HeroProductPreview() {
  const [page, setPage] = useState<PageKey>("today");
  const [stage, setStage] = useState<Stage>(1);

  useEffect(() => {
    if (page !== "today" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => {
      setStage((current) => (current === 4 ? 1 : (current + 1) as Stage));
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [page, stage]);

  const currentStage = STAGES[stage - 1];

  return (
    <figure
      id="hero-workflow"
      className={sceneStyles.productShot}
      style={{ scrollMarginTop: "calc(72px + 32px)" }}
      data-hero-product-preview="workflow"
      data-hero-workflow
      data-active-page={page}
      data-active-stage={stage}
      tabIndex={-1}
      aria-label="Интерактивный workflow Recruiter Radar: настройка рынка, проверка источников, подтверждённый повод и подготовка сообщения."
    >
      <div className={sceneStyles.shotBar}>
        <span className={sceneStyles.shotMark} aria-hidden="true">RR</span>
        <strong>Recruiter Radar</strong>
        <span className={sceneStyles.shotMode}>Интерактивный workflow</span>
      </div>

      <div className={sceneStyles.shotBody}>
        <aside className={sceneStyles.shotSide} aria-label="Разделы workflow">
          <p>Кабинет</p>
          <div className={sceneStyles.shotNav}>
            {PAGES.filter((item) => item.group === "cabinet").map((item) => (
              <button key={item.key} type="button" className={page === item.key ? sceneStyles.shotNavActive : undefined} onClick={() => setPage(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
          <p>Наблюдения</p>
          <div className={sceneStyles.shotNav}>
            {PAGES.filter((item) => item.group === "watch").map((item) => (
              <button key={item.key} type="button" className={page === item.key ? sceneStyles.shotNavActive : undefined} onClick={() => setPage(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        <div className={sceneStyles.shotWorkspace}>
          <header className={sceneStyles.shotWorkspaceHeader}>
            <div>
              <span>{page === "today" ? "Сегодня" : "Recruiter Radar"}</span>
              <strong>{page === "today" ? "Приоритетные компании и поводы" : PAGE_CONTENT[page].title}</strong>
            </div>
          </header>

          {page === "today" ? (
            <div className={sceneStyles.workflowArea}>
              <div className={sceneStyles.workflowTabs} role="tablist" aria-label="Этапы workflow">
                {STAGES.map((item) => (
                  <button
                    key={item.id}
                    id={`hero-workflow-tab-${item.id}`}
                    type="button"
                    role="tab"
                    aria-selected={stage === item.id}
                    aria-controls="hero-workflow-panel"
                    className={stage === item.id ? sceneStyles.workflowTabActive : undefined}
                    onClick={() => setStage(item.id)}
                  >
                    <i>{item.id}</i><span><b>{item.label}</b></span>
                  </button>
                ))}
              </div>

              <article
                id="hero-workflow-panel"
                className={sceneStyles.workflowPanel}
                role="tabpanel"
                aria-live="polite"
                aria-labelledby={`hero-workflow-tab-${stage}`}
              >
                <div className={sceneStyles.workflowMain} key={`stage-${stage}`}>
                  <span className={sceneStyles.workflowEyebrow}>{currentStage.eyebrow}</span>
                  <h2>{currentStage.title}</h2>
                  <p className={sceneStyles.workflowIntro}>{currentStage.intro}</p>
                  <dl className={sceneStyles.workflowRows}>
                    {currentStage.rows.map(([label, copy]) => (
                      <div key={label}><dt>{label}</dt><dd>{copy}</dd></div>
                    ))}
                  </dl>
                </div>
              </article>
            </div>
          ) : (
            <article className={sceneStyles.infoPage} key={`page-${page}`} aria-live="polite">
              <span>{PAGE_CONTENT[page].eyebrow}</span>
              <h2>{PAGE_CONTENT[page].title}</h2>
              <p>{PAGE_CONTENT[page].intro}</p>
              <dl>
                {PAGE_CONTENT[page].rows.map(([label, copy], index) => (
                  <div key={label}><i>{String(index + 1).padStart(2, "0")}</i><dt>{label}</dt><dd>{copy}</dd></div>
                ))}
              </dl>
              <button type="button" onClick={() => setPage("today")}>Вернуться к workflow</button>
            </article>
          )}
        </div>
      </div>
    </figure>
  );
}
