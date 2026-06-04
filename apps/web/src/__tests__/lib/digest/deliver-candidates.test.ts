import { deliverCandidatesForRun } from '@/lib/digest/deliver-candidates'

// Mock @/lib/db — getPool + sendLeadToTelegram
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
  sendLeadToTelegram: jest.fn(),
}))

import { getPool, sendLeadToTelegram } from '@/lib/db'
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>
const mockSendLeadToTelegram = sendLeadToTelegram as jest.MockedFunction<typeof sendLeadToTelegram>

/**
 * Helper: build a mock pool with a controllable query function.
 */
function makeMockPool(queryImpl?: jest.Mock) {
  const query = queryImpl ?? jest.fn()
  return { query } as unknown as import('pg').Pool
}

describe('deliverCandidatesForRun', () => {
  beforeEach(() => {
    mockGetPool.mockReset()
    mockSendLeadToTelegram.mockReset()
  })

  it('returns ok:false with zeroed counters when pool is null', async () => {
    mockGetPool.mockReturnValue(null)

    const result = await deliverCandidatesForRun('run-1')

    expect(result).toEqual({
      ok: false,
      sent: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    })
  })

  it('delivers A-gate candidate and reports sent=1', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    // Step 1: candidates query returns one A-gate candidate
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 42 }],
      rowCount: 1,
    } as never)

    // Step 2: claim INSERT returns ownsClaim=true, status='processing'
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 100, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)

    // Step 3: sendLeadToTelegram succeeds
    mockSendLeadToTelegram.mockResolvedValueOnce({ ok: true })

    // Step 4: UPDATE status to 'sent'
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.sent).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.ok).toBe(true)
    expect(mockSendLeadToTelegram).toHaveBeenCalledWith(42)
  })

  it('skips already-sent candidate (status=sent, ownsClaim=false)', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    // One candidate
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 10 }],
      rowCount: 1,
    } as never)

    // Claim returns status='sent' — already delivered
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 200, status: 'sent', ownsClaim: false }],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.skipped).toBe(1)
    expect(result.sent).toBe(0)
    expect(mockSendLeadToTelegram).not.toHaveBeenCalled()
  })

  it('skips when another worker owns the claim', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 11 }],
      rowCount: 1,
    } as never)

    // Claim returns status='processing' but ownsClaim=false (another worker)
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 201, status: 'processing', ownsClaim: false }],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.skipped).toBe(1)
    expect(result.sent).toBe(0)
  })

  it('records failure when sendLeadToTelegram returns ok:false', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 50 }],
      rowCount: 1,
    } as never)

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 300, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)

    // Telegram send fails
    mockSendLeadToTelegram.mockResolvedValueOnce({
      ok: false,
      error: 'Telegram API timeout',
    })

    // UPDATE status to 'failed'
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(0)
    expect(result.failures).toEqual([
      { digestCandidateId: 50, error: 'Telegram API timeout' },
    ])
    expect(result.ok).toBe(false)
  })

  it('records failure when sendLeadToTelegram throws an exception', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 60 }],
      rowCount: 1,
    } as never)

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 301, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)

    // Telegram send throws
    mockSendLeadToTelegram.mockRejectedValueOnce(new Error('Network error'))

    // UPDATE status to 'failed'
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.failed).toBe(1)
    expect(result.failures[0].error).toBe('Network error')
    expect(result.ok).toBe(false)
  })

  it('handles non-Error exceptions in sendLeadToTelegram', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 70 }],
      rowCount: 1,
    } as never)

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 302, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)

    // Throws a non-Error value
    mockSendLeadToTelegram.mockRejectedValueOnce('string error')

    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.failed).toBe(1)
    expect(result.failures[0].error).toBe('Delivery exception.')
  })

  it('filters out C and D gate candidates', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    // Candidates query returns no rows (all filtered by the SQL gate check)
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.sent).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.ok).toBe(true)
  })

  it('delivers multiple candidates in sequence', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    // Two A-gate candidates
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1 }, { id: 2 }],
      rowCount: 2,
    } as never)

    // First candidate: claim → send → update
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 400, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendLeadToTelegram.mockResolvedValueOnce({ ok: true })
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
    } as never)

    // Second candidate: claim → send → update
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 401, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendLeadToTelegram.mockResolvedValueOnce({ ok: true })
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.sent).toBe(2)
    expect(result.ok).toBe(true)
    expect(mockSendLeadToTelegram).toHaveBeenCalledTimes(2)
  })

  it('continues after one candidate fails', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    // Two candidates
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1 }, { id: 2 }],
      rowCount: 2,
    } as never)

    // First candidate: claim → send fails → update
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 500, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendLeadToTelegram.mockResolvedValueOnce({ ok: false, error: 'Timeout' })
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
    } as never)

    // Second candidate: claim → send succeeds → update
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 501, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)
    mockSendLeadToTelegram.mockResolvedValueOnce({ ok: true })
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 1,
    } as never)

    const result = await deliverCandidatesForRun('run-1')

    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.ok).toBe(false)
  })

  it('passes the correct idempotency key format to the claim query', async () => {
    const pool = makeMockPool()
    mockGetPool.mockReturnValue(pool)

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 99 }],
      rowCount: 1,
    } as never)

    // Capture the claim query to verify idempotency key format
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 600, status: 'processing', ownsClaim: true }],
      rowCount: 1,
    } as never)

    mockSendLeadToTelegram.mockResolvedValueOnce({ ok: true })
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)

    await deliverCandidatesForRun('run-abc')

    // The second call is the claim INSERT — check the idempotency key param
    const claimCall = pool.query.mock.calls[1]
    const idempotencyKey = claimCall[1] as unknown[]  // params array
    // Key should be: `digest:${runId}:candidate:${candidateId}:telegram`
    expect(idempotencyKey[1]).toBe('digest:run-abc:candidate:99:telegram')
  })
})
