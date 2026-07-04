import { deliverCandidatesForRun } from '@/lib/digest/deliver-candidates'

// Mock @/lib/db — getPool + sendBatchDigestForRun (batch delivery, one message
// per profile instead of one per lead).
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  sendBatchDigestForRun: jest.fn(),
}))

// Mock the AI enrichment step so the delivery unit test does not depend on
// provider env / network. The mock is asserted in the enrichment-isolation test.
jest.mock('@/lib/ai/enrichment/enrichRunCandidates', () => ({
  enrichRunCandidates: jest.fn(),
}))

// web-push + email are best-effort side channels — stub them so the unit test
// stays focused on the Telegram batch path.
jest.mock('@/lib/webPush', () => ({ notifyNewLeadsForRun: jest.fn() }))
jest.mock('@/lib/email/sendDigestEmail', () => ({ sendDigestEmailForProfile: jest.fn() }))

import { getPool, sendBatchDigestForRun } from '@/lib/db'
import { enrichRunCandidates } from '@/lib/ai/enrichment/enrichRunCandidates'
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>
const mockSendBatch = sendBatchDigestForRun as jest.MockedFunction<typeof sendBatchDigestForRun>
const mockEnrich = enrichRunCandidates as jest.MockedFunction<typeof enrichRunCandidates>

function makeMockPool(queryImpl?: jest.Mock) {
  const query = queryImpl ?? jest.fn()
  return { query } as unknown as import('pg').Pool
}

describe('deliverCandidatesForRun (batch)', () => {
  beforeEach(() => {
    mockGetPool.mockReset()
    mockSendBatch.mockReset()
    mockEnrich.mockReset().mockResolvedValue({ ran: false, considered: 0, enriched: 0 })
  })

  it('returns ok:false with zeroed counters when pool is null', async () => {
    mockGetPool.mockReturnValue(null)
    const result = await deliverCandidatesForRun('run-1')
    expect(result).toEqual({ ok: false, sent: 0, failed: 0, skipped: 0, failures: [] })
  })

  it('sends one batch per profile and reports sent=1', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    // Step 1: profiles query → one profile with 3 candidates
    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-1', candidate_count: 3 }],
      rowCount: 1,
    } as never)
    // Step 2: claim INSERT → ownsClaim
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 100, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    // Step 3: batch send succeeds
    mockSendBatch.mockResolvedValueOnce({ ok: true, messagesSent: 1, leadCount: 3 })
    // Step 4: UPDATE status='sent'
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
      rows: [{ client_profile_id: 'cp-1', candidate_count: 2 }],
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

  it('records a failure when the batch send returns ok:false', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-1', candidate_count: 1 }],
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
    expect(result.failures[0].error).toContain('Telegram API timeout')
    expect(result.ok).toBe(false)
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
      rows: [{ client_profile_id: 'cp-9', candidate_count: 1 }],
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
  })

  it('runs AI enrichment before delivery and survives its failure', async () => {
    mockEnrich.mockReset().mockRejectedValueOnce(new Error('provider down'))

    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    pool.query.mockResolvedValueOnce({
      rows: [{ client_profile_id: 'cp-1', candidate_count: 1 }],
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
