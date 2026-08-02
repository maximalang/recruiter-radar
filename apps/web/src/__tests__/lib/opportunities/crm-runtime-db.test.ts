import { Pool } from 'pg'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  CrmCallbackAuthenticationError,
  CrmCallbackReplayConflictError,
  ingestCrmOutcomeCallback,
} from '@/lib/opportunities/crm-callback-repository'
import { createCrmCredentialSecret } from '@/lib/opportunities/crm-credential-security'
import {
  CrmDeliveryInProgressError,
  deliverOpportunityToCrm,
} from '@/lib/opportunities/crm-delivery-repository'
import { createCrmWebhookSignature } from '@/lib/opportunities/crm-webhook'

const databaseUrl = process.env.DATABASE_URL
const describeWithDatabase = databaseUrl ? describe : describe.skip

describeWithDatabase('Opportunity CRM bridge PostgreSQL runtime', () => {
  const pool = new Pool({ connectionString: databaseUrl })

  afterAll(async () => {
    await pool.end()
  })

  const globallyEnabledEnv = {
    OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
    OPPORTUNITY_OUTCOMES_ENABLED: 'true',
    OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
    OPPORTUNITY_CRM_BRIDGE_ENABLED: 'true',
  }

  function ingest(
    input: Parameters<typeof ingestCrmOutcomeCallback>[0],
    env: Readonly<Record<string, string | undefined>> = globallyEnabledEnv,
  ) {
    return ingestCrmOutcomeCallback(input, () => pool.connect(), new Date(), env)
  }

  it('enforces tenant scope, revocation and altered-replay rejection in one ledger', async () => {
    const tenant = await seedTenant('primary')
    const foreign = await seedTenant('foreign')
    const active = await seedIntegration(tenant, 'active')
    const revoked = await seedIntegration(tenant, 'revoked')
    const foreignActive = await seedIntegration(foreign, 'active')

    await expect(ingest(signed({
      integrationReference: foreignActive.integrationReference,
      credentialReference: foreignActive.credentialReference,
      credentialSecretHash: foreignActive.credentialSecretHash,
      eventId: 'foreign-canary-credential-1',
      rawBody: body(foreign.opportunityReference, 'accepted'),
    }), {
      OPPORTUNITY_CANARY_WORKSPACE_IDS: tenant.workspaceId,
      OPPORTUNITY_CRM_BRIDGE_ENABLED: 'true',
    })).rejects.toBeInstanceOf(CrmCallbackAuthenticationError)
    expect(await outcomeCount(foreign.opportunityId)).toBe(0)

    const crossBody = body(foreign.opportunityReference, 'accepted')
    await expect(ingest(signed({
      integrationReference: active.integrationReference,
      credentialReference: active.credentialReference,
      credentialSecretHash: active.credentialSecretHash,
      eventId: 'cross-workspace-1',
      rawBody: crossBody,
    }))).resolves.toEqual({
      status: 404,
      code: 'not_found',
      accepted: false,
      idempotent: false,
    })
    expect(await outcomeCount(foreign.opportunityId)).toBe(0)

    const revokedBody = body(tenant.opportunityReference, 'accepted')
    await expect(ingest(signed({
      integrationReference: revoked.integrationReference,
      credentialReference: revoked.credentialReference,
      credentialSecretHash: revoked.credentialSecretHash,
      eventId: 'revoked-credential-1',
      rawBody: revokedBody,
    }))).rejects.toBeInstanceOf(CrmCallbackAuthenticationError)

    const occurredAt = new Date().toISOString()
    const acceptedBody = JSON.stringify({
      opportunityReference: tenant.opportunityReference,
      eventType: 'accepted',
      occurredAt,
    })
    const acceptedInput = signed({
      integrationReference: active.integrationReference,
      credentialReference: active.credentialReference,
      credentialSecretHash: active.credentialSecretHash,
      eventId: 'accepted-1',
      rawBody: acceptedBody,
    })
    await expect(ingest(acceptedInput)).resolves.toEqual({
      status: 200,
      code: 'accepted',
      accepted: true,
      idempotent: false,
    })

    const changedBody = JSON.stringify({
      opportunityReference: tenant.opportunityReference,
      eventType: 'accepted',
      occurredAt,
      channel: 'crm',
    })
    await expect(ingest(signed({
      integrationReference: active.integrationReference,
      credentialReference: active.credentialReference,
      credentialSecretHash: active.credentialSecretHash,
      eventId: 'accepted-1',
      rawBody: changedBody,
    }))).rejects.toBeInstanceOf(CrmCallbackReplayConflictError)

    expect(await outcomeCount(tenant.opportunityId)).toBe(1)
    const state = await pool.query(
      `SELECT current_stage AS "currentStage"
       FROM opportunity_outcome_state
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [tenant.ownerId, tenant.opportunityId],
    )
    expect(state.rows[0]?.currentStage).toBe('accepted')
    const acceptedReceipts = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM opportunity_crm_callback_receipts
       WHERE credential_id = $1
         AND external_event_id = 'accepted-1'
         AND response_code = 'accepted'`,
      [active.credentialId],
    )
    expect(acceptedReceipts.rows[0]?.count).toBe(1)
  })

  it('claims outbound delivery without holding a transaction across network I/O', async () => {
    const tenant = await seedTenant('outbound')
    const integration = await seedIntegration(tenant, 'active')
    let releaseSender!: () => void
    const senderGate = new Promise<void>((resolve) => { releaseSender = resolve })
    const sender = jest.fn(async () => {
      await senderGate
      return { status: 'succeeded' as const, httpStatus: 202 }
    })
    const input = {
      ownerId: tenant.ownerId,
      workspaceId: tenant.workspaceId,
      opportunityId: tenant.opportunityId,
      actorUserId: tenant.ownerId,
      integrationReference: integration.integrationReference,
      idempotencyKey: 'postgres-claim-1',
    }

    const first = deliverOpportunityToCrm(input, sender, () => pool.connect())
    await waitFor(() => sender.mock.calls.length === 1)
    const duringSend = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM opportunity_crm_delivery_claims)::INTEGER
           AS claims,
         (SELECT COUNT(*) FROM opportunity_crm_deliveries)::INTEGER
           AS deliveries`,
    )
    expect(duringSend.rows[0]).toEqual({ claims: 1, deliveries: 0 })
    await expect(deliverOpportunityToCrm(
      input,
      sender,
      () => pool.connect(),
    )).rejects.toBeInstanceOf(CrmDeliveryInProgressError)

    await pool.query(
      `UPDATE opportunity_crm_delivery_claims
       SET claimed_at = NOW() - INTERVAL '31 seconds'`,
    )
    const takeoverSender = jest.fn(async () => ({
      status: 'succeeded' as const,
      httpStatus: 202,
    }))
    await expect(deliverOpportunityToCrm(
      input,
      takeoverSender,
      () => pool.connect(),
    )).resolves.toEqual(expect.objectContaining({
      status: 'succeeded', idempotent: false,
    }))
    expect(takeoverSender).toHaveBeenCalledTimes(1)
    expect(takeoverSender.mock.calls[0]?.[0].body)
      .toBe(sender.mock.calls[0]?.[0].body)
    expect(takeoverSender.mock.calls[0]?.[0].timestamp)
      .toBe(sender.mock.calls[0]?.[0].timestamp)

    releaseSender()
    await expect(first).resolves.toEqual(expect.objectContaining({
      status: 'succeeded', idempotent: true,
    }))
    await expect(deliverOpportunityToCrm(
      input,
      sender,
      () => pool.connect(),
    )).resolves.toEqual(expect.objectContaining({
      status: 'succeeded', idempotent: true,
    }))
    expect(sender).toHaveBeenCalledTimes(1)
    const finalized = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM opportunity_crm_delivery_claims)::INTEGER
           AS claims,
         (SELECT COUNT(*) FROM opportunity_crm_deliveries)::INTEGER
           AS deliveries`,
    )
    expect(finalized.rows[0]).toEqual({ claims: 0, deliveries: 1 })
  })

  it('locks claim insertion before refusing a non-empty rollback', async () => {
    const tenant = await seedTenant('rollback-lock')
    const integration = await seedIntegration(tenant, 'active')
    const claimClient = await pool.connect()
    const downClient = await pool.connect()
    try {
      await claimClient.query('BEGIN')
      await claimClient.query(
        `INSERT INTO opportunity_crm_delivery_claims (
           event_id, workspace_id, integration_id, credential_id,
           owner_id, opportunity_id, request_hash, request_body,
           request_timestamp, claim_token
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4, $5,
           repeat('a', 64), '{}', $6, gen_random_uuid()
         )`,
        [
          tenant.workspaceId,
          integration.integrationId,
          integration.credentialId,
          tenant.ownerId,
          tenant.opportunityId,
          String(Math.floor(Date.now() / 1_000)),
        ],
      )
      const backend = await downClient.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      )
      const downSql = readFileSync(resolve(
        process.cwd(), '..', '..', 'packages', 'db', 'migrations',
        '20260802100000_add_opportunity_crm_delivery_claims.down.sql',
      ), 'utf8')
      const downAttempt = downClient.query(downSql).then(
        () => ({ ok: true as const, error: null }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      await waitFor(async () => {
        const activity = await pool.query<{ waitEventType: string | null }>(
          `SELECT wait_event_type AS "waitEventType"
           FROM pg_stat_activity
           WHERE pid = $1`,
          [backend.rows[0].pid],
        )
        return activity.rows[0]?.waitEventType === 'Lock'
      })
      await claimClient.query('COMMIT')
      const result = await downAttempt
      expect(result.ok).toBe(false)
      expect(result.error).toEqual(expect.objectContaining({
        message: expect.stringContaining('active claims exist'),
      }))
      await downClient.query('ROLLBACK')
      const preserved = await pool.query(
        `SELECT
           TO_REGCLASS('public.opportunity_crm_delivery_claims') AS relation,
           (SELECT COUNT(*)::INTEGER
            FROM opportunity_crm_delivery_claims) AS count`,
      )
      expect(preserved.rows[0]).toEqual({
        relation: 'opportunity_crm_delivery_claims',
        count: 1,
      })
      await pool.query('DELETE FROM opportunity_crm_delivery_claims')
    } finally {
      await claimClient.query('ROLLBACK').catch(() => undefined)
      await downClient.query('ROLLBACK').catch(() => undefined)
      claimClient.release()
      downClient.release()
    }
  })

  async function seedTenant(label: string) {
    const token = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const owner = await pool.query(
      `INSERT INTO users (email, full_name)
       VALUES ($1, $2)
       RETURNING id::TEXT AS id`,
      [`crm-${token}@example.invalid`, `CRM ${label}`],
    )
    const ownerId = owner.rows[0].id as string
    const workspace = await pool.query(
      'SELECT ensure_auth_user_workspace($1)::TEXT AS id',
      [ownerId],
    )
    const workspaceId = workspace.rows[0].id as string
    const profile = await pool.query(
      `INSERT INTO client_profiles (agency_name, owner_id)
       VALUES ($1, $2)
       RETURNING id::TEXT AS id`,
      [`CRM ${label}`, ownerId],
    )
    const organization = await pool.query(
      `INSERT INTO orgs (name, domain)
       VALUES ($1, $2)
       RETURNING id::TEXT AS id`,
      [`CRM ${label}`, `${token}.example.invalid`],
    )
    const episode = await pool.query(
      `INSERT INTO hiring_episodes (
         organization_id, episode_type, episode_key, episode_identity,
         episode_generation, title, summary, started_at, last_seen_at,
         signal_count, vacancy_count, strength_score, freshness_score,
         evidence_hash, engine_version
       ) VALUES (
         $1, 'role_cluster', $2, $2, 1, $3, $3, NOW(), NOW(),
         1, 1, 0.5, 0.5, repeat('a', 64), 'hiring-episode-v1'
       ) RETURNING id::TEXT AS id`,
      [organization.rows[0].id, token, `CRM ${label}`],
    )
    const opportunity = await pool.query(
      `INSERT INTO opportunities (
         owner_id, client_profile_id, organization_id, hiring_episode_id,
         status, title, why_now, problem_hypothesis, recommended_angle,
         recommended_persona, recommended_action, agency_fit_score,
         hiring_intent_score, agency_propensity_score, timing_score,
         reachability_score, confidence_score, opportunity_score,
         confidence_gate, scoring_version, evidence_hash, valid_until,
         episode_evidence_hash, profile_snapshot_hash, fiur_version,
         scoring_config_hash, brief_builder_version, input_hash
       ) VALUES (
         $1, $2, $3, $4, 'new', $5, 'Fixture', 'Fixture', 'Fixture',
         'Fixture', 'Fixture', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
         'B', 'crm-fixture-v1', repeat('b', 64), NOW() + INTERVAL '1 day',
         repeat('b', 64), repeat('c', 64), 'fiur-v1', repeat('d', 64),
         'opportunity-brief-v1', repeat('e', 64)
       ) RETURNING
         id::TEXT AS id,
         public_reference::TEXT AS "publicReference",
         workspace_id::TEXT AS "workspaceId"`,
      [
        ownerId,
        profile.rows[0].id,
        organization.rows[0].id,
        episode.rows[0].id,
        `CRM ${label}`,
      ],
    )
    expect(opportunity.rows[0].workspaceId).toBe(workspaceId)
    return {
      ownerId,
      workspaceId,
      opportunityId: opportunity.rows[0].id as string,
      opportunityReference: opportunity.rows[0].publicReference as string,
    }
  }

  async function seedIntegration(
    tenant: { ownerId: string; workspaceId: string },
    status: 'active' | 'revoked',
  ) {
    const integration = await pool.query(
      `INSERT INTO opportunity_crm_integrations (
         workspace_id, provider, display_name, created_by_user_id
       ) VALUES ($1, 'generic', $2, $3)
       RETURNING id::TEXT AS id, public_reference::TEXT AS reference`,
      [tenant.workspaceId, `CRM ${status}`, tenant.ownerId],
    )
    await pool.query(
      `UPDATE opportunity_crm_integrations
       SET outbound_webhook_url = 'https://hooks.example.test/opportunity'
       WHERE id = $1`,
      [integration.rows[0].id],
    )
    const secret = createCrmCredentialSecret()
    const credential = await pool.query(
      `INSERT INTO opportunity_crm_credentials (
         workspace_id, integration_id, secret_hash, secret_prefix, status,
         allowed_event_types, created_by_user_id, revoked_at
       ) VALUES (
         $1, $2, $3, $4, $5, ARRAY['accepted', 'dismissed']::TEXT[], $6,
         CASE WHEN $5 = 'revoked' THEN NOW() ELSE NULL END
       ) RETURNING id::TEXT AS id, public_reference::TEXT AS reference`,
      [
        tenant.workspaceId,
        integration.rows[0].id,
        secret.secretHash,
        secret.secretPrefix,
        status,
        tenant.ownerId,
      ],
    )
    return {
      integrationId: integration.rows[0].id as string,
      integrationReference: integration.rows[0].reference as string,
      credentialId: credential.rows[0].id as string,
      credentialReference: credential.rows[0].reference as string,
      credentialSecretHash: secret.secretHash,
    }
  }

  function body(opportunityReference: string, eventType: string) {
    return JSON.stringify({
      opportunityReference,
      eventType,
      occurredAt: new Date().toISOString(),
    })
  }

  function signed(input: {
    integrationReference: string
    credentialReference: string
    credentialSecretHash: string
    eventId: string
    rawBody: string
  }) {
    const timestamp = String(Math.floor(Date.now() / 1_000))
    return {
      integrationReference: input.integrationReference,
      credentialReference: input.credentialReference,
      timestamp,
      eventId: input.eventId,
      rawBody: input.rawBody,
      signature: createCrmWebhookSignature({
        credentialSecretHash: input.credentialSecretHash,
        timestamp,
        eventId: input.eventId,
        body: input.rawBody,
      }),
    }
  }

  async function outcomeCount(opportunityId: string) {
    const result = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM opportunity_outcome_events
       WHERE opportunity_id = $1`,
      [opportunityId],
    )
    return result.rows[0].count as number
  }

  async function waitFor(predicate: () => boolean | Promise<boolean>) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Timed out waiting for CRM sender.')
  }
})
