/** @jest-environment node */

import { createHash } from 'node:crypto'
import { Pool } from 'pg'

import { getPool } from '@/lib/db-pool'
import {
  OutcomeChronologyConflictError,
  OutcomeCorrectionConflictError,
  OutcomeIdempotencyConflictError,
  OutcomeSupersededConflictError,
  OutcomeTransitionConflictError,
  recordOpportunityOutcome,
} from '@/lib/opportunities/outcome-repository'
import type { OpportunityOutcomeInput } from '@/lib/opportunities/outcome-domain'
import { applyOpportunityAction } from '@/lib/opportunities/repository'
import { OpportunityActionConflictError } from '@/lib/opportunities/repository'

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

describeWithDatabase('Opportunity Outcome production PostgreSQL runtime', () => {
  jest.setTimeout(90_000)

  const database = new Pool({ connectionString: process.env.DATABASE_URL })
  const token = `${Date.now()}-${process.pid}`
  const originalEngineFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const originalOutcomeFlag = process.env.OPPORTUNITY_OUTCOMES_ENABLED
  const originalContactHashSecret =
    process.env.OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET
  let ownerId = ''
  let otherOwnerId = ''
  let clientProfileId = ''
  let organizationId = ''
  let opportunityId = ''

  beforeAll(async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET =
      'outcome-runtime-contact-hash-secret-32-bytes-minimum'
    const owners = await database.query(
      `INSERT INTO users (email, full_name)
       VALUES
         ($1, 'Outcome owner'),
         ($2, 'Other outcome owner')
       RETURNING id::TEXT AS id
       `,
      [
        `outcome-runtime-${token}@example.invalid`,
        `outcome-runtime-other-${token}@example.invalid`,
      ],
    )
    ownerId = String(owners.rows[0].id)
    otherOwnerId = String(owners.rows[1].id)
    const profile = await database.query(
      `INSERT INTO client_profiles (agency_name, owner_id)
       VALUES ('Outcome Runtime Agency', $1)
       RETURNING id::TEXT AS id`,
      [ownerId],
    )
    clientProfileId = String(profile.rows[0].id)
    const organization = await database.query(
      `INSERT INTO orgs (name, domain)
       VALUES ('Outcome Runtime Organization', $1)
       RETURNING id::TEXT AS id`,
      [`outcome-runtime-${token}.example.invalid`],
    )
    organizationId = String(organization.rows[0].id)
    const episodeId = await insertEpisode('primary')
    opportunityId = await insertOpportunity(episodeId, 'primary')
  })

  afterAll(async () => {
    await database.end()
    const sharedPool = getPool()
    if (sharedPool) await sharedPool.end()
    delete (globalThis as typeof globalThis & {
      recruiterRadarSharedPool?: Pool
    }).recruiterRadarSharedPool
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', originalEngineFlag)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', originalOutcomeFlag)
    restore(
      'OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET',
      originalContactHashSecret,
    )
  })

  it('records the full funnel atomically and preserves outcome history', async () => {
    const base = Date.now() - 60_000
    await expect(record('contacted', 1, { channel: 'email' }))
      .rejects.toBeInstanceOf(OutcomeTransitionConflictError)
    await expect(record('replied', 2))
      .rejects.toBeInstanceOf(OutcomeTransitionConflictError)

    const accepted = await applyOpportunityAction({
      ownerId,
      opportunityId,
      action: 'accepted',
      actionKey: `accepted:${token}`,
      occurredAt: new Date(base + 3_000).toISOString(),
    })
    expect(accepted?.idempotent).toBe(false)
    const acceptedReplay = await applyOpportunityAction({
      ownerId,
      opportunityId,
      action: 'accepted',
      actionKey: `accepted:${token}`,
      occurredAt: new Date(base + 3_000).toISOString(),
    })
    expect(acceptedReplay?.idempotent).toBe(true)

    const acceptedState = await database.query(
      `SELECT
         opportunity.status,
         state.current_stage AS "outcomeStage",
         episode_state.status AS "episodeStage",
         state.contacted_at AS "contactedAt",
         COUNT(event.id)::INTEGER AS "eventCount"
       FROM opportunities opportunity
       JOIN opportunity_outcome_state state
         ON state.owner_id = opportunity.owner_id
        AND state.opportunity_id = opportunity.id
       JOIN client_episode_state episode_state
         ON episode_state.owner_id = opportunity.owner_id
        AND episode_state.client_profile_id = opportunity.client_profile_id
        AND episode_state.hiring_episode_id = opportunity.hiring_episode_id
       JOIN opportunity_outcome_events event
         ON event.owner_id = opportunity.owner_id
        AND event.opportunity_id = opportunity.id
       WHERE opportunity.owner_id = $1 AND opportunity.id = $2
       GROUP BY opportunity.status, state.current_stage,
         episode_state.status, state.contacted_at`,
      [ownerId, opportunityId],
    )
    expect(acceptedState.rows[0]).toMatchObject({
      status: 'accepted',
      outcomeStage: 'accepted',
      episodeStage: 'accepted',
      contactedAt: null,
      eventCount: 1,
    })

    await applyOpportunityAction({
      ownerId,
      opportunityId,
      action: 'contacted',
      actionKey: `contacted:${token}`,
      channel: 'email',
      contactPathType: 'corporate_email',
      contactReference: 'not-returned@example.invalid',
      occurredAt: new Date(base + 4_000).toISOString(),
    })
    await recordAt('replied', base + 5_000)
    await recordAt('meeting', base + 6_000, {
      metadata: { meetingStatus: 'scheduled' },
    })
    await recordAt('proposal', base + 7_000)
    await recordAt('won', base + 8_000, {
      valueMinor: 35_000_000,
      currency: 'RUB',
    })

    const wonState = await database.query(
      `SELECT
         current_stage AS "currentStage",
         deal_value_minor::TEXT AS "dealValueMinor",
         currency,
         accepted_at IS NOT NULL AS accepted,
         contacted_at IS NOT NULL AS contacted,
         replied_at IS NOT NULL AS replied,
         meeting_at IS NOT NULL AS meeting,
         proposal_at IS NOT NULL AS proposal,
         won_at IS NOT NULL AS won
       FROM opportunity_outcome_state
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [ownerId, opportunityId],
    )
    expect(wonState.rows[0]).toEqual({
      currentStage: 'won',
      dealValueMinor: '35000000',
      currency: 'RUB',
      accepted: true,
      contacted: true,
      replied: true,
      meeting: true,
      proposal: true,
      won: true,
    })
    await expect(recordAt('accepted', base + 9_000))
      .rejects.toBeInstanceOf(OutcomeTransitionConflictError)

    const snapshotBefore = await database.query(
      `SELECT analytics_snapshot AS snapshot
       FROM opportunity_outcome_events
       WHERE owner_id = $1 AND opportunity_id = $2 AND event_type = 'won'`,
      [ownerId, opportunityId],
    )
    await database.query(
      `UPDATE opportunities
       SET opportunity_score = 0.11, scoring_version = 'opportunity-v99'
       WHERE owner_id = $1 AND id = $2`,
      [ownerId, opportunityId],
    )
    const snapshotAfter = await database.query(
      `SELECT analytics_snapshot AS snapshot
       FROM opportunity_outcome_events
       WHERE owner_id = $1 AND opportunity_id = $2 AND event_type = 'won'`,
      [ownerId, opportunityId],
    )
    expect(snapshotAfter.rows[0].snapshot).toEqual(snapshotBefore.rows[0].snapshot)

    await database.query(
      'UPDATE opportunities SET superseded_at = NOW() WHERE id = $1',
      [opportunityId],
    )
    await expect(recordAt('shown', base + 10_000, {
      metadata: { surface: 'morning_brief', cycleId: `after-${token}` },
    })).rejects.toBeInstanceOf(OutcomeSupersededConflictError)
    const history = await database.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM opportunity_outcome_events
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [ownerId, opportunityId],
    )
    expect(history.rows[0].count).toBe(6)
  })

  it('enforces tenant ownership and owner-scoped idempotency', async () => {
    await expect(recordOpportunityOutcome({
      ownerId: otherOwnerId,
      opportunityId,
      actorType: 'user',
      actorUserId: otherOwnerId,
      payload: outcomePayload('opened', `foreign:${token}`, Date.now(), {
        metadata: { interactionId: `foreign-${token}` },
      }),
    })).resolves.toBeNull()

    const episodeId = await insertEpisode('idempotency')
    const nextOpportunityId = await insertOpportunity(episodeId, 'idempotency')
    const key = `idempotency:${token}`
    const replayTimestamp = Date.now()
    const first = await recordOpportunityOutcome({
      ownerId,
      opportunityId: nextOpportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      payload: outcomePayload('shown', key, replayTimestamp, {
        metadata: { surface: 'morning_brief', cycleId: `cycle-${token}` },
      }),
    })
    const replay = await recordOpportunityOutcome({
      ownerId,
      opportunityId: nextOpportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      payload: outcomePayload('shown', key, replayTimestamp, {
        metadata: { surface: 'morning_brief', cycleId: `cycle-${token}` },
      }),
    })
    expect(first?.idempotent).toBe(false)
    expect(replay?.idempotent).toBe(true)

    await expect(recordOpportunityOutcome({
      ownerId,
      opportunityId: nextOpportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      payload: outcomePayload('opened', key, Date.now(), {
        metadata: { interactionId: `opened-${token}` },
      }),
    })).rejects.toBeInstanceOf(OutcomeIdempotencyConflictError)

    const firstConcurrentEpisodeId = await insertEpisode('concurrent-idempotency-a')
    const secondConcurrentEpisodeId = await insertEpisode('concurrent-idempotency-b')
    const firstConcurrentOpportunityId = await insertOpportunity(
      firstConcurrentEpisodeId,
      'concurrent-idempotency-a',
    )
    const secondConcurrentOpportunityId = await insertOpportunity(
      secondConcurrentEpisodeId,
      'concurrent-idempotency-b',
    )
    const concurrentKey = `concurrent-idempotency:${token}`
    const concurrentResults = await Promise.allSettled([
      recordOpportunityOutcome({
        ownerId,
        opportunityId: firstConcurrentOpportunityId,
        actorType: 'user',
        actorUserId: ownerId,
        payload: outcomePayload('accepted', concurrentKey, Date.now()),
      }),
      recordOpportunityOutcome({
        ownerId,
        opportunityId: secondConcurrentOpportunityId,
        actorType: 'user',
        actorUserId: ownerId,
        payload: outcomePayload('accepted', concurrentKey, Date.now()),
      }),
    ])
    expect(concurrentResults.filter((result) =>
      result.status === 'fulfilled')).toHaveLength(1)
    const rejected = concurrentResults.find((result) =>
      result.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(OutcomeIdempotencyConflictError),
    })
  })

  it('fingerprints contact semantics and never stores raw contact values', async () => {
    const episodeId = await insertEpisode('contact-idempotency')
    const contactOpportunityId = await insertOpportunity(
      episodeId,
      'contact-idempotency',
    )
    await applyOpportunityAction({
      ownerId,
      opportunityId: contactOpportunityId,
      action: 'accepted',
      actionKey: `contact-idempotency:accepted:${token}`,
    })
    const actionKey = `contact-idempotency:contacted:${token}`
    await applyOpportunityAction({
      ownerId,
      opportunityId: contactOpportunityId,
      action: 'contacted',
      actionKey,
      channel: 'email',
      contactPathType: 'corporate_email',
      contactReference: 'sales@example.invalid',
    })
    await expect(applyOpportunityAction({
      ownerId,
      opportunityId: contactOpportunityId,
      action: 'contacted',
      actionKey,
      channel: 'email',
      contactPathType: 'corporate_email',
      contactReference: 'another@example.invalid',
    })).rejects.toBeInstanceOf(OpportunityActionConflictError)
    await expect(applyOpportunityAction({
      ownerId,
      opportunityId: contactOpportunityId,
      action: 'contacted',
      actionKey,
      channel: 'phone',
      contactPathType: 'company_phone',
      contactReference: 'sales@example.invalid',
    })).rejects.toBeInstanceOf(OpportunityActionConflictError)

    const stored = await database.query(
      `SELECT
         contact_reference AS raw,
         contact_reference_hash AS hash,
         contact_reference_label AS label
       FROM opportunity_outcome_events
       WHERE owner_id = $1
         AND opportunity_id = $2
         AND event_type = 'contacted'`,
      [ownerId, contactOpportunityId],
    )
    expect(stored.rows[0]).toMatchObject({
      raw: null,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      label: 's***@example.invalid',
    })

    const directEpisodeId = await insertEpisode('direct-contact-idempotency')
    const directOpportunityId = await insertOpportunity(
      directEpisodeId,
      'direct-contact-idempotency',
    )
    const directBase = Date.now() - 5_000
    await recordFor(directOpportunityId, 'accepted', directBase)
    const directKey = `direct-contact:${token}`
    await recordOpportunityOutcome({
      ownerId,
      opportunityId: directOpportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      payload: outcomePayload('contacted', directKey, directBase + 1_000, {
        channel: 'email',
        contactPathType: 'corporate_email',
        contactReference: 'sales@example.invalid',
      }),
    })
    await expect(recordOpportunityOutcome({
      ownerId,
      opportunityId: directOpportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      payload: outcomePayload('contacted', directKey, directBase + 1_000, {
        channel: 'email',
        contactPathType: 'corporate_email',
        contactReference: 'another@example.invalid',
      }),
    })).rejects.toBeInstanceOf(OutcomeIdempotencyConflictError)

    const reasonEpisodeId = await insertEpisode('reason-idempotency')
    const reasonOpportunityId = await insertOpportunity(
      reasonEpisodeId,
      'reason-idempotency',
    )
    const reasonKey = `reason-idempotency:${token}`
    await applyOpportunityAction({
      ownerId,
      opportunityId: reasonOpportunityId,
      action: 'dismissed',
      actionKey: reasonKey,
      reasonCode: 'bad_fit',
    })
    await expect(applyOpportunityAction({
      ownerId,
      opportunityId: reasonOpportunityId,
      action: 'dismissed',
      actionKey: reasonKey,
      reasonCode: 'wrong_roles',
    })).rejects.toBeInstanceOf(OpportunityActionConflictError)

    const snoozeEpisodeId = await insertEpisode('snooze-idempotency')
    const snoozeOpportunityId = await insertOpportunity(
      snoozeEpisodeId,
      'snooze-idempotency',
    )
    const snoozeKey = `snooze-idempotency:${token}`
    await applyOpportunityAction({
      ownerId,
      opportunityId: snoozeOpportunityId,
      action: 'snoozed',
      actionKey: snoozeKey,
      snoozeDays: 3,
    })
    await expect(applyOpportunityAction({
      ownerId,
      opportunityId: snoozeOpportunityId,
      action: 'snoozed',
      actionKey: snoozeKey,
      snoozeDays: 7,
    })).rejects.toBeInstanceOf(OpportunityActionConflictError)
  })

  it('preserves commercial stage through snooze and explicit resume', async () => {
    const episodeId = await insertEpisode('workflow')
    const workflowOpportunityId = await insertOpportunity(episodeId, 'workflow')
    const base = Date.now() - 30_000
    await recordFor(workflowOpportunityId, 'accepted', base + 1_000)
    await recordFor(workflowOpportunityId, 'contacted', base + 2_000, {
      channel: 'email',
      contactPathType: 'corporate_email',
    })
    await recordFor(workflowOpportunityId, 'snoozed', base + 3_000, {
      snoozeDays: 3,
    })
    await expect(recordFor(
      workflowOpportunityId,
      'replied',
      base + 4_000,
    )).rejects.toBeInstanceOf(OutcomeTransitionConflictError)

    const snoozed = await database.query(
      `SELECT
         commercial_stage AS "commercialStage",
         workflow_state AS "workflowState",
         snoozed_until IS NOT NULL AS "hasDeadline"
       FROM opportunity_outcome_state
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [ownerId, workflowOpportunityId],
    )
    expect(snoozed.rows[0]).toEqual({
      commercialStage: 'contacted',
      workflowState: 'snoozed',
      hasDeadline: true,
    })

    await recordFor(workflowOpportunityId, 'resumed', base + 4_000)
    await recordFor(workflowOpportunityId, 'replied', base + 5_000)
    const resumed = await database.query(
      `SELECT commercial_stage AS "commercialStage",
         workflow_state AS "workflowState"
       FROM opportunity_outcome_state
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [ownerId, workflowOpportunityId],
    )
    expect(resumed.rows[0]).toEqual({
      commercialStage: 'replied',
      workflowState: 'active',
    })
  })

  it('rejects backdated commercial events but permits observational backfill', async () => {
    const episodeId = await insertEpisode('chronology')
    const chronologyOpportunityId = await insertOpportunity(
      episodeId,
      'chronology',
    )
    const acceptedAt = Date.now() - 10_000
    await recordFor(chronologyOpportunityId, 'accepted', acceptedAt)
    await expect(recordFor(
      chronologyOpportunityId,
      'contacted',
      acceptedAt - 10_000,
      { channel: 'phone' },
    )).rejects.toBeInstanceOf(OutcomeChronologyConflictError)
    await expect(recordFor(
      chronologyOpportunityId,
      'opened',
      acceptedAt - 20_000,
      { metadata: { interactionId: `backfill:${token}` } },
    )).resolves.toMatchObject({ idempotent: false })
  })

  it('rejects an interaction dedupe replay with different semantic payload', async () => {
    const episodeId = await insertEpisode('interaction-dedupe')
    const interactionOpportunityId = await insertOpportunity(
      episodeId,
      'interaction-dedupe',
    )
    const firstAt = Date.now() - 10_000
    const interactionId = `interaction-dedupe:${token}`
    await recordOpportunityOutcome({
      ownerId,
      opportunityId: interactionOpportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      payload: outcomePayload(
        'opened',
        `interaction-dedupe:first:${token}`,
        firstAt,
        { metadata: { interactionId } },
      ),
    })
    await expect(recordOpportunityOutcome({
      ownerId,
      opportunityId: interactionOpportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      payload: outcomePayload(
        'opened',
        `interaction-dedupe:second:${token}`,
        firstAt + 1_000,
        { metadata: { interactionId } },
      ),
    })).rejects.toBeInstanceOf(OutcomeIdempotencyConflictError)
  })

  it('keeps meeting cancellation and no-show observational', async () => {
    const episodeId = await insertEpisode('meeting-observations')
    const meetingOpportunityId = await insertOpportunity(
      episodeId,
      'meeting-observations',
    )
    const base = Date.now() - 10_000
    await expect(recordFor(
      meetingOpportunityId,
      'meeting_cancelled',
      base - 1_000,
    )).rejects.toBeInstanceOf(OutcomeTransitionConflictError)
    await recordFor(meetingOpportunityId, 'accepted', base)
    await recordFor(meetingOpportunityId, 'contacted', base + 1_000, {
      channel: 'email',
      contactPathType: 'corporate_email',
    })
    await recordFor(meetingOpportunityId, 'replied', base + 2_000)
    await recordFor(meetingOpportunityId, 'meeting', base + 3_000, {
      metadata: { meetingStatus: 'scheduled' },
    })
    await recordFor(meetingOpportunityId, 'meeting_cancelled', base + 4_000)
    await expect(recordFor(
      meetingOpportunityId,
      'meeting_no_show',
      base + 5_000,
    )).rejects.toBeInstanceOf(OutcomeTransitionConflictError)

    const state = await database.query(
      `SELECT commercial_stage AS "commercialStage",
         meeting_at IS NOT NULL AS "meetingRecorded"
       FROM opportunity_outcome_state
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [ownerId, meetingOpportunityId],
    )
    expect(state.rows[0]).toEqual({
      commercialStage: 'meeting',
      meetingRecorded: true,
    })
  })

  it('reverts only the latest commercial event append-only', async () => {
    const episodeId = await insertEpisode('correction')
    const correctionOpportunityId = await insertOpportunity(
      episodeId,
      'correction',
    )
    const base = Date.now() - 10_000
    const accepted = await recordFor(
      correctionOpportunityId,
      'accepted',
      base,
    )
    const contacted = await recordFor(
      correctionOpportunityId,
      'contacted',
      base + 1_000,
      { channel: 'email' },
    )
    await expect(recordFor(
      correctionOpportunityId,
      'reverted',
      base + 2_000,
      { revertsEventId: accepted?.event.id ?? null },
    )).rejects.toBeInstanceOf(OutcomeCorrectionConflictError)

    const correction = await recordFor(
      correctionOpportunityId,
      'reverted',
      base + 2_000,
      { revertsEventId: contacted?.event.id ?? null },
    )
    expect(correction?.state).toMatchObject({
      commercialStage: 'accepted',
      contactedAt: null,
    })
    const audit = await database.query(
      `SELECT event_type
       FROM opportunity_outcome_events
       WHERE owner_id = $1 AND opportunity_id = $2
       ORDER BY id`,
      [ownerId, correctionOpportunityId],
    )
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      'accepted',
      'contacted',
      'reverted',
    ])
  })

  it('rolls back the ledger insert when projection persistence fails', async () => {
    const episodeId = await insertEpisode('rollback')
    const rollbackOpportunityId = await insertOpportunity(episodeId, 'rollback')
    await database.query(`
      CREATE OR REPLACE FUNCTION fail_outcome_projection_for_test()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.opportunity_id = ${rollbackOpportunityId} THEN
          RAISE EXCEPTION 'projection failure fixture';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_outcome_projection_for_test
      BEFORE INSERT OR UPDATE ON opportunity_outcome_state
      FOR EACH ROW EXECUTE FUNCTION fail_outcome_projection_for_test();
    `)
    try {
      await expect(recordOpportunityOutcome({
        ownerId,
        opportunityId: rollbackOpportunityId,
        actorType: 'user',
        actorUserId: ownerId,
        payload: outcomePayload('accepted', `rollback:${token}`, Date.now()),
      })).rejects.toThrow('projection failure fixture')
      const events = await database.query(
        `SELECT COUNT(*)::INTEGER AS count
         FROM opportunity_outcome_events
         WHERE owner_id = $1 AND opportunity_id = $2`,
        [ownerId, rollbackOpportunityId],
      )
      expect(events.rows[0].count).toBe(0)
    } finally {
      await database.query(`
        DROP TRIGGER IF EXISTS fail_outcome_projection_for_test
          ON opportunity_outcome_state;
        DROP FUNCTION IF EXISTS fail_outcome_projection_for_test();
      `)
    }
  })

  it('enforces append-only and composite tenant constraints in PostgreSQL', async () => {
    await expect(database.query(
      `UPDATE opportunity_outcome_events
       SET metadata = '{"source":"tampered"}'::jsonb
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [ownerId, opportunityId],
    )).rejects.toThrow('append-only')
    await expect(database.query(
      `DELETE FROM opportunity_outcome_events
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [ownerId, opportunityId],
    )).rejects.toThrow('append-only')

    await expect(database.query(
      `INSERT INTO opportunity_outcome_events (
         owner_id, client_profile_id, opportunity_id, hiring_episode_id,
         organization_id, event_type, previous_stage, new_stage,
         occurred_at, actor_type, metadata, analytics_snapshot,
         idempotency_key, payload_hash
       )
       SELECT
         $1, client_profile_id, id, hiring_episode_id, organization_id,
         'opened', 'new', 'new', NOW(), 'external', '{}'::jsonb, '{}'::jsonb,
         $2, repeat('a', 64)
       FROM opportunities
       WHERE id = $3`,
      [otherOwnerId, `tenant-substitution:${token}`, opportunityId],
    )).rejects.toThrow()

    await expect(database.query(
      `INSERT INTO opportunity_outcome_events (
         owner_id, client_profile_id, opportunity_id, hiring_episode_id,
         organization_id, event_type, previous_stage, new_stage,
         occurred_at, actor_type, metadata, analytics_snapshot,
         idempotency_key, payload_hash
       )
       SELECT
         owner_id, client_profile_id, id, hiring_episode_id, organization_id,
         'dismissed', 'new', 'dismissed', NOW(), 'external',
         '{}'::jsonb, '{}'::jsonb, $2, repeat('b', 64)
       FROM opportunities
       WHERE id = $1`,
      [opportunityId, `missing-reason:${token}`],
    )).rejects.toThrow()

    const firstEpisodeId = await insertEpisode('projection-reference-a')
    const secondEpisodeId = await insertEpisode('projection-reference-b')
    const firstOpportunityId = await insertOpportunity(
      firstEpisodeId,
      'projection-reference-a',
    )
    const secondOpportunityId = await insertOpportunity(
      secondEpisodeId,
      'projection-reference-b',
    )
    const firstEvent = await recordFor(firstOpportunityId, 'shown', Date.now(), {
      metadata: { surface: 'morning_brief', cycleId: `projection-a:${token}` },
    })
    const secondEvent = await recordFor(
      secondOpportunityId,
      'shown',
      Date.now(),
      {
        metadata: {
          surface: 'morning_brief',
          cycleId: `projection-b:${token}`,
        },
      },
    )
    await expect(database.query(
      `UPDATE opportunity_outcome_state
       SET last_event_id = $3
       WHERE owner_id = $1 AND opportunity_id = $2`,
      [ownerId, firstOpportunityId, secondEvent?.event.id],
    )).rejects.toThrow()

    await expect(database.query(
      `INSERT INTO opportunity_outcome_events (
         owner_id, client_profile_id, opportunity_id, hiring_episode_id,
         organization_id, event_type, previous_stage, new_stage,
         reverts_event_id, occurred_at, actor_type, metadata,
         analytics_snapshot, idempotency_key, payload_hash
       )
       SELECT
         owner_id, client_profile_id, id, hiring_episode_id, organization_id,
         'reverted', 'new', 'new', $2, NOW(), 'system',
         '{}'::jsonb, '{}'::jsonb, $3, repeat('c', 64)
       FROM opportunities
       WHERE id = $1`,
      [
        firstOpportunityId,
        firstEvent?.event.id,
        `invalid-observational-correction:${token}`,
      ],
    )).rejects.toThrow()

    await expect(database.query(
      `INSERT INTO opportunity_outcome_events (
         owner_id, client_profile_id, opportunity_id, hiring_episode_id,
         organization_id, event_type, previous_stage, new_stage,
         occurred_at, actor_type, actor_user_id, metadata,
         analytics_snapshot, idempotency_key, payload_hash
       )
       SELECT
         owner_id, client_profile_id, id, hiring_episode_id, organization_id,
         'opened', 'new', 'new', NOW(), 'system', owner_id,
         '{}'::JSONB, '{}'::JSONB, $2, repeat('d', 64)
       FROM opportunities
       WHERE id = $1`,
      [firstOpportunityId, `invalid-system-actor:${token}`],
    )).rejects.toThrow()

    await expect(database.query(
      `INSERT INTO opportunity_outcome_events (
         owner_id, client_profile_id, opportunity_id, hiring_episode_id,
         organization_id, event_type, previous_stage, new_stage,
         reason_code, occurred_at, actor_type, metadata, analytics_snapshot,
         idempotency_key, payload_hash
       )
       SELECT
         owner_id, client_profile_id, id, hiring_episode_id, organization_id,
         'lost', 'proposal', 'lost', 'price', NOW(), 'system',
         '{}'::jsonb, '{}'::jsonb, $2, repeat('e', 64)
       FROM opportunities
       WHERE id = $1`,
      [opportunityId, `conflicting-terminal:${token}`],
    )).rejects.toThrow()
  })

  async function insertEpisode(suffix: string): Promise<string> {
    const episode = await database.query(
      `INSERT INTO hiring_episodes (
         organization_id, episode_type, episode_key, episode_identity,
         episode_generation, title, summary, started_at, last_seen_at,
         signal_count, vacancy_count, strength_score, freshness_score,
         evidence_hash, engine_version
       )
       VALUES (
         $1, 'vacancy_spike', $2, $3, 1,
         'Outcome runtime episode', 'Outcome runtime episode',
         NOW() - INTERVAL '1 day', NOW(), 1, 3, 0.8, 0.9, $4,
         'hiring-episode-v1'
       )
       RETURNING id::TEXT AS id`,
      [
        organizationId,
        `outcome:${suffix}:${token}`,
        `${organizationId}:outcome:${suffix}:${token}`,
        hash(`evidence:${suffix}:${token}`),
      ],
    )
    return String(episode.rows[0].id)
  }

  async function insertOpportunity(episodeId: string, suffix: string): Promise<string> {
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
         $1, $2, $3, $4, 'new', 'Outcome runtime opportunity',
         'Fresh evidence', 'External support may be useful', 'Narrow offer',
         'Head of recruiting', 'Prepare a draft', 0.8, 0.9, 0.7, 0.9,
         0.8, 0.9, 0.83, 'A', 'opportunity-v1', $5,
         NOW() + INTERVAL '14 days', $5, $6, 'fiur-v1', $7,
         'opportunity-brief-v1', $8
       )
       RETURNING id::TEXT AS id`,
      [
        ownerId,
        clientProfileId,
        organizationId,
        episodeId,
        hash(`episode:${suffix}:${token}`),
        hash(`profile:${token}`),
        hash('scoring-config'),
        hash(`input:${suffix}:${token}`),
      ],
    )
    return String(opportunity.rows[0].id)
  }

  function record(
    eventType: Parameters<typeof outcomePayload>[0],
    offset: number,
    override: Partial<OpportunityOutcomeInput> = {},
  ) {
    return recordAt(eventType, Date.now() - 60_000 + offset * 1_000, override)
  }

  function recordAt(
    eventType: Parameters<typeof outcomePayload>[0],
    occurredAt: number,
    override: Partial<OpportunityOutcomeInput> = {},
  ) {
    return recordOpportunityOutcome({
      ownerId,
      opportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      payload: outcomePayload(
        eventType,
        `${eventType}:${token}:${occurredAt}`,
        occurredAt,
        override,
      ),
    })
  }

  function recordFor(
    targetOpportunityId: string,
    eventType: OpportunityOutcomeInput['eventType'],
    occurredAt: number,
    override: Partial<OpportunityOutcomeInput> = {},
  ) {
    return recordOpportunityOutcome({
      ownerId,
      opportunityId: targetOpportunityId,
      actorType: 'user',
      actorUserId: ownerId,
      payload: outcomePayload(
        eventType,
        `${eventType}:${targetOpportunityId}:${token}:${occurredAt}`,
        occurredAt,
        override,
      ),
    })
  }
})

function outcomePayload(
  eventType: OpportunityOutcomeInput['eventType'],
  idempotencyKey: string,
  occurredAt: number,
  override: Partial<OpportunityOutcomeInput> = {},
): OpportunityOutcomeInput {
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
    metadata: {},
    idempotencyKey,
    ...override,
  }
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
