/**
 * Server-side data fetching for the leads list page.
 *
 * Returns digest candidates (leads) for a given client profile,
 * with scoring, confidence, evidence, and feedback state.
 */

import { getPool } from "./db";

// ─── Lead Card Derivation ────────────────────────────────────────

/**
 * Derive `why_now` from scoring reasons.
 * Picks the top 2 urgency/intent reasons, falls back to first reason.
 */
export function deriveWhyNow(reasons: string[]): string {
  if (reasons.length === 0) return 'Повод для контакта есть сейчас';
  // Prefer urgency/intent signals
  const priorityReasons = reasons.filter(r =>
    r.includes('burst') || r.includes('fresh') || r.includes('hard-to-fill') ||
    r.includes('urgency') || r.includes('active hiring') || r.includes('multiple')
  );
  const picked = priorityReasons.length > 0 ? priorityReasons.slice(0, 2) : reasons.slice(0, 2);
  return picked.join('; ');
}

/**
 * Derive `best_angle` — the strongest angle for first contact.
 * Based on what kind of hiring gap or expansion is visible.
 */
export function deriveBestAngle(reasons: string[], opener: string): string {
  // If there's a geographic expansion signal → angle around new region
  const hasExpansion = reasons.some(r => r.includes('new region') || r.includes('location'));
  if (hasExpansion) return 'Поддержать выход в новый регион — компания ищет людей на месте';

  // If hard-to-fill → angle around scarce talent
  const hasHardToFill = reasons.some(r => r.includes('hard-to-fill'));
  if (hasHardToFill) return 'Закрыть дефицитную роль, пока внутренний поиск не растянулся';

  // If multi-function hiring → angle around broad hiring need
  const hasMultiFunction = reasons.some(r => r.includes('non-tech') || r.includes('multiple roles'));
  if (hasMultiFunction) return 'Несколько открытых ролей — компания активно строит команду';

  // If career page available → angle around direct contact
  const hasCareerPage = reasons.some(r => r.includes('career page'));
  if (hasCareerPage) return 'Есть карьерная страница — прямой путь к HR';

  // Default: use opener as fallback
  return opener || 'Короткий созвон, чтобы сверить задачи по найму';
}

/**
 * Derive `lawful_contact_path` from evidence and reasons.
 * Returns the safest non-personal contact path available.
 */
export function deriveLawfulContactPath(reasons: string[], sourceFamilies: string[]): string | null {
  if (reasons.some(r => r.includes('career page'))) {
    return 'career-page';
  }
  if (reasons.some(r => r.includes('corporate') || r.includes('HR/contact'))) {
    return 'corporate-contact';
  }
  if (sourceFamilies.some(s => s === 'egrul-fns' || s === 'fedresurs')) {
    return 'registry-data';
  }
  return null;
}

/**
 * Derive `negative_signals` — risk factors / why not.
 * Detects stale signals, internal recruiter only, agency reposts, low evidence.
 */
export function deriveNegativeSignals(input: {
  reasons: string[];
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
  sourceFamilies: string[];
  confidenceGate: string;
}): string[] {
  const signals: string[] = [];

  // Internal recruiter only
  if (input.reasons.some(r => r.includes('internal recruiter'))) {
    signals.push('Вакансия внутреннего рекрутера — слабый сигнал сам по себе');
  }

  // Low confidence
  if (input.confidenceGate === 'C' || input.confidenceGate === 'D') {
    signals.push('Низкая уверенность в сигнале — требуется проверка');
  }

  // Single source
  if (input.sourceFamilies.length <= 1) {
    signals.push('Только один источник — нет независимого подтверждения');
  }

  // Stale signals
  if (input.reasons.some(r => r.includes('stale') || r.includes('older') || r.includes('без обновления'))) {
    signals.push('Устаревшие сигналы — активность могла закончиться');
  }

  // Repeated similar roles (high vacancy count but low distinct names)
  if (input.vacanciesCount >= 3 && input.distinctVacancyNamesCount <= 1) {
    signals.push('Повторяющиеся одинаковые вакансии — возможен репост');
  }

  return signals;
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
  orgName: string;
  sourceExternalId: string | null;
  score: number;
  confidenceGate: string;
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
  latestPublishedAt: string | null;
  reasons: string[];
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
  clientProfileId: string;
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
  const leadsResult = await pool.query<{
    id: string;
    org_id: string;
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
  }>(`
    SELECT
      dc.id::TEXT AS id,
      dc.org_id::TEXT AS org_id,
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
      dc.location_names
    FROM digest_candidates dc
    LEFT JOIN client_digest_org_state cdos
      ON cdos.org_id = dc.org_id
      AND cdos.client_profile_id = dc.client_profile_id
    WHERE ${whereClause}
    ORDER BY dc.total_score DESC, dc.created_at DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `, [...params, limit, offset]);

  const leads: LeadItem[] = leadsResult.rows.map((row) => {
    const reasons = Array.isArray(row.reasons) ? row.reasons.filter((r: unknown): r is string => typeof r === "string") : [];
    const sourceFamilies = Array.isArray(row.source_families) ? row.source_families.filter((s: unknown): s is string => typeof s === "string") : [];
    return {
      id: row.id,
      orgId: row.org_id,
      orgName: row.org_name ?? "Неизвестная компания",
      sourceExternalId: row.source_external_id,
      score: row.score,
      confidenceGate: row.confidence_gate ?? "",
      vacanciesCount: row.vacancies_count,
      distinctVacancyNamesCount: row.distinct_vacancy_names_count,
      latestPublishedAt: row.latest_published_at,
      reasons,
      whyNow: deriveWhyNow(reasons),
      bestAngle: deriveBestAngle(reasons, row.opener ?? ""),
      lawfulContactPath: deriveLawfulContactPath(reasons, sourceFamilies),
      negativeSignals: deriveNegativeSignals({
        reasons,
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
      evidenceTitles: Array.isArray(row.evidence_titles) ? row.evidence_titles.filter((e: unknown): e is string => typeof e === "string") : [],
      locationNames: Array.isArray(row.location_names) ? row.location_names.filter((l: unknown): l is string => typeof l === "string") : [],
    };
  });

  return { leads, total };
}

// ─── Leads for Multiple Profiles ────────────────────────────────

export async function getLeadsForAllProfiles(input: {
  profileIds: (string | number)[];
  limit?: number;
  offset?: number;
  confidenceGate?: string | null;
  feedbackStatus?: string | null;
}): Promise<LeadsListResult> {
  const pool = getPool();
  if (!pool || input.profileIds.length === 0) {
    return { leads: [], total: 0 };
  }

  const limit = Math.min(input.limit ?? 200, 500);
  const offset = Math.max(input.offset ?? 0, 0);

  const conditions: string[] = [
    "dc.client_profile_id = ANY($1)",
  ];
  const params: unknown[] = [input.profileIds];
  let paramIdx = 2;

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
  const leadsResult = await pool.query<{
    id: string;
    org_id: string;
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
  }>(`
    SELECT
      dc.id::TEXT AS id,
      dc.org_id::TEXT AS org_id,
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
      dc.location_names
    FROM digest_candidates dc
    LEFT JOIN client_digest_org_state cdos
      ON cdos.org_id = dc.org_id
      AND cdos.client_profile_id = dc.client_profile_id
    WHERE ${whereClause}
    ORDER BY dc.total_score DESC, dc.created_at DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `, [...params, limit, offset]);

  const leads: LeadItem[] = leadsResult.rows.map((row) => {
    const reasons = Array.isArray(row.reasons) ? row.reasons.filter((r: unknown): r is string => typeof r === "string") : [];
    const sourceFamilies = Array.isArray(row.source_families) ? row.source_families.filter((s: unknown): s is string => typeof s === "string") : [];
    return {
      id: row.id,
      orgId: row.org_id,
      orgName: row.org_name ?? "Неизвестная компания",
      sourceExternalId: row.source_external_id,
      score: row.score,
      confidenceGate: row.confidence_gate ?? "",
      vacanciesCount: row.vacancies_count,
      distinctVacancyNamesCount: row.distinct_vacancy_names_count,
      latestPublishedAt: row.latest_published_at,
      reasons,
      whyNow: deriveWhyNow(reasons),
      bestAngle: deriveBestAngle(reasons, row.opener ?? ""),
      lawfulContactPath: deriveLawfulContactPath(reasons, sourceFamilies),
      negativeSignals: deriveNegativeSignals({
        reasons,
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
      evidenceTitles: Array.isArray(row.evidence_titles) ? row.evidence_titles.filter((e: unknown): e is string => typeof e === "string") : [],
      locationNames: Array.isArray(row.location_names) ? row.location_names.filter((l: unknown): l is string => typeof l === "string") : [],
    };
  });

  return { leads, total };
}

// ─── Lead Detail ────────────────────────────────────────────────

export async function getLeadDetail(input: {
  candidateId: string | number;
}): Promise<LeadDetail | null> {
  const pool = getPool();
  if (!pool) {
    return null;
  }

  const result = await pool.query<{
    id: string;
    client_profile_id: string;
    org_id: string;
    org_name: string;
    org_website: string | null;
    org_inn: string | null;
    org_ogrn: string | null;
    org_domain: string | null;
    career_page_url: string | null;
    source_external_id: string | null;
    score: number;
    confidence_gate: string;
    vacancies_count: number;
    distinct_vacancy_names_count: number;
    latest_published_at: string | null;
    reasons: unknown;
    opener: string;
    feedback_status: string | null;
    feedback_note: string | null;
    suppressed_until: string | null;
    cooldown_until: string | null;
    created_at: string;
    source_families: unknown;
    evidence_titles: unknown;
    location_names: unknown;
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
    LEFT JOIN client_digest_org_state cdos
      ON cdos.org_id = dc.org_id
      AND cdos.client_profile_id = dc.client_profile_id
    LEFT JOIN orgs o
      ON o.id = dc.org_id
    WHERE dc.id = $1
  `, [input.candidateId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const reasons = Array.isArray(row.reasons) ? row.reasons.filter((r: unknown): r is string => typeof r === "string") : [];
  const sourceFamilies = Array.isArray(row.source_families) ? row.source_families.filter((s: unknown): s is string => typeof s === "string") : [];

  return {
    id: row.id,
    clientProfileId: row.client_profile_id,
    orgId: row.org_id,
    orgName: row.org_name ?? "Неизвестная компания",
    orgWebsite: row.org_website,
    orgInn: row.org_inn,
    orgOgrn: row.org_ogrn,
    orgDomain: row.org_domain,
    careerPageUrl: row.career_page_url,
    sourceExternalId: row.source_external_id,
    score: row.score,
    confidenceGate: row.confidence_gate ?? "",
    vacanciesCount: row.vacancies_count,
    distinctVacancyNamesCount: row.distinct_vacancy_names_count,
    latestPublishedAt: row.latest_published_at,
    reasons,
    whyNow: deriveWhyNow(reasons),
    bestAngle: deriveBestAngle(reasons, row.opener ?? ""),
    lawfulContactPath: deriveLawfulContactPath(reasons, sourceFamilies),
    negativeSignals: deriveNegativeSignals({
      reasons,
      vacanciesCount: row.vacancies_count,
      distinctVacancyNamesCount: row.distinct_vacancy_names_count,
      sourceFamilies,
      confidenceGate: row.confidence_gate ?? "",
    }),
    opener: row.opener ?? "",
    feedbackStatus: row.feedback_status,
    feedbackNote: row.feedback_note,
    suppressedUntil: row.suppressed_until,
    cooldownUntil: row.cooldown_until,
    createdAt: row.created_at,
    sourceFamilies,
    evidenceTitles: Array.isArray(row.evidence_titles) ? row.evidence_titles.filter((e: unknown): e is string => typeof e === "string") : [],
    locationNames: Array.isArray(row.location_names) ? row.location_names.filter((l: unknown): l is string => typeof l === "string") : [],
    candidateSourceKeys: Array.isArray(row.candidate_source_keys) ? row.candidate_source_keys.filter((k: unknown): k is string => typeof k === "string") : [],
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
