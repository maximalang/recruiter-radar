/** @jest-environment node */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'

import { getPool } from '@/lib/db-pool'
import { toPublicOpportunity } from '@/lib/opportunities/api-projection'
import { getOutcomeAnalyticsV2Summary } from '@/lib/opportunities/outcome-analytics-v2'
import { getOutcomeCalibrationDataset } from '@/lib/opportunities/outcome-calibration-export'
import { recordOpportunityOutcome } from '@/lib/opportunities/outcome-repository'
import type { OpportunityOutcomeInput } from '@/lib/opportunities/outcome-domain'
import { listOpportunities } from '@/lib/opportunities/repository'
import {
  OpportunityWorkflowAccessError,
  OpportunityWorkflowAssigneeError,
  OpportunityWorkflowIdempotencyConflictError,
  listOpportunityWorkflowAssignees,
  updateOpportunityWorkflow,
} from '@/lib/opportunities/opportunity-workflow-repository'

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

describeWithDatabase('Opportunity workflow PostgreSQL runtime', () => {
  jest.setTimeout(90_000)

  const database = new Pool({ connectionString: process.env.DATABASE_URL })
  const token = `${Date.now()}-${process.pid}`
  let ownerId = ''
  let recruiterId = ''
  let secondRecruiterId = ''
  let viewerId = ''
  let otherOwnerId = ''
  let workspaceId = ''
  let otherWorkspaceId = ''
  let opportunityId = ''
  let concurrentDueAt = ''

  beforeAll(async () => {
    const users = await database.query(
      `INSERT INTO users (email, full_name)
       VALUES
         ($1, 'Workflow owner'),
         ($2, 'Workflow recruiter'),
         ($3, 'Workflow second recruiter'),
         ($4, 'Workflow viewer'),
         ($5, 'Workflow other owner')
       RETURNING id::TEXT AS id`,
      [
        `workflow-owner-${token}@example.invalid`,
        `workflow-recruiter-${token}@example.invalid`,
        `workflow-second-${token}@example.invalid`,
        `workflow-viewer-${token}@example.invalid`,
        `workflow-other-${token}@example.invalid`,
      ],
    )
    ownerId = String(users.rows[0].id)
    recruiterId = String(users.rows[1].id)
    secondRecruiterId = String(users.rows[2].id)
    viewerId = String(users.rows[3].id)
    otherOwnerId = String(users.rows[4].id)

    workspaceId = await ensureWorkspace(ownerId)
    otherWorkspaceId = await ensureWorkspace(otherOwnerId)
    await database.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES
         ($1, $2, 'recruiter'),
         ($1, $3, 'recruiter'),
         ($1, $4, 'viewer')`,
      [workspaceId, recruiterId, secondRecruiterId, viewerId],
    )

    const profile = await database.query(
      `INSERT INTO client_profiles (agency_name, owner_id)
       VALUES ('Workflow Runtime Agency', $1)
       RETURNING id::TEXT AS id`,
      [ownerId],
    )
    const organization = await database.query(
      `INSERT INTO orgs (name, domain)
       VALUES ('Workflow Runtime Organization', $1)
       RETURNING id::TEXT AS id`,
      [`workflow-${token}.example.invalid`],
    )
    const episode = await database.query(
      `INSERT INTO hiring_episodes (
         organization_id, episode_type, episode_key, episode_identity,
         episode_generation, title, summary, started_at, last_seen_at,
         signal_count, vacancy_count, strength_score, freshness_score,
         evidence_hash, engine_version
       )
       VALUES (
         $1, 'vacancy_spike', $2, $3, 1,
         'Workflow runtime episode', 'Workflow runtime episode',
         NOW() - INTERVAL '1 day', NOW(), 1, 3, 0.8, 0.9, $4,
         'hiring-episode-v1'
       )
       RETURNING id::TEXT AS id`,
      [
        organization.rows[0].id,
        `workflow:${token}`,
        `${organization.rows[0].id}:workflow:${token}`,
        hash(`workflow-evidence:${token}`),
      ],
    )
    const opportunity = await database.query(
      `INSERT INTO opportunities (
         owner_id, client_profile_id, organization_id, hiring_episode_id,
         status, title, why_now, problem_hypothesis, recommended_angle,
         recommended_persona, recommended_action, agency_fit_score,
         hiring_intent_score, agency_propensity_score, timing_score,
         reachability_score, confidence_score, opportunity_score,
         confidence_gate, scoring_version, evidence_hash, valid_until,
         episode_evidence_hash, profile_snapshot_hash, fiur_version,
         scoring_config_hash, brief_builder_version, input_hash
       )
       VALUES (
         $1, $2, $3, $4, 'new', 'Workflow runtime opportunity',
         'Fresh evidence', 'External support may be useful', 'Narrow offer',
         'Head of recruitment', 'Prepare a draft', 0.8, 0.9, 0.7, 0.9,
         0.8, 0.9, 0.83, 'A', 'opportunity-v1', $5,
         NOW() + INTERVAL '14 days', $5, $6, 'fiur-v1', $7,
         'opportunity-brief-v1', $8
       )
       RETURNING id::TEXT AS id`,
      [
        ownerId,
        profile.rows[0].id,
        organization.rows[0].id,
        episode.rows[0].id,
        hash(`workflow-opportunity:${token}`),
        hash(`workflow-profile:${token}`),
        hash('workflow-scoring-config'),
        hash(`workflow-input:${token}`),
      ],
    )
    opportunityId = String(opportunity.rows[0].id)
  })

  afterAll(async () => {
    await database.end()
    const sharedPool = getPool()
    if (sharedPool) await sharedPool.end()
    delete (globalThis as typeof globalThis & {
      recruiterRadarSharedPool?: Pool
    }).recruiterRadarSharedPool
  })

  it('serializes an exact concurrent claim into one immutable event', async () => {
    concurrentDueAt = new Date(Date.now() + 86_400_000).toISOString()
    const command = {
      ownerId,
      workspaceId,
      opportunityId,
      actorUserId: recruiterId,
      actorRole: 'recruiter' as const,
      idempotencyKey: `workflow-concurrent:${token}`,
      patch: {
        assignedToUserId: recruiterId,
        nextActionType: 'follow_up' as const,
        nextActionDueAt: concurrentDueAt,
        workflowPriority: 'high' as const,
        internalNote: 'Согласовать следующий шаг внутри команды.',
      },
    }
    const results = await Promise.all([
      updateOpportunityWorkflow(command),
      updateOpportunityWorkflow(command),
    ])

    expect(results.map((result) => result?.idempotent).sort()).toEqual([
      false,
      true,
    ])
    const events = await database.query(
      `SELECT
         actor_user_id::TEXT AS "actorUserId",
         actor_workspace_id::TEXT AS "actorWorkspaceId",
         actor_role_snapshot AS "actorRoleSnapshot",
         changed_fields AS "changedFields"
       FROM opportunity_workflow_events
       WHERE owner_id = $1 AND workspace_id = $2 AND idempotency_key = $3`,
      [ownerId, workspaceId, command.idempotencyKey],
    )
    expect(events.rows).toEqual([expect.objectContaining({
      actorUserId: recruiterId,
      actorWorkspaceId: workspaceId,
      actorRoleSnapshot: 'recruiter',
      changedFields: expect.arrayContaining([
        'assignedToUserId',
        'nextActionType',
        'workflowPriority',
        'internalNote',
      ]),
    })])
  })

  it('rejects changed idempotency payloads and append-only mutation', async () => {
    await expect(updateOpportunityWorkflow({
      ownerId,
      workspaceId,
      opportunityId,
      actorUserId: recruiterId,
      actorRole: 'recruiter',
      idempotencyKey: `workflow-concurrent:${token}`,
      patch: { workflowPriority: 'low' },
    })).rejects.toBeInstanceOf(OpportunityWorkflowIdempotencyConflictError)

    await expect(database.query(
      `UPDATE opportunity_workflow_events
       SET workflow_priority = 'low'
       WHERE owner_id = $1 AND workspace_id = $2 AND opportunity_id = $3`,
      [ownerId, workspaceId, opportunityId],
    )).rejects.toThrow('opportunity_workflow_events is append-only')
  })

  it('enforces recruiter handoff policy and assignee eligibility', async () => {
    const handoff = await updateOpportunityWorkflow({
      ownerId,
      workspaceId,
      opportunityId,
      actorUserId: recruiterId,
      actorRole: 'recruiter',
      idempotencyKey: `workflow-handoff:${token}`,
      patch: { assignedToUserId: secondRecruiterId },
    })
    expect(handoff?.state.assignedToUserId).toBe(secondRecruiterId)

    await expect(updateOpportunityWorkflow({
      ownerId,
      workspaceId,
      opportunityId,
      actorUserId: recruiterId,
      actorRole: 'recruiter',
      idempotencyKey: `workflow-takeover:${token}`,
      patch: { assignedToUserId: recruiterId },
    })).rejects.toBeInstanceOf(OpportunityWorkflowAccessError)

    await expect(updateOpportunityWorkflow({
      ownerId,
      workspaceId,
      opportunityId,
      actorUserId: ownerId,
      actorRole: 'owner',
      idempotencyKey: `workflow-viewer:${token}`,
      patch: { assignedToUserId: viewerId },
    })).rejects.toBeInstanceOf(OpportunityWorkflowAssigneeError)
  })

  it('proves event-time assignment, maturity, corrections, revenue and tenant isolation', async () => {
    const base = Date.now() - 20_000
    const events: Array<{
      eventType: OpportunityOutcomeInput['eventType']
      override?: Partial<OpportunityOutcomeInput>
    }> = [
      { eventType: 'shown' },
      { eventType: 'accepted' },
      {
        eventType: 'contacted',
        override: {
          channel: 'email',
          contactPathType: 'corporate_email',
        },
      },
      { eventType: 'replied' },
      {
        eventType: 'meeting',
        override: { metadata: { meetingStatus: 'scheduled' } },
      },
      { eventType: 'meeting_completed' },
      { eventType: 'proposal' },
      {
        eventType: 'won',
        override: { valueMinor: 250_000, currency: 'RUB' },
      },
    ]
    let wonEventId: string | null = null
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]
      const result = await recordOpportunityOutcome({
        ownerId,
        workspaceId,
        opportunityId,
        actorType: 'user',
        actorUserId: ownerId,
        actorWorkspaceId: workspaceId,
        actorRoleSnapshot: 'owner',
        authMode: 'auth_v2',
        payload: outcomePayload(
          event.eventType,
          `analytics:${event.eventType}:${token}`,
          base + index * 1_000,
          event.override,
        ),
      })
      if (event.eventType === 'won') wonEventId = result?.event.id ?? null
    }
    await recordOpportunityOutcome({
      ownerId,
      workspaceId,
      opportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      actorWorkspaceId: workspaceId,
      actorRoleSnapshot: 'owner',
      authMode: 'auth_v2',
      payload: outcomePayload(
        'reverted',
        `analytics:reverted:${token}`,
        base + 9_000,
        { revertsEventId: wonEventId },
      ),
    })
    const finalWon = await recordOpportunityOutcome({
      ownerId,
      workspaceId,
      opportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      actorWorkspaceId: workspaceId,
      actorRoleSnapshot: 'owner',
      authMode: 'auth_v2',
      payload: outcomePayload(
        'won',
        `analytics:won-again:${token}`,
        base + 10_000,
        { valueMinor: 250_000, currency: 'RUB' },
      ),
    })

    const capturedAssignment = await database.query(
      `SELECT DISTINCT assigned_user_id::TEXT AS "assignedUserId"
       FROM opportunity_outcome_events
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [ownerId, opportunityId],
    )
    expect(capturedAssignment.rows).toEqual([
      { assignedUserId: secondRecruiterId },
    ])
    const invalidAssigneeClient = await database.connect()
    try {
      await invalidAssigneeClient.query('BEGIN')
      await invalidAssigneeClient.query(
        `ALTER TABLE opportunity_outcome_events
         DISABLE TRIGGER opportunity_outcome_events_validate_insert`,
      )
      await expect(invalidAssigneeClient.query(
        `INSERT INTO opportunity_outcome_events (
           owner_id, client_profile_id, opportunity_id, hiring_episode_id,
           organization_id, event_type, previous_stage, new_stage,
           reason_code, reason_note, channel, contact_path_type,
           contact_reference, contact_reference_hash, contact_reference_label,
           snoozed_until, reverts_event_id, external_system, external_event_id,
           value_minor, currency, occurred_at, actor_type, actor_user_id,
           actor_workspace_id, actor_role_snapshot, assigned_user_id, metadata,
           analytics_snapshot, idempotency_key, dedupe_key, payload_hash
         )
         SELECT
           owner_id, client_profile_id, opportunity_id, hiring_episode_id,
           organization_id, event_type, previous_stage, new_stage,
           reason_code, reason_note, channel, contact_path_type,
           contact_reference, contact_reference_hash, contact_reference_label,
           snoozed_until, reverts_event_id, external_system, external_event_id,
           value_minor, currency, NOW(), actor_type, actor_user_id,
           actor_workspace_id, actor_role_snapshot, $3, metadata,
           analytics_snapshot, $4, NULL, payload_hash
         FROM opportunity_outcome_events
         WHERE owner_id = $1
           AND opportunity_id = $2
           AND event_type = 'shown'
         ORDER BY id
         LIMIT 1`,
        [
          ownerId,
          opportunityId,
          otherOwnerId,
          `analytics:foreign-assignee:${token}`,
        ],
      )).rejects.toThrow(
        'outcome event assignee must belong to the opportunity workspace',
      )
    } finally {
      await invalidAssigneeClient.query('ROLLBACK').catch(() => undefined)
      invalidAssigneeClient.release()
    }
    const rollbackSql = readFileSync(resolve(
      process.cwd(),
      '..',
      '..',
      'packages',
      'db',
      'migrations',
      '20260801150000_add_opportunity_analytics_v2.down.sql',
    ), 'utf8')
    const rollbackClient = await database.connect()
    try {
      await expect(rollbackClient.query(rollbackSql)).rejects.toThrow(
        'assigned-user attribution exists',
      )
      await rollbackClient.query('ROLLBACK')
    } finally {
      rollbackClient.release()
    }

    const from = new Date(base - 1_000).toISOString()
    const immatureTo = new Date(base + 24 * 60 * 60 * 1_000).toISOString()
    const matureTo = new Date(base + 31 * 24 * 60 * 60 * 1_000).toISOString()
    const filter = {
      ownerId,
      workspaceId,
      from,
      to: matureTo,
      cohort: 'contacted' as const,
      channel: 'email',
      contactPathType: 'corporate_email',
      assignedUserId: secondRecruiterId,
      maturityDays: 30,
    }
    const mature = await getOutcomeAnalyticsV2Summary(filter, database)
    const immature = await getOutcomeAnalyticsV2Summary({
      ...filter,
      to: immatureTo,
    }, database)
    const foreignWorkspace = await getOutcomeAnalyticsV2Summary({
      ...filter,
      workspaceId: otherWorkspaceId,
    }, database)

    expect(mature.cohort).toMatchObject({ size: 1, matured: true })
    expect(immature.cohort).toMatchObject({ size: 1, matured: false })
    expect(foreignWorkspace.cohort.size).toBe(0)
    expect(mature.terminalOutcomes).toMatchObject({ won: 1, lost: 0 })
    expect(mature.confirmedRevenue).toMatchObject({
      confirmedValueMinor: '250000',
      wonWithConfirmedValue: 1,
      wonWithoutConfirmedValue: 0,
    })

    const calibration = await getOutcomeCalibrationDataset(filter, database)
    expect(calibration).toHaveLength(1)
    expect(calibration[0]).toMatchObject({
      opportunityReference: expect.any(String),
      terminalStatus: 'won',
      confirmedRevenueMinor: '250000',
      maturityStatus: 'mature',
    })
    expect(calibration[0]).not.toHaveProperty('assignedUserId')

    await recordOpportunityOutcome({
      ownerId,
      workspaceId,
      opportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      actorWorkspaceId: workspaceId,
      actorRoleSnapshot: 'owner',
      authMode: 'auth_v2',
      payload: outcomePayload(
        'reverted',
        `analytics:cleanup:${token}`,
        base + 11_000,
        { revertsEventId: finalWon?.event.id ?? null },
      ),
    })
    await updateOpportunityWorkflow({
      ownerId,
      workspaceId,
      opportunityId,
      actorUserId: ownerId,
      actorRole: 'owner',
      idempotencyKey: `analytics:cleanup-workflow:${token}`,
      patch: {
        nextActionDueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    })
  })

  it('serves tenant-scoped Today, follow-up, overdue, and search projections', async () => {
    const names = [
      'OPPORTUNITY_ENGINE_V1_ENABLED',
      'OPPORTUNITY_OUTCOMES_ENABLED',
      'OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED',
      'OPPORTUNITY_WORKFLOW_V1_ENABLED',
    ] as const
    const original = Object.fromEntries(names.map((name) => [name, process.env[name]]))
    try {
      names.forEach((name) => { process.env[name] = 'true' })
      const result = await listOpportunities({
        ownerId,
        workspaceId,
        view: 'today',
        pageSize: 20,
      })
      const opportunity = result.opportunities.find((item) => item.id === opportunityId)
      expect(opportunity?.workflow).toEqual(expect.objectContaining({
        assignedToUserId: secondRecruiterId,
        workflowPriority: 'high',
      }))
      expect(opportunity?.workflow?.internalNote).toBeTruthy()
      expect(JSON.stringify(toPublicOpportunity(opportunity!)))
        .not.toContain(String(opportunity?.workflow?.internalNote))

      const followUp = await listOpportunities({
        ownerId,
        workspaceId,
        view: 'follow_up',
        query: 'Runtime Organization',
        pageSize: 20,
      })
      expect(followUp.opportunities.map((item) => item.id))
        .toContain(opportunityId)

      await updateOpportunityWorkflow({
        ownerId,
        workspaceId,
        opportunityId,
        actorUserId: ownerId,
        actorRole: 'owner',
        idempotencyKey: `runtime-overdue:${token}`,
        patch: {
          nextActionDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
            .toISOString(),
        },
      })
      const overdue = await listOpportunities({
        ownerId,
        workspaceId,
        view: 'overdue',
        pageSize: 20,
      })
      expect(overdue.opportunities.map((item) => item.id))
        .toContain(opportunityId)

      const crossWorkspaceSearch = await listOpportunities({
        ownerId,
        workspaceId: otherWorkspaceId,
        view: 'all',
        query: 'Runtime Organization',
        pageSize: 20,
      })
      expect(crossWorkspaceSearch.opportunities.map((item) => item.id))
        .not.toContain(opportunityId)

      const assignees = await listOpportunityWorkflowAssignees(workspaceId)
      expect(assignees).toEqual(expect.arrayContaining([
        expect.objectContaining({ userId: ownerId, role: 'owner' }),
        expect.objectContaining({ userId: recruiterId, role: 'recruiter' }),
        expect.objectContaining({ userId: secondRecruiterId, role: 'recruiter' }),
      ]))
      expect(JSON.stringify(assignees)).not.toContain('@example.invalid')
    } finally {
      for (const name of names) {
        if (original[name] === undefined) delete process.env[name]
        else process.env[name] = original[name]
      }
    }
  })

  it('rejects forged Commercial Signal metadata without exact lineage', async () => {
    try {
      await database.query(
        `UPDATE opportunities
         SET metadata = $1::JSONB
         WHERE id = $2
           AND owner_id = $3`,
        [
          JSON.stringify({
            commercialSignalCard: {
              version: 'commercial-signal-card-v1',
              scoreVersion: 'opportunity-v3',
              status: 'qualified_needs_enrichment',
            },
          }),
          opportunityId,
          ownerId,
        ],
      )

      const forged = await listOpportunities({
        ownerId,
        workspaceId,
        view: 'all',
        commercialSignalOnly: true,
        pageSize: 20,
      })
      expect(forged.opportunities.map((item) => item.id))
        .not.toContain(opportunityId)

      const otherWorkspace = await listOpportunities({
        ownerId,
        workspaceId: otherWorkspaceId,
        view: 'all',
        commercialSignalOnly: true,
        pageSize: 20,
      })
      expect(otherWorkspace.opportunities.map((item) => item.id))
        .not.toContain(opportunityId)
    } finally {
      await database.query(
        `UPDATE opportunities
         SET metadata = '{}'::JSONB
         WHERE id = $1
           AND owner_id = $2`,
        [opportunityId, ownerId],
      )
    }
  })

  it('does not cross workspace boundaries or rewrite historical actor data', async () => {
    await expect(updateOpportunityWorkflow({
      ownerId,
      workspaceId: otherWorkspaceId,
      opportunityId,
      actorUserId: ownerId,
      actorRole: 'owner',
      idempotencyKey: `workflow-cross-workspace:${token}`,
      patch: { workflowPriority: 'low' },
    })).resolves.toBeNull()

    await database.query(
      `UPDATE workspace_members
       SET status = 'removed', updated_at = NOW()
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, recruiterId],
    )
    await expect(updateOpportunityWorkflow({
      ownerId,
      workspaceId,
      opportunityId,
      actorUserId: recruiterId,
      actorRole: 'recruiter',
      idempotencyKey: `workflow-concurrent:${token}`,
      patch: {
        assignedToUserId: recruiterId,
        nextActionType: 'follow_up',
        nextActionDueAt: concurrentDueAt,
        workflowPriority: 'high',
        internalNote: 'Согласовать следующий шаг внутри команды.',
      },
    })).rejects.toBeInstanceOf(OpportunityWorkflowAccessError)
    const history = await database.query(
      `SELECT actor_user_id::TEXT AS "actorUserId",
              actor_role_snapshot AS "actorRoleSnapshot"
       FROM opportunity_workflow_events
       WHERE owner_id = $1 AND workspace_id = $2 AND opportunity_id = $3
       ORDER BY id ASC
       LIMIT 1`,
      [ownerId, workspaceId, opportunityId],
    )
    expect(history.rows[0]).toEqual({
      actorUserId: recruiterId,
      actorRoleSnapshot: 'recruiter',
    })
  })

  async function ensureWorkspace(userId: string): Promise<string> {
    const result = await database.query(
      `SELECT ensure_auth_user_workspace($1)::TEXT AS id`,
      [userId],
    )
    return String(result.rows[0].id)
  }

  function outcomePayload(
    eventType: OpportunityOutcomeInput['eventType'],
    idempotencyKey: string,
    occurredAt: number,
    override: Partial<OpportunityOutcomeInput> = {},
  ): OpportunityOutcomeInput {
    const metadata: Record<string, string> = eventType === 'shown'
      ? { surface: 'runtime_test', cycleId: idempotencyKey }
      : eventType === 'opened'
        ? { interactionId: idempotencyKey }
        : {}
    return {
      eventType,
      occurredAt: new Date(occurredAt).toISOString(),
      reasonCode: null,
      reasonNote: null,
      channel: null,
      contactPathType: null,
      contactReference: null,
      snoozeDays: null,
      snoozedUntil: null,
      revertsEventId: null,
      valueMinor: null,
      currency: null,
      metadata,
      idempotencyKey,
      ...override,
    }
  }
})
