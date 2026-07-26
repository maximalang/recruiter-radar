/**
 * Cross-owner identity protection for notification connection lifecycle.
 *
 * An active Telegram bot or VK community must be globally unique across owners.
 * A second owner attempting to register an already-connected identity must be
 * rejected BEFORE any provider webhook/callback is reconfigured, without
 * leaking the other owner's data. Revoked connections must not block a
 * legitimate reconnect. Provider setup/teardown must never run for an identity
 * owned by someone else.
 */

export {}

const originalDatabaseUrl = process.env.DATABASE_URL

type QueryResult = { rowCount: number; rows: unknown[] }

function makeRow(partial: Record<string, unknown>): Record<string, unknown> {
  return partial
}

jest.mock('@/lib/notification-providers', () => ({
  verifyTelegramBotToken: jest.fn(),
  verifyVkCommunity: jest.fn(),
  configureTelegramWebhook: jest.fn(),
  deleteTelegramWebhook: jest.fn(),
  deleteVkCallbackServer: jest.fn(),
}))

jest.mock('@/lib/notification-secrets', () => ({
  decryptNotificationSecret: jest.fn(<T>(ciphertext: string) => {
    // Return a shape that satisfies TelegramCredentials / VkCredentials consumers.
    void ciphertext
    return { botToken: 'decrypted', webhookSecret: 's', username: 'bot' } as unknown as T
  }),
  redactProviderSecret: jest.fn((value: string) => value),
}))

jest.mock('@/lib/notification-vk-reconcile', () => ({
  reconcileVkNotificationConnection: jest.fn(),
}))

jest.mock('@/lib/notifications', () => ({
  createNotificationBindingInstructions: jest.fn(),
  createTelegramNotificationConnection: jest.fn(),
  createVkNotificationConnection: jest.fn(),
  disconnectNotificationConnection: jest.fn(),
}))

// db-pool is mocked per-test via jest.doMock so each test can install its own
// pool without cross-test leakage. We re-import the module under test after
// installing the mock.

describe('notification connection cross-owner identity', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgres://test'
  })

  afterAll(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
  })

  afterEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  function installPool(query: jest.Mock) {
    jest.doMock('@/lib/db-pool', () => ({
      getPool: () => ({ query }),
    }))
  }

  function providerResultOnce(result: QueryResult) {
    return async () => result
  }

  async function loadModule() {
    return await import('@/lib/notification-connection-operations')
  }

  function providers() {
    return require('@/lib/notification-providers') as {
      verifyTelegramBotToken: jest.Mock
      verifyVkCommunity: jest.Mock
      configureTelegramWebhook: jest.Mock
      deleteTelegramWebhook: jest.Mock
      deleteVkCallbackServer: jest.Mock
    }
  }

  function notifications() {
    return require('@/lib/notifications') as {
      createTelegramNotificationConnection: jest.Mock
      createVkNotificationConnection: jest.Mock
      disconnectNotificationConnection: jest.Mock
    }
  }

  function secrets() {
    return require('@/lib/notification-secrets') as {
      decryptNotificationSecret: jest.Mock
      redactProviderSecret: jest.Mock
    }
  }

  it('rejects the same Telegram bot reconnecting for the same owner', async () => {
    const query = jest.fn(
      providerResultOnce({
        rowCount: 1,
        rows: [
          makeRow({
            id: 'acct-1',
            ownerId: '10',
            provider: 'telegram',
            status: 'active',
            secretCiphertext: 'c',
            providerMetadata: { webhookUrl: 'https://x.test/tg' },
          }),
        ],
      }),
    )
    installPool(query)
    providers().verifyTelegramBotToken.mockResolvedValue({ id: '999', username: 'bot', displayName: 'Bot' })

    const mod = await loadModule()
    await expect(
      mod.createTelegramNotificationConnectionSafely({
        ownerId: 10,
        clientProfileId: 1,
        botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ).rejects.toThrow(/уже подключён к вашему аккаунту/)

    // No provider webhook setup or DB insert attempted.
    expect(notifications().createTelegramNotificationConnection).not.toHaveBeenCalled()
    expect(providers().configureTelegramWebhook).not.toHaveBeenCalled()
  })

  it('rejects the same Telegram bot connecting for a different owner without reconfiguring the webhook', async () => {
    const query = jest.fn(
      providerResultOnce({
        rowCount: 1,
        rows: [
          makeRow({
            id: 'acct-other',
            ownerId: '20',
            provider: 'telegram',
            status: 'active',
            secretCiphertext: 'c',
            providerMetadata: { webhookUrl: 'https://x.test/tg' },
          }),
        ],
      }),
    )
    installPool(query)
    providers().verifyTelegramBotToken.mockResolvedValue({ id: '999', username: 'bot', displayName: 'Bot' })

    const mod = await loadModule()
    await expect(
      mod.createTelegramNotificationConnectionSafely({
        ownerId: 10,
        clientProfileId: 1,
        botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ).rejects.toThrow(/используется другим аккаунтом/)

    expect(notifications().createTelegramNotificationConnection).not.toHaveBeenCalled()
    expect(providers().configureTelegramWebhook).not.toHaveBeenCalled()
    // The other owner's webhook must not be deleted.
    expect(providers().deleteTelegramWebhook).not.toHaveBeenCalled()
  })

  it('rejects the same VK community connecting for a different owner without reconfiguring callback', async () => {
    const query = jest.fn(
      providerResultOnce({
        rowCount: 1,
        rows: [
          makeRow({
            id: 'vk-other',
            ownerId: '20',
            provider: 'vk',
            status: 'active',
            secretCiphertext: 'c',
            providerMetadata: { callbackServerId: 'srv-1' },
          }),
        ],
      }),
    )
    installPool(query)
    providers().verifyVkCommunity.mockResolvedValue({ id: '555', name: 'Community' })

    const mod = await loadModule()
    await expect(
      mod.createVkNotificationConnectionSafely({
        ownerId: 10,
        clientProfileId: 1,
        groupId: '555',
        token: 't'.repeat(30),
      }),
    ).rejects.toThrow(/используется другим аккаунтом/)

    expect(notifications().createVkNotificationConnection).not.toHaveBeenCalled()
    expect(providers().deleteVkCallbackServer).not.toHaveBeenCalled()
  })

  it('does not call provider setup or webhook deletion on a cross-owner unique-index conflict', async () => {
    // Pre-check sees nothing. The insert then fails with a unique violation
    // (23505) because a different owner's row raced in. The after-check finds
    // the other owner's row. No webhook delete may happen.
    const otherRow = makeRow({
      id: 'acct-other',
      ownerId: '20',
      provider: 'telegram',
      status: 'active',
      secretCiphertext: 'c',
      providerMetadata: { webhookUrl: 'https://x.test/tg' },
    })
    const query: jest.Mock = jest.fn(async () => ({ rowCount: 0, rows: [] }))
    // First call (before) -> empty. Second call (after) -> other owner's row.
    query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [otherRow] })
    installPool(query)
    providers().verifyTelegramBotToken.mockResolvedValue({ id: '999', username: 'bot', displayName: 'Bot' })
    const uniqueError = Object.assign(new Error('duplicate'), { code: '23505' })
    notifications().createTelegramNotificationConnection.mockRejectedValue(uniqueError)

    const mod = await loadModule()
    await expect(
      mod.createTelegramNotificationConnectionSafely({
        ownerId: 10,
        clientProfileId: 1,
        botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ).rejects.toThrow(/используется другим аккаунтом/)

    expect(providers().deleteTelegramWebhook).not.toHaveBeenCalled()
    expect(providers().configureTelegramWebhook).not.toHaveBeenCalled()
  })

  it('allows reconnect when the only existing connection is revoked', async () => {
    // findExistingAccount filters status <> 'revoked', so a revoked row is
    // invisible and the connection proceeds.
    const query = jest.fn(async () => ({ rowCount: 0, rows: [] }))
    installPool(query)
    providers().verifyTelegramBotToken.mockResolvedValue({ id: '999', username: 'bot', displayName: 'Bot' })
    notifications().createTelegramNotificationConnection.mockResolvedValue({
      connectionId: 'acct-new',
      privateLink: 'https://t.me/bot?start=t',
      groupLink: 'https://t.me/bot?startgroup=t',
    })

    const mod = await loadModule()
    await expect(
      mod.createTelegramNotificationConnectionSafely({
        ownerId: 10,
        clientProfileId: 1,
        botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ).resolves.toEqual({
      connectionId: 'acct-new',
      privateLink: 'https://t.me/bot?start=t',
      groupLink: 'https://t.me/bot?startgroup=t',
    })

    expect(notifications().createTelegramNotificationConnection).toHaveBeenCalledTimes(1)
  })

  it('revokes the connection even when provider cleanup fails, and records an audit warning', async () => {
    // getOwnedAccount finds the owner's active telegram account.
    const accountRow = makeRow({
      id: 'acct-1',
      ownerId: '10',
      provider: 'telegram',
      status: 'active',
      secretCiphertext: 'c',
      providerMetadata: { webhookUrl: 'https://x.test/tg' },
    })
    // First query: getOwnedAccount. Second query: audit log insert.
    const query = jest.fn()
    query
      .mockResolvedValueOnce({ rowCount: 1, rows: [accountRow] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
    installPool(query)
    providers().deleteTelegramWebhook.mockRejectedValue(new Error('Telegram cleanup boom'))
    notifications().disconnectNotificationConnection.mockResolvedValue(undefined)

    const mod = await loadModule()
    const result = await mod.disconnectNotificationConnectionSafely({ ownerId: 10, connectionId: 'acct-1' })

    // Local revoke proceeded.
    expect(notifications().disconnectNotificationConnection).toHaveBeenCalledWith({
      ownerId: 10,
      connectionId: 'acct-1',
    })
    // Cleanup failure surfaced as a redacted warning, not thrown.
    expect(result.cleanupWarning).toMatch(/Telegram cleanup boom/)
    // Audit log insert happened (second query call).
    expect(query).toHaveBeenCalledTimes(2)
    expect(secrets().redactProviderSecret).toHaveBeenCalled()
  })
})
