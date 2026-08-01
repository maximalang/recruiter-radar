import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'

import { getClient } from '@/lib/db-pool'
import { canonicalJsonStringify } from './canonical-hash'
import type { CrmOutboundAttempt } from './crm-webhook'

const DELIVERY_NAMESPACE = '8cd64a14-5ed4-4ad3-bc5e-b90003852120'

export interface CrmOutboundRequest {
  destinationUrl: string
  credentialReference: string
  credentialSecretHash: string
  timestamp: string
  eventId: string
  body: string
}

export type CrmOutboundSender = (
  input: CrmOutboundRequest,
) => Promise<CrmOutboundAttempt>

export interface CrmDeliveryResult extends CrmOutboundAttempt {
  eventId: string
  idempotent: boolean
}

export class CrmDeliveryAccessError extends Error {
  readonly code = 'crm_delivery_access_denied'

  constructor() {
    super('Active writable workspace access is required.')
    this.name = 'CrmDeliveryAccessError'
  }
}

export class CrmDeliveryIdempotencyKeyError extends Error {
  readonly code = 'crm_delivery_idempotency_key_invalid'

  constructor() {
    super('A printable idempotency key of at most 160 characters is required.')
    this.name = 'CrmDeliveryIdempotencyKeyError'
  }
}

type ClientProvider = () => Promise<PoolClient | null>
type ReplayRow = { status: 'succeeded' | 'failed'; httpStatus: number | null }
type DeliveryRow = {
  integrationId: string
  integrationReference: string
  outboundWebhookUrl: string
  credentialReference: string
  credentialSecretHash: string
  opportunityReference: string
  organizationName: string
  organizationDomain: string | null
  title: string
  commercialStage: string
  workflowState: string
  whyNow: string
  problemHypothesis: string
  recommendedAngle: string
  recommendedPersona: string
  recommendedAction: string
  opportunityScore: number
  confidenceGate: string
  validUntil: string | null
  nextActionType: string | null
  nextActionDueAt: string | null
  workflowPriority: string | null
  evidenceUrls: string[]
}

export async function deliverOpportunityToCrm(
  input: {
    ownerId: string | number
    workspaceId: string | number
    opportunityId: string | number
    actorUserId: string | number
    integrationReference: string
    idempotencyKey: string
  },
  send: CrmOutboundSender,
  provideClient: ClientProvider = getClient,
): Promise<CrmDeliveryResult | null> {
  const ownerId = positiveId(input.ownerId)
  const workspaceId = positiveId(input.workspaceId)
  const opportunityId = positiveId(input.opportunityId)
  const actorUserId = positiveId(input.actorUserId)
  if (!ownerId || !workspaceId || !opportunityId || !actorUserId) {
    throw new CrmDeliveryAccessError()
  }
  if (!isUuid(input.integrationReference)) return null
  const idempotencyKey = input.idempotencyKey.trim()
  if (
    !idempotencyKey ||
    idempotencyKey.length > 160 ||
    !/^[\x21-\x7E]+$/.test(idempotencyKey)
  ) {
    throw new CrmDeliveryIdempotencyKeyError()
  }
  const eventId = uuidV5(DELIVERY_NAMESPACE, [
    workspaceId,
    input.integrationReference.toLowerCase(),
    opportunityId,
    idempotencyKey,
  ].join('\0'))

  const client = await provideClient()
  if (!client) throw new Error('DATABASE_URL is not set.')
  try {
    await client.query('BEGIN')
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::TEXT, 0))',
      [`opportunity-crm-delivery:${eventId}`],
    )
    await requireDeliveryActor(client, workspaceId, actorUserId)

    const replay = await client.query<ReplayRow>(
      `SELECT status, http_status AS "httpStatus"
       FROM opportunity_crm_deliveries
       WHERE workspace_id = $1 AND event_id = $2::UUID
       LIMIT 1`,
      [workspaceId, eventId],
    )
    if (replay.rows[0]) {
      await client.query('COMMIT')
      return {
        eventId,
        status: replay.rows[0].status,
        httpStatus: replay.rows[0].httpStatus,
        idempotent: true,
      }
    }

    const delivery = await loadDelivery(
      client,
      workspaceId,
      ownerId,
      opportunityId,
      input.integrationReference,
    )
    if (!delivery) {
      await client.query('COMMIT')
      return null
    }
    const occurredAt = new Date().toISOString()
    const timestamp = String(Math.floor(Date.parse(occurredAt) / 1_000))
    const body = canonicalJsonStringify({
      schemaVersion: '2026-08-01',
      eventType: 'opportunity.upserted',
      eventId,
      occurredAt,
      integrationReference: delivery.integrationReference,
      opportunity: {
        opportunityReference: delivery.opportunityReference,
        organizationName: delivery.organizationName,
        organizationDomain: delivery.organizationDomain,
        title: delivery.title,
        commercialStage: delivery.commercialStage,
        workflowState: delivery.workflowState,
        whyNow: delivery.whyNow,
        problemHypothesis: delivery.problemHypothesis,
        recommendedAngle: delivery.recommendedAngle,
        recommendedPersona: delivery.recommendedPersona,
        recommendedAction: delivery.recommendedAction,
        opportunityScore: delivery.opportunityScore,
        confidenceGate: delivery.confidenceGate,
        validUntil: delivery.validUntil,
        nextActionType: delivery.nextActionType,
        nextActionDueAt: delivery.nextActionDueAt,
        workflowPriority: delivery.workflowPriority,
        evidenceUrls: delivery.evidenceUrls,
      },
    })
    const attempt = await send({
      destinationUrl: delivery.outboundWebhookUrl,
      credentialReference: delivery.credentialReference,
      credentialSecretHash: delivery.credentialSecretHash,
      timestamp,
      eventId,
      body,
    })
    const requestHash = createHash('sha256').update(body, 'utf8').digest('hex')
    await client.query(
      `INSERT INTO opportunity_crm_deliveries (
         workspace_id,
         integration_id,
         owner_id,
         opportunity_id,
         event_id,
         request_hash,
         status,
         http_status
       ) VALUES ($1, $2, $3, $4, $5::UUID, $6, $7, $8)`,
      [
        workspaceId,
        delivery.integrationId,
        ownerId,
        opportunityId,
        eventId,
        requestHash,
        attempt.status,
        attempt.httpStatus,
      ],
    )
    await client.query('COMMIT')
    return { eventId, ...attempt, idempotent: false }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function requireDeliveryActor(
  client: PoolClient,
  workspaceId: string,
  actorUserId: string,
) {
  const result = await client.query<{ role: string }>(
    `SELECT membership.role
     FROM workspace_members membership
     JOIN workspaces workspace ON workspace.id = membership.workspace_id
     JOIN users actor ON actor.id = membership.user_id
     WHERE membership.workspace_id = $1
       AND membership.user_id = $2
       AND membership.status = 'active'
       AND membership.role IN ('owner', 'admin', 'recruiter')
       AND workspace.status = 'active'
       AND workspace.deleted_at IS NULL
       AND actor.status = 'active'
     FOR UPDATE OF membership, workspace`,
    [workspaceId, actorUserId],
  )
  if (!['owner', 'admin', 'recruiter'].includes(result.rows[0]?.role ?? '')) {
    throw new CrmDeliveryAccessError()
  }
}

async function loadDelivery(
  client: PoolClient,
  workspaceId: string,
  ownerId: string,
  opportunityId: string,
  integrationReference: string,
): Promise<DeliveryRow | null> {
  const result = await client.query<DeliveryRow>(
    `SELECT
       integration.id::TEXT AS "integrationId",
       integration.public_reference::TEXT AS "integrationReference",
       integration.outbound_webhook_url AS "outboundWebhookUrl",
       credential.public_reference::TEXT AS "credentialReference",
       credential.secret_hash AS "credentialSecretHash",
       opportunity.public_reference::TEXT AS "opportunityReference",
       organization.name AS "organizationName",
       organization.domain AS "organizationDomain",
       opportunity.title,
       COALESCE(outcome_state.current_stage, opportunity.status)
         AS "commercialStage",
       COALESCE(workflow_state.workflow_state, 'active') AS "workflowState",
       opportunity.why_now AS "whyNow",
       opportunity.problem_hypothesis AS "problemHypothesis",
       opportunity.recommended_angle AS "recommendedAngle",
       opportunity.recommended_persona AS "recommendedPersona",
       opportunity.recommended_action AS "recommendedAction",
       opportunity.opportunity_score AS "opportunityScore",
       opportunity.confidence_gate AS "confidenceGate",
       opportunity.valid_until::TEXT AS "validUntil",
       workflow_state.next_action_type AS "nextActionType",
       workflow_state.next_action_due_at::TEXT AS "nextActionDueAt",
       workflow_state.workflow_priority AS "workflowPriority",
       ARRAY(
         SELECT DISTINCT COALESCE(signal.source_url, evidence.url)
         FROM hiring_episode_evidence episode_evidence
         LEFT JOIN signals signal ON signal.id = episode_evidence.signal_id
         LEFT JOIN evidence_items evidence ON evidence.id = episode_evidence.evidence_id
         WHERE episode_evidence.hiring_episode_id = opportunity.hiring_episode_id
           AND COALESCE(signal.source_url, evidence.url) IS NOT NULL
         ORDER BY COALESCE(signal.source_url, evidence.url)
       ) AS "evidenceUrls"
     FROM opportunity_crm_integrations integration
     JOIN opportunity_crm_credentials credential
       ON credential.integration_id = integration.id
      AND credential.workspace_id = integration.workspace_id
      AND credential.status = 'active'
     JOIN opportunities opportunity
       ON opportunity.id = $3
      AND opportunity.owner_id = $2
      AND opportunity.workspace_id = integration.workspace_id
     JOIN orgs organization ON organization.id = opportunity.organization_id
     LEFT JOIN opportunity_outcome_state outcome_state
       ON outcome_state.owner_id = opportunity.owner_id
      AND outcome_state.opportunity_id = opportunity.id
     LEFT JOIN opportunity_workflow_state workflow_state
       ON workflow_state.owner_id = opportunity.owner_id
      AND workflow_state.workspace_id = opportunity.workspace_id
      AND workflow_state.opportunity_id = opportunity.id
     WHERE integration.workspace_id = $1
       AND integration.public_reference = $4::UUID
       AND integration.status = 'active'
       AND integration.outbound_webhook_url IS NOT NULL
       AND opportunity.superseded_at IS NULL
     FOR UPDATE OF integration, credential, opportunity`,
    [workspaceId, ownerId, opportunityId, integrationReference],
  )
  return result.rows[0] ?? null
}

function positiveId(value: string | number): string | null {
  const normalized = String(value)
  if (!/^[1-9]\d*$/.test(normalized)) return null
  try {
    return BigInt(normalized) <= BigInt('9223372036854775807')
      ? normalized
      : null
  } catch {
    return null
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)
}

function uuidV5(namespace: string, value: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex')
  const bytes = createHash('sha1')
    .update(namespaceBytes)
    .update(value, 'utf8')
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
