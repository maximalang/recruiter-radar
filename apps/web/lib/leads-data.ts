/**
 * Server-side data fetching for the leads list page.
 *
 * Returns digest candidates (leads) for a given client profile,
 * with scoring, confidence, evidence, and feedback state.
 */

import { getPool } from "./db";
import { formatReason, type ScoringReason } from "./scoring/scoring-reasons";

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
      // Legacy string — wrap as a synthetic reason for backward compat
      result.push({ component: 'fit', key: `legacy.${item.slice(0, 40)}` })
    }
  }
  return result
}

// ─── Lead Card Derivation ────────────────────────────────────────

/**
 * Derive `why_now` from scoring reasons.
 * Picks the top urgency/intent reason keys, renders Russian labels.
 */
export function deriveWhyNow(rawReasons: unknown): string {
  const reasons = parseReasons(rawReasons)
  if (reasons.length === 0) return 'Повод для контакта есть сейчас'

  // Prefer urgency/intent component reasons
  const priorityReasons = reasons.filter(r =>
    r.component === 'urgency' || r.component === 'intent'
  )
  const picked = priorityReasons.length > 0 ? priorityReasons.slice(0, 2) : reasons.slice(0, 2)
  return picked.map(formatReason).join('; ')
}

/**
 * Derive `best_angle` — the strongest angle for first contact.
 * Uses reason.key for structured matching, not substring search.
 * Falls back to source-family heuristics when no reason key matches.
 */
export function deriveBestAngle(rawReasons: unknown, opener: string, sourceFamilies: string[] = []): string {
  const reasons = parseReasons(rawReasons)
  const keys = reasons.map(r => r.key)

  // Geographic expansion
  if (keys.includes('fit.location.outside') || keys.includes('fit.location.match')) {
    return 'Поддержать выход в новый регион — компания ищет людей на месте'
  }

  // Hard-to-fill roles
  if (keys.includes('urgency.hard-to-fill')) {
    return 'Закрыть дефицитную роль, пока внутренний поиск не растянулся'
  }

  // Non-tech / multi-role mix
  if (keys.includes('intent.non-tech-mix') || keys.includes('intent.multiple-roles')) {
    return 'Несколько открытых ролей — компания активно строит команду'
  }

  // Career page available
  if (keys.includes('reachability.career-page')) {
    return 'Есть карьерная страница — прямой путь к HR'
  }

  // Hiring burst
  if (keys.some(k => k.startsWith('urgency.burst'))) {
    return 'Hiring burst — компания массово ищет специалистов'
  }

  // Opener takes precedence over source-family heuristics
  if (opener) return opener

  // Source-family fallback (for preview where reasons are plain strings)
  if (sourceFamilies.length > 0) {
    if (sourceFamilies.includes('career-pages')) {
      return 'Карьерная страница — прямой путь к HR'
    }
    if (sourceFamilies.includes('egrul-fns') || sourceFamilies.includes('fedresurs')) {
      return 'Данные реестра — можно найти контакт через официальный сайт'
    }
    if (sourceFamilies.length >= 2) {
      return 'Несколько независимых источников подтверждают найм'
    }
    if (sourceFamilies.includes('hh')) {
      return 'Активные вакансии на HeadHunter — можно заходить с релевантной ролью'
    }
  }

  // Final fallback
  return 'Короткий созвон, чтобы сверить задачи по найму'
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

  // Single source
  if (input.sourceFamilies.length <= 1) {
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

/** Valid feedback status values matching the DB enum digest_feedback_status */
export const VALID_FEEDBACK_STATUSES = new Set([
  'none', 'accepted', 'dismissed', 'later', 'contacted', 'replied', 'call', 'client', 'badfit',
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
  /** Best angle — the strongest angle for first contact */
  bestAngle: string;
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
  confidence_gate: string;
  vacancies_count: number;
  distinct_vacancy_names_count: number;
  latest_published_at: string | null;
  reasons: unknown;
  opener: string;
  feedback_status: string | null;
  suppressed_until: string | null;
  created_at: string;
  source_families: unknown;
  evidence_titles: unknown;
  location_names: unknown;
}

/** SELECT column list shared by every list query that maps into a LeadItem. */
const LEAD_SELECT_COLUMNS = `
      dc.id::TEXT AS id,
      dc.org_id::TEXT AS org_id,
      dc.client_profile_id::TEXT AS client_profile_id,
      dc.source_display_name AS org_name,
      dc.source_external_id,
      dc.total_score AS score,
      dc.confidence_gate,
      dc.vacancies_count,
      dc.distinct_vacancy_names_count,
      dc.latest_published_at,
      dc.reasons,
      dc.opener,
      cdos.feedback_status,
      cdos.suppressed_until,
      dc.created_at::TEXT AS created_at,
      dc.source_families,
      dc.evidence_titles,
      dc.location_names`;

function toStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v: unknown): v is string => typeof v === "string") : [];
}

/** Map a raw joined row into the derived LeadItem shape (why-now, best-angle, etc.). */
function mapLeadRow(row: LeadRow): LeadItem {
  const reasonsRaw = row.reasons;
  const structuredReasons = parseReasons(reasonsRaw);
  const reasons = structuredReasons.map(formatReason);
  const sourceFamilies = toStringArray(row.source_families);
  return {
    id: row.id,
    orgId: row.org_id,
    clientProfileId: row.client_profile_id,
    orgName: row.org_name ?? "Неизвестная компания",
    sourceExternalId: row.source_external_id,
    score: row.score,
    confidenceGate: row.confidence_gate ?? "",
    vacanciesCount: row.vacancies_count,
    distinctVacancyNamesCount: row.distinct_vacancy_names_count,
    latestPublishedAt: row.latest_published_at,
    reasons,
    structuredReasons,
    whyNow: deriveWhyNow(reasonsRaw),
    bestAngle: deriveBestAngle(reasonsRaw, row.opener ?? "", sourceFamilies),
    lawfulContactPath: deriveLawfulContactPath(reasonsRaw, sourceFamilies),
    negativeSignals: deriveNegativeSignals({
      reasons: reasonsRaw,
      vacanciesCount: row.vacancies_count,
      distinctVacancyNamesCount: row.distinct_vacancy_names_count,
      sourceFamilies,
      confidenceGate: row.confidence_gate ?? "",
    }),
    opener: row.opener ?? "",
    feedbackStatus: row.feedback_status,
    suppressedUntil: row.suppressed_until,
    createdAt: row.created_at,
    sourceFamilies,
    evidenceTitles: toStringArray(row.evidence_titles),
    locationNames: toStringArray(row.location_names),
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
    conditions.push(`dc.confidence_gate = $${paramIdx}`);
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
}): Promise<LeadsListResult> {
  const pool = getPool();
  if (!pool || input.profileIds.length === 0) {
    return { leads: [], total: 0 };
  }

  const limit = Math.min(input.limit ?? 200, 500);
  const offset = Math.max(input.offset ?? 0, 0);

  const conditions: string[] = [
    "dc.client_profile_id = ANY($1)",
    "(cp.owner_id = $2 OR cp.owner_id IS NULL)",
  ];
  const params: unknown[] = [input.profileIds, input.ownerId];
  let paramIdx = 3;

  if (input.digestRunId !== undefined && input.digestRunId !== null) {
    conditions.push(`dc.digest_run_id = $${paramIdx}`);
    params.push(input.digestRunId);
    paramIdx++;
  }

  if (input.confidenceGate) {
    conditions.push(`dc.confidence_gate = $${paramIdx}`);
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

  const whereClause = conditions.join(" AND ");

  // Count total. JOIN client_profiles cp is required so the owner-scope
  // predicate (cp.owner_id = $2 OR cp.owner_id IS NULL) can reference cp.
  const countResult = await pool.query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM digest_candidates dc
    JOIN client_profiles cp
      ON cp.id = dc.client_profile_id
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
    JOIN client_profiles cp
      ON cp.id = dc.client_profile_id
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

// ─── Pending Review Count ───────────────────────────────────────

/**
 * Count digest candidates awaiting analyst review (review_status = 'pending_review')
 * across the given client profiles. Used to surface a "to review" metric on /leads
 * that links into the review queue. Returns 0 when no pool or no profiles.
 *
 * Owner-scoped: only counts candidates under profiles owned by `ownerId`
 * (or pilot/anonymous profiles with owner_id IS NULL), so the metric cannot
 * leak another tenant's review backlog.
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
      AND (cp.owner_id = $2 OR cp.owner_id IS NULL)
      AND dc.review_status = 'pending_review'
  `, [input.profileIds, input.ownerId]);

  return parseInt(result.rows[0]?.count ?? "0", 10);
}

// ─── Lead Detail ────────────────────────────────────────────────

/**
 * Fetch full detail for a single lead (digest candidate) by ID.
 * Owner-scoped: only returns the lead if its client_profile is owned by `ownerId`
 * (or is a pilot/anonymous profile with owner_id IS NULL).
 * Returns null if not found or access denied.
 */
export async function getLeadDetail(input: {
  candidateId: string | number;
  ownerId: string | number;
}): Promise<LeadDetail | null> {
  const pool = getPool();
  if (!pool) {
    return null;
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
      dc.confidence_gate,
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
      dc.evidence_titles,
      dc.location_names,
      dc.candidate_source_keys,
      dc.payload
    FROM digest_candidates dc
    JOIN client_profiles cp
      ON cp.id = dc.client_profile_id
    LEFT JOIN client_digest_org_state cdos
      ON cdos.org_id = dc.org_id
      AND cdos.client_profile_id = dc.client_profile_id
    LEFT JOIN orgs o
      ON o.id = dc.org_id
    WHERE dc.id = $1
      AND (cp.owner_id = $2 OR cp.owner_id IS NULL)
  `, [input.candidateId, input.ownerId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    ...mapLeadRow(row),
    orgWebsite: row.org_website,
    orgInn: row.org_inn,
    orgOgrn: row.org_ogrn,
    orgDomain: row.org_domain,
    careerPageUrl: row.career_page_url,
    feedbackNote: row.feedback_note,
    cooldownUntil: row.cooldown_until,
    candidateSourceKeys: toStringArray(row.candidate_source_keys),
    payload: (typeof row.payload === 'object' && row.payload !== null && !Array.isArray(row.payload)) ? row.payload as Record<string, unknown> : {},
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
    return { ok: false, error: `Invalid feedback status: "${status}". Must be one of: accepted, dismissed, later, contacted, replied, call, client, badfit.` };
  }

  // feedback_note is only allowed for 'badfit' status (matches DB constraint)
  const feedbackNote = input.feedbackStatus === 'badfit' && input.feedbackNote
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
