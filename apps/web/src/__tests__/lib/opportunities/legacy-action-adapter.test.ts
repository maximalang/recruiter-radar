import { recordOpportunityOutcome } from '@/lib/opportunities/outcome-repository'
import {
  recordLegacyOpportunityAction,
  toLegacyOutcomeCommand,
} from '@/lib/opportunities/legacy-action-adapter'

jest.mock('@/lib/opportunities/outcome-repository', () => ({
  recordOpportunityOutcome: jest.fn(),
}))

const mockedRecordOutcome = jest.mocked(recordOpportunityOutcome)

describe('legacy opportunity action adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('maps a legacy action to one canonical outcome command', () => {
    const command = toLegacyOutcomeCommand({
      action: 'dismissed',
      actionKey: 'legacy-key',
      note: '  Проверено вручную  ',
      reasonCode: 'bad_fit',
    })

    expect(command.payload).toEqual(expect.objectContaining({
      eventType: 'dismissed',
      idempotencyKey: 'legacy-key',
      occurredAt: expect.any(String),
      reasonCode: 'bad_fit',
      reasonNote: 'Проверено вручную',
      metadata: { source: 'legacy_action' },
    }))
    expect(command.idempotencyPayload).toEqual(expect.objectContaining({
      eventType: 'dismissed',
      idempotencyKey: 'legacy-key',
      reasonCode: 'bad_fit',
      reasonNote: 'Проверено вручную',
    }))
    expect(command.idempotencyPayload).not.toHaveProperty('occurredAt')
  })

  it('keeps a caller-provided occurredAt in the semantic fingerprint', () => {
    const command = toLegacyOutcomeCommand({
      action: 'accepted',
      actionKey: 'legacy-key',
      occurredAt: '2024-07-31T10:00:00.000Z',
    })

    expect(command.idempotencyPayload).toHaveProperty(
      'occurredAt',
      '2024-07-31T10:00:00.000Z',
    )
  })

  it('keeps retries stable when legacy clients do not send occurredAt', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-07-31T10:00:00.000Z'))
    const first = toLegacyOutcomeCommand({
      action: 'snoozed',
      actionKey: 'legacy-key',
      snoozeDays: 7,
    })
    jest.setSystemTime(new Date('2024-07-31T10:05:00.000Z'))
    const retry = toLegacyOutcomeCommand({
      action: 'snoozed',
      actionKey: 'legacy-key',
      snoozeDays: 7,
    })
    jest.useRealTimers()

    expect(first.payload.occurredAt).not.toBe(retry.payload.occurredAt)
    expect(first.idempotencyPayload).toEqual(retry.idempotencyPayload)
  })

  it('uses canonical validation for required action details', () => {
    expect(() => toLegacyOutcomeCommand({
      action: 'dismissed',
      actionKey: 'dismissed-key',
    })).toThrow('A controlled reasonCode is required for dismissed.')
    expect(() => toLegacyOutcomeCommand({
      action: 'contacted',
      actionKey: 'contacted-key',
    })).toThrow('channel is required for contacted.')
  })

  it('uses the canonical writer and preserves workspace actor attribution', async () => {
    mockedRecordOutcome.mockResolvedValue(null)

    await recordLegacyOpportunityAction({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      action: 'accepted',
      actionKey: 'legacy-key',
      occurredAt: '2024-07-31T10:00:00.000Z',
      actorUserId: '42',
      actorWorkspaceId: '9',
      actorRoleSnapshot: 'recruiter',
      authMode: 'auth_v2',
    })

    expect(mockedRecordOutcome).toHaveBeenCalledTimes(1)
    expect(mockedRecordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      workspaceId: '9',
      opportunityId: '10',
      actorType: 'user',
      actorUserId: '42',
      actorWorkspaceId: '9',
      actorRoleSnapshot: 'recruiter',
      authMode: 'auth_v2',
      payload: expect.objectContaining({
        eventType: 'accepted',
        idempotencyKey: 'legacy-key',
      }),
      idempotencyPayload: expect.objectContaining({
        eventType: 'accepted',
        idempotencyKey: 'legacy-key',
      }),
    }))
  })
})
