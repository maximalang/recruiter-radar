/**
 * G3: createWebhookNotificationConnection — HMAC webhook connect flow.
 *
 * The signing secret is generated server-side, encrypted into the account row
 * and returned to the caller EXACTLY once; it must never appear in any SQL
 * parameter in plaintext. The generic_webhook endpoint is created immediately
 * 'active' (no provider handshake exists for webhooks), the daily-digest route
 * is registered and the connect action is audited. URL validation runs the
 * REAL validateWebhookUrl: non-HTTPS, malformed URLs, embedded credentials and
 * private-network targets are rejected before any database access.
 */

jest.mock('@/lib/db-pool', () => ({
  getPool: jest.fn(),
}))
jest.mock('@/lib/notification-providers', () => {
  const actual = jest.requireActual('@/lib/notification-providers')
  return {
    ...actual,
    sendSignedWebhook: jest.fn(),
    sendTelegramNotification: jest.fn(),
    sendVkNotification: jest.fn(),
  }
})
jest.mock('@/lib/notification-secrets', () => ({
  decryptNotificationSecret: jest.fn(),
  encryptNotificationSecret: jest.fn(() => 'ciphertext-blob'),
  hashNotificationToken: jest.fn(() => 'tok-hash-value'),
  redactProviderSecret: jest.fn((v: string) => v),
  timingSafeTextEqual: jest.fn((a: string, b: string) => a === b),
}))
jest.mock('@/lib/telegram-callback-authorization', () => ({
  isAuthorizedTelegramCallbackOrigin: jest.fn(() => true),
}))
jest.mock('@/lib/auth-v2/owner-write-fence', () => ({
  acquireAuthOwnerWriteFence: jest.fn(async () => undefined),
}))

import { getPool } from '@/lib/db-pool'
import { encryptNotificationSecret } from '@/lib/notification-secrets'
import { createWebhookNotificationConnection } from '@/lib/notifications'

const mockGetPool = jest.mocked(getPool)
const mockEncrypt = jest.mocked(encryptNotificationSecret)

type QueryCall = { sql: string; params: unknown[] }

function makePool() {
  const calls: QueryCall[] = []
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.includes('INSERT INTO notification_endpoints')) {
        return { rows: [{ id: 'endpoint-1' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    }),
    release: jest.fn(),
  }
  const pool = {
    connect: jest.fn(async () => client),
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      return { rows: [], rowCount: 0 }
    }),
  }
  return { pool, client, calls }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('createWebhookNotificationConnection', () => {
  it('creates an active connection and returns the signing secret exactly once', async () => {
    const { pool, client, calls } = makePool()
    mockGetPool.mockReturnValue(pool as never)

    const result = await createWebhookNotificationConnection({
      ownerId: 10,
      clientProfileId: 1,
      url: 'https://hooks.example.com/radar',
    })

    expect(result.connectionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    expect(result.signingSecret.length).toBeGreaterThanOrEqual(32)

    // The plaintext secret goes only into the encryption helper (with an
    // account-scoped AAD), never into any SQL parameter.
    expect(mockEncrypt).toHaveBeenCalledTimes(1)
    const [plaintext, aad] = mockEncrypt.mock.calls[0] as unknown as [
      { url: string; signingSecret: string },
      string,
    ]
    expect(plaintext.signingSecret).toBe(result.signingSecret)
    expect(plaintext.url).toBe('https://hooks.example.com/radar')
    expect(aad).toContain('notification-account:')
    for (const call of calls) {
      for (const param of call.params) {
        if (typeof param === 'string') {
          expect(param).not.toContain(result.signingSecret)
        }
      }
    }

    const sql = calls.map((c) => c.sql).join('\n')
    expect(sql).toMatch(/BEGIN/)
    expect(sql).toMatch(/COMMIT/)
    expect(sql).not.toMatch(/ROLLBACK/)

    const accountInsert = calls.find((c) =>
      c.sql.includes('INSERT INTO notification_provider_accounts'),
    )
    expect(accountInsert).toBeDefined()
    expect(accountInsert!.sql).toContain("'webhook'")
    expect(accountInsert!.sql).toContain("'active'")
    expect(accountInsert!.params).toContain('hooks.example.com')
    expect(accountInsert!.params).toContain('ciphertext-blob')

    const endpointInsert = calls.find((c) => c.sql.includes('INSERT INTO notification_endpoints'))
    expect(endpointInsert).toBeDefined()
    expect(endpointInsert!.params).toEqual(
      expect.arrayContaining(['generic_webhook', 'active', 'webhook:tok-hash-value', 'hooks.example.com']),
    )

    const routeInsert = calls.find((c) => c.sql.includes('INSERT INTO notification_routes'))
    expect(routeInsert).toBeDefined()

    const auditInsert = calls.find((c) => c.sql.includes('INSERT INTO notification_audit_log'))
    expect(auditInsert).toBeDefined()
    expect(auditInsert!.params).toContain('notification.webhook.connected')

    expect(client.release).toHaveBeenCalled()
  })

  it('rejects non-HTTPS URLs before touching the database', async () => {
    const { pool } = makePool()
    mockGetPool.mockReturnValue(pool as never)

    await expect(
      createWebhookNotificationConnection({
        ownerId: 10,
        clientProfileId: 1,
        url: 'http://hooks.example.com/radar',
      }),
    ).rejects.toThrow(/must use HTTPS/)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects malformed URLs', async () => {
    const { pool } = makePool()
    mockGetPool.mockReturnValue(pool as never)

    await expect(
      createWebhookNotificationConnection({ ownerId: 10, clientProfileId: 1, url: 'not-a-url' }),
    ).rejects.toThrow(/invalid/i)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects URLs with embedded credentials', async () => {
    const { pool } = makePool()
    mockGetPool.mockReturnValue(pool as never)

    await expect(
      createWebhookNotificationConnection({
        ownerId: 10,
        clientProfileId: 1,
        url: 'https://user:pass@hooks.example.com/radar',
      }),
    ).rejects.toThrow(/embedded credentials/)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rejects URLs pointing at private network addresses', async () => {
    const { pool } = makePool()
    mockGetPool.mockReturnValue(pool as never)

    await expect(
      createWebhookNotificationConnection({
        ownerId: 10,
        clientProfileId: 1,
        url: 'https://10.0.0.5/radar',
      }),
    ).rejects.toThrow(/private network address/)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('rolls the transaction back when the account insert fails and rethrows', async () => {
    const { pool, client, calls } = makePool()
    const failure = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    })
    client.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.includes('INSERT INTO notification_provider_accounts')) throw failure
      if (sql.includes('INSERT INTO notification_endpoints')) {
        return { rows: [{ id: 'endpoint-1' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    })
    mockGetPool.mockReturnValue(pool as never)

    await expect(
      createWebhookNotificationConnection({
        ownerId: 10,
        clientProfileId: 1,
        url: 'https://hooks.example.com/radar',
      }),
    ).rejects.toThrow(failure)

    const sql = calls.map((c) => c.sql).join('\n')
    expect(sql).toMatch(/ROLLBACK/)
    expect(sql).not.toMatch(/COMMIT/)
    expect(client.release).toHaveBeenCalled()
  })

  it('fails when DATABASE_URL is not configured', async () => {
    mockGetPool.mockReturnValue(null)

    await expect(
      createWebhookNotificationConnection({
        ownerId: 10,
        clientProfileId: 1,
        url: 'https://hooks.example.com/radar',
      }),
    ).rejects.toThrow(/DATABASE_URL/)
  })
})
