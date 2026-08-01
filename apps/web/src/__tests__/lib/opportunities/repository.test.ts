import {
  applyOpportunityAction,
  getOpportunityOutcomeOperationalSummary,
  getOpportunityById,
  listOpportunities,
  OpportunityTransitionConflictError,
  isOpportunityTransitionAllowed,
} from '@/lib/opportunities/repository'
import { getPool } from '@/lib/db-pool'
import { recordLegacyOpportunityAction } from '@/lib/opportunities/legacy-action-adapter'

jest.mock('@/lib/db-pool', () => ({
  getClient: jest.fn(),
  getPool: jest.fn(() => null),
}))
jest.mock('@/lib/opportunities/legacy-action-adapter', () => ({
  recordLegacyOpportunityAction: jest.fn(),
}))

type QueryCall = { sql: string; params: readonly unknown[] | undefined }
type OpportunityDb = NonNullable<Parameters<typeof listOpportunities>[1]>

function createDb(rowsByCall: unknown[][]) {
  const calls: QueryCall[] = []
  const query = jest.fn(async (sql: string, params?: readonly unknown[]) => {
    calls.push({ sql, params })
    const rows = rowsByCall[calls.length - 1] ?? []
    return { rowCount: rows.length, rows }
  })
  return {
    calls,
    db: { query } as { query: typeof query } & OpportunityDb,
  }
}

const mockedPool = jest.mocked(getPool)
const mockedLegacyWriter = jest.mocked(recordLegacyOpportunityAction)

describe('opportunity repository tenant scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedPool.mockReturnValue(null)
  })

  it.each([
    ['new', 'accepted'],
    ['new', 'dismissed'],
    ['new', 'snoozed'],
    ['review', 'accepted'],
    ['review', 'dismissed'],
    ['review', 'snoozed'],
    ['snoozed', 'accepted'],
    ['snoozed', 'dismissed'],
    ['accepted', 'contacted'],
    ['accepted', 'dismissed'],
    ['accepted', 'snoozed'],
  ] as const)('allows transition %s -> %s', (status, action) => {
    expect(isOpportunityTransitionAllowed(status, action)).toBe(true)
  })

  it.each([
    ['new', 'contacted'],
    ['snoozed', 'contacted'],
    ['contacted', 'accepted'],
    ['dismissed', 'accepted'],
    ['expired', 'dismissed'],
  ] as const)('rejects transition %s -> %s', (status, action) => {
    expect(isOpportunityTransitionAllowed(status, action)).toBe(false)
  })

  it('keeps the deprecated transition conflict contract available', () => {
    expect(new OpportunityTransitionConflictError()).toMatchObject({
      code: 'opportunity_transition_conflict',
    })
  })

  it('scopes list, count, and evidence queries to the session owner', async () => {
    const { db, calls } = createDb([
      [{ count: '1' }],
      [{
        id: '10',
        ownerId: '7',
        clientProfileId: '8',
        organizationId: '9',
        hiringEpisodeId: '11',
      }],
      [],
    ])

    const result = await listOpportunities(
      {
        ownerId: '7',
        morningBriefOnly: true,
        statuses: ['new'],
        confidenceGate: 'A',
        minimumScore: 0.5,
      },
      db,
    )

    expect(result.total).toBe(1)
    expect(result.nextOffset).toBeNull()
    expect(result.opportunities[0]?.strategistBrief).toBeNull()
    expect(calls).toHaveLength(3)
    expect(calls[0].sql).toContain('o.owner_id = $1')
    expect(calls[1].sql).toContain('o.owner_id = $1')
    expect(calls[2].sql).toContain('o.owner_id = $1')
    expect(calls[0].sql).toContain(
      `o.metadata->>'morningBriefEligible' = 'true'`,
    )
    expect(calls[0].sql).toContain(`he.status = 'active'`)
    expect(calls[0].sql).toContain(`o.valid_until >= NOW()`)
    expect(calls[1].sql).toContain(
      `o.metadata->>'morningBriefEligible' = 'true'`,
    )
    expect(calls[0].params?.[0]).toBe('7')
    expect(calls[2].params?.[0]).toBe('7')
  })

  it('uses an explicit cursor offset and returns the next offset', async () => {
    const { db, calls } = createDb([
      [{ count: '5' }],
      [
        { id: '3', ownerId: '7' },
        { id: '4', ownerId: '7' },
      ],
      [],
    ])

    const result = await listOpportunities(
      { ownerId: '7', pageSize: 2, offset: 2 },
      db,
    )

    expect(result.page).toBe(2)
    expect(result.nextOffset).toBe(4)
    expect(calls[1].params?.slice(-2)).toEqual([2, 2])
  })

  it('adds the active workspace to list and detail tenant fences', async () => {
    const list = createDb([[{ count: '0' }], []])
    await listOpportunities({ ownerId: '7', workspaceId: '9' }, list.db)

    expect(list.calls[0].sql).toContain('o.workspace_id = $2')
    expect(list.calls[0].params?.slice(0, 2)).toEqual(['7', '9'])
    expect(list.calls[1].sql).toContain('o.workspace_id = $2')

    const detail = createDb([[]])
    await getOpportunityById({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
    }, detail.db)

    expect(detail.calls[0].sql).toContain('o.workspace_id = $3')
    expect(detail.calls[0].params).toEqual(['10', '7', '9'])
  })

  it.each([
    ['morning', `CASE WHEN o.status = 'snoozed'`, `IN ('new', 'review')`],
    ['accepted', `= 'active'`, `= 'accepted'`],
    ['pipeline', `= 'active'`, `IN ('contacted', 'replied', 'meeting', 'proposal')`],
    ['snoozed', `= 'snoozed'`, null],
    ['completed', null, `IN ('won', 'lost', 'dismissed')`],
    ['all', null, null],
  ] as const)(
    'uses the outcome projection with a legacy fallback for the %s view',
    async (view, workflowClause, stageClause) => {
      const { db, calls } = createDb([[{ count: '0' }], []])

      await listOpportunities({ ownerId: '7', view }, db)

      expect(calls[0].sql).toContain(
        'LEFT JOIN opportunity_outcome_state outcome_state',
      )
      expect(calls[0].sql).toContain('outcome_state.owner_id = o.owner_id')
      if (workflowClause) expect(calls[0].sql).toContain(workflowClause)
      if (stageClause) expect(calls[0].sql).toContain(stageClause)
      expect(calls[0].params?.[0]).toBe('7')
    },
  )

  it('returns a tenant-scoped operational summary', async () => {
    const { db, calls } = createDb([[
      {
        newCount: '2',
        acceptedCount: '3',
        pipelineCount: '4',
        snoozedCount: '5',
        wonCount: '6',
        lostCount: '7',
        dismissedCount: '8',
        overdueSnoozeCount: '1',
      },
    ]])

    const summary = await getOpportunityOutcomeOperationalSummary('7', db)

    expect(summary).toEqual({
      newCount: 2,
      acceptedCount: 3,
      pipelineCount: 4,
      snoozedCount: 5,
      wonCount: 6,
      lostCount: 7,
      dismissedCount: 8,
      overdueSnoozeCount: 1,
    })
    expect(calls[0].sql).toContain('WHERE o.owner_id = $1')
    expect(calls[0].sql).toContain(
      'LEFT JOIN opportunity_outcome_state outcome_state',
    )
    expect(calls[0].params).toEqual(['7'])
  })

  it('does not run an evidence lookup for a foreign detail', async () => {
    const { db, calls } = createDb([[]])

    await expect(getOpportunityById(
      { ownerId: '7', opportunityId: '999' },
      db,
    )).resolves.toBeNull()

    expect(calls).toHaveLength(1)
    expect(calls[0].params).toEqual(['999', '7'])
  })

  it('deduplicates timeline publications by canonical URL', async () => {
    const { db } = createDb([
      [{ id: '10', ownerId: '7' }],
      [
        {
          opportunityId: '10',
          id: 'signal:1',
          kind: 'signal',
          source: 'hh',
          label: 'Java developer',
          url: 'https://example.test/jobs/java/?utm_source=hh',
          publishedAt: '2026-07-25T09:00:00.000Z',
          tier: 'corroboration',
        },
        {
          opportunityId: '10',
          id: 'evidence:2',
          kind: 'evidence',
          source: 'career-pages',
          label: 'Java developer',
          url: 'https://example.test/jobs/java?ref=careers',
          publishedAt: '2026-07-25T09:00:00.000Z',
          tier: 'direct',
        },
      ],
    ])

    const result = await getOpportunityById(
      { ownerId: '7', opportunityId: '10' },
      db,
    )

    expect(result?.evidenceTimeline).toHaveLength(1)
  })

  it('delegates legacy actions to the canonical writer and reloads tenant data', async () => {
    mockedLegacyWriter.mockResolvedValue({
      idempotent: false,
    } as Awaited<ReturnType<typeof recordLegacyOpportunityAction>>)
    const { db, calls } = createDb([
      [{ id: '10', ownerId: '7', status: 'accepted' }],
      [],
    ])
    mockedPool.mockReturnValue(
      db as unknown as ReturnType<typeof getPool>,
    )

    const result = await applyOpportunityAction({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      action: 'accepted',
      actionKey: ' legacy-key ',
      actorUserId: '42',
      actorWorkspaceId: '9',
      actorRoleSnapshot: 'recruiter',
      authMode: 'auth_v2',
    })

    expect(mockedLegacyWriter).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      action: 'accepted',
      actionKey: 'legacy-key',
      actorUserId: '42',
    }))
    expect(calls[0].sql).toContain('o.workspace_id = $3')
    expect(result).toEqual(expect.objectContaining({
      idempotent: false,
      opportunity: expect.objectContaining({ id: '10' }),
    }))
  })

  it('does not reload when the canonical writer cannot see the opportunity', async () => {
    mockedLegacyWriter.mockResolvedValue(null)

    await expect(applyOpportunityAction({
      ownerId: '7',
      opportunityId: '99',
      action: 'accepted',
      actionKey: 'legacy-key',
    })).resolves.toBeNull()

    expect(mockedPool).not.toHaveBeenCalled()
  })

  it('rejects an invalid action key before invoking the writer', async () => {
    await expect(applyOpportunityAction({
      ownerId: '7',
      opportunityId: '10',
      action: 'accepted',
      actionKey: ' ',
    })).rejects.toThrow('Invalid opportunity action key.')

    expect(mockedLegacyWriter).not.toHaveBeenCalled()
  })
})
