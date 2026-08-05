export const LANDING_NAV_ITEMS = [
  { id: "scene-workspace", label: "Пример" },
  { id: "scene-evidence", label: "Доказательства" },
  { id: "scene-delivery", label: "Как работает" },
  { id: "pricing", label: "Тарифы" },
  { id: "faq", label: "FAQ" },
] as const;

/** Compatibility export for older imports and analytics fixtures. */
export const LANDING_SCENES = LANDING_NAV_ITEMS;

export const DEMO_COMPANY = {
  name: "Производственная компания",
  location: "Москва и область",
  industry: "Промышленность",
  signal: "Инженерный найм ускоряется",
  change: "8 инженерных позиций и новая роль руководителя направления",
  freshness: "2 часа назад",
  confidence: "A / высокая",
  whyNow: "Четыре связанных события за семь дней показывают расширение команды, а не разовую замену.",
  score: 87,
} as const;

export const DEMO_TIMELINE = [
  {
    date: "12 августа",
    title: "Открыты четыре инженерные вакансии",
    source: "карьерная страница",
  },
  {
    date: "15 августа",
    title: "Появилась позиция руководителя направления",
    source: "публичная вакансия",
  },
  {
    date: "18 августа",
    title: "Набор расширен на Московскую область",
    source: "карьерная страница",
  },
  {
    date: "Сегодня",
    title: "Три роли обновлены повторно",
    source: "изменение публикаций",
  },
] as const;

export const DEMO_EVIDENCE = [
  {
    label: "Сила сигнала",
    points: "+24",
    fact: "Восемь релевантных позиций открыты за последние семь дней.",
  },
  {
    label: "Динамика",
    points: "+18",
    fact: "Темп публикаций выше предыдущего периода и затрагивает несколько функций.",
  },
  {
    label: "Свежесть",
    points: "+16",
    fact: "Последнее подтверждённое изменение обнаружено сегодня.",
  },
  {
    label: "Соответствие профилю",
    points: "+21",
    fact: "Большинство ролей совпадает со специализацией инженерного агентства.",
  },
] as const;

export const DEMO_CONTACT_PATHS = [
  "Корпоративная форма",
  "Карьерная страница",
  "Общий HR-канал",
] as const;

export const DEMO_OUTREACH_COPY =
  "Заметили, что компания одновременно усиливает несколько инженерных направлений и недавно открыла руководящую позицию. Мы специализируемся на подборе таких команд и можем подключиться к наиболее сложным ролям.";
