/**
 * Server-side data fetching for the leads list page.
 *
 * Returns digest candidates (leads) for a given client profile,
 * with scoring, confidence, evidence, and feedback state.
 */

import { getPool } from "./db";

// ─── Types ──────────────────────────────────────────────────────

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
    conditions.push(`cdos.feedback_status = $${paramIdx}`);
    params.push(input.feedbackStatus);
    paramIdx++;
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

  const leads: LeadItem[] = leadsResult.rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    orgName: row.org_name ?? "Неизвестная компания",
    sourceExternalId: row.source_external_id,
    score: row.score,
    confidenceGate: row.confidence_gate ?? "",
    vacanciesCount: row.vacancies_count,
    distinctVacancyNamesCount: row.distinct_vacancy_names_count,
    latestPublishedAt: row.latest_published_at,
    reasons: Array.isArray(row.reasons) ? row.reasons.filter((r: unknown): r is string => typeof r === "string") : [],
    opener: row.opener ?? "",
    feedbackStatus: row.feedback_status,
    suppressedUntil: row.suppressed_until,
    createdAt: row.created_at,
    sourceFamilies: Array.isArray(row.source_families) ? row.source_families.filter((s: unknown): s is string => typeof s === "string") : [],
    evidenceTitles: Array.isArray(row.evidence_titles) ? row.evidence_titles.filter((e: unknown): e is string => typeof e === "string") : [],
    locationNames: Array.isArray(row.location_names) ? row.location_names.filter((l: unknown): l is string => typeof l === "string") : [],
  }));

  return { leads, total };
}
