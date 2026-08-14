/**
 * Server-side data fetching for the leads list page.
 *
 * Returns digest candidates (leads) for a given client profile,
 * with scoring, confidence, evidence, and feedback state.
 */

import { getPool } from "./db";
import { formatReason, type ScoringReason } from "./scoring/scoring-reasons";
import { parseStoredEnrichment, type StoredAiEnrichment } from "./ai/enrichment/enrichmentStore";
import { hasCompanyHiringSource } from "./sources/company-hiring-sources";

// ─── Reason parsing ──────────────────────────────────────────────

/**
 * Parse the `reasons` column from digest_candidates.
 * Handles both legacy string[] and new ScoringReason[] format.
 * Returns structured ScoringReason[] regardless of storage format.
 */
function parseReasons(raw: unknown): ScoringReason[] {
  if (!Array.isArray(raw)) return []

  const result: ScoringReason[] = []
  for (const item of raw) {
    if (typeof item === 'object' && item !== null && 'key' in item && 'component' in item) {
      // New ScoringReason format
      result.push(item as ScoringReason)
    } else if (typeof item === 'string' && item.length > 0) {
      // Legacy free-form Russian string (the older digest format, still present
      // on prod rows that predate the structured-reason migration). Wrap it as a
      // synthetic reason whose KEY is the stable signal 'legacy' and whose FULL
      // original text rides in params.text — so formatReason can render the
      // human string verbatim instead of the debug-style `[legacy.<text>]` stub
      // it used to leak into the lead card. Do NOT truncate (the old code sliced
      // to 40 chars and baked the slice into the key, which both lost text and
      // produced the bracketed stub users saw).
      result.push({ component: 'fit', key: 'legacy', params: { text: item } })
    }
  }
  return result
}

// ─── Lead Card Derivation ────────────────────────────────────────

// ─── Why-now priority ──────────────────────────────────────────────
// Strongest "почему сейчас" signals first, so the lead card never leads with a
// weak/ambient reason when a concrete hiring-urgency signal exists. Ordered by
// evidential strength: direct corroborated hiring > burst > fresh > multiple
// roles > generic freshness. Keys not listed inherit the lowest priority.
const WHY_NOW_KEY_PRIORITY: Record<string, number> = {
  'intent.direct-evidence.corroborated': 100,
  'intent.multiple-corroborating': 95,
  'intent.direct-evidence.present': 90,
  'urgency.recent-signal-burst': 85,
  'urgency.burst': 80,
  'urgency.hard-to-fill': 75,
  'urgency.fresh-postings': 70,
  'intent.fresh-signals': 65,
  'intent.partially-fresh': 55,
  'intent.multiple-roles': 50,
  'intent.source-diversity.high': 45,
  'intent.source-diversity.medium': 40,
  'intent.direct-surface': 35,
  'intent.stale-signals': 10,
  'urgency.stale-role-repeated': 5,
  'urgency.stale-role-single': 4,
}

function whyNowPriority(reason: { component: string; key: string }): number {
  return WHY_NOW_KEY_PRIORITY[reason.key] ?? 20
}

/**
 * Derive `why_now` from scoring reasons.
 * Picks the top urgency/intent reason keys, renders Russian labels.
 *
 * Priority-ordered: the strongest hiring-urgency/direct-evidence signal leads,
 * so a low-quality lead (only stale/ambient reasons) cannot read as a hot one.
 * Returns an empty string when there are no reasons at all — the caller hides
 * the line, which is more honest than a vacuous "повод для контакта есть сейчас".
 *
 * TODO(Stage-1 AI-assist hook): this is the Stage-1 `explanation-enhance` hook
 * point — a pure `(reasons) => rewordedText` adapter may wrap/replace the
 * returned string WITHOUT touching `reasons`, score, gate, or evidence (see
 * docs/specs/2026-06-27-stage1-ai-assist-deterministic.md + the delivery-paths
 * roadmap §"UX-хук (готовить дёшево)"). The deterministic fallback must stay
 * when the hook is absent/unavailable. deriveLawfulContactPath below is the
 * same kind of pure derivation point.
 */
export function deriveWhyNow(rawReasons: unknown): string {
  const reasons = parseReasons(rawReasons)
  if (reasons.length === 0) return ''

  // Prefer urgency/intent component reasons, ordered by evidential strength.
  const priorityReasons = reasons.filter(r =>
    r.component === 'urgency' || r.component === 'intent'
  )
  const pool = priorityReasons.length > 0 ? priorityReasons : reasons
  const picked = [...pool].sort((a, b) => whyNowPriority(b) - whyNowPriority(a)).slice(0, 2)
  return picked.map(formatReason).join('; ')
}

/**
 * Derive `lawful_contact_path` from evidence and reasons.
 * Returns the safest non-personal contact path available.
 */
export function deriveLawfulContactPath(rawReasons: unknown, sourceFamilies: string[]): string | null {
  const reasons = parseReasons(rawReasons)
  const keys = reasons.map(r => r.key)

  if (keys.includes('reachability.career-page')) {
    return 'career-page'
  }
  if (keys.includes('reachability.corporate-contact')) {
    return 'corporate-contact'
  }
  if (sourceFamilies.some(s => s === 'egrul-fns' || s === 'fedresurs')) {
    return 'registry-data'
  }
  if (keys.includes('reachability.direct-surface')) {
    return 'direct-surface'
  }
  return null
}

/**
 * Format a lawful-contact-path key into Russian copy.
 * Single source of truth shared by the lead detail page and the public preview.
 * Returns null for unknown / absent paths so callers can hide the block.
 */
export function formatLawfulContactPath(path: string | null): string | null {
  switch (path) {
    case 'career-page':
      return 'Карьерная страница компании — прямой путь к HR'
    case 'corporate-contact':
      return 'Корпоративная форма обратной связи или общий HR-email'
    case 'registry-data':
      return 'Данные из открытых реестров (ЕГРЮЛ/ФНС)'
    case 'direct-surface':
      return 'Прямая поверхность компании — официальный сайт или карьерный раздел'
    default:
      return null
  }
}

/**
 * Derive `negative_signals` — risk factors / why not.
 * Uses reason.key for structured matching + confidence gate + source count.
 */
export function deriveNegativeSignals(input: {
  reasons: unknown;
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
  sourceFamilies: string[];
  confidenceGate: string;
}): string[] {
  const signals: string[] = []
  const reasons = parseReasons(input.reasons)
  const keys = reasons.map(r => r.key)

  // Internal recruiter only
  if (keys.includes('intent.internal-recruiter-only')) {
    signals.push('Вакансия внутреннего рекрутера — слабый сигнал сам по себе')
  }

  // Low confidence
  if (input.confidenceGate === 'C' || input.confidenceGate === 'D') {
    signals.push('Низкая уверенность в сигнале — требуется проверка')
  }

  // Single source — only flag when no direct corporate surface is present.
  // A single company career/hosted-ATS source IS a direct hiring surface, so
  // "только один источник" would be misleading noise there; reserve the flag
  // for platform-only aggregation where corroboration genuinely is missing.
  const hasDirectSurface =
    keys.includes('reachability.career-page') ||
    keys.includes('reachability.corporate-contact') ||
    keys.includes('reachability.direct-surface') ||
    hasCompanyHiringSource(input.sourceFamilies)
  if (input.sourceFamilies.length <= 1 && !hasDirectSurface) {
    signals.push('Только один источник — нет независимого подтверждения')
  }

  // Stale signals
  if (keys.includes('intent.stale-signals') ||
      keys.includes('urgency.stale-role-repeated') ||
      keys.includes('urgency.stale-role-single')) {
    signals.push('Устаревшие сигналы — активность могла закончиться')
  }

  // Repeated similar roles (high vacancy count but low distinct names)
  if (input.vacanciesCount >= 3 && input.distinctVacancyNamesCount <= 1) {
    signals.push('Повторяющиеся одинаковые вакансии — возможен репост')
  }

  // Industry excluded by ICP
  if (keys.includes('fit.industry.excluded')) {
    signals.push('Индустрия исключена из ICP агентства')
  }

  // Competitor (recruitment/staffing agency) — never a valid client
  if (keys.includes('fit.competitor.excluded')) {
    signals.push('Компания-конкурент — кадровое/рекрутинговое агентство')
  }

  // No safe contact path
  if (keys.includes('reachability.no-path')) {
    signals.push('Безопасный путь контакта пока не найден')
  }

  return signals
}

// ─── Types ──────────────────────────────────────────────────────

/**
 * Valid feedback status values — MUST match the DB enum `digest_feedback_status`
 * exactly (packages/db/schema/init.sql). The enum is:
 *   none, contacted, replied, won, badfit, snooze, dismissed
 *
 * This set was previously drifted (listed accepted/later/call/client, which are
 * NOT in the enum) — clicking in-app "Беру"/"Позже" threw `invalid input value
 * for enum` at runtime because updateLeadFeedback casts the status to
 * digest_feedback_status. The in-app writer now uses only DB-legal values.
 * FEEDBACK_LABELS (internal-page.tsx) still carries the legacy labels for
 * display-only tolerance of any old rows, but no writer emits them.
 *
 * `snooze` is a DB-legal triage state ("отложить на N дней") — the digest path
 * pairs it with a suppressed_until window; the in-app path writes the status
 * without the suppression window (the lead is marked "отложен", and a future
 * run can re-surface it). This is intentional: the in-app button is a triage
 * label, not a scheduling action.
 */
export const VALID_FEEDBACK_STATUSES = new Set([
  'none', 'contacted', 'replied', 'won', 'badfit', 'snooze', 'dismissed',
] as const);

export type FeedbackStatus = Exclude<typeof VALID_FEEDBACK_STATUSES extends Set<infer T> ? T : never, 'none'>;

export interface LeadItem {
  id: string;
  orgId: string;
  /** Owning client profile — lets the list page match a lead to its agency profile. */
  clientProfileId: string;
  orgName: string;
  sourceExternalId: string | null;
  score: number;
  confidenceGate: string;
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
  latestPublishedAt: string | null;
  reasons: string[];
  /**
   * Structured scoring reasons (component + stable key + params), parsed from the
   * raw `reasons` column. Drives the deterministic fit explanation, which matches
   * on stable keys rather than localized strings. Empty for legacy string-only
   * rows — the fit builder degrades gracefully. Read-only to any AI layer.
   */
  structuredReasons: ScoringReason[];
  /** Why now — 1–2 short arguments for why this company is in focus today */
  whyNow: string;
  /** Lawful contact path — corporate form / generic HR / career page */
  lawfulContactPath: string | null;
  /** Negative signals — risk factors / why not */
  negativeSignals: string[];
  opener: string;
  feedbackStatus: string | null;
  suppressedUntil: string | null;
  createdAt: string;
  sourceFamilies: string[];
  evidenceTitles: string[];
  locationNames: string[];
  /**
   * Whether an attributed AI enrichment was persisted for this candidate
   * (`digest_candidates.ai_enrichment IS NOT NULL`). Presence only — the actual
   * advisory payload lives on LeadDetail.aiEnrichment. Lets the list/API surface
   * an "AI-подсказка есть" cue without loading the full enrichment per row.
   */
  hasAiHint: boolean;
  /**
   * Geo gate (Block 1): true when the lead is a foreign employer (foreign-ATS
   * host, no RU footprint). Drives the «Иностранный работодатель» badge. The
   * score already reflects the soft foreign penalty.
   */
  isForeignEmployer: boolean;
  /** The foreign ATS domain that triggered the flag, when isForeignEmployer. */
  foreignMatchedDomain: string | null;
  /**
   * Auto-discovered contact surface extracted from the career-page HTML by the
   * ingest crawler — the concrete HR/careers email, phone, Telegram, or
   * contact-form the system found so the agency does not have to open the page
   * and hunt for it. Deduped, ranked HR-first. Read from digest_candidates
   * payload (contact_paths). [] when the career page exposed no surface — the
   * honest empty state, not "unknown".
   */
  contactPaths: Array<{ category: string; value: string }>;
  /**
   * Analyst-review gate status from `digest_candidates.review_status`
   * (auto_approved / pending_review / approved / rejected). Surfaces as a
   * "На проверке аналитиком" badge on lead detail and drives the /review
   * queue. `auto_approved` is the default and is NOT shown (no badge = no
   * review needed). Null when the query didn't project the column (legacy
   * paths) — callers treat null as auto_approved.
   */
  reviewStatus: string | null;
  /**
   * Optional CRM-lookup identifiers populated only when the list query is asked
   * to JOIN orgs (includeOrgDetails: true, used by the CSV export so a row
   * carries INN/ОГРН/domain/career-page for pasting into a CRM). Null on the
   * default /leads UI path, which does not need them and must not pay the join
   * cost. See getLeadsForAllProfiles.
   */
  orgInn?: string | null;
  orgOgrn?: string | null;
  orgDomain?: string | null;
  careerPageUrl?: string | null;
  /**
   * The owning client profile's display name, populated only when
   * includeOrgDetails: true (CSV export) so an exported row names the practice
   * the lead belongs to. Null on the default UI path.
   */
  profileName?: string | null;
}

export interface LeadsListResult {
  leads: LeadItem[];
  total: number;
}

export interface LeadDetail extends LeadItem {
  orgWebsite: string | null;
  /** ИНН from entity resolution */
  orgInn: string | null;
  /** ОГРН from entity resolution */
  orgOgrn: string | null;
  /** Company domain */
  orgDomain: string | null;
  /** Career page URL */
  careerPageUrl: string | null;
  feedbackNote: string | null;
  cooldownUntil: string | null;
  candidateSourceKeys: string[];
  payload: Record<string, unknown>;
  /**
   * Stage-2 AI enrichment for weak career pages — a SEPARATE, attributed advisory
   * layer (provider + confidence + provenance). NULL unless a successful
   * enrichment was persisted. Never feeds score/gate/evidence; UI renders it as an
   * explicitly-labelled "AI-подсказка" block.
   */
  aiEnrichment: StoredAiEnrichment | null;
}

// ─── Row Mapping ─────────────────────────────────────────────────

/** Shape of a digest_candidates row joined with feedback state, as selected by the list queries. */
interface LeadRow {
  id: string;
  org_id: string;
  client_profile_id: string;
  org_name: string;
  source_external_id: string | null;
  score: number;
  vacancies_count: number;
  distinct_vacancy_names_count: number;
  /** Analyst-review gate status (auto_approved/pending_review/approved/rejected). */
  review_status?: string | null;
  latest_published_at: string | null;
  reasons: unknown;
  opener: string;
  feedback_status: string | null;
  suppressed_until: string | null;
  created_at: string;
  source_families: unknown;
  /**
   * Raw digest_candidates.payload JSON. The source of truth (evidence-first) for
   * confidence gate, evidence titles, and location names — these are NOT real
   * columns on digest_candidates (no migration ever created them), they live
   * inside payload. `extractPayloadFields` reads them with snake_case/camelCase
   * tolerance and safe empty-array degradation.
   */
  payload: unknown;
  /** TRUE when digest_candidates.ai_enrichment IS NOT NULL — presence flag only. */
  has_ai_hint?: boolean;
  /**
   * Optional orgs columns. Only present when the query JOINs orgs
   * (includeOrgDetails: true). mapLeadRow forwards them into LeadItem's
   * optional CRM-identifier fields. Undefined on the default UI path.
   */
  org_inn?: string | null;
  org_ogrn?: string | null;
  org_domain?: string | null;
  career_page_url?: string | null;
  /** client_profiles.agency_name — only when joined for export. */
  profile_name?: string | null;
}

/** SELECT column list shared by every list query that maps into a LeadItem. */
const LEAD_SELECT_COLUMNS = `
      dc.id::TEXT AS id,
      dc.org_id::TEXT AS org_id,
      dc.client_profile_id::TEXT AS client_profile_id,
      dc.source_display_name AS org_name,
      dc.source_external_id,
      dc.total_score AS score,
      dc.vacancies_count,
      dc.distinct_vacancy_names_count,
      dc.latest_published_at,
      dc.reasons,
      dc.opener,
      cdos.feedback_status,
      cdos.suppressed_until,
      dc.created_at::TEXT AS created_at,
      dc.source_families,
      dc.payload,
      (dc.ai_enrichment IS NOT NULL) AS has_ai_hint,
      dc.review_status::TEXT AS review_status`;

function toStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v: unknown): v is string => typeof v === "string") : [];
}

/**
 * Pull confidence gate + evidence titles + location names out of the
 * digest_candidates.payload JSON. These three are stored in payload, never as
 * real columns. Tolerates both snake_case (how the digest writer persists them:
 * `confidence_gate`, `evidence_titles`, `location_names`) and camelCase, and
 * degrades to "" / [] when a key is absent — so a thin payload renders the lead
 * without these fields rather than throwing.
 */
export function extractPayloadFields(payload: unknown): {
  confidenceGate: string;
  evidenceTitles: string[];
  locationNames: string[];
  isForeignEmployer: boolean;
  foreignMatchedDomain: string | null;
  contactPaths: Array<{ category: string; value: string }>;
} {
  const p =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const gateRaw = p.confidenceGate ?? p.confidence_gate;
  const foreignRaw = p.isForeignEmployer ?? p.is_foreign_employer;
  const foreignDomainRaw = p.foreignMatchedDomain ?? p.foreign_matched_domain;
  return {
    confidenceGate: typeof gateRaw === "string" ? gateRaw : "",
    evidenceTitles: toStringArray(p.evidenceTitles ?? p.evidence_titles),
    locationNames: toStringArray(p.locationNames ?? p.location_names),
    isForeignEmployer: foreignRaw === true,
    foreignMatchedDomain: typeof foreignDomainRaw === "string" ? foreignDomainRaw : null,
    contactPaths: toContactPathArray(p.contactPaths ?? p.contact_paths),
  };
}

/**
 * Normalize a raw contact_paths value (from payload JSON) into a stable
 * {category,value}[] shape. Tolerates non-array / malformed elements; drops
 * blanks and dedupes. Empty array is the honest "no surface found" outcome.
 */
function toContactPathArray(value: unknown): Array<{ category: string; value: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Array<{ category: string; value: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const category = typeof obj.category === "string" ? obj.category.trim() : "";
    const val = typeof obj.value === "string" ? obj.value.trim() : "";
    if (!category || !val) continue;
    const key = `${category}:${val}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ category, value: val });
  }
  return out;
}

/** Map a raw joined row into the derived LeadItem shape (why-now, best-angle, etc.). */
function mapLeadRow(row: LeadRow): LeadItem {
  const reasonsRaw = row.reasons;
  const structuredReasons = parseReasons(reasonsRaw);
  const reasons = structuredReasons.map(formatReason);
  const sourceFamilies = toStringArray(row.source_families);
  const { confidenceGate, evidenceTitles, locationNames, isForeignEmployer, foreignMatchedDomain, contactPaths } = extractPayloadFields(row.payload);
  return {
    id: row.id,
    orgId: row.org_id,
    clientProfileId: row.client_profile_id,
    orgName: row.org_name ?? "Неизвестная компания",
    sourceExternalId: row.source_external_id,
    score: row.score,
    confidenceGate,
    vacanciesCount: row.vacancies_count,
    distinctVacancyNamesCount: row.distinct_vacancy_names_count,
    latestPublishedAt: row.latest_published_at,
    reasons,
    structuredReasons,
    whyNow: deriveWhyNow(reasonsRaw),
    lawfulContactPath: deriveLawfulContactPath(reasonsRaw, sourceFamilies),
    negativeSignals: deriveNegativeSignals({
      reasons: reasonsRaw,
      vacanciesCount: row.vacancies_count,
      distinctVacancyNamesCount: row.distinct_vacancy_names_count,
      sourceFamilies,
      confidenceGate,
    }),
    opener: row.opener ?? "",
    feedbackStatus: row.feedback_status,
    suppressedUntil: row.suppressed_until,
    createdAt: row.created_at,
    sourceFamilies,
    evidenceTitles,
    locationNames,
    hasAiHint: row.has_ai_hint === true,
    isForeignEmployer,
    foreignMatchedDomain,
    contactPaths,
    reviewStatus: row.review_status ?? null,
    // Optional CRM identifiers — only populated by the export path's
    // includeOrgDetails join. Undefined (not null) on the default UI path, so
    // the list page never sees them and pays no join cost.
    orgInn: row.org_inn ?? undefined,
    orgOgrn: row.org_ogrn ?? undefined,
    orgDomain: row.org_domain ?? undefined,
    careerPageUrl: row.career_page_url ?? undefined,
    profileName: row.profile_name ?? undefined,
  };
}

// ─── Data Fetching ──────────────────────────────────────────────

export async function getLeadsForProfile(input: {
  clientProfileId: string | number;
  limit?: number;
  offset?: number;
  confidenceGate?: string | null;
  feedbackStatus?: string | null;
}): Promise<LeadsListResult> {
  const pool = getPool();
  if (!pool) {
    return { leads: [], total: 0 };
  }

  const limit = Math.min(input.limit ?? 50, 200);
  const offset = Math.max(input.offset ?? 0, 0);

  const conditions: string[] = [
    "dc.client_profile_id = $1",
  ];
  const params: unknown[] = [input.clientProfileId];
  let paramIdx = 2;

  if (input.confidenceGate) {
    // confidence_gate lives in payload JSON, not a real column (snake_case from
    // the digest writer; tolerate camelCase too).
    conditions.push(`COALESCE(dc.payload->>'confidenceGate', dc.payload->>'confidence_gate') = $${paramIdx}`);
    params.push(input.confidenceGate);
    paramIdx++;
  }

  if (input.feedbackStatus) {
    if (input.feedbackStatus === 'none') {
      // "none" matches rows with no feedback (NULL from LEFT JOIN) or literal 'none'
      conditions.push(`(cdos.feedback_status IS NULL OR cdos.feedback_status = 'none')`);
    } else {
      conditions.push(`cdos.feedback_status = $${paramIdx}`);
      params.push(input.feedbackStatus);
      paramIdx++;
    }
  }

  const whereClause = conditions.join(" AND ");

  // Count total
  const countResult = await pool.query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM digest_candidates dc
    LEFT JOIN client_digest_org_state cdos
      ON cdos.org_id = dc.org_id
      AND cdos.client_profile_id = dc.client_profile_id
    WHERE ${whereClause}
  `, params);

  const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

  // Fetch leads
  const leadsResult = await pool.query<LeadRow>(`
    SELECT
${LEAD_SELECT_COLUMNS}
    FROM digest_candidates dc
    LEFT JOIN client_digest_org_state cdos
      ON cdos.org_id = dc.org_id
      AND cdos.client_profile_id = dc.client_profile_id
    WHERE ${whereClause}
    ORDER BY dc.total_score DESC, dc.created_at DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `, [...params, limit, offset]);

  const leads: LeadItem[] = leadsResult.rows.map(mapLeadRow);

  return { leads, total };
}

// ─── Leads for Multiple Profiles ────────────────────────────────

export async function getLeadsForAllProfiles(input: {
  profileIds: (string | number)[];
  ownerId: string | number;
  limit?: number;
  offset?: number;
  confidenceGate?: string | null;
  feedbackStatus?: string | null;
  /**
   * Restrict to candidates produced by a single digest run. Pass this for
   * delivery channels (email/push) so the digest reflects THIS run's fresh
   * batch — "companies worth contacting today" — instead of every candidate
   * ever scored for the profile. Omit for the /leads UI, which shows the full
   * history on purpose.
   */
  digestRunId?: string | number | null;
  /**
   * When true, LEFT JOIN orgs + project client_profiles.agency_name so each
   * LeadItem carries CRM-lookup identifiers (INN/ОГРН/domain/career-page) and
   * the owning practice name. Used ONLY by the CSV export path — the /leads UI,
   * dashboard today-radar, email, and API do not need these and must not pay
   * the extra join. Default false keeps the original query plan.
   */
  includeOrgDetails?: boolean;
  /**
   * Narrow to the agency's active working set — leads currently in motion
   * (feedback_status IN contacted/replied, i.e. "взял в работу" / "ответили").
   * The "today in work" view on /leads uses this so a recruiter sees their
   * open pipeline, not the full scored pool. Distinct from feedbackStatus
   * (which narrows to ONE status); workingSet is the active-work band.
   * Default false.
   */
  workingSet?: boolean;
}): Promise<LeadsListResult> {
  const pool = getPool();
  if (!pool || input.profileIds.length === 0) {
    return { leads: [], total: 0 };
  }

  const limit = Math.min(input.limit ?? 200, 500);
  const offset = Math.max(input.offset ?? 0, 0);

  const conditions: string[] = [
    "dc.client_profile_id = ANY($1)",
    "cp.owner_id = $2",
  ];
  const params: unknown[] = [input.profileIds, input.ownerId];
  let paramIdx = 3;

  if (input.digestRunId !== undefined && input.digestRunId !== null) {
    conditions.push(`dc.digest_run_id = $${paramIdx}`);
    params.push(input.digestRunId);
    paramIdx++;
  }

  if (input.confidenceGate) {
    conditions.push(`COALESCE(dc.payload->>'confidenceGate', dc.payload->>'confidence_gate') = $${paramIdx}`);
    params.push(input.confidenceGate);
    paramIdx++;
  }

  if (input.feedbackStatus) {
    if (input.feedbackStatus === 'none') {
      conditions.push(`(cdos.feedback_status IS NULL OR cdos.feedback_status = 'none')`);
    } else {
      conditions.push(`cdos.feedback_status = $${paramIdx}`);
      params.push(input.feedbackStatus);
      paramIdx++;
    }
  }

  // "Today in work" band: leads the recruiter has taken into active motion.
  // Contacted = "взял в работу / написал", replied = "ответили". Won is excluded
  // (closed-won is done, not in-work) and snooze/dismissed/badfit are excluded
  // (parked/rejected). This is the open-pipeline view.
  if (input.workingSet) {
    conditions.push(`cdos.feedback_status IN ('contacted', 'replied')`);
  }

  const whereClause = conditions.join(" AND ");

  // Optional orgs join for the CSV export path. The default UI path skips it
  // (no extra join, no extra columns) so the dashboard/email/API queries keep
  // their original plan. cp is always joined (owner-scope predicate needs it).
  const orgJoin = input.includeOrgDetails
    ? `\n    LEFT JOIN orgs o ON o.id = dc.org_id`
    : '';
  const orgSelect = input.includeOrgDetails
    ? `,
      o.inn AS org_inn,
      o.ogrn AS org_ogrn,
      o.domain AS org_domain,
      o.career_page_url,
      cp.agency_name AS profile_name`
    : '';

  // Count total. JOIN client_profiles cp is required so the owner-scope
  // predicate cp.owner_id = $2 can reference cp.
  const countResult = await pool.query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM digest_candidates dc
    JOIN client_profiles cp
      ON cp.id = dc.client_profile_id
    LEFT JOIN client_digest_org_state cdos
      ON cdos.org_id = dc.org_id
      AND cdos.client_profile_id = dc.client_profile_id${orgJoin}
    WHERE ${whereClause}
  `, params);

  const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

  // Fetch leads
  const leadsResult = await pool.query<LeadRow>(`
    SELECT
${LEAD_SELECT_COLUMNS}${orgSelect}
    FROM digest_candidates dc
    JOIN client_profiles cp
      ON cp.id = dc.client_profile_id
    LEFT JOIN client_digest_org_state cdos
      ON cdos.org_id = dc.org_id
      AND cdos.client_profile_id = dc.client_profile_id${orgJoin}
    WHERE ${whereClause}
    ORDER BY dc.total_score DESC, dc.created_at DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `, [...params, limit, offset]);

  const leads: LeadItem[] = leadsResult.rows.map(mapLeadRow);

  return { leads, total };
}

// ─── Pending Review Count ───────────────────────────────────────

/**
 * Count digest candidates awaiting analyst review (review_status = 'pending_review')
 * across the given client profiles. Used to surface a "to review" metric on /leads
 * that links into the review queue. Returns 0 when no pool or no profiles.
 *
 * Owner-scoped: only counts candidates under profiles owned by `ownerId`
 * so the metric cannot leak another tenant's review backlog.
 */
export async function getPendingReviewCount(input: {
  profileIds: (string | number)[];
  ownerId: string | number;
}): Promise<number> {
  const pool = getPool();
  if (!pool || input.profileIds.length === 0) {
    return 0;
  }

  const result = await pool.query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM digest_candidates dc
    JOIN client_profiles cp
      ON cp.id = dc.client_profile_id
    WHERE dc.client_profile_id = ANY($1)
      AND cp.owner_id = $2
      AND dc.review_status = 'pending_review'
  `, [input.profileIds, input.ownerId]);

  return parseInt(result.rows[0]?.count ?? "0", 10);
}

/**
 * Most recent completed/attempted radar run for the caller's profiles.
 * The owner join is deliberate: a forged profile id cannot reveal another
 * workspace's activity timestamp. Infrastructure failures throw so callers
 * can distinguish "never ran" from "could not read run history".
 */
export async function getLastRadarRunAt(input: {
  profileIds: Array<string | number>;
  ownerId: string | number;
}): Promise<string | null> {
  if (input.profileIds.length === 0) return null;

  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query<{ lastRunAt: string | null }>(
    `SELECT MAX(run.created_at)::TEXT AS "lastRunAt"
     FROM digest_runs AS run
     JOIN client_profiles AS profile ON profile.id = run.client_profile_id
     WHERE run.client_profile_id = ANY($1::BIGINT[])
       AND profile.owner_id = $2`,
    [input.profileIds, String(input.ownerId)],
  );
  return result.rows[0]?.lastRunAt ?? null;
}

// ─── Lead Detail ────────────────────────────────────────────────

/**
 * Fetch full detail for a single lead (digest candidate) by ID.
 * Owner-scoped: only returns the lead if its client_profile is owned by `ownerId`
 * Returns null if not found or access denied.
 */
export async function getLeadDetail(input: {
  candidateId: string | number;
  ownerId: string | number;
}): Promise<LeadDetail | null> {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query<LeadRow & {
    client_profile_id: string;
    org_website: string | null;
    org_inn: string | null;
    org_ogrn: string | null;
    org_domain: string | null;
    career_page_url: string | null;
    feedback_note: string | null;
    cooldown_until: string | null;
    candidate_source_keys: unknown;
    payload: unknown;
    ai_enrichment: unknown;
  }>(`
    SELECT
      dc.id::TEXT AS id,
      dc.client_profile_id::TEXT AS client_profile_id,
      dc.org_id::TEXT AS org_id,
      dc.source_display_name AS org_name,
      o.website_url AS org_website,
      o.inn AS org_inn,
      o.ogrn AS org_ogrn,
      o.domain AS org_domain,
      o.career_page_url,
      dc.source_external_id,
      dc.total_score AS score,
      dc.vacancies_count,
      dc.distinct_vacancy_names_count,
      dc.latest_published_at,
      dc.reasons,
      dc.opener,
      cdos.feedback_status,
      cdos.feedback_note,
      cdos.suppressed_until,
      cdos.cooldown_until,
      dc.created_at::TEXT AS created_at,
      dc.source_families,
      COALESCE(
        dc.payload->'candidateSourceKeys',
        dc.payload->'candidate_source_keys',
        '[]'::JSONB
      ) AS candidate_source_keys,
      dc.payload,
      dc.ai_enrichment,
      dc.review_status::TEXT AS review_status
    FROM digest_candidates dc
    JOIN client_profiles cp
      ON cp.id = dc.client_profile_id
    LEFT JOIN client_digest_org_state cdos
      ON cdos.org_id = dc.org_id
      AND cdos.client_profile_id = dc.client_profile_id
    LEFT JOIN orgs o
      ON o.id = dc.org_id
    WHERE dc.id = $1
      AND cp.owner_id = $2
  `, [input.candidateId, input.ownerId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  const aiEnrichment = parseStoredEnrichment(row.ai_enrichment);

  return {
    ...mapLeadRow(row),
    // mapLeadRow reads has_ai_hint, which the detail SELECT does not project;
    // derive it from the parsed enrichment so the flag is correct on detail too.
    hasAiHint: aiEnrichment !== null,
    orgWebsite: row.org_website,
    orgInn: row.org_inn,
    orgOgrn: row.org_ogrn,
    orgDomain: row.org_domain,
    careerPageUrl: row.career_page_url,
    feedbackNote: row.feedback_note,
    cooldownUntil: row.cooldown_until,
    candidateSourceKeys: toStringArray(row.candidate_source_keys),
    payload: (typeof row.payload === 'object' && row.payload !== null && !Array.isArray(row.payload)) ? row.payload as Record<string, unknown> : {},
    aiEnrichment,
  };
}

// ─── Lead Feedback ──────────────────────────────────────────────

export interface FeedbackUpdateResult {
  ok: true;
  data: {
    clientProfileId: string;
    orgId: string;
    feedbackStatus: string;
    feedbackNote: string | null;
    feedbackAt: string | null;
  };
}

export interface FeedbackUpdateError {
  ok: false;
  error: string;
}

export async function updateLeadFeedback(input: {
  orgId: string | number;
  clientProfileId: string | number;
  feedbackStatus: string;
  feedbackNote?: string | null;
}): Promise<FeedbackUpdateResult | FeedbackUpdateError> {
  const pool = getPool();
  if (!pool) {
    return { ok: false, error: "Database not configured." };
  }

  // Validate feedback status
  const status = input.feedbackStatus;
  if (!VALID_FEEDBACK_STATUSES.has(status as never) || status === 'none') {
    return { ok: false, error: `Invalid feedback status: "${status}". Must be one of: contacted, replied, won, badfit, snooze, dismissed.` };
  }

  // feedback_note is allowed on the "not a fit" rejection states (badfit,
  // dismissed) where a one-line "почему мимо" is useful triage context. The DB
  // constraint (client_digest_org_state_feedback_note_check) permits a non-blank
  // note for ANY non-'none' status; we restrict at the app layer to the states
  // where the UI surfaces a note input, to keep notes intentional.
  const NOTE_ALLOWED_STATUSES = new Set(['badfit', 'dismissed']);
  const feedbackNote = NOTE_ALLOWED_STATUSES.has(input.feedbackStatus) && input.feedbackNote
    ? input.feedbackNote.trim() || null
    : null;

  const result = await pool.query<{
    client_profile_id: string;
    org_id: string;
    feedback_status: string;
    feedback_note: string | null;
    feedback_at: string | null;
  }>(`
    INSERT INTO client_digest_org_state (client_profile_id, org_id, feedback_status, feedback_note, feedback_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (client_profile_id, org_id)
    DO UPDATE SET
      feedback_status = EXCLUDED.feedback_status,
      feedback_note = EXCLUDED.feedback_note,
      feedback_at = EXCLUDED.feedback_at,
      updated_at = NOW()
    RETURNING
      client_profile_id::TEXT AS client_profile_id,
      org_id::TEXT AS org_id,
      feedback_status,
      feedback_note,
      feedback_at::TEXT AS feedback_at
  `, [input.clientProfileId, input.orgId, input.feedbackStatus, feedbackNote]);

  if (result.rows.length === 0) {
    return { ok: false, error: "Failed to update feedback state." };
  }

  const row = result.rows[0];
  return {
    ok: true,
    data: {
      clientProfileId: row.client_profile_id,
      orgId: row.org_id,
      feedbackStatus: row.feedback_status,
      feedbackNote: row.feedback_note,
      feedbackAt: row.feedback_at,
    },
  };
}
