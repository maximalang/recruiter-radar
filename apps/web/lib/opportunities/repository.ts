import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

import { getClient, getPool } from '@/lib/db-pool'
import { logEvent } from '@/lib/runtime'
import { canonicalizeOpportunityUrl } from './canonical-hash'
import type { HiringEpisodeType } from './hiring-episode-detection'
import {
  clampOpportunityPageSize,
  clampOpportunitySnoozeDays,
} from './config'
import {
  DEFAULT_OPPORTUNITY_SCORING_CONFIG,
  OPPORTUNITY_STATUSES,
  type ConfidenceGate,
  type OpportunityStatus,
} from './opportunity-scoring'

export const OPPORTUNITY_ACTIONS = [
  'accepted',
  'dismissed',
  'snoozed',
  'contacted',
] as const

export type OpportunityAction = (typeof OPPORTUNITY_ACTIONS)[number]

export class OpportunityActionConflictError extends Error {
  constructor() {
    super('Opportunity action idempotency key was reused with another payload.')
    this.name = 'OpportunityActionConflictError'
  }
}

export class OpportunityTransitionConflictError extends Error {
  readonly code = 'opportunity_transition_conflict'

  constructor(
    readonly previousStatus?: OpportunityStatus,
    readonly requestedStatus?: OpportunityAction,
  ) {
    super('Opportunity status transition is not allowed.')
    this.name = 'OpportunityTransitionConflictError'
  }
}

export class OpportunitySupersededConflictError extends Error {
  readonly code = 'opportunity_superseded'

  constructor() {
    super('Opportunity has been superseded by a newer scoring version.')
    this.name = 'OpportunitySupersededConflictError'
  }
}

const ALLOWED_OPPORTUNITY_TRANSITIONS: Readonly<
  Record<OpportunityStatus, readonly OpportunityAction[]>
> = {
  new: ['accepted', 'dismissed', 'snoozed'],
  review: ['accepted', 'dismissed', 'snoozed'],
  snoozed: ['accepted', 'dismissed'],
  accepted: ['contacted', 'dismissed', 'snoozed'],
  contacted: [],
  dismissed: [],
  expired: [],
}

type OpportunityDb = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

interface OpportunityRow {
  id: string
  ownerId: string
  clientProfileId: string
  organizationId: string
  hiringEpisodeId: string
  organizationName: string
  organizationDomain: string | null
  episodeType: HiringEpisodeType
  episodeStatus: 'active' | 'closed'
  episodeStartedAt: string
  episodeLastSeenAt: string
  status: OpportunityStatus
  title: string
  whyNow: string
  problemHypothesis: string
  recommendedAngle: string
  recommendedPersona: string
  recommendedAction: string
  opportunityScore: number
  confidenceGate: ConfidenceGate
  scores: Record<string, number>
  evidenceHash: string
  validFrom: string
  validUntil: string | null
  snoozedUntil: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  evidenceCount: number
  factCount: number
  publicationCount: number
  sourceFamilyCount: number
  directEvidenceCount: number
  agencyFitExplanation: string
}

export interface OpportunityItem extends OpportunityRow {
  evidenceTimeline: OpportunityEvidenceItem[]
}

export interface OpportunityEvidenceItem {
  id: string
  kind: 'signal' | 'evidence'
  source: string
  title: string
  url: string | null
  occurredAt: string
  tier: string | null
}

export interface OpportunityListInput {
  ownerId: string | number
  clientProfileId?: string | null
  morningBriefOnly?: boolean
  statuses?: OpportunityStatus[]
  minimumScore?: number | null
  confidenceGate?: ConfidenceGate | null
  episodeType?: HiringEpisodeType | null
  organizationId?: string | null
  page?: number
  pageSize?: number
  offset?: number
}

export interface OpportunityListResult {
  opportunities: OpportunityItem[]
  total: number
  page: number
  pageSize: number
  nextOffset: number | null
}

export async function listOpportunities(
  input: OpportunityListInput,
  db: OpportunityDb | null = getPool(),
): Promise<OpportunityListResult> {
  if (!db) throw new Error('DATABASE_URL is not set.')

  const pageSize = clampOpportunityPageSize(input.pageSize ?? Number.NaN)
  const requestedPage = Math.max(Math.trunc(input.page ?? 1), 1)
  const offset = typeof input.offset === 'number' && Number.isFinite(input.offset)
    ? Math.max(Math.trunc(input.offset), 0)
    : (requestedPage - 1) * pageSize
  const page = Math.floor(offset / pageSize) + 1
  const params: unknown[] = [String(input.ownerId)]
  const clauses = ['o.owner_id = $1', 'o.superseded_at IS NULL']

  if (input.morningBriefOnly) {
    clauses.push(`o.metadata->>'morningBriefEligible' = 'true'`)
    clauses.push(`o.status <> 'dismissed'`)
    clauses.push(`he.status = 'active'`)
    clauses.push(`(o.valid_until IS NULL OR o.valid_until >= NOW())`)
    clauses.push(`o.confidence_gate <> 'D'`)
    params.push(DEFAULT_OPPORTUNITY_SCORING_CONFIG.minimumAgencyFit)
    clauses.push(`o.agency_fit_score >= $${params.length}`)
    params.push(
      DEFAULT_OPPORTUNITY_SCORING_CONFIG.minimumExternalSupportNeed,
    )
    clauses.push(`o.agency_propensity_score >= $${params.length}`)
  }
  if (input.clientProfileId) {
    params.push(input.clientProfileId)
    clauses.push(`o.client_profile_id = $${params.length}`)
  }
  const statuses = (input.statuses ?? []).filter(isOpportunityStatus)
  if (statuses.length > 0) {
    params.push(statuses)
    clauses.push(`o.status = ANY($${params.length}::text[])`)
  }
  if (typeof input.minimumScore === 'number' && Number.isFinite(input.minimumScore)) {
    params.push(Math.min(Math.max(input.minimumScore, 0), 1))
    clauses.push(`o.opportunity_score >= $${params.length}`)
  }
  if (input.confidenceGate && isConfidenceGate(input.confidenceGate)) {
    params.push(input.confidenceGate)
    clauses.push(`o.confidence_gate = $${params.length}`)
  }
  if (input.episodeType) {
    params.push(input.episodeType)
    clauses.push(`he.episode_type = $${params.length}`)
  }
  if (input.organizationId) {
    params.push(input.organizationId)
    clauses.push(`o.organization_id = $${params.length}`)
  }

  const where = clauses.join('\n      AND ')
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count
     FROM opportunities o
     JOIN hiring_episodes he ON he.id = o.hiring_episode_id
     WHERE ${where}`,
    params,
  )

  params.push(pageSize, offset)
  const rows = await db.query<OpportunityRow>(
    `${OPPORTUNITY_SELECT}
     WHERE ${where}
     ORDER BY
       o.opportunity_score DESC,
       o.valid_until ASC NULLS LAST,
       o.created_at DESC,
       o.id DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params,
  )

  const evidenceByOpportunity = await getEvidenceForOpportunities(
    String(input.ownerId),
    rows.rows.map((row) => row.id),
    db,
  )

  const total = Number(countResult.rows[0]?.count ?? 0)
  const consumed = offset + rows.rows.length
  return {
    opportunities: rows.rows.map((row) => ({
      ...row,
      evidenceTimeline: evidenceByOpportunity.get(row.id) ?? [],
    })),
    total,
    page,
    pageSize,
    nextOffset: consumed < total ? consumed : null,
  }
}

export async function getOpportunityById(
  input: { ownerId: string | number; opportunityId: string | number },
  db: OpportunityDb | null = getPool(),
): Promise<OpportunityItem | null> {
  if (!db) throw new Error('DATABASE_URL is not set.')

  const result = await db.query<OpportunityRow>(
    `${OPPORTUNITY_SELECT}
     WHERE o.id = $1
       AND o.owner_id = $2
       AND o.superseded_at IS NULL
     LIMIT 1`,
    [input.opportunityId, String(input.ownerId)],
  )
  const row = result.rows[0]
  if (!row) return null

  const evidence = await getEvidenceForOpportunities(
    String(input.ownerId),
    [row.id],
    db,
  )
  return {
    ...row,
    evidenceTimeline: evidence.get(row.id) ?? [],
  }
}

export async function applyOpportunityAction(input: {
  ownerId: string | number
  opportunityId: string | number
  action: OpportunityAction
  actionKey: string
  note?: string | null
  snoozeDays?: number
}): Promise<{ opportunity: OpportunityItem; idempotent: boolean } | null> {
  if (!isOpportunityAction(input.action)) {
    throw new Error('Unsupported opportunity action.')
  }
  const actionKey = input.actionKey.trim()
  if (!actionKey || actionKey.length > 160) {
    throw new Error('Invalid opportunity action key.')
  }

  const client = await getClient()
  if (!client) throw new Error('DATABASE_URL is not set.')
  const note = normalizeNote(input.note)
  const snoozeDays = clampOpportunitySnoozeDays(input.snoozeDays)
  const actionFingerprint = createActionFingerprint({
    action: input.action,
    note,
    snoozeDays: input.action === 'snoozed' ? snoozeDays : null,
  })

  try {
    await client.query('BEGIN')
    const context = await client.query<{
      id: string
      clientProfileId: string
      organizationId: string
      hiringEpisodeId: string
      status: OpportunityStatus
      supersededAt: string | null
    }>(
      `SELECT
         id::TEXT AS id,
         client_profile_id::TEXT AS "clientProfileId",
         organization_id::TEXT AS "organizationId",
         hiring_episode_id::TEXT AS "hiringEpisodeId",
         status,
         superseded_at::TEXT AS "supersededAt"
       FROM opportunities
       WHERE id = $1
         AND owner_id = $2
       FOR UPDATE`,
      [input.opportunityId, String(input.ownerId)],
    )
    const row = context.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return null
    }

    const existingAction = await client.query<{
      actionFingerprint: string
      newStatus: OpportunityAction
    }>(
      `SELECT action_fingerprint AS "actionFingerprint",
         new_status AS "newStatus"
       FROM opportunity_actions
       WHERE opportunity_id = $1
         AND owner_id = $2
         AND action_key = $3
       LIMIT 1`,
      [input.opportunityId, String(input.ownerId), actionKey],
    )
    if (existingAction.rows[0]) {
      if (existingAction.rows[0].actionFingerprint !== actionFingerprint) {
        throw new OpportunityActionConflictError()
      }
      const current = await client.query<{ id: string }>(
        `SELECT id::TEXT AS id
         FROM opportunities
         WHERE client_profile_id = $1
            AND hiring_episode_id = $2
            AND owner_id = $3
            AND superseded_at IS NULL
          LIMIT 1`,
        [row.clientProfileId, row.hiringEpisodeId, String(input.ownerId)],
      )
      const opportunity = current.rows[0]
        ? await getOpportunityById(
            { ownerId: input.ownerId, opportunityId: current.rows[0].id },
            client,
          )
        : null
      await client.query('COMMIT')
      if (!opportunity) return null
      logEvent('opportunity.replay_served', {
        ownerId: String(input.ownerId),
        opportunityId: String(input.opportunityId),
        action: input.action,
        currentOpportunityId: opportunity.id,
      })
      return { opportunity, idempotent: true }
    }

    if (row.supersededAt) {
      throw new OpportunitySupersededConflictError()
    }

    if (!isOpportunityTransitionAllowed(row.status, input.action)) {
      logEvent('opportunity.transition_rejected', {
        ownerId: String(input.ownerId),
        opportunityId: String(input.opportunityId),
        previousStatus: row.status,
        requestedStatus: input.action,
      })
      throw new OpportunityTransitionConflictError(row.status, input.action)
    }

    const actionInsert = await client.query(
      `INSERT INTO opportunity_actions (
         owner_id,
         opportunity_id,
         action_type,
         action_key,
         action_fingerprint,
         previous_status,
         new_status,
         note,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        String(input.ownerId),
        input.opportunityId,
        input.action,
        actionKey,
        actionFingerprint,
        row.status,
        input.action,
        note,
        JSON.stringify({
          source: 'opportunity-api',
          ...(input.action === 'snoozed'
            ? { snoozeDays }
            : {}),
        }),
      ],
    )
    if (actionInsert.rowCount !== 1) {
      throw new Error('Opportunity action insert returned no row.')
    }
    await client.query(
      `UPDATE opportunities
       SET
         status = $1,
         snoozed_until = CASE
           WHEN $1 = 'snoozed'
             THEN NOW() + ($3 * INTERVAL '1 day')
           ELSE NULL
         END,
         updated_at = NOW()
       WHERE id = $2
         AND owner_id = $4
         AND superseded_at IS NULL`,
      [input.action, input.opportunityId, snoozeDays, String(input.ownerId)],
    )
    await client.query(
      `INSERT INTO client_episode_state (
         client_profile_id,
         owner_id,
         hiring_episode_id,
         organization_id,
         status,
         suppressed_until
       )
       VALUES (
         $1, $2, $3, $4, $5,
         CASE
           WHEN $5 = 'snoozed'
             THEN NOW() + ($6 * INTERVAL '1 day')
           ELSE NULL
         END
       )
       ON CONFLICT (client_profile_id, hiring_episode_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         suppressed_until = EXCLUDED.suppressed_until,
         updated_at = NOW()`,
      [
        row.clientProfileId,
        String(input.ownerId),
        row.hiringEpisodeId,
        row.organizationId,
        input.action,
        snoozeDays,
      ],
    )
    await client.query('COMMIT')
    const opportunity = await getOpportunityById(
      { ownerId: input.ownerId, opportunityId: input.opportunityId },
      client,
    )
    if (!opportunity) return null

    logEvent('opportunity.action', {
      ownerId: String(input.ownerId),
      opportunityId: String(input.opportunityId),
      action: input.action,
      idempotent: false,
    })
    if (input.action === 'contacted') {
      logEvent('opportunity.contact_recorded', {
        ownerId: String(input.ownerId),
        opportunityId: String(input.opportunityId),
        hiringEpisodeId: row.hiringEpisodeId,
      })
    }
    return { opportunity, idempotent: false }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export function isOpportunityAction(value: unknown): value is OpportunityAction {
  return typeof value === 'string' &&
    OPPORTUNITY_ACTIONS.includes(value as OpportunityAction)
}

export function isOpportunityTransitionAllowed(
  status: OpportunityStatus,
  action: OpportunityAction,
): boolean {
  return ALLOWED_OPPORTUNITY_TRANSITIONS[status].includes(action)
}

const OPPORTUNITY_SELECT = `
  SELECT
    o.id::TEXT AS id,
    o.owner_id::TEXT AS "ownerId",
    o.client_profile_id::TEXT AS "clientProfileId",
    o.organization_id::TEXT AS "organizationId",
    o.hiring_episode_id::TEXT AS "hiringEpisodeId",
    org.name AS "organizationName",
    org.domain AS "organizationDomain",
    he.episode_type AS "episodeType",
    he.status AS "episodeStatus",
    he.started_at::TEXT AS "episodeStartedAt",
    he.last_seen_at::TEXT AS "episodeLastSeenAt",
    o.status,
    o.title,
    o.why_now AS "whyNow",
    o.problem_hypothesis AS "problemHypothesis",
    o.recommended_angle AS "recommendedAngle",
    o.recommended_persona AS "recommendedPersona",
    o.recommended_action AS "recommendedAction",
    o.opportunity_score AS "opportunityScore",
    o.confidence_gate AS "confidenceGate",
    jsonb_build_object(
      'agencyFit', o.agency_fit_score,
      'hiringIntent', o.hiring_intent_score,
      'externalSupportNeed', o.agency_propensity_score,
      'timing', o.timing_score,
      'reachability', o.reachability_score,
      'confidence', o.confidence_score
    ) AS scores,
    o.evidence_hash AS "evidenceHash",
    o.valid_from::TEXT AS "validFrom",
    o.valid_until::TEXT AS "validUntil",
    o.snoozed_until::TEXT AS "snoozedUntil",
    o.metadata,
    COALESCE(
      NULLIF(o.metadata->>'agencyFitExplanation', ''),
      'Соответствие требует ручной проверки по профилю агентства.'
    ) AS "agencyFitExplanation",
    o.created_at::TEXT AS "createdAt",
    o.updated_at::TEXT AS "updatedAt",
    (
      SELECT COUNT(*)::INT
      FROM hiring_episode_evidence evidence_count
      WHERE evidence_count.hiring_episode_id = he.id
    ) AS "evidenceCount",
    (
      SELECT COUNT(DISTINCT COALESCE(
        'signal:' || evidence_fact.signal_id::TEXT,
        'evidence:' || evidence_fact.evidence_id::TEXT
      ))::INT
      FROM hiring_episode_evidence evidence_fact
      WHERE evidence_fact.hiring_episode_id = he.id
    ) AS "factCount",
    (
      SELECT COUNT(DISTINCT COALESCE(
        NULLIF(publication_signal.source_url, ''),
        NULLIF(publication_evidence.url, ''),
        'signal:' || publication.signal_id::TEXT,
        'evidence:' || publication.evidence_id::TEXT
      ))::INT
      FROM hiring_episode_evidence publication
      LEFT JOIN signals publication_signal
        ON publication_signal.id = publication.signal_id
      LEFT JOIN evidence_items publication_evidence
        ON publication_evidence.id = publication.evidence_id
      WHERE publication.hiring_episode_id = he.id
    ) AS "publicationCount",
    (
      SELECT COUNT(DISTINCT COALESCE(source_signal.source, source_evidence.source))::INT
      FROM hiring_episode_evidence source_row
      LEFT JOIN signals source_signal ON source_signal.id = source_row.signal_id
      LEFT JOIN evidence_items source_evidence ON source_evidence.id = source_row.evidence_id
      WHERE source_row.hiring_episode_id = he.id
    ) AS "sourceFamilyCount",
    (
      SELECT COUNT(*)::INT
      FROM hiring_episode_evidence direct_row
      LEFT JOIN signals direct_signal ON direct_signal.id = direct_row.signal_id
      LEFT JOIN evidence_items direct_evidence ON direct_evidence.id = direct_row.evidence_id
      WHERE direct_row.hiring_episode_id = he.id
        AND (
          direct_signal.source = 'career-pages'
          OR direct_evidence.tier = 'direct'
        )
    ) AS "directEvidenceCount"
  FROM opportunities o
  JOIN orgs org ON org.id = o.organization_id
  JOIN hiring_episodes he ON he.id = o.hiring_episode_id
`

async function getEvidenceForOpportunities(
  ownerId: string,
  opportunityIds: string[],
  db: OpportunityDb,
): Promise<Map<string, OpportunityEvidenceItem[]>> {
  if (opportunityIds.length === 0) return new Map()

  const result = await db.query<OpportunityEvidenceItem & { opportunityId: string }>(
    `SELECT
       o.id::TEXT AS "opportunityId",
       COALESCE(hee.signal_id, hee.evidence_id)::TEXT AS id,
       CASE WHEN hee.signal_id IS NOT NULL THEN 'signal' ELSE 'evidence' END AS kind,
       COALESCE(s.source, ei.source) AS source,
       COALESCE(s.headline, ei.payload_ref->>'title', 'Подтверждающий источник') AS title,
       COALESCE(s.source_url, ei.url) AS url,
       COALESCE(s.occurred_at, ei.fetched_at)::TEXT AS "occurredAt",
       ei.tier
     FROM opportunities o
     JOIN hiring_episode_evidence hee
       ON hee.hiring_episode_id = o.hiring_episode_id
     LEFT JOIN signals s ON s.id = hee.signal_id
     LEFT JOIN evidence_items ei ON ei.id = hee.evidence_id
     WHERE o.owner_id = $1
       AND o.id = ANY($2::bigint[])
     ORDER BY o.id, COALESCE(s.occurred_at, ei.fetched_at) DESC, hee.id DESC`,
    [ownerId, opportunityIds],
  )

  const byOpportunity = new Map<string, OpportunityEvidenceItem[]>()
  for (const row of result.rows) {
    const items = byOpportunity.get(row.opportunityId) ?? []
    const publicationIdentity = canonicalPublicationIdentity(row)
    if (items.some((item) => canonicalPublicationIdentity(item) === publicationIdentity)) {
      continue
    }
    items.push({
      id: row.id,
      kind: row.kind,
      source: row.source,
      title: row.title,
      url: row.url,
      occurredAt: row.occurredAt,
      tier: row.tier,
    })
    byOpportunity.set(row.opportunityId, items)
  }
  return byOpportunity
}

function canonicalPublicationIdentity(
  item: Pick<OpportunityEvidenceItem, 'id' | 'kind' | 'source' | 'url'>,
): string {
  const canonicalUrl = canonicalizeOpportunityUrl(item.url)
  if (canonicalUrl) return `url:${canonicalUrl}`
  return `${item.kind}:${item.source}:${item.id}`
}

function isOpportunityStatus(value: unknown): value is OpportunityStatus {
  return typeof value === 'string' &&
    OPPORTUNITY_STATUSES.includes(value as OpportunityStatus)
}

function isConfidenceGate(value: unknown): value is ConfidenceGate {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D'
}

function normalizeNote(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, 1000) : null
}

function createActionFingerprint(input: {
  action: OpportunityAction
  note: string | null
  snoozeDays: number | null
}): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
}
