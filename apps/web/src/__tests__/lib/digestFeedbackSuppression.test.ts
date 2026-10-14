import {
  clampSuppressionDays,
  updateDigestOrgStateFeedbackCore,
} from '@/lib/digestFeedbackCore.mjs'

describe('ER-suppression fan-out for dismissed ("Скрыть похожие")', () => {
  const baseDb = () => ({
    query: jest.fn().mockResolvedValueOnce({
      rows: [
        {
          clientProfileId: '7',
          orgId: '42',
          feedbackStatus: 'dismissed',
          feedbackAt: '2026-08-28T00:00:00.000Z',
          feedbackNote: null,
          cooldownUntil: null,
          suppressedUntil: '2026-09-27T00:00:00.000Z',
          lastDigestCandidateId: '5',
          lastDigestRunId: null,
          updatedAt: '2026-08-28T00:00:00.000Z',
        },
      ],
      rowCount: 1,
    }),
    getSuppressionScope: jest.fn().mockResolvedValue({
      suppressionKey: 'inn:7701234567',
      suppressedOrgIds: ['42', '77'],
    }),
    recordSuppression: jest.fn().mockResolvedValue({
      id: '1',
      clientProfileId: '7',
      suppressionKey: 'inn:7701234567',
      suppressedUntil: '2026-09-27T00:00:00.000Z',
    }),
  })

  it('writes an ER suppression row when dismissed is applied', async () => {
    const db = baseDb()

    await updateDigestOrgStateFeedbackCore(
      { clientProfileId: '7', orgId: '42', action: 'dismissed' },
      db,
    )

    expect(db.recordSuppression).toHaveBeenCalledTimes(1)
    expect(db.recordSuppression).toHaveBeenCalledWith(
      expect.objectContaining({
        clientProfileId: '7',
        orgId: '42',
        suppressionKey: 'inn:7701234567',
        suppressedOrgIds: ['42', '77'],
        sourceDigestCandidateId: '5',
        sourceFeedbackAt: '2026-08-28T00:00:00.000Z',
      }),
    )
  })

  it('does not fan out suppression for non-dismissed actions', async () => {
    const db = baseDb()

    await updateDigestOrgStateFeedbackCore(
      { clientProfileId: '7', orgId: '42', action: 'badfit' },
      db,
    )

    expect(db.getSuppressionScope).not.toHaveBeenCalled()
    expect(db.recordSuppression).not.toHaveBeenCalled()
  })

  it('fails the feedback operation when the promised ER suppression cannot be persisted', async () => {
    const db = baseDb()
    db.getSuppressionScope.mockRejectedValueOnce(new Error('corroboration view unavailable'))

    await expect(updateDigestOrgStateFeedbackCore(
      { clientProfileId: '7', orgId: '42', action: 'dismissed' },
      db,
    )).rejects.toThrow('corroboration view unavailable')
    expect(db.recordSuppression).not.toHaveBeenCalled()
  })

  it('skips suppression fan-out when the CAS rejects a stale downgrade', async () => {
    const db = baseDb()
    // First call (the mutation) is rejected by the CAS; second call returns the
    // already-'won' state so the core takes the stale no-op path.
    db.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            clientProfileId: '7',
            orgId: '42',
            feedbackStatus: 'won',
            feedbackAt: '2026-08-27T00:00:00.000Z',
            feedbackNote: null,
            cooldownUntil: null,
            suppressedUntil: 'infinity',
            lastDigestCandidateId: '5',
            lastDigestRunId: null,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
        rowCount: 1,
      })

    const state = await updateDigestOrgStateFeedbackCore(
      { clientProfileId: '7', orgId: '42', action: 'dismissed' },
      db,
    )

    expect(state.feedbackStatus).toBe('won')
    expect(db.recordSuppression).not.toHaveBeenCalled()
    expect(db.getSuppressionScope).not.toHaveBeenCalled()
  })

  it('suppresses only the dismissed org when it has no ER key', async () => {
    const db = baseDb()
    db.getSuppressionScope.mockResolvedValueOnce({
      suppressionKey: 'org:42',
      suppressedOrgIds: ['42'],
    })

    await updateDigestOrgStateFeedbackCore(
      { clientProfileId: '7', orgId: '42', action: 'dismissed' },
      db,
    )

    expect(db.recordSuppression).toHaveBeenCalledWith(
      expect.objectContaining({
        suppressionKey: 'org:42',
        suppressedOrgIds: ['42'],
      }),
    )
  })

  it('clamps the suppression window with the same bounds as badfit', () => {
    expect(clampSuppressionDays(undefined)).toBe(30)
    expect(clampSuppressionDays(0)).toBe(30)
    expect(clampSuppressionDays(-5)).toBe(30)
    expect(clampSuppressionDays(9999)).toBe(365)
    expect(clampSuppressionDays(14)).toBe(14)
  })
})
