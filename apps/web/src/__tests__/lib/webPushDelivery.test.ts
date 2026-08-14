const query = jest.fn()

jest.mock('web-push', () => ({
  __esModule: true,
  default: { sendNotification: jest.fn(), setVapidDetails: jest.fn() },
}))
jest.mock('@/lib/db-pool', () => ({
  getPool: () => ({ query }),
}))

import webpush from 'web-push'
import { notifyNewLeadsForRun } from '@/lib/webPush'

const sendNotification = jest.mocked(webpush.sendNotification)

describe('web-push aggregate delivery state', () => {
  beforeAll(() => {
    process.env.WEB_PUSH_PUBLIC_KEY = 'test-public'
    process.env.WEB_PUSH_PRIVATE_KEY = 'test-private'
    process.env.WEB_PUSH_SUBJECT = 'mailto:test@example.invalid'
  })

  afterAll(() => {
    delete process.env.WEB_PUSH_PUBLIC_KEY
    delete process.env.WEB_PUSH_PRIVATE_KEY
    delete process.env.WEB_PUSH_SUBJECT
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reclaims a retryable failure once, then skips the successfully delivered run', async () => {
    let status: string | null = null
    let attemptCount = 0
    query.mockImplementation(async (sqlValue: unknown, params: readonly unknown[] = []) => {
      const sql = String(sqlValue)
      if (sql.includes('SELECT delivery_status') && sql.includes('lead_channel_deliveries')) {
        return status
          ? { rowCount: 1, rows: [{ delivery_status: status, attempt_count: attemptCount }] }
          : { rowCount: 0, rows: [] }
      }
      if (sql.includes('SELECT web_push_enabled')) {
        return { rowCount: 1, rows: [{ web_push_enabled: true }] }
      }
      if (sql.includes('COUNT(*)::TEXT')) {
        return { rowCount: 1, rows: [{ count: '1' }] }
      }
      if (sql.includes('INSERT INTO lead_channel_deliveries')) {
        if (status === null || status === 'failed_retryable') {
          status = 'processing'
          attemptCount += 1
          return { rowCount: 1, rows: [{ id: 1, attemptCount, ownsClaim: true }] }
        }
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('FROM web_push_subscriptions')) {
        return {
          rowCount: 1,
          rows: [{ id: 7, endpoint: 'https://push.example/sub', p256dh: 'p', auth: 'a' }],
        }
      }
      if (sql.includes("last_error_reason = 'ambiguous_stale_processing'")) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('UPDATE lead_channel_deliveries')) {
        status = String(params[1])
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error('temporary push failure'), { statusCode: 429 }))
      .mockResolvedValueOnce(undefined as never)

    const first = await notifyNewLeadsForRun({ clientProfileId: '9', digestRunId: '77', count: 2 })
    const second = await notifyNewLeadsForRun({ clientProfileId: '9', digestRunId: '77', count: 2 })
    const third = await notifyNewLeadsForRun({ clientProfileId: '9', digestRunId: '77', count: 2 })

    expect(first).toMatchObject({ delivered: false, state: 'failed_retryable' })
    expect(second).toMatchObject({ delivered: true, state: 'sent' })
    expect(third).toMatchObject({ delivered: false, state: 'already_successfully_delivered', attempt: 2 })
    expect(sendNotification).toHaveBeenCalledTimes(2)
  })

  it('keeps a partial provider result terminal to avoid resending successful subscriptions', async () => {
    let status: string | null = null
    query.mockImplementation(async (sqlValue: unknown, params: readonly unknown[] = []) => {
      const sql = String(sqlValue)
      if (sql.includes('SELECT delivery_status') && sql.includes('lead_channel_deliveries')) {
        return status
          ? { rowCount: 1, rows: [{ delivery_status: status, attempt_count: 1 }] }
          : { rowCount: 0, rows: [] }
      }
      if (sql.includes('SELECT web_push_enabled')) return { rowCount: 1, rows: [{ web_push_enabled: true }] }
      if (sql.includes('COUNT(*)::TEXT')) return { rowCount: 1, rows: [{ count: '2' }] }
      if (sql.includes('INSERT INTO lead_channel_deliveries')) {
        status = 'processing'
        return { rowCount: 1, rows: [{ id: 1, attemptCount: 1, ownsClaim: true }] }
      }
      if (sql.includes('FROM web_push_subscriptions')) {
        return {
          rowCount: 2,
          rows: [
            { id: 7, endpoint: 'https://push.example/one', p256dh: 'p1', auth: 'a1' },
            { id: 8, endpoint: 'https://push.example/two', p256dh: 'p2', auth: 'a2' },
          ],
        }
      }
      if (sql.includes("last_error_reason = 'ambiguous_stale_processing'")) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('UPDATE lead_channel_deliveries')) {
        status = String(params[1])
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })
    sendNotification
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(Object.assign(new Error('temporary push failure'), { statusCode: 503 }))

    const first = await notifyNewLeadsForRun({ clientProfileId: '9', digestRunId: '88', count: 2 })
    const second = await notifyNewLeadsForRun({ clientProfileId: '9', digestRunId: '88', count: 2 })

    expect(first).toMatchObject({ delivered: false, state: 'failed_terminal' })
    expect(second).toMatchObject({ delivered: false, state: 'failed_terminal', attempt: 1 })
    expect(sendNotification).toHaveBeenCalledTimes(2)
  })

  it('keeps an ambiguous zero-send outcome terminal because replay could duplicate delivery', async () => {
    let status: string | null = null
    query.mockImplementation(async (sqlValue: unknown, params: readonly unknown[] = []) => {
      const sql = String(sqlValue)
      if (sql.includes('SELECT delivery_status') && sql.includes('lead_channel_deliveries')) {
        return status
          ? { rowCount: 1, rows: [{ delivery_status: status, attempt_count: 1 }] }
          : { rowCount: 0, rows: [] }
      }
      if (sql.includes('SELECT web_push_enabled')) return { rowCount: 1, rows: [{ web_push_enabled: true }] }
      if (sql.includes('COUNT(*)::TEXT')) return { rowCount: 1, rows: [{ count: '1' }] }
      if (sql.includes('INSERT INTO lead_channel_deliveries')) {
        status = 'processing'
        return { rowCount: 1, rows: [{ id: 1, attemptCount: 1, ownsClaim: true }] }
      }
      if (sql.includes('FROM web_push_subscriptions')) {
        return { rowCount: 1, rows: [{ id: 7, endpoint: 'https://push.example/one', p256dh: 'p', auth: 'a' }] }
      }
      if (sql.includes("last_error_reason = 'ambiguous_stale_processing'")) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('UPDATE lead_channel_deliveries')) {
        status = String(params[1])
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })
    sendNotification.mockRejectedValueOnce(new Error('network outcome unknown'))

    const first = await notifyNewLeadsForRun({ clientProfileId: '9', digestRunId: '99', count: 1 })
    const second = await notifyNewLeadsForRun({ clientProfileId: '9', digestRunId: '99', count: 1 })

    expect(first).toMatchObject({ delivered: false, state: 'failed_terminal' })
    expect(second).toMatchObject({ delivered: false, state: 'failed_terminal', attempt: 1 })
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('terminalizes a stale processing claim without invoking the provider', async () => {
    query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue)
      if (sql.includes('SELECT delivery_status') && sql.includes('lead_channel_deliveries')) {
        return { rowCount: 1, rows: [{ delivery_status: 'processing', attempt_count: 1 }] }
      }
      if (sql.includes("last_error_reason = 'ambiguous_stale_processing'")) {
        return { rowCount: 1, rows: [] }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await notifyNewLeadsForRun({ clientProfileId: '9', digestRunId: '100', count: 1 })

    expect(result).toMatchObject({ delivered: false, state: 'failed_terminal', attempt: 1 })
    expect(sendNotification).not.toHaveBeenCalled()
  })
})
