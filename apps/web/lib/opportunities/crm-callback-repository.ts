import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'

import { getClient } from '@/lib/db-pool'
import { OutcomeValidationError } from './outcome-domain'
import {
  OutcomeChronologyConflictError,
  OutcomeIdempotencyConflictError,
  OutcomeSupersededConflictError,
  OutcomeTransitionConflictError,
  recordOpportunityOutcomeInTransaction,
} from './outcome-repository'
import { verifyCrmWebhookSignature } from './crm-webhook'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/
const TIMESTAMP_PATTERN = /^\d{10}$/
const ALLOWED_BODY_KEYS = new Set([
  'opportunityReference',
  'eventType',
  'occurredAt',
  'reasonCode',
  'reasonNote',
  'channel',
  'contactPathType',
  'snoozeDays',
  'snoozedUntil',
  'valueMinor',
  'currency',
])

export interface CrmCallbackResult {
  status: number
  code: string
  accepted: boolean
  idempotent: boolean
}

export class CrmCallbackAuthenticationError extends Error {
  readonly code = 'invalid_signature'

  constructor() {
    super('CRM callback authentication failed.')
    this.name = 'CrmCallbackAuthenticationError'
  }
}

export class CrmCallbackReplayConflictError extends Error {
  readonly code = 'crm_callback_replay_conflict'

  constructor() {
    super('A CRM event ID was reused with another payload.')
    this.name = 'CrmCallbackReplayConflictError'
  }
}

type ClientProvider = () => Promise<PoolClient | null>
type CredentialRow = {
  workspaceId: string
  integrationId: string
  credentialId: string
  credentialSecretHash: string
  allowedEventTypes: string[]
  rateLimitMaxRequests: number
  rateLimitWindowSeconds: number
  replayWindowSeconds: number
}
type ReceiptRow = {
  requestHash: string
  responseStatus: number
  responseCode: string
}
type ParsedCallback = {
  opportunityReference: string
  eventType: string
  payload: Record<string, unknown>
}

export async function ingestCrmOutcomeCallback(
  input: {
    integrationReference: string
    credentialReference: string
    timestamp: string
    eventId: string
    rawBody: string
    signature: string
  },
  provideClient: ClientProvider = getClient,
  now: Date = new Date(),
): Promise<CrmCallbackResult> {
  if (
    !UUID_PATTERN.test(input.integrationReference) ||
    !UUID_PATTERN.test(input.credentialReference) ||
    !EVENT_ID_PATTERN.test(input.eventId) ||
    !TIMESTAMP_PATTERN.test(input.timestamp)
  ) {
    throw new CrmCallbackAuthenticationError()
  }

  const client = await provideClient()
  if (!client) throw new Error('DATABASE_URL is not set.')
  try {
    await client.query('BEGIN')
    const credential = await lockCredential(client, input)
    if (!credential) throw new CrmCallbackAuthenticationError()
    if (
      !verifyCrmWebhookSignature({
        credentialSecretHash: credential.credentialSecretHash,
        timestamp: input.timestamp,
        eventId: input.eventId,
        body: input.rawBody,
        signature: input.signature,
      }) ||
      !isWithinReplayWindow(
        input.timestamp,
        credential.replayWindowSeconds,
        now,
      )
    ) {
      throw new CrmCallbackAuthenticationError()
    }

    const requestHash = createHash('sha256')
      .update(input.rawBody, 'utf8')
      .digest('hex')
    const replay = await findReceipt(
      client,
      credential.credentialId,
      input.eventId,
    )
    if (replay) {
      if (replay.requestHash !== requestHash) {
        throw new CrmCallbackReplayConflictError()
      }
      await client.query('COMMIT')
      return {
        status: replay.responseStatus,
        code: replay.responseCode,
        accepted: replay.responseCode === 'accepted',
        idempotent: true,
      }
    }

    const requestCount = await countRecentRequests(
      client,
      credential.credentialId,
      credential.rateLimitWindowSeconds,
    )
    if (requestCount >= credential.rateLimitMaxRequests) {
      const response = rejected(429, 'rate_limited')
      await insertReceipt(client, credential, input, requestHash, null, null, response)
      await client.query('COMMIT')
      return response
    }

    let callback: ParsedCallback
    try {
      callback = parseCallback(
        input.rawBody,
        input.credentialReference,
        input.eventId,
      )
    } catch {
      const response = rejected(400, 'invalid_payload')
      await insertReceipt(client, credential, input, requestHash, null, null, response)
      await client.query('COMMIT')
      return response
    }
    if (!credential.allowedEventTypes.includes(callback.eventType)) {
      const response = rejected(403, 'event_type_not_allowed')
      await insertReceipt(
        client,
        credential,
        input,
        requestHash,
        callback.opportunityReference,
        null,
        response,
      )
      await client.query('COMMIT')
      return response
    }

    const opportunity = await resolveOpportunity(
      client,
      credential.workspaceId,
      callback.opportunityReference,
    )
    if (!opportunity) {
      const response = rejected(404, 'not_found')
      await insertReceipt(
        client,
        credential,
        input,
        requestHash,
        callback.opportunityReference,
        null,
        response,
      )
      await client.query('COMMIT')
      return response
    }

    try {
      const outcome = await recordOpportunityOutcomeInTransaction({
        ownerId: opportunity.ownerId,
        workspaceId: credential.workspaceId,
        opportunityId: opportunity.opportunityId,
        actorType: 'external',
        externalSystem: `crm:${input.integrationReference.toLowerCase()}`,
        externalEventId: input.eventId,
        dedupeKey: `${input.credentialReference.toLowerCase()}:${input.eventId}`,
        validationNow: now,
        payload: callback.payload,
      }, client)
      if (!outcome) {
        const response = rejected(404, 'not_found')
        await insertReceipt(
          client,
          credential,
          input,
          requestHash,
          callback.opportunityReference,
          null,
          response,
        )
        await client.query('COMMIT')
        return response
      }
      const response: CrmCallbackResult = {
        status: 200,
        code: 'accepted',
        accepted: true,
        idempotent: outcome.idempotent,
      }
      await insertReceipt(
        client,
        credential,
        input,
        requestHash,
        callback.opportunityReference,
        outcome.event.id,
        response,
      )
      await client.query('COMMIT')
      return response
    } catch (error) {
      const response = expectedOutcomeError(error)
      if (!response) throw error
      await insertReceipt(
        client,
        credential,
        input,
        requestHash,
        callback.opportunityReference,
        null,
        response,
      )
      await client.query('COMMIT')
      return response
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function lockCredential(
  client: PoolClient,
  input: { integrationReference: string; credentialReference: string },
) {
  const result = await client.query<CredentialRow>(
    `SELECT
       integration.workspace_id::TEXT AS "workspaceId",
       integration.id::TEXT AS "integrationId",
       credential.id::TEXT AS "credentialId",
       credential.secret_hash AS "credentialSecretHash",
       credential.allowed_event_types AS "allowedEventTypes",
       credential.rate_limit_max_requests AS "rateLimitMaxRequests",
       credential.rate_limit_window_seconds AS "rateLimitWindowSeconds",
       credential.replay_window_seconds AS "replayWindowSeconds"
     FROM opportunity_crm_integrations integration
     JOIN opportunity_crm_credentials credential
       ON credential.integration_id = integration.id
      AND credential.workspace_id = integration.workspace_id
     JOIN workspaces workspace ON workspace.id = integration.workspace_id
     WHERE integration.public_reference = $1::UUID
       AND credential.public_reference = $2::UUID
       AND integration.status = 'active'
       AND credential.status = 'active'
       AND workspace.status = 'active'
       AND workspace.deleted_at IS NULL
     FOR UPDATE OF integration, credential`,
    [input.integrationReference, input.credentialReference],
  )
  return result.rows[0] ?? null
}

async function findReceipt(
  client: PoolClient,
  credentialId: string,
  eventId: string,
) {
  const result = await client.query<ReceiptRow>(
    `SELECT
       request_hash AS "requestHash",
       response_status AS "responseStatus",
       response_code AS "responseCode"
     FROM opportunity_crm_callback_receipts
     WHERE credential_id = $1 AND external_event_id = $2
     LIMIT 1`,
    [credentialId, eventId],
  )
  return result.rows[0] ?? null
}

async function countRecentRequests(
  client: PoolClient,
  credentialId: string,
  windowSeconds: number,
) {
  const result = await client.query<{ requestCount: string }>(
    `SELECT COUNT(*)::TEXT AS "requestCount"
     FROM opportunity_crm_callback_receipts
     WHERE credential_id = $1
       AND received_at > NOW() - ($2 * INTERVAL '1 second')`,
    [credentialId, windowSeconds],
  )
  return Number(result.rows[0]?.requestCount ?? 0)
}

async function resolveOpportunity(
  client: PoolClient,
  workspaceId: string,
  opportunityReference: string,
) {
  const result = await client.query<{ opportunityId: string; ownerId: string }>(
    `SELECT id::TEXT AS "opportunityId", owner_id::TEXT AS "ownerId"
     FROM opportunities
     WHERE workspace_id = $1
       AND public_reference = $2::UUID
       AND superseded_at IS NULL
     LIMIT 1`,
    [workspaceId, opportunityReference],
  )
  return result.rows[0] ?? null
}

async function insertReceipt(
  client: PoolClient,
  credential: CredentialRow,
  input: { eventId: string },
  requestHash: string,
  opportunityReference: string | null,
  outcomeEventId: string | null,
  response: CrmCallbackResult,
) {
  await client.query(
    `INSERT INTO opportunity_crm_callback_receipts (
       workspace_id,
       integration_id,
       credential_id,
       external_event_id,
       request_hash,
       opportunity_reference,
       outcome_event_id,
       response_status,
       response_code
     ) VALUES ($1, $2, $3, $4, $5, $6::UUID, $7, $8, $9)`,
    [
      credential.workspaceId,
      credential.integrationId,
      credential.credentialId,
      input.eventId,
      requestHash,
      opportunityReference,
      outcomeEventId,
      response.status,
      response.code,
    ],
  )
}

function parseCallback(
  rawBody: string,
  credentialReference: string,
  eventId: string,
): ParsedCallback {
  const parsed = JSON.parse(rawBody) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid payload')
  }
  const body = parsed as Record<string, unknown>
  if (Object.keys(body).some((key) => !ALLOWED_BODY_KEYS.has(key))) {
    throw new Error('invalid payload')
  }
  if (
    typeof body.opportunityReference !== 'string' ||
    !UUID_PATTERN.test(body.opportunityReference) ||
    typeof body.eventType !== 'string'
  ) {
    throw new Error('invalid payload')
  }
  const idempotencyKey = `crm:${createHash('sha256')
    .update(credentialReference.toLowerCase())
    .update('\0')
    .update(eventId)
    .digest('hex')}`
  return {
    opportunityReference: body.opportunityReference,
    eventType: body.eventType,
    payload: {
      eventType: body.eventType,
      occurredAt: body.occurredAt,
      reasonCode: body.reasonCode ?? null,
      reasonNote: body.reasonNote ?? null,
      channel: body.channel ?? null,
      contactPathType: body.contactPathType ?? null,
      contactReference: null,
      snoozeDays: body.snoozeDays ?? null,
      snoozedUntil: body.snoozedUntil ?? null,
      valueMinor: body.valueMinor ?? null,
      currency: body.currency ?? null,
      metadata: { source: 'crm_callback' },
      idempotencyKey,
    },
  }
}

function isWithinReplayWindow(
  timestamp: string,
  replayWindowSeconds: number,
  now: Date,
) {
  const timestampMs = Number(timestamp) * 1_000
  return Number.isFinite(timestampMs) &&
    Math.abs(now.getTime() - timestampMs) <= replayWindowSeconds * 1_000
}

function expectedOutcomeError(error: unknown): CrmCallbackResult | null {
  if (error instanceof OutcomeValidationError) {
    return rejected(400, error.code)
  }
  if (
    error instanceof OutcomeIdempotencyConflictError ||
    error instanceof OutcomeTransitionConflictError ||
    error instanceof OutcomeChronologyConflictError ||
    error instanceof OutcomeSupersededConflictError
  ) {
    const code = 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'outcome_conflict'
    return rejected(409, code)
  }
  return null
}

function rejected(status: number, code: string): CrmCallbackResult {
  return { status, code, accepted: false, idempotent: false }
}
