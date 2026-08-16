/** @jest-environment node */

import { withSingleTimewebMcpRecovery } from '@/lib/timeweb-mcp-recovery'

type AttemptResult = { status: number }

describe('Timeweb MCP bounded recovery', () => {
  it('reinitializes once and retries once after session expiry', async () => {
    const attempt = jest.fn<Promise<AttemptResult>, []>()
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: 200 })
    const recover = jest.fn(async () => undefined)

    const outcome = await withSingleTimewebMcpRecovery<AttemptResult>(
      attempt,
      recover,
      (result) => result.status === 404 || result.status === 410,
    )

    expect(outcome).toEqual({ result: { status: 200 }, recovered: true })
    expect(recover).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('does not create a reconnect loop when the retry is still expired', async () => {
    const attempt = jest.fn<Promise<AttemptResult>, []>().mockResolvedValue({ status: 410 })
    const recover = jest.fn(async () => undefined)

    const outcome = await withSingleTimewebMcpRecovery<AttemptResult>(attempt, recover, (result) => result.status === 410)

    expect(outcome.result.status).toBe(410)
    expect(recover).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('does not reconnect a healthy session', async () => {
    const attempt = jest.fn<Promise<AttemptResult>, []>().mockResolvedValue({ status: 200 })
    const recover = jest.fn(async () => undefined)

    const outcome = await withSingleTimewebMcpRecovery<AttemptResult>(attempt, recover, (result) => result.status === 410)

    expect(outcome.recovered).toBe(false)
    expect(recover).not.toHaveBeenCalled()
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})
