import type { Pool } from 'pg';
import { extractPayloadFields } from './leads-data';
import { formatReason, type ScoringReason } from './scoring/scoring-reasons';

export interface ReviewCandidate {
  id: string;
  orgId: string;
  orgName: string;
  score: number;
  confidenceGate: string;
  isForeignEmployer: boolean;
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
  latestPublishedAt: string | null;
  reasons: string[];
  sourceFamilies: string[];
  evidenceTitles: string[];
  locationNames: string[];
  createdAt: string;
}

function formatReasonsFromRaw(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (typeof item === 'object' && item !== null && 'key' in item && 'component' in item) {
      return [formatReason(item as ScoringReason)];
    }
    return [];
  });
}

export async function listPendingReviewCandidates(input: {
  pool: Pool;
  clientProfileId: string;
  ownerId: string | number;
  limit: number;
  offset: number;
}): Promise<{ items: ReviewCandidate[]; total: number }> {
  const countResult = await input.pool.query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM digest_candidates dc
    JOIN client_profiles cp ON cp.id = dc.client_profile_id
    WHERE dc.client_profile_id = $1
      AND cp.owner_id = $2
      AND dc.review_status = 'pending_review'
  `, [input.clientProfileId, input.ownerId]);

  const itemsResult = await input.pool.query<{
    id: string;
    org_id: string;
    org_name: string;
    score: number;
    vacancies_count: number;
    distinct_vacancy_names_count: number;
    latest_published_at: string | null;
    reasons: unknown;
    source_families: unknown;
    payload: unknown;
    created_at: string;
  }>(`
    SELECT
      dc.id::TEXT AS id,
      dc.org_id::TEXT AS org_id,
      dc.source_display_name AS org_name,
      dc.total_score AS score,
      dc.vacancies_count,
      dc.distinct_vacancy_names_count,
      dc.latest_published_at,
      dc.reasons,
      dc.source_families,
      dc.payload,
      dc.created_at::TEXT AS created_at
    FROM digest_candidates dc
    JOIN client_profiles cp ON cp.id = dc.client_profile_id
    WHERE dc.client_profile_id = $1
      AND cp.owner_id = $2
      AND dc.review_status = 'pending_review'
    ORDER BY dc.total_score DESC, dc.created_at DESC
    LIMIT $3 OFFSET $4
  `, [input.clientProfileId, input.ownerId, input.limit, input.offset]);

  const items = itemsResult.rows.map((row) => {
    const fields = extractPayloadFields(row.payload);
    return {
      id: row.id,
      orgId: row.org_id,
      orgName: row.org_name ?? 'Неизвестная компания',
      score: row.score,
      confidenceGate: fields.confidenceGate,
      isForeignEmployer: fields.isForeignEmployer,
      vacanciesCount: row.vacancies_count,
      distinctVacancyNamesCount: row.distinct_vacancy_names_count,
      latestPublishedAt: row.latest_published_at,
      reasons: formatReasonsFromRaw(row.reasons),
      sourceFamilies: Array.isArray(row.source_families)
        ? row.source_families.filter((source): source is string => typeof source === 'string')
        : [],
      evidenceTitles: fields.evidenceTitles,
      locationNames: fields.locationNames,
      createdAt: row.created_at,
    };
  });

  return {
    items,
    total: Number.parseInt(countResult.rows[0]?.count ?? '0', 10),
  };
}
