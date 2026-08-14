import { deliverCandidatesForRun } from '@/lib/digest/deliver-candidates'

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  sendBatchDigestForRun: jest.fn(),
}))

jest.mock('@/lib/ai/enrichment/enrichRunCandidates', () => ({
  enrichRunCandidates: jest.fn(),
}))

jest.mock('@/lib/webPush', () => ({ notifyNewLeadsForRun: jest.fn() }))
jest.mock('@/lib/email/sendDigestEmail', () => ({ sendDigestEmailForProfile: jest.fn() }))
jest.mock('@/lib/notification-dispatch', () => ({
  hasActiveNotificationEndpoint: jest.fn(),
  dispatchDigestNotifications: jest.fn(),
}))
jest.mock('@/lib/telemetry', () => ({ tryRecordProductEvent: jest.fn() }))

import { getPool, sendBatchDigestForRun } from '@/lib/db'
import { enrichRunCandidates } from '@/lib/ai/enrichment/enrichRunCandidates'
import { notifyNewLeadsForRun } from '@/lib/webPush'
import { sendDigestEmailForProfile } from '@/lib/email/sendDigestEmail'
import {
  dispatchDigestNotifications,
  hasActiveNotificationEndpoint,
} from '@/lib/notification-dispatch'
import { tryRecordProductEvent } from '@/lib/telemetry'

const mockGetPool = getPool as jest.Mock
const mockSendBatch = sendBatchDigestForRun as jest.MockedFunction<typeof sendBatchDigestForRun>
const mockEnrich = enrichRunCandidates as jest.MockedFunction<typeof enrichRunCandidates>
const mockPush = notifyNewLeadsForRun as jest.MockedFunction<typeof notifyNewLeadsForRun>
const mockEmail = sendDigestEmailForProfile as jest.MockedFunction<typeof sendDigestEmailForProfile>
const mockHasEndpoint = hasActiveNotificationEndpoint as jest.MockedFunction<typeof hasActiveNotificationEndpoint>
const mockDispatch = dispatchDigestNotifications as jest.MockedFunction<typeof dispatchDigestNotifications>
const mockTelemetry = tryRecordProductEvent as jest.MockedFunction<typeof tryRecordProductEvent>

function makeMockPool(queryImpl?: jest.Mock) {
  const query = queryImpl ?? jest.fn()
  return { query }
}

describe('deliverCandidatesForRun (batch)', () => {
  beforeEach(() => {
    mockGetPool.mockReset()
    mockSendBatch.mockReset()
    mockEnrich.mockReset().mockResolvedValue({
      ran: false,
      considered: 0,
      enriched: 0,
      discoveryConsidered: 0,
      discoveryDiscovered: 0,
    })
    mockPush.mockReset().mockResolvedValue({ delivered: false, state: 'skipped_not_configured', reason: 'not_configured' })
    mockEmail.mockReset().mockResolvedValue({ delivered: false, state: 'skipped_not_configured', reason: 'not_configured' })
    mockHasEndpoint.mockReset().mockResolvedValue(false)
    mockDispatch.mockReset().mockResolvedValue({ sent: 0, failed: 0, skipped: 0, errors: [] })
    mockTelemetry.mockReset().mockResolvedValue(true)
  })

  it('returns ok:false with zeroed counters when pool is null', async () => {
    mockGetPool.mockReturnValue(null)
    const result = await deliverCandidatesForRun('run-1')
    expect(result).toEqual({ ok: false, sent: 0, failed: 0, skipped: 0, failures: [] })
  })

  it('sends one batch per profile and reports sent=1', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-1', candidate_count: 3, anchor_candidate_id: '101' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 100, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendBatch.mockResolvedValueOnce({ ok: true, messagesSent: 1, leadCount: 3 })
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.sent).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.ok).toBe(true)
    expect(mockSendBatch).toHaveBeenCalledWith({ runId: 'run-1', clientProfileId: 'cp-1' })
  })

  it('skips a profile already delivered (status=sent)', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-1', candidate_count: 2, anchor_candidate_id: '201' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 200, status: 'sent', ownsClaim: false }],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.skipped).toBe(1)
    expect(result.sent).toBe(0)
    expect(mockSendBatch).not.toHaveBeenCalled()
  })

  it('keeps processing additive channels when Telegram was already delivered', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-retry', candidate_count: 2, anchor_candidate_id: '211' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 210, status: 'sent', ownsClaim: false }],
      rowCount: 1,
    } as never)
    mockEmail.mockResolvedValueOnce({ delivered: false, state: 'failed_terminal', reason: 'send_failed' })

    const result = await deliverCandidatesForRun('run-retry')

    expect(mockSendBatch).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith({
      clientProfileId: 'cp-retry',
      digestRunId: 'run-retry',
      count: 2,
    })
    expect(mockEmail).toHaveBeenCalledWith({
      clientProfileId: 'cp-retry',
      digestRunId: 'run-retry',
    })
    expect(mockDispatch).toHaveBeenCalledWith({
      runId: 'run-retry',
      clientProfileId: 'cp-retry',
      providers: ['vk', 'webhook'],
    })
    expect(result).toMatchObject({ ok: false, failed: 1, skipped: 1 })
  })

  it('records a failure when the batch send returns ok:false', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-1', candidate_count: 1, anchor_candidate_id: '301' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 300, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendBatch.mockResolvedValueOnce({ ok: false, error: 'Telegram API timeout' })
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(0)
    expect(result.failures[0]).toMatchObject({
      channel: 'telegram',
      state: 'failed_terminal',
      retryable: false,
    })
    expect(result.failures[0].error).toContain('legacy_telegram_delivery_failed')
    expect(result.failures[0].error).not.toContain('Telegram API timeout')
    expect(result.ok).toBe(false)
    expect(String(pool.query.mock.calls[2][0])).toContain('SET status = $4')
    expect(pool.query.mock.calls[2][1]?.[3]).toBe('failed_terminal')
  })

  it('does not replay a terminal ambiguous Telegram failure', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-terminal', candidate_count: 1, anchor_candidate_id: '351' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 350, status: 'failed_terminal', ownsClaim: false }],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-terminal')

    expect(result).toMatchObject({ ok: false, sent: 0, failed: 1 })
    expect(result.failures[0]?.error).toContain('telegram (failed_terminal)')
    expect(mockSendBatch).not.toHaveBeenCalled()
  })

  it('does not fall back to legacy Telegram after a terminal custom-route failure', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-custom', candidate_count: 1, anchor_candidate_id: '371' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 370, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    mockHasEndpoint.mockResolvedValueOnce(true)
    mockDispatch
      .mockResolvedValueOnce({
        sent: 0,
        failed: 1,
        skipped: 0,
        errors: ['ambiguous provider outcome'],
        terminalFailed: 1,
      })
      .mockResolvedValueOnce({ sent: 0, failed: 0, skipped: 0, errors: [] })

    const result = await deliverCandidatesForRun('run-custom-terminal')

    expect(result).toMatchObject({ ok: false, sent: 0, failed: 1 })
    expect(mockSendBatch).not.toHaveBeenCalled()
  })

  it('persists a safe custom Telegram retry without falling back to legacy delivery', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-custom-retry', candidate_count: 1, anchor_candidate_id: '381' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 380, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    mockHasEndpoint.mockResolvedValueOnce(true)
    mockDispatch.mockResolvedValueOnce({
      sent: 0,
      failed: 1,
      skipped: 0,
      errors: ['rate limited'],
      retryableFailed: 1,
      terminalFailed: 0,
      processing: 0,
    })

    const result = await deliverCandidatesForRun('run-custom-retry')

    expect(result).toMatchObject({ ok: false, sent: 0, failed: 1 })
    expect(result.failures[0]).toMatchObject({
      channel: 'telegram',
      state: 'failed_retryable',
      retryable: true,
    })
    expect(String(pool.query.mock.calls[2][0])).toContain('SET status = $4')
    expect(pool.query.mock.calls[2][1]?.[3]).toBe('failed_retryable')
    expect(mockSendBatch).not.toHaveBeenCalled()
  })

  it('does not fail additive delivery when the profile has no Telegram chat', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-email', candidate_count: 1, anchor_candidate_id: '401' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 400, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendBatch.mockResolvedValueOnce({
      ok: false,
      error: 'Client profile has no linked Telegram chat.',
    })
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    const result = await deliverCandidatesForRun('run-email')

    expect(result).toMatchObject({ ok: true, sent: 0, failed: 0, skipped: 1 })
  })

  it('records email and web-push telemetry and counts actual provider successes', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-multi', candidate_count: 2, anchor_candidate_id: '501' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 500, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendBatch.mockResolvedValueOnce({
      ok: false,
      error: 'Client profile has no linked Telegram chat.',
    })
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    mockPush.mockResolvedValueOnce({
      delivered: true,
      state: 'sent',
      attempt: 1,
      result: { sent: 2, failed: 0, ambiguous: 0, retryable: 0, pruned: 0 },
    })
    mockEmail.mockResolvedValueOnce({ delivered: true, state: 'sent', leadCount: 2 })

    const result = await deliverCandidatesForRun('run-multi')

    expect(result).toMatchObject({ ok: true, sent: 2, failed: 0, skipped: 1 })
    expect(mockTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'digest_delivered',
      provider: 'web_push',
      clientProfileId: 'cp-multi',
    }))
    expect(mockTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'digest_delivered',
      provider: 'email',
      clientProfileId: 'cp-multi',
    }))
    expect(mockTelemetry).toHaveBeenCalledTimes(4)
  })

  it('makes the run partial when an enabled additive provider fails without exposing its raw error', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-email', candidate_count: 1, anchor_candidate_id: '551' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 550, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendBatch.mockResolvedValueOnce({
      ok: false,
      error: 'Client profile has no linked Telegram chat.',
    })
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    mockEmail.mockResolvedValueOnce({ delivered: false, state: 'failed_terminal', reason: 'send_failed' })

    const result = await deliverCandidatesForRun('run-email-fail')

    expect(result).toMatchObject({ ok: false, failed: 1, skipped: 1 })
    expect(result.failures).toEqual([expect.objectContaining({
      digestCandidateId: 0,
      error: 'cp-email: email (failed_terminal) delivery failed',
      channel: 'email',
      state: 'failed_terminal',
      retryable: false,
    })])
    expect(mockTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'delivery_failed',
      provider: 'email',
      outcome: 'failed_terminal',
    }))
    expect(JSON.stringify(mockTelemetry.mock.calls)).not.toContain('SMTP')
  })

  it('makes the run partial when a configured VK/webhook endpoint fails', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-webhook', candidate_count: 1, anchor_candidate_id: '575' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 574, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendBatch.mockResolvedValueOnce({
      ok: false,
      error: 'Client profile has no linked Telegram chat.',
    })
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    mockDispatch.mockResolvedValueOnce({
      sent: 0,
      failed: 1,
      skipped: 0,
      errors: ['provider secret should stay internal'],
    })

    const result = await deliverCandidatesForRun('run-webhook-fail')

    expect(result).toMatchObject({ ok: false, sent: 0, failed: 1, skipped: 1 })
    expect(result.failures[0]?.error).toBe(
      'cp-webhook: additional notification delivery failed (1)',
    )
    expect(JSON.stringify(result.failures)).not.toContain('provider secret')
  })

  it('produces no batch when there are no A/B candidates', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.sent).toBe(0)
    expect(result.ok).toBe(true)
    expect(mockSendBatch).not.toHaveBeenCalled()
  })

  it('uses a per-profile idempotency key', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-9', candidate_count: 1, anchor_candidate_id: '601' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 600, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendBatch.mockResolvedValueOnce({ ok: true, messagesSent: 1, leadCount: 1 })
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    await deliverCandidatesForRun('run-abc')

    const claimCall = pool.query.mock.calls[1]
    const params = claimCall[1] as unknown[]
    expect(params[0]).toBe('digest:run-abc:profile:cp-9:telegram-batch')
    expect(params[2]).toBe('601')
  })

  it('runs AI enrichment before delivery and survives its failure', async () => {
    mockEnrich.mockReset().mockRejectedValueOnce(new Error('provider down'))
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-1', candidate_count: 1, anchor_candidate_id: '301' }],
      rowCount: 1,
    } as never)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 100, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendBatch.mockResolvedValueOnce({ ok: true, messagesSent: 1, leadCount: 1 })
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(mockEnrich).toHaveBeenCalledWith('run-1')
    expect(result.sent).toBe(1)
    expect(result.ok).toBe(true)
  })
})
