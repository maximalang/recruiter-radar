import { DEFAULT_LANDING_DEMO_STORY } from "../../lib/landing-demo";

export const LANDING_NAV_ITEMS = [
  { id: "scene-workspace", label: "Пример" },
  { id: "scene-evidence", label: "Как работает" },
  { id: "pricing", label: "Тариф" },
  { id: "faq", label: "FAQ" },
] as const;
export const DEMO_COMPANY = {
  name: DEFAULT_LANDING_DEMO_STORY.company.name,
  location: DEFAULT_LANDING_DEMO_STORY.company.location,
  industry: DEFAULT_LANDING_DEMO_STORY.company.industry,
  signal: DEFAULT_LANDING_DEMO_STORY.company.signal,
  change: DEFAULT_LANDING_DEMO_STORY.company.change,
  freshness: DEFAULT_LANDING_DEMO_STORY.company.freshness,
  confidence: DEFAULT_LANDING_DEMO_STORY.company.confidence,
  whyNow: DEFAULT_LANDING_DEMO_STORY.company.whyNow,
  opener: DEFAULT_LANDING_DEMO_STORY.company.opener,
  score: DEFAULT_LANDING_DEMO_STORY.company.score,
} as const;

export const DEMO_EVIDENCE_SOURCES = DEFAULT_LANDING_DEMO_STORY.evidence;

export const DEMO_EVIDENCE = [
  {
    label: "Сила сигнала",
    points: "+26",
    fact: "Демо-сценарий: восемь релевантных позиций открыты в течение одной недели до даты сценария.",
  },
  {
    label: "Динамика",
    points: "+20",
    fact: "Темп публикаций вырос и затронул несколько инженерных направлений.",
  },
  {
    label: "Свежесть",
    points: "+18",
    fact: "Последнее подтверждённое изменение зафиксировано 12 мая (демо-сценарий).",
  },
  {
    label: "Соответствие профилю",
    points: "+23",
    fact: "Роли и география совпадают с профилем инженерного рекрутингового агентства.",
  },
] as const;
