const mockUpdateCore = jest.fn()
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
}
const mockPool = {
  connect: jest.fn(async () => mockClient),
}

jest.mock('@/lib/db-pool', () => ({
  getPool: () => mockPool,
}))

jest.mock('@/lib/digestFeedbackCore.mjs', () => ({
  DIGEST_FEEDBACK_ACTIONS: [
    'shown',
    'accepted',
    'badfit',
    'dismissed',
    'snooze',
    'contacted',
    'replied',
    'meeting',
    'won',
  ],
  isDigestFeedbackAction: (value: string) => value === 'dismissed',
  updateDigestOrgStateFeedbackCore: (...args: unknown[]) => mockUpdateCore(...args),
}))

import { updateDigestOrgStateFeedback } from '@/lib/digestFeedback'

describe('digest feedback transaction boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 })
  })

  it('commits the state transition and ER suppression together', async () => {
    const state = { feedbackStatus: 'dismissed' }
    mockUpdateCore.mockResolvedValueOnce(state)

    await expect(updateDigestOrgStateFeedback({
      clientProfileId: '7',
      orgId: '42',
      action: 'dismissed',
    })).resolves.toBe(state)

    expect(mockPool.connect).toHaveBeenCalledTimes(1)
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'COMMIT')
    expect(mockUpdateCore).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dismissed' }),
      expect.objectContaining({
        getSuppressionScope: expect.any(Function),
        recordSuppression: expect.any(Function),
      }),
    )
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })

  it('rolls the feedback state back when ER suppression fails', async () => {
    mockUpdateCore.mockRejectedValueOnce(new Error('suppression write failed'))

    await expect(updateDigestOrgStateFeedback({
      clientProfileId: '7',
      orgId: '42',
      action: 'dismissed',
    })).rejects.toThrow('suppression write failed')

    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(mockClient.query).toHaveBeenNthCalledWith(2, 'ROLLBACK')
    expect(mockClient.release).toHaveBeenCalledTimes(1)
  })

  it('uses a caller-owned transaction without nesting BEGIN or COMMIT', async () => {
    const callerDb = { query: jest.fn() }
    mockUpdateCore.mockResolvedValueOnce({ feedbackStatus: 'dismissed' })

    await updateDigestOrgStateFeedback({
      clientProfileId: '7',
      orgId: '42',
      action: 'dismissed',
    }, callerDb as never)

    expect(mockPool.connect).not.toHaveBeenCalled()
    expect(callerDb.query).not.toHaveBeenCalledWith('BEGIN')
    expect(callerDb.query).not.toHaveBeenCalledWith('COMMIT')
    expect(mockUpdateCore).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        getSuppressionScope: expect.any(Function),
        recordSuppression: expect.any(Function),
      }),
    )
  })
})
