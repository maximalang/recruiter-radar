"use client";

import { useEffect, useState } from "react";

import sceneStyles from "./detection-scene.module.css";

type PageKey = "today" | "companies" | "radar" | "engineering" | "finance";
type Stage = 1 | 2 | 3 | 4;

const AUTO_ADVANCE_MS = 8_000;

const PAGES: ReadonlyArray<{ key: PageKey; label: string; group: "cabinet" | "watch" }> = [
  { key: "today", label: "Сегодня", group: "cabinet" },
  { key: "companies", label: "Компании", group: "cabinet" },
  { key: "radar", label: "Как работает", group: "cabinet" },
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
    label: "Настройте рынок",
    eyebrow: "Шаг 1 · Настройка",
    title: "Так вы задаёте рынок и признаки спроса",
    intro: "Один профиль вместо десятков сохранённых поисков.",
    rows: [
      ["Кого искать", "Отрасли, роли, география"],
      ["Что считать сигналом", "Рост найма, редкие роли, новые направления"],
      ["Где проверять", "Открытые источники — автоматически"],
    ],
  },
  {
    id: 2,
    label: "Радар проверяет",
    eyebrow: "Шаг 2 · Проверка",
    title: "Радар проходит по 42 открытым источникам",
    intro: "Повторы отбрасываются, шум не выдаётся за повод.",
    rows: [
      ["Вакансии и найм", "Карьерные страницы, публичные вакансии"],
      ["Новости компании", "Запуски, расширение, сделки"],
      ["Проверка фактов", "Источник и дата — рядом с каждым фактом"],
    ],
  },
  {
    id: 3,
    label: "Получите повод",
    eyebrow: "Шаг 3 · Результат",
    title: "Каждая компания приходит с причиной написать сейчас",
    intro: "Карточка отвечает на три вопроса — без десятков вкладок.",
    rows: [
      ["Почему сейчас", "Изменение, которое создаёт момент"],
      ["Чем подтверждено", "Независимые источники и даты"],
      ["Насколько уверены", "Что усиливает сигнал, что проверить"],
    ],
  },
  {
    id: 4,
    label: "Подготовьте сообщение",
    eyebrow: "Шаг 4 · Действие",
    title: "Радар находит повод. Пишете вы.",
    intro: "Черновик опирается на подтверждённые факты. Отправляете вы сами.",
    rows: [
      ["Контекст", "Изменение и его деловой смысл"],
      ["Основание", "Факты и источники для опоры"],
      ["Следующий шаг", "Черновик — проверяете и отправляете сами"],
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
    eyebrow: "Как работает",
    title: "От рынка до разговора — четыре прозрачных шага",
    intro: "Радар берёт на себя широту поиска и проверку. Решения остаются за вами.",
    rows: [
      ["Рынок", "Границы и признаки спроса"],
      ["Проверка", "Открытые источники, связь изменений"],
      ["Повод", "Ранжирование по силе и свежести"],
      ["Действие", "Контекст — контакт за вами"],
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
              <strong>{page === "today" ? "От сигнала до сообщения" : PAGE_CONTENT[page].title}</strong>
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
                <div className={sceneStyles.workflowMain}>
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
            <article className={sceneStyles.infoPage} aria-live="polite">
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
