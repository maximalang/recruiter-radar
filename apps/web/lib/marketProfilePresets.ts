/**
 * Market-profile presets — named bundles of ready-made ICP criteria that a
 * recruiter picks during pilot onboarding instead of typing every field from
 * scratch.
 *
 * Product truth for the frozen landing demo (app/landing/hero-product-preview.tsx,
 * stage «Профиль рынка — Инженерный подбор»): the radar creates a market
 * profile preset with ниша / роли / география / признаки спроса, and the
 * criteria stay editable at any moment. This module is the product-side
 * implementation of that promise.
 *
 * Design constraints (mirror lib/clientProfileOptions.ts):
 * - Pure + client-safe: NO server-only imports. clientProfiles.ts transitively
 *   pulls in `pg` and must never reach the browser bundle, so the canonical
 *   whitelists are NOT imported here. The key ⊆ VALID_ROLES / VALID_INDUSTRIES
 *   invariant is enforced by a server-side unit test
 *   (src/__tests__/lib/market-profile-presets.test.ts).
 * - A preset never invents new scan mechanics. Its criteria are exactly the
 *   existing ClientProfile fields (specialization, roles, industries,
 *   includeKeywords, remoteFriendly) that already flow into the query-planner
 *   v2 scan parameters (HH_SEARCH_TEXT / SUPERJOB_KEYWORD /
 *   RABOTA_ROSSII_SEARCH_TEXT via buildProfileKeywords). Selecting a preset
 *   fills those fields; the user can edit every one of them afterwards —
 *   submitted form values always win over preset defaults.
 */

export type MarketProfilePresetId = "engineering-hiring" | "finance-software";

export type MarketProfilePresetCriteria = {
  /** Ниша — persisted as client_profiles.specialization. */
  specialization: string;
  /** Роли — canonical keys (must be ⊆ VALID_ROLES). */
  roles: readonly string[];
  /** Отрасли ниши — canonical keys (must be ⊆ VALID_INDUSTRIES). */
  industries: readonly string[];
  /**
   * Признаки спроса — demand-signal phrases persisted as includeKeywords.
   * They feed the source scan query text AND the digest keyword relevance
   * filter, i.e. the profile "collects companies" by these signals.
   */
  demandSignals: readonly string[];
  /** География — preset default: federal coverage incl. remote-friendly. */
  remoteFriendly: boolean;
};

export type MarketProfilePreset = {
  id: MarketProfilePresetId;
  /** Human-facing preset name; also the specialization text it persists. */
  label: string;
  /** One-line picker description. */
  description: string;
  /** Display-only geography summary for the picker card. */
  geographyLabel: string;
  criteria: MarketProfilePresetCriteria;
};

/**
 * Preset registry. Labels match the frozen landing watch-list exactly
 * («Инженерный подбор», «Финансовый софт») so the demo persona corresponds to
 * a real product entity. Criteria derive from the landing demo rows:
 * - engineering: «Рост команд и редкие роли в нише», «Компании объявляют
 *   расширение и новые площадки» → it-engineering/data roles; manufacturing,
 *   energy and IT industries; expansion/new-site demand signals.
 * - finance software: «Растут продажи, внедрение, разработка и ИБ», «Новые
 *   решения и интеграции», «Финансирование и партнёрства» → sales/product/
 *   engineering/finance roles; finance+IT industries; fintech/integration
 *   demand signals.
 */
export const MARKET_PROFILE_PRESETS: readonly MarketProfilePreset[] = [
  {
    id: "engineering-hiring",
    label: "Инженерный подбор",
    description: "Ниша инженерного найма: рост команд, редкие роли, расширение и новые площадки.",
    geographyLabel: "Вся Россия, включая удалёнку",
    criteria: {
      specialization: "Инженерный подбор",
      roles: ["it-engineering", "data"],
      industries: ["it", "manufacturing", "energy"],
      demandSignals: ["инженер", "конструктор", "расширение производства", "новая площадка"],
      remoteFriendly: true,
    },
  },
  {
    id: "finance-software",
    label: "Финансовый софт",
    description: "Финансовый софт и финтех: запуски, сделки, внедрения и рост найма.",
    geographyLabel: "Вся Россия, включая удалёнку",
    criteria: {
      specialization: "Финансовый софт",
      roles: ["it-engineering", "sales", "product", "finance"],
      industries: ["finance", "it"],
      demandSignals: ["финтех", "внедрение", "интеграция", "финансирование"],
      remoteFriendly: true,
    },
  },
] as const;

const PRESET_BY_ID: ReadonlyMap<string, MarketProfilePreset> = new Map(
  MARKET_PROFILE_PRESETS.map((preset) => [preset.id, preset]),
);

const PRESET_BY_LABEL: ReadonlyMap<string, MarketProfilePreset> = new Map(
  MARKET_PROFILE_PRESETS.map((preset) => [preset.label.trim().toLowerCase(), preset]),
);

/** Lookup a preset by its canonical id. Unknown/empty → null. */
export function getMarketProfilePresetById(
  id: string | null | undefined,
): MarketProfilePreset | null {
  if (typeof id !== "string") return null;
  return PRESET_BY_ID.get(id.trim()) ?? null;
}

/**
 * Resolve a persisted/submitted preset reference to a canonical id.
 * Accepts the preset id ("engineering-hiring") or its human label
 * («Инженерный подбор» — the specialization text a preset persists, so an
 * already-saved profile round-trips back to its preset). The explicit
 * "custom" choice and anything unknown resolve to null (no preset).
 */
export function resolveMarketProfilePresetId(
  raw: string | null | undefined,
): MarketProfilePresetId | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "") return null;
  const byId = PRESET_BY_ID.get(value);
  if (byId) return byId.id;
  const byLabel = PRESET_BY_LABEL.get(value.toLowerCase());
  return byLabel ? byLabel.id : null;
}

/**
 * Profile-field draft for a preset — the exact ClientProfile-shaped values the
 * onboarding form prefills and the server action falls back to for fields the
 * submission left empty. Never overrides user-entered values.
 */
export function buildMarketProfileDraftFromPreset(preset: MarketProfilePreset): {
  specialization: string;
  roles: string[];
  industries: string[];
  includeKeywords: string[];
  remoteFriendly: boolean;
} {
  return {
    specialization: preset.criteria.specialization,
    roles: [...preset.criteria.roles],
    industries: [...preset.criteria.industries],
    includeKeywords: [...preset.criteria.demandSignals],
    remoteFriendly: preset.criteria.remoteFriendly,
  };
}
