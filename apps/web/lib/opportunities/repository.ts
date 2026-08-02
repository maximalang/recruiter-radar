import type { Pool, PoolClient } from 'pg'

import type { WorkspaceRole } from '@/lib/auth-v2/workspaces'
import { getClient, getPool } from '@/lib/db-pool'
import { logEvent } from '@/lib/runtime'
import {
  canonicalizeOpportunityUrl,
} from './canonical-hash'
import type { HiringEpisodeType } from './hiring-episode-detection'
import {
  clampOpportunityPageSize,
  isOpportunityStrategistV1EnabledForContext,
  isOpportunityWorkflowV1EnabledForContext,
} from './config'
import type { OpportunityWorkflowState } from './opportunity-workflow-repository'
import type {
  DismissedReasonCode,
  OpportunityContactPathType,
  OpportunityOutcomeChannel,
  OpportunityOutcomeStage,
} from './outcome-domain'
import { recordLegacyOpportunityAction } from './legacy-action-adapter'
import {
  DEFAULT_OPPORTUNITY_SCORING_CONFIG,
  OPPORTUNITY_STATUSES,
  type ConfidenceGate,
  type OpportunityStatus,
} from './opportunity-scoring'
import {
  parseOpportunityStrategistBrief,
  type OpportunityStrategistBrief,
} from './opportunity-strategist-v1'

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

export const OPPORTUNITY_VIEWS = [
  'today',
  'morning',
  'accepted',
  'follow_up',
  'overdue',
  'pipeline',
  'snoozed',
  'completed',
  'all',
] as const

export type OpportunityView = (typeof OPPORTUNITY_VIEWS)[number]

interface OpportunityRow {
  id: string
  publicReference: string
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
  commercialStage: OpportunityOutcomeStage
  workflowState: 'active' | 'snoozed'
  workflow: OpportunityWorkflowState | null
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
  strategistBrief: OpportunityStrategistBrief | null
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
  workspaceId?: string | number | null
  clientProfileId?: string | null
  morningBriefOnly?: boolean
  view?: OpportunityView
  statuses?: OpportunityStatus[]
  minimumScore?: number | null
  confidenceGate?: ConfidenceGate | null
  episodeType?: HiringEpisodeType | null
  organizationId?: string | null
  query?: string | null
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

export interface OpportunityOutcomeOperationalSummary {
  newCount: number
  acceptedCount: number
  pipelineCount: number
  snoozedCount: number
  wonCount: number
  lostCount: number
  dismissedCount: number
  overdueSnoozeCount: number
  followUpCount: number
  overdueCount: number
}

const EFFECTIVE_WORKFLOW_SQL = `COALESCE(
  outcome_state.workflow_state,
  CASE WHEN o.status = 'snoozed' THEN 'snoozed' ELSE 'active' END
)`

const EFFECTIVE_COMMERCIAL_STAGE_SQL = `COALESCE(
  outcome_state.commercial_stage,
  CASE
    WHEN o.status IN ('new', 'review', 'accepted', 'contacted', 'dismissed')
      THEN o.status
    ELSE 'new'
  END
)`

const MOSCOW_TODAY_START_SQL = `(
  DATE_TRUNC('day', NOW() AT TIME ZONE 'Europe/Moscow')
  AT TIME ZONE 'Europe/Moscow'
)`

const MOSCOW_TOMORROW_START_SQL = `(
  (DATE_TRUNC('day', NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 day')
  AT TIME ZONE 'Europe/Moscow'
)`

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
  if (input.workspaceId != null) {
    params.push(String(input.workspaceId))
    clauses.push(`o.workspace_id = $${params.length}`)
  }
  const view = input.view ?? (input.morningBriefOnly ? 'morning' : 'all')
  if (view !== 'all') clauses.push(`o.status <> 'expired'`)

  if (view === 'morning') {
    clauses.push(`o.metadata->>'morningBriefEligible' = 'true'`)
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
  if (view === 'today') {
    clauses.push(
      `${EFFECTIVE_COMMERCIAL_STAGE_SQL} NOT IN ('won', 'lost', 'dismissed')`,
    )
    clauses.push(`(
      (
        ${EFFECTIVE_WORKFLOW_SQL} = 'active'
        AND (
          (
            workflow_state.next_action_due_at >= ${MOSCOW_TODAY_START_SQL}
            AND workflow_state.next_action_due_at < ${MOSCOW_TOMORROW_START_SQL}
          )
          OR (
            workflow_state.next_action_type = 'follow_up'
            AND workflow_state.next_action_due_at < ${MOSCOW_TODAY_START_SQL}
          )
          OR (
            workflow_state.workflow_priority = 'high'
            AND ${EFFECTIVE_COMMERCIAL_STAGE_SQL} IN ('new', 'review')
          )
          OR workflow_state.assigned_to_user_id IS NULL
        )
      )
      OR (
        ${EFFECTIVE_WORKFLOW_SQL} = 'snoozed'
        AND COALESCE(outcome_state.snoozed_until, o.snoozed_until) < NOW()
      )
    )`)
  } else if (
    view === 'morning' || view === 'accepted' || view === 'follow_up' ||
    view === 'pipeline'
  ) {
    clauses.push(`${EFFECTIVE_WORKFLOW_SQL} = 'active'`)
  } else if (view === 'snoozed') {
    clauses.push(`${EFFECTIVE_WORKFLOW_SQL} = 'snoozed'`)
  }
  if (view === 'morning') {
    clauses.push(`${EFFECTIVE_COMMERCIAL_STAGE_SQL} IN ('new', 'review')`)
  } else if (view === 'accepted') {
    clauses.push(`${EFFECTIVE_COMMERCIAL_STAGE_SQL} = 'accepted'`)
  } else if (view === 'follow_up') {
    clauses.push(
      `${EFFECTIVE_COMMERCIAL_STAGE_SQL} NOT IN ('won', 'lost', 'dismissed')`,
    )
    clauses.push(`workflow_state.next_action_type = 'follow_up'`)
    clauses.push(
      `workflow_state.next_action_due_at >= ${MOSCOW_TODAY_START_SQL}`,
    )
  } else if (view === 'overdue') {
    clauses.push(
      `${EFFECTIVE_COMMERCIAL_STAGE_SQL} NOT IN ('won', 'lost', 'dismissed')`,
    )
    clauses.push(`(
      (
        ${EFFECTIVE_WORKFLOW_SQL} = 'active'
        AND workflow_state.next_action_due_at < ${MOSCOW_TODAY_START_SQL}
      )
      OR (
        ${EFFECTIVE_WORKFLOW_SQL} = 'snoozed'
        AND COALESCE(outcome_state.snoozed_until, o.snoozed_until) < NOW()
      )
    )`)
  } else if (view === 'pipeline') {
    clauses.push(
      `${EFFECTIVE_COMMERCIAL_STAGE_SQL} ` +
      `IN ('contacted', 'replied', 'meeting', 'proposal')`,
    )
  } else if (view === 'completed') {
    clauses.push(
      `${EFFECTIVE_COMMERCIAL_STAGE_SQL} IN ('won', 'lost', 'dismissed')`,
    )
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
  const query = normalizeOpportunityQuery(input.query)
  if (query) {
    params.push(`%${escapeLikePattern(query)}%`)
    clauses.push(`(
      org.name ILIKE $${params.length} ESCAPE '\\'
      OR org.domain ILIKE $${params.length} ESCAPE '\\'
      OR o.title ILIKE $${params.length} ESCAPE '\\'
    )`)
  }

  const where = clauses.join('\n      AND ')
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count
     FROM opportunities o
     JOIN orgs org ON org.id = o.organization_id
     JOIN hiring_episodes he ON he.id = o.hiring_episode_id
     LEFT JOIN opportunity_outcome_state outcome_state
       ON outcome_state.owner_id = o.owner_id
      AND outcome_state.opportunity_id = o.id
     LEFT JOIN opportunity_workflow_state workflow_state
       ON workflow_state.owner_id = o.owner_id
      AND workflow_state.workspace_id = o.workspace_id
      AND workflow_state.opportunity_id = o.id
     WHERE ${where}`,
    params,
  )

  const orderBy = view === 'today' || view === 'follow_up' || view === 'overdue'
    ? `CASE
         WHEN workflow_state.next_action_due_at < NOW() THEN 0
         WHEN workflow_state.next_action_due_at < ${MOSCOW_TOMORROW_START_SQL} THEN 1
         WHEN ${EFFECTIVE_WORKFLOW_SQL} = 'snoozed' THEN 2
         WHEN workflow_state.workflow_priority = 'high' THEN 3
         ELSE 4
       END,
       workflow_state.next_action_due_at ASC NULLS LAST,
       CASE workflow_state.workflow_priority
         WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2
       END,
       o.opportunity_score DESC,
       o.id DESC`
    : `o.opportunity_score DESC,
       o.valid_until ASC NULLS LAST,
       o.created_at DESC,
       o.id DESC`
  params.push(pageSize, offset)
  const rows = await db.query<OpportunityRow>(
    `${OPPORTUNITY_SELECT}
     WHERE ${where}
     ORDER BY ${orderBy}
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
  const strategistEnabled = isOpportunityStrategistV1EnabledForContext({
    dataOwnerId: input.ownerId,
    workspaceId: input.workspaceId,
  })
  const workflowEnabled = isOpportunityWorkflowV1EnabledForContext({
    dataOwnerId: input.ownerId,
    workspaceId: input.workspaceId,
  })
  return {
    opportunities: rows.rows.map((row) => toOpportunityItem(
      row,
      evidenceByOpportunity.get(row.id) ?? [],
      strategistEnabled,
      workflowEnabled,
    )),
    total,
    page,
    pageSize,
    nextOffset: consumed < total ? consumed : null,
  }
}

export async function getOpportunityOutcomeOperationalSummary(
  ownerId: string | number,
  db: OpportunityDb | null = getPool(),
  workspaceId: string | number | null = null,
): Promise<OpportunityOutcomeOperationalSummary> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const params: unknown[] = [String(ownerId)]
  const workspaceClause = workspaceId == null
    ? ''
    : '\n       AND o.workspace_id = $2'
  if (workspaceId != null) params.push(String(workspaceId))
  const result = await db.query<Record<
    keyof OpportunityOutcomeOperationalSummary,
    string
  >>(
    `SELECT
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_WORKFLOW_SQL} = 'active'
           AND ${EFFECTIVE_COMMERCIAL_STAGE_SQL} IN ('new', 'review')
       )::TEXT AS "newCount",
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_WORKFLOW_SQL} = 'active'
           AND ${EFFECTIVE_COMMERCIAL_STAGE_SQL} = 'accepted'
       )::TEXT AS "acceptedCount",
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_WORKFLOW_SQL} = 'active'
           AND ${EFFECTIVE_COMMERCIAL_STAGE_SQL}
             IN ('contacted', 'replied', 'meeting', 'proposal')
       )::TEXT AS "pipelineCount",
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_WORKFLOW_SQL} = 'snoozed'
       )::TEXT AS "snoozedCount",
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_COMMERCIAL_STAGE_SQL} = 'won'
       )::TEXT AS "wonCount",
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_COMMERCIAL_STAGE_SQL} = 'lost'
       )::TEXT AS "lostCount",
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_COMMERCIAL_STAGE_SQL} = 'dismissed'
       )::TEXT AS "dismissedCount",
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_WORKFLOW_SQL} = 'snoozed'
           AND COALESCE(outcome_state.snoozed_until, o.snoozed_until) < NOW()
       )::TEXT AS "overdueSnoozeCount",
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_WORKFLOW_SQL} = 'active'
           AND ${EFFECTIVE_COMMERCIAL_STAGE_SQL}
             NOT IN ('won', 'lost', 'dismissed')
           AND workflow_state.next_action_type = 'follow_up'
           AND workflow_state.next_action_due_at >= ${MOSCOW_TODAY_START_SQL}
       )::TEXT AS "followUpCount",
       COUNT(*) FILTER (
         WHERE ${EFFECTIVE_COMMERCIAL_STAGE_SQL}
             NOT IN ('won', 'lost', 'dismissed')
           AND (
             (
               ${EFFECTIVE_WORKFLOW_SQL} = 'active'
               AND workflow_state.next_action_due_at < ${MOSCOW_TODAY_START_SQL}
             )
             OR (
               ${EFFECTIVE_WORKFLOW_SQL} = 'snoozed'
               AND COALESCE(outcome_state.snoozed_until, o.snoozed_until) < NOW()
             )
           )
       )::TEXT AS "overdueCount"
     FROM opportunities o
     LEFT JOIN opportunity_outcome_state outcome_state
       ON outcome_state.owner_id = o.owner_id
      AND outcome_state.opportunity_id = o.id
     LEFT JOIN opportunity_workflow_state workflow_state
       ON workflow_state.owner_id = o.owner_id
      AND workflow_state.workspace_id = o.workspace_id
      AND workflow_state.opportunity_id = o.id
     WHERE o.owner_id = $1
       ${workspaceClause}
       AND o.superseded_at IS NULL
       AND o.status <> 'expired'`,
    params,
  )
  const row = result.rows[0]
  return {
    newCount: Number(row?.newCount ?? 0),
    acceptedCount: Number(row?.acceptedCount ?? 0),
    pipelineCount: Number(row?.pipelineCount ?? 0),
    snoozedCount: Number(row?.snoozedCount ?? 0),
    wonCount: Number(row?.wonCount ?? 0),
    lostCount: Number(row?.lostCount ?? 0),
    dismissedCount: Number(row?.dismissedCount ?? 0),
    overdueSnoozeCount: Number(row?.overdueSnoozeCount ?? 0),
    followUpCount: Number(row?.followUpCount ?? 0),
    overdueCount: Number(row?.overdueCount ?? 0),
  }
}

function normalizeOpportunityQuery(value: string | null | undefined): string {
  return value?.trim().slice(0, 80) ?? ''
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

export async function getOpportunityById(
  input: {
    ownerId: string | number
    workspaceId?: string | number | null
    opportunityId: string | number
  },
  db: OpportunityDb | null = getPool(),
): Promise<OpportunityItem | null> {
  if (!db) throw new Error('DATABASE_URL is not set.')

  const params: unknown[] = [input.opportunityId, String(input.ownerId)]
  const workspaceClause = input.workspaceId == null
    ? ''
    : `\n       AND o.workspace_id = $3`
  if (input.workspaceId != null) params.push(String(input.workspaceId))
  const result = await db.query<OpportunityRow>(
    `${OPPORTUNITY_SELECT}
     WHERE o.id = $1
       AND o.owner_id = $2
       ${workspaceClause}
       AND o.superseded_at IS NULL
     LIMIT 1`,
    params,
  )
  const row = result.rows[0]
  if (!row) return null

  const evidence = await getEvidenceForOpportunities(
    String(input.ownerId),
    [row.id],
    db,
  )
  return toOpportunityItem(
    row,
    evidence.get(row.id) ?? [],
    isOpportunityStrategistV1EnabledForContext({
      dataOwnerId: input.ownerId,
      workspaceId: input.workspaceId,
    }),
    isOpportunityWorkflowV1EnabledForContext({
      dataOwnerId: input.ownerId,
      workspaceId: input.workspaceId,
    }),
  )
}

export async function applyOpportunityAction(input: {
  ownerId: string | number
  workspaceId?: string | number | null
  opportunityId: string | number
  action: OpportunityAction
  actionKey: string
  note?: string | null
  snoozeDays?: number
  reasonCode?: DismissedReasonCode | null
  channel?: OpportunityOutcomeChannel | null
  contactPathType?: OpportunityContactPathType | null
  contactReference?: string | null
  occurredAt?: string
  actorUserId?: string | number | null
  actorWorkspaceId?: string | number | null
  actorRoleSnapshot?: WorkspaceRole | null
  authMode?: 'auth_v2' | 'auth_v2_compat' | 'legacy'
  outcomesEnabled?: boolean
}): Promise<{ opportunity: OpportunityItem; idempotent: boolean } | null> {
  if (!isOpportunityAction(input.action)) {
    throw new Error('Unsupported opportunity action.')
  }
  const actionKey = input.actionKey.trim()
  if (!actionKey || actionKey.length > 160) {
    throw new Error('Invalid opportunity action key.')
  }

  const outcome = await recordLegacyOpportunityAction({
    ...input,
    actionKey,
  })
  if (!outcome) return null
  let opportunity = await getOpportunityById({
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    opportunityId: input.opportunityId,
  })
  if (!opportunity && outcome.idempotent) {
    const contextParams: unknown[] = [
      input.opportunityId,
      String(input.ownerId),
    ]
    const workspaceClause = input.workspaceId == null
      ? ''
      : '\n         AND workspace_id = $3'
    if (input.workspaceId != null) {
      contextParams.push(String(input.workspaceId))
    }
    const client = await getClient()
    if (!client) throw new Error('DATABASE_URL is not set.')
    try {
      const context = await client.query<{
        clientProfileId: string
        hiringEpisodeId: string
      }>(
        `SELECT
           client_profile_id::TEXT AS "clientProfileId",
           hiring_episode_id::TEXT AS "hiringEpisodeId"
         FROM opportunities
         WHERE id = $1
           AND owner_id = $2
           ${workspaceClause}
         LIMIT 1`,
        contextParams,
      )
      const row = context.rows[0]
      if (row) {
        const current = await client.query<OpportunityRow>(
          `${OPPORTUNITY_SELECT}
           WHERE o.client_profile_id = $1
             AND o.hiring_episode_id = $2
             AND o.owner_id = $3
             AND o.superseded_at IS NULL
           LIMIT 1`,
          [row.clientProfileId, row.hiringEpisodeId, String(input.ownerId)],
        )
        const currentRow = current.rows[0]
        if (currentRow) {
          const evidence = await getEvidenceForOpportunities(
            String(input.ownerId),
            [currentRow.id],
            client,
          )
          opportunity = toOpportunityItem(
            currentRow,
            evidence.get(currentRow.id) ?? [],
            isOpportunityStrategistV1EnabledForContext({
              dataOwnerId: input.ownerId,
              workspaceId: input.workspaceId,
            }),
            isOpportunityWorkflowV1EnabledForContext({
              dataOwnerId: input.ownerId,
              workspaceId: input.workspaceId,
            }),
          )
        }
      }
    } finally {
      client.release()
    }
  }
  if (!opportunity) {
    throw new Error('Updated opportunity could not be reloaded.')
  }
  return { opportunity, idempotent: outcome.idempotent }
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
    o.public_reference::TEXT AS "publicReference",
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
    ${EFFECTIVE_COMMERCIAL_STAGE_SQL} AS "commercialStage",
    ${EFFECTIVE_WORKFLOW_SQL} AS "workflowState",
    CASE WHEN workflow_state.opportunity_id IS NULL THEN NULL ELSE
      jsonb_build_object(
        'assignedToUserId', workflow_state.assigned_to_user_id::TEXT,
        'nextActionType', workflow_state.next_action_type,
        'nextActionDueAt', workflow_state.next_action_due_at,
        'workflowPriority', workflow_state.workflow_priority,
        'internalNote', workflow_state.internal_note,
        'lastEventId', workflow_state.last_event_id::TEXT,
        'updatedAt', workflow_state.updated_at
      )
    END AS workflow,
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
    COALESCE(
      outcome_state.snoozed_until,
      o.snoozed_until
    )::TEXT AS "snoozedUntil",
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
  LEFT JOIN opportunity_outcome_state outcome_state
    ON outcome_state.owner_id = o.owner_id
   AND outcome_state.opportunity_id = o.id
  LEFT JOIN opportunity_workflow_state workflow_state
    ON workflow_state.owner_id = o.owner_id
   AND workflow_state.workspace_id = o.workspace_id
   AND workflow_state.opportunity_id = o.id
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

function toOpportunityItem(
  row: OpportunityRow,
  evidenceTimeline: OpportunityEvidenceItem[],
  strategistEnabled: boolean,
  workflowEnabled: boolean,
): OpportunityItem {
  return {
    ...row,
    workflow: workflowEnabled ? row.workflow : null,
    evidenceTimeline,
    strategistBrief: strategistEnabled
      ? parseOpportunityStrategistBrief(row.metadata?.strategistBrief)
      : null,
  }
}

function isOpportunityStatus(value: unknown): value is OpportunityStatus {
  return typeof value === 'string' &&
    OPPORTUNITY_STATUSES.includes(value as OpportunityStatus)
}

function isConfidenceGate(value: unknown): value is ConfidenceGate {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D'
}
