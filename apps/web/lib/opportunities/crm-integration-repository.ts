import type { PoolClient } from 'pg'

import { getClient } from '@/lib/db-pool'
import { createCrmCredentialSecret } from './crm-credential-security'
import type {
  CrmInboundEventType,
  CrmIntegrationProvider,
  NormalizedCrmIntegrationInput,
} from './crm-integration-domain'

export interface CrmIntegrationDescriptor {
  reference: string
  provider: CrmIntegrationProvider
  displayName: string
  outboundWebhookUrl: string | null
  status: 'active'
  createdAt: string
}

export interface IssuedCrmCredentialDescriptor {
  reference: string
  secret: string
  secretPrefix: string
  status: 'active'
  allowedEventTypes: CrmInboundEventType[]
  rateLimitPolicy: { maxRequests: number; windowSeconds: number }
  replayWindowSeconds: number
  createdAt: string
}

export interface CrmIntegrationIssueResult {
  integration: CrmIntegrationDescriptor
  credential: IssuedCrmCredentialDescriptor
}

export class CrmIntegrationAccessError extends Error {
  readonly code = 'crm_integration_access_denied'

  constructor() {
    super('Active owner or admin workspace access is required.')
    this.name = 'CrmIntegrationAccessError'
  }
}

type ClientProvider = () => Promise<PoolClient | null>
type IntegrationInsertRow = {
  id: string
  reference: string
  createdAt: string
}
type CredentialInsertRow = { reference: string; createdAt: string }
type LockedIntegrationRow = {
  id: string
  provider: CrmIntegrationProvider
  displayName: string
  outboundWebhookUrl: string | null
  integrationCreatedAt: string
  credentialId: string
  allowedEventTypes: CrmInboundEventType[]
  rateLimitMaxRequests: number
  rateLimitWindowSeconds: number
  replayWindowSeconds: number
}

export async function createCrmIntegration(
  input: {
    workspaceId: string | number
    actorUserId: string | number
    integration: NormalizedCrmIntegrationInput
  },
  provideClient: ClientProvider = getClient,
): Promise<CrmIntegrationIssueResult> {
  const workspaceId = positiveId(input.workspaceId)
  const actorUserId = positiveId(input.actorUserId)
  if (!workspaceId || !actorUserId) throw new CrmIntegrationAccessError()

  return inTransaction(provideClient, async (client) => {
    await requireIntegrationManager(client, workspaceId, actorUserId)
    const integrationResult = await client.query<IntegrationInsertRow>(
      `INSERT INTO opportunity_crm_integrations (
         workspace_id,
         provider,
         display_name,
         outbound_webhook_url,
         created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id::TEXT AS id,
         public_reference::TEXT AS reference,
         created_at::TEXT AS "createdAt"`,
      [
        workspaceId,
        input.integration.provider,
        input.integration.displayName,
        input.integration.outboundWebhookUrl,
        actorUserId,
      ],
    )
    const integration = integrationResult.rows[0]
    if (!integration) throw new Error('CRM integration insert returned no row.')

    const credential = await insertCredential(client, {
      workspaceId,
      integrationId: integration.id,
      actorUserId,
      allowedEventTypes: input.integration.allowedEventTypes,
      rateLimitMaxRequests: input.integration.rateLimitMaxRequests,
      rateLimitWindowSeconds: input.integration.rateLimitWindowSeconds,
      replayWindowSeconds: input.integration.replayWindowSeconds,
    })
    return {
      integration: {
        reference: integration.reference,
        provider: input.integration.provider,
        displayName: input.integration.displayName,
        outboundWebhookUrl: input.integration.outboundWebhookUrl,
        status: 'active',
        createdAt: integration.createdAt,
      },
      credential,
    }
  })
}

export async function rotateCrmCredential(
  input: {
    workspaceId: string | number
    actorUserId: string | number
    integrationReference: string
  },
  provideClient: ClientProvider = getClient,
): Promise<CrmIntegrationIssueResult | null> {
  const workspaceId = positiveId(input.workspaceId)
  const actorUserId = positiveId(input.actorUserId)
  if (!workspaceId || !actorUserId) throw new CrmIntegrationAccessError()
  if (!isUuid(input.integrationReference)) return null

  return inTransaction(provideClient, async (client) => {
    await requireIntegrationManager(client, workspaceId, actorUserId)
    const lockedResult = await client.query<LockedIntegrationRow>(
      `SELECT
         integration.id::TEXT AS id,
         integration.provider,
         integration.display_name AS "displayName",
         integration.outbound_webhook_url AS "outboundWebhookUrl",
         integration.created_at::TEXT AS "integrationCreatedAt",
         credential.id::TEXT AS "credentialId",
         credential.allowed_event_types AS "allowedEventTypes",
         credential.rate_limit_max_requests AS "rateLimitMaxRequests",
         credential.rate_limit_window_seconds AS "rateLimitWindowSeconds",
         credential.replay_window_seconds AS "replayWindowSeconds"
       FROM opportunity_crm_integrations integration
       JOIN opportunity_crm_credentials credential
         ON credential.integration_id = integration.id
        AND credential.workspace_id = integration.workspace_id
        AND credential.status = 'active'
       WHERE integration.workspace_id = $1
         AND integration.public_reference = $2::UUID
         AND integration.status = 'active'
       FOR UPDATE OF integration, credential`,
      [workspaceId, input.integrationReference],
    )
    const locked = lockedResult.rows[0]
    if (!locked) return null

    const rotated = await client.query(
      `UPDATE opportunity_crm_credentials
       SET status = 'rotated', rotated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
      [locked.credentialId, workspaceId],
    )
    if (rotated.rowCount !== 1) {
      throw new Error('Active CRM credential changed while locked.')
    }
    const credential = await insertCredential(client, {
      workspaceId,
      integrationId: locked.id,
      actorUserId,
      allowedEventTypes: locked.allowedEventTypes,
      rateLimitMaxRequests: locked.rateLimitMaxRequests,
      rateLimitWindowSeconds: locked.rateLimitWindowSeconds,
      replayWindowSeconds: locked.replayWindowSeconds,
    })
    return {
      integration: {
        reference: input.integrationReference,
        provider: locked.provider,
        displayName: locked.displayName,
        outboundWebhookUrl: locked.outboundWebhookUrl,
        status: 'active',
        createdAt: locked.integrationCreatedAt,
      },
      credential,
    }
  })
}

export async function revokeCrmCredential(
  input: {
    workspaceId: string | number
    actorUserId: string | number
    integrationReference: string
    credentialReference: string
  },
  provideClient: ClientProvider = getClient,
): Promise<boolean> {
  const workspaceId = positiveId(input.workspaceId)
  const actorUserId = positiveId(input.actorUserId)
  if (!workspaceId || !actorUserId) throw new CrmIntegrationAccessError()
  if (!isUuid(input.integrationReference) || !isUuid(input.credentialReference)) {
    return false
  }

  return inTransaction(provideClient, async (client) => {
    await requireIntegrationManager(client, workspaceId, actorUserId)
    const result = await client.query<{ reference: string }>(
      `UPDATE opportunity_crm_credentials credential
       SET status = 'revoked', revoked_at = NOW()
       FROM opportunity_crm_integrations integration
       WHERE credential.integration_id = integration.id
         AND credential.workspace_id = integration.workspace_id
         AND credential.workspace_id = $1
         AND integration.public_reference = $2::UUID
         AND credential.public_reference = $3::UUID
         AND integration.status = 'active'
         AND credential.status = 'active'
       RETURNING credential.public_reference::TEXT AS reference`,
      [workspaceId, input.integrationReference, input.credentialReference],
    )
    return result.rowCount === 1
  })
}

async function insertCredential(
  client: PoolClient,
  input: {
    workspaceId: string
    integrationId: string
    actorUserId: string
    allowedEventTypes: CrmInboundEventType[]
    rateLimitMaxRequests: number
    rateLimitWindowSeconds: number
    replayWindowSeconds: number
  },
): Promise<IssuedCrmCredentialDescriptor> {
  const issued = createCrmCredentialSecret()
  const result = await client.query<CredentialInsertRow>(
    `INSERT INTO opportunity_crm_credentials (
       workspace_id,
       integration_id,
       created_by_user_id,
       secret_hash,
       secret_prefix,
       allowed_event_types,
       rate_limit_max_requests,
       rate_limit_window_seconds,
       replay_window_seconds
     ) VALUES ($1, $2, $3, $4, $5, $6::TEXT[], $7, $8, $9)
     RETURNING
       public_reference::TEXT AS reference,
       created_at::TEXT AS "createdAt"`,
    [
      input.workspaceId,
      input.integrationId,
      input.actorUserId,
      issued.secretHash,
      issued.secretPrefix,
      input.allowedEventTypes,
      input.rateLimitMaxRequests,
      input.rateLimitWindowSeconds,
      input.replayWindowSeconds,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('CRM credential insert returned no row.')
  return {
    reference: row.reference,
    secret: issued.secret,
    secretPrefix: issued.secretPrefix,
    status: 'active',
    allowedEventTypes: input.allowedEventTypes,
    rateLimitPolicy: {
      maxRequests: input.rateLimitMaxRequests,
      windowSeconds: input.rateLimitWindowSeconds,
    },
    replayWindowSeconds: input.replayWindowSeconds,
    createdAt: row.createdAt,
  }
}

async function requireIntegrationManager(
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
       AND membership.role IN ('owner', 'admin')
       AND workspace.status = 'active'
       AND workspace.deleted_at IS NULL
       AND actor.status = 'active'
     FOR UPDATE OF membership, workspace`,
    [workspaceId, actorUserId],
  )
  const role = result.rows[0]?.role
  if (role !== 'owner' && role !== 'admin') {
    throw new CrmIntegrationAccessError()
  }
}

async function inTransaction<T>(
  provideClient: ClientProvider,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await provideClient()
  if (!client) throw new Error('DATABASE_URL is not set.')
  try {
    await client.query('BEGIN')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
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
