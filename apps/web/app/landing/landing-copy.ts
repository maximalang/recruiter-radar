import { DEFAULT_LANDING_DEMO_STORY } from "../../lib/landing-demo";

export const LANDING_NAV_ITEMS = [
  { id: "scene-evidence", label: "Разбор" },
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
