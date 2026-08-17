import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import {
  summarizeOpportunityTemporalContext,
  type OpportunityTemporalContext,
} from '@/lib/opportunities/temporal-context'

export type EvidenceRadarLead = {
  cardId: string
  organizationId: string
  organizationName: string
  legalName: string | null
  domain: string | null
  title: string
  whyNow: string
  recommendedAction: string
  recommendedContactAt: string | null
  validUntil: string
  location: {
    city: string
    federalSubjectCode: string | null
    federalSubjectName: string | null
    address: string | null
    latitude: number | null
    longitude: number | null
    confidence: number | null
    locationType: string | null
  }
  score: {
    leadScore: number
    opportunityScore: number
    confidenceScore: number
    urgencyScore: number
    contactabilityScore: number
    riskScore: number
    components: Record<string, number>
    contributions: Array<{
      eventId: string
      component: string
      delta: number
      reason: string
    }>
  }
  staffingNeed: Record<string, unknown> | null
  specialization: string | null
  independentSourceCount: number
  evidence: Array<{
    id: string
    eventType: string
    sourceRegistryId: string
    sourceFamily: string
    occurredAt: string
    detectedAt: string
    canonicalUrl: string | null
    confidence: number
    primarySource: boolean
  }>
  contactPaths: Array<{
    id: string
    type: string
    label: string
    href: string | null
  }>
  riskReasons: string[]
  temporalContext?: OpportunityTemporalContext
}

type EvidenceRadarDb = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

export async function listEvidenceRadarLeads(
  input: { workspaceId: string | number; limit?: number },
  db: EvidenceRadarDb | null = getPool(),
): Promise<EvidenceRadarLead[]> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const limit = Math.min(200, Math.max(1, Math.trunc(input.limit ?? 100)))
  const result = await db.query<{
    cardId: string
    organizationId: string
    organizationName: string
    legalName: string | null
    domain: string | null
    title: string
    whyNow: string
    recommendedAction: string
    recommendedContactAt: string | null
    validUntil: string
    city: string | null
    federalSubjectCode: string | null
    federalSubjectName: string | null
    address: string | null
    latitude: number | null
    longitude: number | null
    geoConfidence: number | null
    locationType: string | null
    leadScore: number
    opportunityScore: number
    confidenceScore: number
    urgencyScore: number
    contactabilityScore: number
    riskScore: number
    components: Record<string, number>
    contributions: EvidenceRadarLead['score']['contributions']
    staffingNeed: Record<string, unknown> | null
    specialization: string | null
    independentSourceCount: number
    evidence: EvidenceRadarLead['evidence']
    contactPaths: EvidenceRadarLead['contactPaths']
    riskReasons: string[]
    temporalEvents: unknown
  }>(
    `SELECT
       card.id::TEXT AS "cardId",
       card.organization_id::TEXT AS "organizationId",
       COALESCE(NULLIF(identity.brand, ''), organization.name) AS "organizationName",
       identity.legal_name AS "legalName",
       COALESCE(identity.primary_domain, organization.domain) AS domain,
       card.title,
       card.why_now AS "whyNow",
       card.recommended_action AS "recommendedAction",
       card.recommended_contact_at::TEXT AS "recommendedContactAt",
       card.valid_until::TEXT AS "validUntil",
       location.city,
       location.federal_subject_code AS "federalSubjectCode",
       location.federal_subject_name AS "federalSubjectName",
       location.address,
       location.latitude::DOUBLE PRECISION AS latitude,
       location.longitude::DOUBLE PRECISION AS longitude,
       location.geo_confidence::DOUBLE PRECISION AS "geoConfidence",
       location.location_type AS "locationType",
       score.lead_score::DOUBLE PRECISION AS "leadScore",
       score.opportunity_score::DOUBLE PRECISION AS "opportunityScore",
       score.confidence_score::DOUBLE PRECISION AS "confidenceScore",
       score.urgency_score::DOUBLE PRECISION AS "urgencyScore",
       score.contactability_score::DOUBLE PRECISION AS "contactabilityScore",
       score.risk_score::DOUBLE PRECISION AS "riskScore",
       score.components,
       score.contributions,
       card.staffing_need AS "staffingNeed",
       card.specialization,
       COALESCE(evidence.source_count, 0)::INTEGER AS "independentSourceCount",
       COALESCE(evidence.items, '[]'::JSONB) AS evidence,
       COALESCE(contacts.items, '[]'::JSONB) AS "contactPaths",
       COALESCE(card.risk_reasons, ARRAY[]::TEXT[]) AS "riskReasons",
       COALESCE(temporal.items, '[]'::JSONB) AS "temporalEvents"
     FROM evidence_lead_cards_v1 AS card
     JOIN organization_identity_profiles_v1 AS identity
       ON identity.workspace_id = card.workspace_id
      AND identity.organization_id = card.organization_id
     JOIN orgs AS organization
       ON organization.id = card.organization_id
     LEFT JOIN organization_locations_v1 AS location
       ON location.id = card.location_id
      AND location.workspace_id = card.workspace_id
      AND location.organization_id = card.organization_id
      AND location.verification_status = 'verified'
     JOIN evidence_lead_score_snapshots_v1 AS score
       ON score.id = card.score_snapshot_id
      AND score.workspace_id = card.workspace_id
      AND score.organization_id = card.organization_id
     LEFT JOIN LATERAL (
       SELECT
         JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'id', event.id::TEXT,
             'eventType', event.event_type,
             'sourceRegistryId', event.source_registry_id,
             'sourceFamily', event.source_family,
             'occurredAt', event.occurred_at::TEXT,
             'detectedAt', event.detected_at::TEXT,
             'canonicalUrl', event.canonical_url,
             'confidence', event.confidence,
             'primarySource', event.primary_source
           ) ORDER BY event.occurred_at DESC, event.id DESC
         ) AS items,
         COUNT(DISTINCT event.source_family)::INTEGER AS source_count
       FROM evidence_events_v1 AS event
       WHERE event.workspace_id = card.workspace_id
         AND event.organization_id = card.organization_id
         AND event.id = ANY(card.evidence_event_ids)
         AND event.verification_status = 'verified'
         AND event.valid_until >= NOW()
     ) AS evidence ON TRUE
     LEFT JOIN LATERAL (
       SELECT JSONB_AGG(
         JSONB_BUILD_OBJECT(
           'id', contact.id::TEXT,
           'type', contact.contact_type,
           'label', contact.label,
           'href', contact.href
         ) ORDER BY contact.id
       ) AS items
       FROM public_contact_paths_v1 AS contact
       WHERE contact.workspace_id = card.workspace_id
         AND contact.organization_id = card.organization_id
         AND contact.id = ANY(card.contact_path_ids)
         AND contact.verification_status = 'verified'
     ) AS contacts ON TRUE
     LEFT JOIN LATERAL (
       SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
         'id', event.id::TEXT,
         'subjectType', event.subject_type,
         'eventType', event.event_type,
         'occurredAt', event.occurred_at::TEXT,
         'windowDays', event.window_days,
         'delta', event.delta,
         'evidenceIds', event.evidence_ids::TEXT[]
       ) ORDER BY event.occurred_at DESC, event.id DESC) AS items
       FROM source_temporal_derived_events AS event
       WHERE event.organization_id = card.organization_id
         AND event.occurred_at >= card.generated_at - INTERVAL '30 days'
         AND event.occurred_at <= NOW()
     ) AS temporal ON TRUE
     WHERE card.workspace_id = $1
       AND card.status = 'qualified'
       AND card.valid_until >= NOW()
       AND score.valid_until >= NOW()
       AND identity.resolution_status = 'verified'
     ORDER BY score.lead_score DESC, card.generated_at DESC, card.id DESC
     LIMIT $2`,
    [String(input.workspaceId), limit],
  )

  return result.rows.map((row) => ({
    cardId: row.cardId,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    legalName: row.legalName,
    domain: row.domain,
    title: row.title,
    whyNow: row.whyNow,
    recommendedAction: row.recommendedAction,
    recommendedContactAt: row.recommendedContactAt,
    validUntil: row.validUntil,
    location: {
      city: row.city ?? 'География не подтверждена',
      federalSubjectCode: row.federalSubjectCode,
      federalSubjectName: row.federalSubjectName,
      address: row.address,
      latitude: row.latitude == null ? null : Number(row.latitude),
      longitude: row.longitude == null ? null : Number(row.longitude),
      confidence: row.geoConfidence == null ? null : Number(row.geoConfidence),
      locationType: row.locationType,
    },
    score: {
      leadScore: Number(row.leadScore),
      opportunityScore: Number(row.opportunityScore),
      confidenceScore: Number(row.confidenceScore),
      urgencyScore: Number(row.urgencyScore),
      contactabilityScore: Number(row.contactabilityScore),
      riskScore: Number(row.riskScore),
      components: row.components ?? {},
      contributions: Array.isArray(row.contributions) ? row.contributions : [],
    },
    staffingNeed: row.staffingNeed,
    specialization: row.specialization,
    independentSourceCount: Number(row.independentSourceCount),
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    contactPaths: Array.isArray(row.contactPaths) ? row.contactPaths : [],
    riskReasons: Array.isArray(row.riskReasons) ? row.riskReasons : [],
    temporalContext: summarizeOpportunityTemporalContext(row.temporalEvents),
  }))
}