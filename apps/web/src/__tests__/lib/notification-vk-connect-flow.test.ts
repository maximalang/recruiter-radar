/**
 * G3: VK connect flow — createVkNotificationConnectionSafely wrapper and the
 * real reconcileVkNotificationConnection recovery loop.
 *
 * Covers: happy-path pass-through, input validation, cross-owner duplicate
 * rejection, degraded -> active recovery via the REAL reconcile (Callback API
 * reconfigured, audit written), and the degraded fallback when VK keeps
 * refusing the callback setup. The reconcile module itself is exercised
 * directly for both the active and degraded transitions.
 */

jest.mock('@/lib/db-pool', () => ({
  getPool: jest.fn(),
}))
jest.mock('@/lib/notification-providers', () => {
  const actual = jest.requireActual('@/lib/notification-providers')
  return {
    ...actual,
    configureTelegramWebhook: jest.fn(),
    deleteTelegramWebhook: jest.fn(),
    deleteVkCallbackServer: jest.fn(),
    verifyTelegramBotToken: jest.fn(),
    verifyVkCommunity: jest.fn(),
    configureVkCallback: jest.fn(),
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
jest.mock('@/lib/notifications', () => ({
  createNotificationBindingInstructions: jest.fn(),
  createTelegramNotificationConnection: jest.fn(),
  createVkNotificationConnection: jest.fn(),
  disconnectNotificationConnection: jest.fn(),
}))

import { getPool } from '@/lib/db-pool'
import {
  configureVkCallback,
  deleteVkCallbackServer,
  verifyVkCommunity,
} from '@/lib/notification-providers'
import { decryptNotificationSecret, redactProviderSecret } from '@/lib/notification-secrets'
import {
  createNotificationBindingInstructions,
  createVkNotificationConnection,
} from '@/lib/notifications'
import { createVkNotificationConnectionSafely } from '@/lib/notification-connection-operations'
import { reconcileVkNotificationConnection } from '@/lib/notification-vk-reconcile'

const mockGetPool = jest.mocked(getPool)
const mockVerifyVk = jest.mocked(verifyVkCommunity)
const mockConfigureCallback = jest.mocked(configureVkCallback)
const mockDeleteCallbackServer = jest.mocked(deleteVkCallbackServer)
const mockCreateVk = jest.mocked(createVkNotificationConnection)
const mockInstructions = jest.mocked(createNotificationBindingInstructions)
const mockDecrypt = jest.mocked(decryptNotificationSecret)
const mockRedact = jest.mocked(redactProviderSecret)

const VK_CREDENTIALS = {
  token: 'vk-token',
  groupId: '555',
  callbackSecret: 'cb-secret',
  confirmationCode: 'code-1',
}

const CALLBACK_URL = 'https://app.example.com/api/notifications/vk/pub-1'

type QueryCall = { sql: string; params: unknown[] }

type QueryResult = { rows: unknown[]; rowCount: number | null }

// Queue-driven pool: every call is recorded (so SQL assertions see UPDATE and
// audit statements too), results come from the per-test queue, and an empty
// queue falls back to "no rows" which findExistingAccount reads as null.
function makePool(resultQueue: QueryResult[] = []) {
  const queries: QueryCall[] = []
  const pool = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      return resultQueue.shift() ?? { rows: [], rowCount: 0 }
    }),
    connect: jest.fn(),
  }
  return { pool, queries }
}

const one = (rows: unknown[]): QueryResult => ({ rows, rowCount: rows.length })

const credentialStore: Record<string, unknown> = { 'enc:vk': VK_CREDENTIALS }

beforeEach(() => {
  jest.clearAllMocks()
  credentialStore['enc:vk'] = VK_CREDENTIALS
  mockDecrypt.mockImplementation(((ciphertext: string) => credentialStore[ciphertext]) as never)
  mockRedact.mockImplementation(((v: string) => v) as never)
})

describe('createVkNotificationConnectionSafely', () => {
  it('verifies the community and passes the created connection through', async () => {
    const { pool } = makePool()
    mockGetPool.mockReturnValue(pool as never)
    mockVerifyVk.mockResolvedValue({ id: '555', name: 'Test Community' })
    mockCreateVk.mockResolvedValue({
      connectionId: 'vk-conn-1',
      connectCommand: '/connect fresh-token',
      callbackConfigured: true,
    })

    const result = await createVkNotificationConnectionSafely({
      ownerId: 10,
      clientProfileId: 1,
      groupId: '555',
      token: 't'.repeat(30),
    })

    expect(result).toEqual({
      connectionId: 'vk-conn-1',
      connectCommand: '/connect fresh-token',
      callbackConfigured: true,
    })
    expect(mockVerifyVk).toHaveBeenCalledWith({ groupId: '555', token: 't'.repeat(30) })
    expect(mockCreateVk).toHaveBeenCalledWith({
      ownerId: 10,
      clientProfileId: 1,
      groupId: '555',
      token: 't'.repeat(30),
    })
  })

  it('rejects invalid community id or short token before any provider call', async () => {
    const { pool } = makePool()
    mockGetPool.mockReturnValue(pool as never)

    await expect(
      createVkNotificationConnectionSafely({
        ownerId: 10,
        clientProfileId: 1,
        groupId: 'abc',
        token: 't'.repeat(30),
      }),
    ).rejects.toThrow(/ID сообщества/)
    await expect(
      createVkNotificationConnectionSafely({
        ownerId: 10,
        clientProfileId: 1,
        groupId: '555',
        token: 'short',
      }),
    ).rejects.toThrow(/ID сообщества/)
    expect(mockVerifyVk).not.toHaveBeenCalled()
    expect(mockCreateVk).not.toHaveBeenCalled()
  })

  it('fails when a duplicate community belongs to another owner', async () => {
    const { pool } = makePool([
      { rows: [], rowCount: 0 }, // pre-check: none
      one([{ id: 'vk-acct-x', ownerId: '999', provider: 'vk', status: 'active' }]), // after-check
    ])
    mockGetPool.mockReturnValue(pool as never)
    mockVerifyVk.mockResolvedValue({ id: '555', name: 'Test Community' })
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' })
    mockCreateVk.mockRejectedValue(uniqueViolation)

    await expect(
      createVkNotificationConnectionSafely({
        ownerId: 10,
        clientProfileId: 1,
        groupId: '555',
        token: 't'.repeat(30),
      }),
    ).rejects.toThrow(/используется другим аккаунтом/)
    expect(mockDeleteCallbackServer).not.toHaveBeenCalled()
  })

  it('recovers own degraded connection by reconfiguring the callback', async () => {
    const ownRow = {
      id: 'vk-acct-9',
      ownerId: '10',
      clientProfileId: '1',
      provider: 'vk',
      status: 'degraded',
      secretCiphertext: 'enc:vk',
      providerMetadata: { callbackUrl: CALLBACK_URL },
    }
    const { pool, queries } = makePool([
      { rows: [], rowCount: 0 },   // pre-check: none
      one([ownRow]),               // after-check: own degraded
      one([ownRow]),               // reconcile SELECT account
      { rows: [], rowCount: 1 },   // reconcile UPDATE active
      { rows: [], rowCount: 1 },   // reconcile audit INSERT
    ])
    mockGetPool.mockReturnValue(pool as never)
    mockVerifyVk.mockResolvedValue({ id: '555', name: 'Test Community' })
    mockCreateVk.mockRejectedValue(new Error('callback exploded'))
    mockConfigureCallback.mockResolvedValue({ serverId: 'srv-9' })
    mockInstructions.mockResolvedValue({
      connectCommand: '/connect recovered-token',
      expiresAt: '2026-01-01T00:00:00.000Z',
    })

    const result = await createVkNotificationConnectionSafely({
      ownerId: 10,
      clientProfileId: 1,
      groupId: '555',
      token: 't'.repeat(30),
    })

    expect(result).toEqual({
      connectionId: 'vk-acct-9',
      connectCommand: '/connect recovered-token',
      callbackConfigured: true,
    })
    expect(mockConfigureCallback).toHaveBeenCalledWith({
      groupId: '555',
      token: 'vk-token',
      callbackUrl: CALLBACK_URL,
      callbackSecret: 'cb-secret',
    })
    expect(queries.some((q) => q.sql.includes("status = 'active'"))).toBe(true)
    expect(queries.some((q) => q.sql.includes('notification.vk.callback_reconciled'))).toBe(true)
  })

  it('keeps the connection degraded when the callback recovery fails again', async () => {
    const ownRow = {
      id: 'vk-acct-9',
      ownerId: '10',
      clientProfileId: '1',
      provider: 'vk',
      status: 'degraded',
      secretCiphertext: 'enc:vk',
      providerMetadata: { callbackUrl: CALLBACK_URL },
    }
    const { pool, queries } = makePool([
      { rows: [], rowCount: 0 },   // pre-check: none
      one([ownRow]),               // after-check: own degraded
      one([ownRow]),               // reconcile SELECT account
      { rows: [], rowCount: 1 },   // reconcile UPDATE degraded
    ])
    mockGetPool.mockReturnValue(pool as never)
    mockVerifyVk.mockResolvedValue({ id: '555', name: 'Test Community' })
    mockCreateVk.mockRejectedValue(new Error('callback exploded'))
    mockConfigureCallback.mockRejectedValue(new Error('VK API is down token=vk-token'))
    mockInstructions.mockResolvedValue({
      connectCommand: '/connect still-there',
      expiresAt: '2026-01-01T00:00:00.000Z',
    })

    const result = await createVkNotificationConnectionSafely({
      ownerId: 10,
      clientProfileId: 1,
      groupId: '555',
      token: 't'.repeat(30),
    })

    expect(result).toEqual({
      connectionId: 'vk-acct-9',
      connectCommand: '/connect still-there',
      callbackConfigured: false,
    })
    expect(mockRedact).toHaveBeenCalled()
    expect(queries.some((q) => q.sql.includes("status = 'degraded'"))).toBe(true)
  })
})

describe('reconcileVkNotificationConnection', () => {
  const accountRow = {
    id: 'vk-acct-1',
    ownerId: '10',
    clientProfileId: '1',
    secretCiphertext: 'enc:vk',
    providerMetadata: { callbackUrl: CALLBACK_URL },
  }

  it('reconfigures the callback server and marks the connection active with audit', async () => {
    const { pool, queries } = makePool([
      one([accountRow]),           // SELECT account
      { rows: [], rowCount: 1 },   // UPDATE active
      { rows: [], rowCount: 1 },   // audit INSERT
    ])
    mockGetPool.mockReturnValue(pool as never)
    mockConfigureCallback.mockResolvedValue({ serverId: 'srv-2' })

    await expect(
      reconcileVkNotificationConnection({ ownerId: '10', connectionId: 'vk-acct-1' }),
    ).resolves.toBeUndefined()

    expect(mockConfigureCallback).toHaveBeenCalledWith({
      groupId: '555',
      token: 'vk-token',
      callbackUrl: CALLBACK_URL,
      callbackSecret: 'cb-secret',
    })
    const update = queries.find((q) => q.sql.includes('UPDATE notification_provider_accounts'))
    expect(update).toBeDefined()
    expect(update!.sql).toContain("status = 'active'")
    expect(update!.params[2]).toBe(JSON.stringify({ callbackServerId: 'srv-2' }))
    const audit = queries.find((q) => q.sql.includes('INSERT INTO notification_audit_log'))
    expect(audit).toBeDefined()
    expect(audit!.sql).toContain('notification.vk.callback_reconciled')
    expect(audit!.params).toContain(JSON.stringify({ callbackServerId: 'srv-2' }))
  })

  it('marks the connection degraded and rethrows the redacted error on failure', async () => {
    const { pool, queries } = makePool([
      one([accountRow]),           // SELECT account
      { rows: [], rowCount: 1 },   // UPDATE degraded
    ])
    mockGetPool.mockReturnValue(pool as never)
    mockConfigureCallback.mockRejectedValue(new Error('boom secret=vk-token'))

    await expect(
      reconcileVkNotificationConnection({ ownerId: '10', connectionId: 'vk-acct-1' }),
    ).rejects.toThrow('boom secret=vk-token')

    const update = queries.find((q) => q.sql.includes('UPDATE notification_provider_accounts'))
    expect(update).toBeDefined()
    expect(update!.sql).toContain("status = 'degraded'")
    expect(update!.sql).toContain("last_error_code = 'callback_setup_failed'")
    expect(update!.params[2]).toBe('boom secret=vk-token')
    expect(mockRedact).toHaveBeenCalledWith('boom secret=vk-token')
    expect(queries.some((q) => q.sql.includes('INSERT INTO notification_audit_log'))).toBe(false)
  })

  it('fails when the connection is missing', async () => {
    const { pool } = makePool([{ rows: [], rowCount: 0 }])
    mockGetPool.mockReturnValue(pool as never)

    await expect(
      reconcileVkNotificationConnection({ ownerId: '10', connectionId: 'missing' }),
    ).rejects.toThrow(/VK-подключение не найдено/)
  })

  it('fails when the stored connection has no callback URL', async () => {
    const { pool } = makePool([one([{ ...accountRow, providerMetadata: {} }])])
    mockGetPool.mockReturnValue(pool as never)

    await expect(
      reconcileVkNotificationConnection({ ownerId: '10', connectionId: 'vk-acct-1' }),
    ).rejects.toThrow(/Callback API URL/)
    expect(mockConfigureCallback).not.toHaveBeenCalled()
  })

  it('fails when DATABASE_URL is not configured', async () => {
    mockGetPool.mockReturnValue(null)

    await expect(
      reconcileVkNotificationConnection({ ownerId: '10', connectionId: 'vk-acct-1' }),
    ).rejects.toThrow(/DATABASE_URL/)
  })
})
