export const LANDING_SCENES = [
  { id: "scene-detection", index: "01", label: "Обнаружение" },
  { id: "scene-timeline", index: "02", label: "Сигнал" },
  { id: "scene-evidence", index: "03", label: "Доказательство" },
  { id: "scene-outreach", index: "04", label: "Контакт" },
  { id: "scene-workspace", index: "05", label: "Рабочий радар" },
] as const;

export const DEMO_COMPANY = {
  name: "Производственная компания",
  location: "Москва и область",
  industry: "Промышленность",
  signal: "Инженерный найм",
  score: 87,
} as const;

export const DEMO_TIMELINE = [
  {
    date: "12 августа",
    title: "Открыто 4 инженерные вакансии",
    source: "карьерная страница",
  },
  {
    date: "15 августа",
    title: "Появилась позиция руководителя направления",
    source: "публичная вакансия",
  },
  {
    date: "18 августа",
    title: "Набор расширен на новый регион",
    source: "карьерная страница",
  },
  {
    date: "Сегодня",
    title: "3 вакансии обновлены повторно",
    source: "изменение публикации",
  },
] as const;

export const DEMO_EVIDENCE = [
  {
    label: "Сила сигнала",
    points: "+24",
    fact: "8 релевантных позиций открыты за последние 7 дней.",
  },
  {
    label: "Динамика",
    points: "+18",
    fact: "Темп публикации вакансий выше предыдущего периода.",
  },
  {
    label: "Свежесть",
    points: "+16",
    fact: "Последнее подтверждённое изменение обнаружено сегодня.",
  },
  {
    label: "Релевантность",
    points: "+21",
    fact: "Большинство ролей совпадает со специализацией агентства.",
  },
] as const;

export const DEMO_CONTACT_PATHS = [
  "Корпоративная форма",
  "Карьерная страница",
  "Общий HR-канал",
] as const;

export const DEMO_OUTREACH_COPY =
  "Заметили, что компания одновременно усиливает несколько инженерных направлений и недавно открыла руководящую позицию. Мы специализируемся на подборе таких команд и можем подключиться к наиболее сложным ролям.";
