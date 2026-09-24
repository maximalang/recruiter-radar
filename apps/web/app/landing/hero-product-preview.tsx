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

const STAGES: ReadonlyArray<{
  id: Stage;
  label: string;
  cadence: string;
  eyebrow: string;
  title: string;
  intro: string;
  rows: ReadonlyArray<[string, string]>;
  valueLabel: string;
  value: string;
  valueCopy: string;
  action: string;
}> = [
  {
    id: 1,
    label: "Настройте рынок",
    cadence: "один раз",
    eyebrow: "Шаг 1 · Настройка",
    title: "Так вы задаёте рынок и признаки спроса",
    intro: "Вы описываете нужные компании и сигналы человеческим языком. Радар превращает это в постоянное наблюдение.",
    rows: [
      ["Кого искать", "Отрасли, роли и типы компаний, которые подходят вашему агентству."],
      ["Что считать сигналом", "Рост найма, редкие вакансии, запуск направления или выход в новый регион."],
      ["Где проверять", "Подходящие открытые источники выбираются автоматически."],
    ],
    valueLabel: "Что вы получаете",
    value: "Один профиль вместо десятков сохранённых поисков",
    valueCopy: "Настройку можно уточнять по мере того, как Радар узнаёт ваш рынок.",
    action: "Посмотреть проверку",
  },
  {
    id: 2,
    label: "Радар проверяет",
    cadence: "по частоте источника",
    eyebrow: "Шаг 2 · Проверка",
    title: "Радар проходит по 42 открытым источникам",
    intro: "Он сопоставляет изменения между источниками, отбрасывает повторы и не выдаёт неподтверждённый шум за повод.",
    rows: [
      ["Вакансии и найм", "Изменения на карьерных страницах и в публичных вакансиях."],
      ["Новости компании", "Запуски, расширение, сделки и другие признаки движения."],
      ["Проверка фактов", "Источник и дата сохраняются рядом с каждым выводом."],
    ],
    valueLabel: "Проверить механику",
    value: "Посмотрите путь от источника до подтверждённого повода",
    valueCopy: "Проверка запускается только по вашему действию и ничего не отправляет наружу.",
    action: "Запустить проверку",
  },
  {
    id: 3,
    label: "Получите повод",
    cadence: "только с фактами",
    eyebrow: "Шаг 3 · Результат",
    title: "Каждая компания приходит с причиной написать сейчас",
    intro: "Результат сразу отвечает на три вопроса — без десятков вкладок и ручного восстановления контекста.",
    rows: [
      ["Почему сейчас", "Какое изменение создаёт момент для разговора."],
      ["Чем подтверждено", "Какие независимые источники подтверждают вывод."],
      ["Насколько уверены", "Что усиливает сигнал и что ещё требует проверки."],
    ],
    valueLabel: "Главная ценность",
    value: "Не «кому можно написать», а «почему стоит написать сегодня»",
    valueCopy: "Сильные поводы поднимаются выше, слабые остаются на проверке.",
    action: "Дальше: сообщение",
  },
  {
    id: 4,
    label: "Подготовьте сообщение",
    cadence: "отправляете вы",
    eyebrow: "Шаг 4 · Действие",
    title: "Радар находит повод. Пишете вы.",
    intro: "На основе подтверждённого контекста Радар предлагает спокойное начало разговора — без массовой рассылки от вашего имени.",
    rows: [
      ["Контекст", "Коротко сформулированное изменение и его деловой смысл."],
      ["Основание", "Факты и источники, на которые можно уверенно опереться."],
      ["Следующий шаг", "Точечный черновик, который вы проверяете и отправляете сами."],
    ],
    valueLabel: "Контроль остаётся у вас",
    value: "Никаких автоматических сообщений и массового outreach",
    valueCopy: "Вы выбираете компанию, формулировку и момент отправки.",
    action: "Вернуться к началу",
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
    intro: "Радар собирает подтверждённые изменения в единую историю, чтобы к каждой реальной компании вы возвращались с готовым контекстом.",
    rows: [
      ["Единая хронология", "Все сигналы, проверки и решения остаются рядом — без ручных заметок."],
      ["Связь изменений", "Видно не отдельную новость, а динамику и её значение для найма."],
      ["Следующий шаг", "Для каждой компании сохраняется причина вернуться и безопасное действие."],
    ],
  },
  radar: {
    eyebrow: "Как работает",
    title: "От рынка до разговора — четыре прозрачных шага",
    intro: "Радар не заменяет рекрутера. Он берёт на себя ту часть работы, где важны широта поиска, проверка и дисциплина.",
    rows: [
      ["Рынок", "Вы задаёте границы и признаки спроса."],
      ["Проверка", "Радар просматривает открытые источники и связывает изменения."],
      ["Повод", "Подтверждённые события ранжируются по силе и свежести."],
      ["Действие", "Вы получаете контекст и сами решаете, кому и что написать."],
    ],
  },
  engineering: {
    eyebrow: "Наблюдение",
    title: "Инженерный подбор",
    intro: "Готовый профиль для рынков, где спрос заметен через вакансии, производство и запуск новых технических направлений.",
    rows: [
      ["Вакансии и найм", "Рост инженерных команд, редкие роли и повторяющиеся потребности."],
      ["Публикации компаний", "Расширение производства, запуск площадок и новые проекты."],
      ["Каналы и СМИ", "Отраслевые источники, где изменения появляются раньше общих новостей."],
    ],
  },
  finance: {
    eyebrow: "Наблюдение",
    title: "Финансовый софт",
    intro: "Профиль для компаний, где момент обращения создают продуктовые запуски, сделки и рост специализированного найма.",
    rows: [
      ["Вакансии и найм", "Команды продаж, внедрения, разработки и информационной безопасности."],
      ["Продуктовые новости", "Новые решения, интеграции и выход в смежные сегменты."],
      ["Раунды и сделки", "Финансирование, партнёрства и другие признаки готовности к росту."],
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
  const showStage = (next: Stage) => {
    setPage("today");
    setStage(next);
  };

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
          <div className={sceneStyles.shotPromise}>
            <strong>7 дней полного доступа</strong>
            <span>990 ₽ · без автопродления</span>
          </div>
        </aside>

        <div className={sceneStyles.shotWorkspace}>
          <header className={sceneStyles.shotWorkspaceHeader}>
            <div>
              <span>{page === "today" ? "Сегодня" : "Recruiter Radar"}</span>
              <strong>{page === "today" ? "От сигнала до сообщения" : PAGE_CONTENT[page].title}</strong>
            </div>
            <small>Вся информация внутри</small>
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
                    onClick={() => showStage(item.id)}
                  >
                    <i>{item.id}</i><span><b>{item.label}</b><small>{item.cadence}</small></span>
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
                <aside className={sceneStyles.workflowValue}>
                  <span>{currentStage.valueLabel}</span>
                  <strong>{currentStage.value}</strong>
                  <p>{currentStage.valueCopy}</p>
                  <button type="button" onClick={() => showStage(stage === 4 ? 1 : (stage + 1) as Stage)}>
                    {currentStage.action}
                  </button>
                </aside>
              </article>
              <p className={sceneStyles.autoHint}>Этап сменится автоматически через 8 секунд · клик перезапускает таймер</p>
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
