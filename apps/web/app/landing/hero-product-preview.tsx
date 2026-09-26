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
 * sublabels, the price promise and the timer hint are removed as noise.
 * Owner verdict 26.09 (pass 9): the demo window reproduces the linear.app
 * hero demo layout — sidebar nav with icons and groups, issue topbar
 * (status dot + id + title + counter), tool row, activity-style content,
 * right summary column and a floating assistant panel — with Recruiter
 * Radar data inside. */
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

/* Minimal 16px line-icon set mirroring the reference demo's sidebar/topbar
 * glyphs. Decorative only — every icon is aria-hidden. */
const ICON_PATHS: Record<string, string> = {
  back: "M9.8 3.6 5.4 8l4.4 4.4",
  bolt: "M8.8 1.8 4.2 8.6h3.3L7.2 14.2l4.6-6.8H8.5l.3-5.6Z",
  inbox: "M2 9.6 3.8 4h8.4l1.8 5.6V13H2V9.6Zm0 0h3.1l.9 1.6h4l.9-1.6h3.1",
  target: "M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6Zm0 3.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z",
  branch: "M4.6 2.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm0 7.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6ZM4.6 6v4m6.8-7.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Zm0 3.2v1.2a2 2 0 0 1-2 2H6.4",
  chart: "M3 13V8m5 5V3m5 10V6",
  search: "M7.2 2.8a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Zm3.4 7.8 2.8 2.8",
  plus: "M8 3.4v9.2M3.4 8h9.2",
  caret: "m4.6 6.4 3.4 3.2 3.4-3.2",
  star: "m8 2.6 1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.3l-3.4 1.8.7-3.8L2.5 6.6l3.8-.5L8 2.6Z",
  link: "M6.8 9.2 9.2 6.8M5 7.4l-.8.8a2.4 2.4 0 0 0 3.4 3.4l.8-.8m2.6-4.2.8-.8a2.4 2.4 0 0 0-3.4-3.4l-.8.8",
  doc: "M3.6 2.4h8.8v11.2H3.6V2.4ZM6 6h4M6 8.6h4",
  panelIco: "M2.2 3.4h11.6v9.2H2.2V3.4Zm7.2 0v9.2",
  expand: "M9.6 3.6h2.8v2.8m0-2.8-4 4M6.4 12.4H3.6V9.6m0 2.8 4-4",
  up: "M8 11.4V4.6M5.2 7.4 8 4.6l2.8 2.8",
  down: "M8 4.6v6.8M5.2 8.6 8 11.4l2.8-2.8",
  more: "M3.6 8a1.1 1.1 0 1 0 0-.01Zm4.4 0a1.1 1.1 0 1 0 0-.01Zm4.4 0a1.1 1.1 0 1 0 0-.01Z",
};

const NAV_ICONS: Record<PageKey, string> = {
  today: "bolt",
  companies: "inbox",
  radar: "target",
  engineering: "branch",
  finance: "chart",
};

function Ico({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export default function HeroProductPreview() {
  const [page, setPage] = useState<PageKey>("today");
  const [stage, setStage] = useState<Stage>(1);

  useEffect(() => {
    if (page !== "today" || window.matchMedia?.("prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => {
      setStage((current) => (current === 4 ? 1 : (current + 1) as Stage));
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [page, stage]);

  const currentStage = STAGES[stage - 1];
  const prevStage = () => setStage(stage === 1 ? 4 : ((stage - 1) as Stage));
  const nextStage = () => setStage(stage === 4 ? 1 : ((stage + 1) as Stage));

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
      <div className={sceneStyles.shotBody}>
        <aside className={sceneStyles.shotSide} aria-label="Разделы workflow">
          <div className={sceneStyles.sideWorkspace}>
            <span className={sceneStyles.shotMark} aria-hidden="true">RR</span>
            <strong>Recruiter Radar</strong>
            <span className={sceneStyles.sideWorkspaceTools} aria-hidden="true">
              <Ico name="caret" />
              <Ico name="search" />
              <Ico name="plus" />
            </span>
          </div>
          <div className={sceneStyles.shotNav}>
            {PAGES.filter((item) => item.group === "cabinet").map((item) => (
              <button key={item.key} type="button" className={page === item.key ? sceneStyles.shotNavActive : undefined} onClick={() => setPage(item.key)}>
                <Ico name={NAV_ICONS[item.key]} />
                {item.label}
              </button>
            ))}
          </div>
          <p className={sceneStyles.sideGroup}>Наблюдения <Ico name="caret" /></p>
          <div className={sceneStyles.shotNav}>
            {PAGES.filter((item) => item.group === "watch").map((item) => (
              <button key={item.key} type="button" className={page === item.key ? sceneStyles.shotNavActive : undefined} onClick={() => setPage(item.key)}>
                <Ico name={NAV_ICONS[item.key]} />
                {item.label}
              </button>
            ))}
          </div>
          <p className={sceneStyles.sideGroup}>Этапы пилота <Ico name="caret" /></p>
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
                onClick={() => { setStage(item.id); setPage("today"); }}
              >
                <span className={sceneStyles.stageState} data-state={item.id < stage ? "done" : item.id === stage ? "active" : "todo"} aria-hidden="true" /><span><b>{item.label}</b></span>
              </button>
            ))}
          </div>
          <div className={sceneStyles.sideUser}>
            <span aria-hidden="true">7д</span>
            <small>Недельный пилот</small>
          </div>
        </aside>

        <div className={sceneStyles.shotWorkspace}>
          <header className={sceneStyles.shotWorkspaceHeader}>
            <span className={sceneStyles.shotBack} aria-hidden="true"><Ico name="back" /></span>
            <span className={sceneStyles.shotStatus} aria-hidden="true" />
            <span className={sceneStyles.shotIssueId}>RR-1042</span>
            <strong>{page === "today" ? "Приоритетные компании и поводы" : PAGE_CONTENT[page].title}</strong>
            <span className={sceneStyles.shotHeaderTools} aria-hidden="true">
              <Ico name="star" />
              <Ico name="more" />
            </span>
            {page === "today" ? (
              <span className={sceneStyles.shotCounter}>
                <b>{stage} / 4</b>
                <button type="button" aria-label="Предыдущий этап" onClick={prevStage}><Ico name="up" /></button>
                <button type="button" aria-label="Следующий этап" onClick={nextStage}><Ico name="down" /></button>
              </span>
            ) : null}
          </header>

          <div className={sceneStyles.shotToolRow} aria-hidden="true">
            <span className={sceneStyles.shotToolCaption}>Интерактивный workflow</span>
            <span className={sceneStyles.shotToolIco}><Ico name="link" /></span>
            <span className={sceneStyles.shotToolIco}><Ico name="doc" /></span>
            <span className={sceneStyles.shotToolIco}><Ico name="panelIco" /></span>
            <span className={sceneStyles.shotToolIco}><Ico name="expand" /></span>
          </div>

          {page === "today" ? (
            <div className={sceneStyles.workflowArea}>
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
                  <p className={sceneStyles.activityHead}>Активность</p>
                  <dl className={sceneStyles.workflowRows}>
                    {currentStage.rows.map(([label, copy], index) => (
                      <div key={label}>
                        {index % 3 === 0 && <span className={sceneStyles.rowIco} data-i={index % 3} aria-hidden="true"><Ico name={["search", "chart", "target"][index % 3]} /></span>}
                        {index % 3 === 1 && <span className={sceneStyles.rowLabel}>{label}</span>}
                        {index % 3 === 2 && <span className={sceneStyles.rowAv} aria-hidden="true">RR</span>}
                        {index % 3 !== 1 && <dt>{label}</dt>}
                        <dd>{copy}</dd>
                        <span className={sceneStyles.rowTime}>{["сейчас", "1 мин назад", "2 мин назад"][index % 3]}</span>
                      </div>
                    ))}
                  </dl>
                  <div className={sceneStyles.cmtCard}>
                    <span className={sceneStyles.cmtAv} aria-hidden="true">RR</span>
                    <div className={sceneStyles.cmtBody}>
                      <p className={sceneStyles.cmtHead}><strong>Радар</strong><span>сейчас</span></p>
                      <p>Следующий этап включится автоматически — сценарий пилота идёт без ручных шагов.</p>
                    </div>
                  </div>
                </div>
                <aside className={sceneStyles.shotProps} aria-label="Сводка этапа">
                  <div className={sceneStyles.propsCard}>
                    <h3>Сводка</h3>
                    <p className={sceneStyles.propsStatus}><span className={sceneStyles.statusDot} aria-hidden="true" />Этап {stage} из 4</p>
                    <p className={sceneStyles.propsMeta}>Пилот · 7 дней. Этапы сменяются сами</p>
                  </div>
                  <div className={sceneStyles.aiFloat} aria-hidden="true">
                    <div className={sceneStyles.aiFloatHead}>
                      <span className={sceneStyles.shotMark}>RR</span>
                      <strong>Радар</strong>
                      <em>AI</em>
                      <span className={sceneStyles.aiFloatCaret}><Ico name="caret" /></span>
                    </div>
                    <p className={sceneStyles.aiFloatCard}>Найти 10 компаний с поводом написать</p>
                    <p className={sceneStyles.aiFloatCtx}>RR-1042 · профиль рынка в контексте</p>
                    <p className={sceneStyles.aiFloatState}><span />Сканирует 42 источника…</p>
                  </div>
                </aside>
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
