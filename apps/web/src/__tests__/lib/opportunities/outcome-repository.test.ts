import { getClient } from '@/lib/db-pool'
import {
  OutcomeIdempotencyConflictError,
  OutcomeTransitionConflictError,
  getOpportunityOutcomeHistory,
  getOutcomeFunnelSummary,
  recordOpportunityOutcome,
} from '@/lib/opportunities/outcome-repository'

jest.mock('@/lib/db-pool', () => ({
  getClient: jest.fn(),
  getPool: jest.fn(() => null),
}))

type OpportunityClient = NonNullable<Awaited<ReturnType<typeof getClient>>>

function clientFrom(query: jest.Mock, release = jest.fn()): OpportunityClient {
  return { query, release } as unknown as OpportunityClient
}

const opportunityContext = {
  id: '10',
  ownerId: '7',
  workspaceId: '9',
  clientProfileId: '8',
  organizationId: '9',
  hiringEpisodeId: '11',
  status: 'new',
  supersededAt: null,
  scoringVersion: 'opportunity-v1',
  confidenceGate: 'A',
  opportunityScore: 0.84,
  externalSupportNeedScore: 0.8,
  episodeType: 'vacancy_spike',
  profileSnapshotHash: 'b'.repeat(64),
  analyticsCohort: {
    clientProfileId: '8',
    clientProfileVersion: 'b'.repeat(64),
    agencyDnaVersion: 'b'.repeat(64),
    hiringMode: 'auto',
    specialization: 'it recruitment',
    matchedRoleFamilies: ['backend'],
    matchedIndustries: ['it'],
    matchedRegions: ['москва'],
    organizationSizeBucket: 'unknown',
    episodeType: 'vacancy_spike',
    confidenceGate: 'A',
    scoreBucket: '80-89',
    externalSupportNeedBucket: 'high',
    sourceFamilies: ['career-pages', 'hh'],
    scoringVersion: 'opportunity-v1',
  },
}

function successfulQuery(options: { projectionFails?: boolean } = {}) {
  return jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('FROM opportunities o') && sql.includes('FOR UPDATE')) {
      return { rowCount: 1, rows: [opportunityContext] }
    }
    if (sql.includes('FROM opportunity_outcome_events') && sql.includes('idempotency_key')) {
      return { rowCount: 0, rows: [] }
    }
    if (sql.includes('FROM opportunity_outcome_state') && sql.includes('FOR UPDATE')) {
      return { rowCount: 0, rows: [] }
    }
    if (sql.includes('ARRAY_AGG')) {
      return { rowCount: 1, rows: [{ sourceFamilies: ['career-pages', 'hh'] }] }
    }
    if (sql.includes('INSERT INTO opportunity_outcome_events')) {
      return { rowCount: 1, rows: [{ id: '21', recordedAt: '2026-07-27T12:00:01.000Z' }] }
    }
    if (sql.includes('INSERT INTO opportunity_outcome_state')) {
      if (options.projectionFails) throw new Error('projection failed')
      return { rowCount: 1, rows: [] }
    }
    return { rowCount: 1, rows: [] }
  })
}

describe('opportunity outcome repository', () => {
  it('records accepted and updates projection plus legacy state atomically', async () => {
    const query = successfulQuery()
    const release = jest.fn()
    jest.mocked(getClient).mockResolvedValue(clientFrom(query, release))

    const result = await recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'accepted:request-1',
        metadata: {},
      },
    })

    expect(result).toMatchObject({
      idempotent: false,
      event: { id: '21', eventType: 'accepted', newStage: 'accepted' },
      state: { currentStage: 'accepted' },
    })
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_state'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('UPDATE opportunities'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO client_episode_state'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('records the real Auth v2 actor and immutable workspace role snapshot', async () => {
    const query = successfulQuery()
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await recordOpportunityOutcome({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '42',
      actorWorkspaceId: '9',
      actorRoleSnapshot: 'recruiter',
      authMode: 'auth_v2',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'accepted:workspace-actor',
        metadata: {},
      },
    })

    const contextRead = query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM opportunities o') &&
      String(sql).includes('FOR UPDATE'))
    expect(String(contextRead?.[0])).toContain('o.workspace_id = $3')
    expect(contextRead?.[1]).toEqual(['10', '7', '9'])

    const eventInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'))
    expect(String(eventInsert?.[0])).toContain('actor_workspace_id')
    expect(String(eventInsert?.[0])).toContain('actor_role_snapshot')
    expect(eventInsert?.[1]).toEqual(expect.arrayContaining([
      '42',
      '9',
      'recruiter',
    ]))
    expect(JSON.parse(String(eventInsert?.[1]?.[27]))).toEqual(
      opportunityContext.analyticsCohort,
    )
  })

  it('normalizes adapter fingerprints to protected contact hashes', async () => {
    const baseQuery = successfulQuery()
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM opportunity_outcome_state') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rowCount: 1,
          rows: [{
            commercialStage: 'accepted',
            currentStage: 'accepted',
            workflowState: 'active',
            meetingStatus: 'none',
          }],
        }
      }
      return baseQuery(sql, params)
    })
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))
    const occurredAt = new Date(Date.now() - 60_000).toISOString()
    const previousSecret = process.env.OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET
    process.env.OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET = 'a'.repeat(32)
    const payload = {
      eventType: 'contacted',
      occurredAt,
      channel: 'email',
      contactPathType: 'corporate_email',
      contactReference: 'hr@example.test',
      idempotencyKey: 'contacted:legacy-key',
      metadata: { source: 'legacy_action' },
    }

    try {
      await recordOpportunityOutcome({
        ownerId: '7',
        opportunityId: '10',
        actorType: 'user',
        actorUserId: '7',
        payload,
        idempotencyPayload: {
          ...payload,
          occurredAt: undefined,
          snoozedUntil: undefined,
        },
      })
    } finally {
      if (previousSecret === undefined) {
        delete process.env.OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET
      } else {
        process.env.OPPORTUNITY_OUTCOME_CONTACT_HASH_SECRET = previousSecret
      }
    }

    const eventInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'))
    const payloadHash = String(eventInsert?.[1]?.[30])
    expect(payloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(payloadHash).not.toContain('hr@example.test')
  })

  it('workspace-scopes funnel events through their opportunity tenant', async () => {
    const query = jest.fn(async (sql: string, params?: readonly unknown[]) => {
      expect(sql).toContain('JOIN opportunities scoped_opportunity')
      expect(sql).toContain('scoped_opportunity.workspace_id = $5')
      expect(params?.slice(0, 5)).toEqual([
        '7',
        '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
        'shown',
        '9',
      ])
      return {
        rowCount: 1,
        rows: [{
          cohortSize: '0',
          effectiveActivity: [],
          ledgerActivity: [],
          correctionsCount: '0',
          cohortCounts: {},
          conversionHours: {},
        }],
      }
    })

    await getOutcomeFunnelSummary({
      ownerId: '7',
      workspaceId: '9',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    }, { query } as never)
  })

  it('rejects incomplete Auth v2 actor attribution before inserting an event', async () => {
    const query = successfulQuery()
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '42',
      actorWorkspaceId: '9',
      actorRoleSnapshot: null,
      authMode: 'auth_v2',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'accepted:missing-role',
        metadata: {},
      },
    })).rejects.toThrow('Auth v2 outcome actor context is incomplete.')

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'),
    )).toBe(false)
  })

  it('keeps legacy user attribution owner-scoped', async () => {
    const query = successfulQuery()
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '42',
      authMode: 'legacy',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'accepted:legacy-foreign-actor',
        metadata: {},
      },
    })).rejects.toThrow('User outcome actor must match the tenant owner.')
  })

  it('does not treat accepted as contacted', async () => {
    const query = successfulQuery()
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'accepted:request-2',
        metadata: {},
      },
    })

    const eventInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'))
    expect(eventInsert?.[1]).toContain('accepted')
    expect(eventInsert?.[1]).not.toContain('contacted')
  })

  it('rejects replied before contacted without inserting a ledger event', async () => {
    const query = successfulQuery()
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'replied',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'replied:too-soon',
        metadata: {},
      },
    })).rejects.toBeInstanceOf(OutcomeTransitionConflictError)

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'),
    )).toBe(false)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true)
  })

  it('returns null for an unavailable tenant opportunity', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM opportunities o') && sql.includes('FOR UPDATE')) {
        return { rowCount: 0, rows: [] }
      }
      return { rowCount: 0, rows: [] }
    })
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '999',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'opened',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'opened:foreign',
        metadata: { interactionId: 'view-1' },
      },
    })).resolves.toBeNull()

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'),
    )).toBe(false)
  })

  it('rejects reuse of an owner idempotency key with another payload', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM opportunities o') && sql.includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [opportunityContext] }
      }
      if (sql.includes('FROM opportunity_outcome_events') && sql.includes('idempotency_key')) {
        return { rowCount: 1, rows: [{ id: '20', payloadHash: '0'.repeat(64) }] }
      }
      return { rowCount: 0, rows: [] }
    })
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'reused',
        metadata: {},
      },
    })).rejects.toBeInstanceOf(OutcomeIdempotencyConflictError)
  })

  it('rolls back the ledger insert when projection update fails', async () => {
    const query = successfulQuery({ projectionFails: true })
    jest.mocked(getClient).mockResolvedValue(clientFrom(query))

    await expect(recordOpportunityOutcome({
      ownerId: '7',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '7',
      payload: {
        eventType: 'accepted',
        occurredAt: '2026-07-27T12:00:00.000Z',
        idempotencyKey: 'accepted:projection-failure',
        metadata: {},
      },
    })).rejects.toThrow('projection failed')

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO opportunity_outcome_events'),
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true)
    expect(query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(false)
  })
})

describe('opportunity outcome funnel', () => {
  it('scopes analytics to owner and controlled snapshot filters', async () => {
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({
      rowCount: 1,
      rows: [{
        cohortSize: '20',
        effectiveActivityCounts: JSON.stringify([
          { eventType: 'shown', eventCount: '21', opportunityCount: '20' },
          { eventType: 'opened', eventCount: '16', opportunityCount: '15' },
        ]),
        ledgerActivityCounts: JSON.stringify([
          { eventType: 'shown', eventCount: '22', opportunityCount: '20' },
          { eventType: 'reverted', eventCount: '1', opportunityCount: '1' },
        ]),
        correctionsCount: '1',
        shownCohortCount: '20', openedCohortCount: '15',
        acceptedCohortCount: '10', contactedCohortCount: '8',
        repliedCohortCount: '4', meetingCohortCount: '3',
        proposalCohortCount: '2', wonCohortCount: '1',
        lostCohortCount: '4',
        shownOpenedPairs: '15', shownOpenedMedianHours: '2.50',
        openedAcceptedPairs: '10', openedAcceptedMedianHours: '5.00',
        acceptedContactedPairs: '8', acceptedContactedMedianHours: '12.00',
        contactedRepliedPairs: '4', contactedRepliedMedianHours: '24.00',
        repliedMeetingPairs: '3', repliedMeetingMedianHours: '48.00',
        meetingProposalPairs: '2', meetingProposalMedianHours: '72.00',
        proposalWonPairs: '1', proposalWonMedianHours: '96.00',
      }],
    }))

    const summary = await getOutcomeFunnelSummary({
      ownerId: '7',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      episodeType: 'vacancy_spike',
      clientProfileId: '8',
      clientProfileVersion: 'b'.repeat(64),
      agencyDnaVersion: 'c'.repeat(64),
      hiringMode: 'auto',
      specialization: 'it recruitment',
      matchedRoleFamily: 'backend',
      matchedIndustry: 'it',
      matchedRegion: 'москва',
      organizationSizeBucket: 'unknown',
      confidenceGate: 'A',
      sourceFamily: 'hh',
      scoreBucket: '80-89',
      externalSupportNeedBucket: 'high',
      scoringVersion: 'opportunity-v1',
      maturityDays: 30,
    }, { query } as never)

    expect(String(query.mock.calls[0]?.[0])).toContain('owner_id = $1')
    expect(query.mock.calls[0]?.[1]).toEqual([
      '7', '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
      'shown', '8', 'b'.repeat(64), 'c'.repeat(64), 'auto',
      'it recruitment', 'backend', 'it', 'москва', 'unknown',
      'vacancy_spike', 'A', '80-89', 'hh', 'high', 'opportunity-v1',
    ])
    expect(String(query.mock.calls[0]?.[0])).toContain(
      `cohort_snapshot->'matchedRoleFamilies' ?`,
    )
    expect(String(query.mock.calls[0]?.[0])).toContain(
      `cohort_snapshot->>'agencyDnaVersion'`,
    )
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'JOIN active_events event USING (opportunity_id)',
    )
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'ROW_NUMBER() OVER',
    )
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'cohort_at >= $2::timestamptz',
    )
    expect(String(query.mock.calls[0]?.[0])).not.toContain('LEAST(')
    expect(summary.effectiveActivityCounts).toEqual([
      {
        eventType: 'shown',
        label: 'Показано',
        eventCount: 21,
        opportunityCount: 20,
      },
      {
        eventType: 'opened',
        label: 'Открыто',
        eventCount: 16,
        opportunityCount: 15,
      },
    ])
    expect(summary.ledgerActivityCounts).toEqual([
      {
        eventType: 'shown',
        label: 'Показано',
        eventCount: 22,
        opportunityCount: 20,
      },
      {
        eventType: 'reverted',
        label: 'Последнее изменение отменено',
        eventCount: 1,
        opportunityCount: 1,
      },
    ])
    expect(summary.correctionsCount).toBe(1)
    expect(summary.cohort).toMatchObject({
      policy: 'first_effective_event_ever_closed_window',
      cohortAgeDays: 31,
      observationWindowDays: 31,
      matured: true,
      maturityThresholdDays: 30,
    })
    expect(summary.cohortCounts.find((stage) =>
      stage.eventType === 'shown')?.count)
      .toBe(20)
    expect(summary.conversions[0]).toMatchObject({
      from: 'shown', to: 'opened', sampleSize: 20, converted: 15,
      rate: 0.75, medianHours: 2.5, status: 'ready',
    })
  })

  it('does not present small-sample conversion as significant', async () => {
    const query = jest.fn(async () => ({
      rowCount: 1,
      rows: [{
        cohortSize: '4',
        cohortFirstAt: '2026-07-25T00:00:00.000Z',
        shownCohortCount: '4',
        openedCohortCount: '3',
        shownOpenedPairs: '3',
      }],
    }))
    const summary = await getOutcomeFunnelSummary({
      ownerId: '7',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      maturityDays: 30,
    }, { query } as never)

    expect(summary.conversions[0]).toMatchObject({
      sampleSize: 4,
      converted: 3,
      rate: null,
      medianHours: null,
      status: 'insufficient_data',
      sampleStatus: 'insufficient_data',
      maturityStatus: 'immature',
    })
    expect(summary.cohort.matured).toBe(false)
  })

  it('omits discovery transitions for an accepted cohort', async () => {
    const query = jest.fn(async () => ({
      rowCount: 1,
      rows: [{
        cohortSize: '12',
        cohortFirstAt: '2026-07-01T00:00:00.000Z',
        cohortLastAt: '2026-07-01T00:00:00.000Z',
        acceptedCohortCount: '12',
        contactedCohortCount: '10',
        repliedCohortCount: '8',
        meetingCohortCount: '6',
        proposalCohortCount: '4',
        wonCohortCount: '6',
        lostCohortCount: '6',
        acceptedContactedPairs: '10',
        contactedRepliedPairs: '8',
        repliedMeetingPairs: '6',
        meetingProposalPairs: '4',
        proposalWonPairs: '2',
      }],
    }))

    const summary = await getOutcomeFunnelSummary({
      ownerId: '7',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      cohort: 'accepted',
    }, { query } as never)

    expect(summary.cohortCounts.map((stage) => stage.eventType)).toEqual([
      'accepted', 'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost',
    ])
    expect(summary.conversions.map(({ from, to }) => `${from}:${to}`)).toEqual([
      'accepted:contacted',
      'contacted:replied',
      'replied:meeting',
      'meeting:proposal',
      'proposal:won',
      'contacted:lost',
      'replied:lost',
      'meeting:lost',
      'proposal:lost',
    ])
    expect(summary.terminalOutcomes).toMatchObject({
      completed: 12,
      winRate: 0.5,
      denominator: 'effective_won_plus_lost',
    })
  })
})

describe('opportunity outcome history', () => {
  it('pages by append cursor while correction capability uses the full ledger', async () => {
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM opportunities') && sql.includes('superseded_at')) {
        return {
          rowCount: 1,
          rows: [{ status: 'new', supersededAt: null }],
        }
      }
      if (sql.includes('COUNT(*)::TEXT AS count')) {
        return { rowCount: 1, rows: [{ count: '75' }] }
      }
      if (sql.includes('WITH page_events AS')) {
        return {
          rowCount: 26,
          rows: Array.from({ length: 26 }, (_, index) => ({
            id: String(49 - index),
            eventType: 'proposal',
            previousStage: 'meeting',
            newStage: 'proposal',
            occurredAt: '2026-07-27T12:00:00.000Z',
            recordedAt: '2026-07-27T12:00:01.000Z',
            actorType: 'user',
            reasonCode: null,
            reasonNote: null,
            channel: null,
            contactPathType: null,
            contactReferenceLabel: null,
            valueMinor: null,
            currency: null,
            metadata: {},
            revertsEventId: null,
            isEffective: true,
            isReverted: false,
            revertedByEventId: null,
          })),
        }
      }
      if (sql.includes('FROM opportunity_outcome_state')) {
        return {
          rowCount: 1,
          rows: [{
            commercialStage: 'won',
            currentStage: 'won',
            workflowState: 'active',
            snoozedUntil: null,
            lastEventId: '75',
            lastEventAt: '2026-07-27T13:00:00.000Z',
            lastStageEventId: '75',
            lastStageEventAt: '2026-07-27T13:00:00.000Z',
            firstShownAt: null,
            firstOpenedAt: null,
            acceptedAt: null,
            contactedAt: null,
            repliedAt: null,
            meetingAt: null,
            proposalAt: null,
            wonAt: '2026-07-27T13:00:00.000Z',
            lostAt: null,
            dismissReasonCode: null,
            lostReasonCode: null,
            dealValueMinor: null,
            currency: null,
            meetingStatus: 'completed',
            activeMeetingEventId: null,
            lastMeetingEventAt: null,
            meetingAttemptCount: 1,
          }],
        }
      }
      if (sql.includes('effective_commercial')) {
        return {
          rowCount: 1,
          rows: [{
            targetEventId: '75',
            targetEventType: 'won',
            targetOccurredAt: '2026-07-27T13:00:00.000Z',
          }],
        }
      }
      throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`)
    })

    const history = await getOpportunityOutcomeHistory({
      ownerId: '7',
      opportunityId: '10',
      beforeEventId: '50',
      pageSize: 25,
    }, { query } as never)

    expect(history).toMatchObject({
      correction: {
        canRevert: true,
        targetEventId: '75',
        targetEventType: 'won',
        targetOccurredAt: '2026-07-27T13:00:00.000Z',
      },
      pagination: {
        pageSize: 25,
        sortOrder: 'append_desc',
        totalItems: 75,
        hasMore: true,
        nextBeforeEventId: '25',
      },
    })
    expect(history?.events[0]).toMatchObject({
      appendOrder: '49',
      isEffective: true,
      isReverted: false,
      revertedByEventId: null,
    })
    expect(history?.events).toHaveLength(25)
    const pageQuery = query.mock.calls.find(([sql]) =>
      String(sql).includes('WITH page_events AS'))
    expect(String(pageQuery?.[0])).toContain('event.id < $3::bigint')
    expect(String(pageQuery?.[0])).toContain('ORDER BY event.id DESC')
    expect(pageQuery?.[1]).toEqual(['7', '10', '50', 26])
  })

  it('does not expose correction for a legacy snoozed opportunity', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM opportunities') && sql.includes('superseded_at')) {
        return {
          rowCount: 1,
          rows: [{ status: 'snoozed', supersededAt: null }],
        }
      }
      if (sql.includes('COUNT(*)::TEXT AS count')) {
        return { rowCount: 1, rows: [{ count: '1' }] }
      }
      if (sql.includes('WITH page_events AS')) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('FROM opportunity_outcome_state')) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('effective_commercial')) {
        return {
          rowCount: 1,
          rows: [{
            targetEventId: '1',
            targetEventType: 'accepted',
            targetOccurredAt: '2026-07-27T13:00:00.000Z',
          }],
        }
      }
      throw new Error(`Unexpected query: ${sql}`)
    })

    const history = await getOpportunityOutcomeHistory({
      ownerId: '7',
      opportunityId: '10',
    }, { query } as never)

    expect(history?.correction).toEqual({
      canRevert: false,
      targetEventId: null,
      targetEventType: null,
      targetOccurredAt: null,
    })
  })

  it('workspace-scopes history availability and exposes immutable actor attribution', async () => {
    const query = jest.fn(async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('FROM opportunities') && sql.includes('superseded_at')) {
        expect(sql).toContain('workspace_id = $3')
        expect(params).toEqual(['10', '7', '9'])
        return {
          rowCount: 1,
          rows: [{ status: 'accepted', supersededAt: null }],
        }
      }
      if (sql.includes('COUNT(*)::TEXT AS count')) {
        return { rowCount: 1, rows: [{ count: '1' }] }
      }
      if (sql.includes('WITH page_events AS')) {
        expect(sql).toContain('event.actor_user_id')
        expect(sql).toContain('event.actor_workspace_id')
        expect(sql).toContain('event.actor_role_snapshot')
        return {
          rowCount: 1,
          rows: [{
            id: '80',
            eventType: 'accepted',
            previousStage: 'new',
            newStage: 'accepted',
            occurredAt: '2026-07-31T10:00:00.000Z',
            recordedAt: '2026-07-31T10:00:00.000Z',
            actorType: 'user',
            actorUserId: '42',
            actorWorkspaceId: '9',
            actorRoleSnapshot: 'recruiter',
            reasonCode: null,
            reasonNote: null,
            channel: null,
            contactPathType: null,
            contactReferenceLabel: null,
            valueMinor: null,
            currency: null,
            metadata: {},
            revertsEventId: null,
            isEffective: true,
            isReverted: false,
            revertedByEventId: null,
          }],
        }
      }
      if (sql.includes('FROM opportunity_outcome_state')) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('effective_commercial')) {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    })

    const history = await getOpportunityOutcomeHistory({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
    }, { query } as never)

    expect(history?.events[0]).toMatchObject({
      actorType: 'user',
      actorUserId: '42',
      actorWorkspaceId: '9',
      actorRoleSnapshot: 'recruiter',
      actorAttribution: 'workspace',
    })
  })
})
