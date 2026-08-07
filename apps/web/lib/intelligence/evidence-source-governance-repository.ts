import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'

import { listEvidenceRuntimeSourceBindings } from './evidence-source-compatibility'
import {
  getSourceRegistryEntry,
  type SourceAutomationPolicy,
  type SourceIntegrationStatus,
  type SourceLegalReviewStatus,
  type SourceRegistryEntry,
} from './source-registry'

export type EvidenceSourceGovernanceView = SourceRegistryEntry & {
  runtimeSourceIds: string[]
  operational: {
    integrationStatus: SourceIntegrationStatus
    automationPolicy: SourceAutomationPolicy
    reviewStatus: SourceLegalReviewStatus
    automationAllowed: boolean
    termsReference: string | null
    reviewerReference: string | null
    reviewNotes: string | null
    reviewedAt: string | null
    updatedAt: string
  }
}

type EvidenceSourceGovernanceDb = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

export async function listEvidenceSourceGovernance(
  db: EvidenceSourceGovernanceDb | null = getPool(),
): Promise<EvidenceSourceGovernanceView[]> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const result = await db.query<{
    id: string
    integrationStatus: SourceIntegrationStatus
    automationPolicy: SourceAutomationPolicy
    termsReference: string | null
    updatedAt: string
    reviewStatus: SourceLegalReviewStatus | null
    reviewTermsReference: string | null
    reviewerReference: string | null
    reviewNotes: string | null
    reviewedAt: string | null
    automationAllowed: boolean
  }>(
    `SELECT
       source.id,
       source.integration_status AS "integrationStatus",
       source.automation_policy AS "automationPolicy",
       source.terms_reference AS "termsReference",
       source.updated_at::TEXT AS "updatedAt",
       review.review_status AS "reviewStatus",
       review.terms_reference AS "reviewTermsReference",
       review.reviewer_reference AS "reviewerReference",
       review.notes AS "reviewNotes",
       review.reviewed_at::TEXT AS "reviewedAt",
       evidence_radar_source_allowed_v1(source.id) AS "automationAllowed"
     FROM source_registry_entries_v1 AS source
     LEFT JOIN LATERAL (
       SELECT
         item.review_status,
         item.terms_reference,
         item.reviewer_reference,
         item.notes,
         item.reviewed_at
       FROM source_registry_reviews_v1 AS item
       WHERE item.source_registry_id = source.id
       ORDER BY item.reviewed_at DESC, item.id DESC
       LIMIT 1
     ) AS review ON TRUE
     ORDER BY source.role, source.id`,
  )

  const runtimeIdsByPolicy = new Map<string, string[]>()
  for (const binding of listEvidenceRuntimeSourceBindings()) {
    const ids = runtimeIdsByPolicy.get(binding.evidenceSourceRegistryId) ?? []
    ids.push(binding.runtimeSourceId)
    runtimeIdsByPolicy.set(binding.evidenceSourceRegistryId, ids)
  }

  return result.rows.map((row) => {
    const baseline = getSourceRegistryEntry(row.id)
    if (!baseline) {
      throw new Error(`Database Source Registry entry ${row.id} has no typed policy definition.`)
    }
    return {
      ...baseline,
      status: row.integrationStatus,
      automationPolicy: row.automationPolicy,
      legalReviewStatus: row.reviewStatus ?? 'pending',
      termsReference: row.reviewTermsReference ?? row.termsReference ?? baseline.termsReference,
      reviewedAt: row.reviewedAt,
      runtimeSourceIds: (runtimeIdsByPolicy.get(row.id) ?? []).sort(),
      operational: {
        integrationStatus: row.integrationStatus,
        automationPolicy: row.automationPolicy,
        reviewStatus: row.reviewStatus ?? 'pending',
        automationAllowed: row.automationAllowed,
        termsReference: row.reviewTermsReference ?? row.termsReference,
        reviewerReference: row.reviewerReference,
        reviewNotes: row.reviewNotes,
        reviewedAt: row.reviewedAt,
        updatedAt: row.updatedAt,
      },
    }
  })
}
