/**
 * Ownership validation for runDigestForClientProfile.
 *
 * When a user-authenticated caller passes userId, the function must verify
 * that the user owns the target client profile before opening the digest run.
 * System callers (n8n, scripts) omit userId and bypass the check.
 */

export {}

const originalDatabaseUrl = process.env.DATABASE_URL

// digest.ts transitively imports lead-discovery/habr-keywords, whose module-level
// guard reads VALID_ROLES at import time. Mock only getClientProfileById and keep
// the real exports (VALID_ROLES, INDUSTRY_KEYWORDS) so the guard does not crash on
// a partial mock — and so the role surface never drifts from a hand-copied list.
jest.mock('@/lib/clientProfiles', () => ({
  ...(jest.requireActual('@/lib/clientProfiles') as object),
  getClientProfileById: jest.fn(),
}))

describe('runDigestForClientProfile ownership validation', () => {
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

  type ClientStub = {
    query: jest.Mock
    release: jest.Mock
  }

  function buildClient(ownerRowCount: number): ClientStub {
    const client: ClientStub = {
      query: jest.fn(),
      release: jest.fn(),
    }
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: ownerRowCount, rows: ownerRowCount === 1 ? [{ ok: true }] : [] })
    return client
  }

  function installPool(client: ClientStub) {
    jest.doMock('pg', () => ({
      Pool: class {
        connect = jest.fn(async () => client)
        query = jest.fn()
      },
    }))
  }

  async function loadDigest() {
    return await import('@/lib/digest')
  }

  async function loadClientProfiles() {
    return await import('@/lib/clientProfiles')
  }

  it('throws when userId is provided but does not own the client profile', async () => {
    const client = buildClient(0)
    installPool(client)

    const { getClientProfileById } = await loadClientProfiles()
    ;(getClientProfileById as jest.Mock).mockResolvedValue({
      id: '42',
      agencyName: 'Test',
      telegramChatId: null,
      targetCity: null,
      specialization: null,
      includeKeywords: [],
      excludeKeywords: [],
      dailyDigestLimit: 10,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    })

    const { runDigestForClientProfile } = await loadDigest()

    await expect(
      runDigestForClientProfile({ clientProfileId: '42', userId: '7' }),
    ).rejects.toThrow(/access denied|ownership/i)

    // Ownership check must have been issued
    const ownershipCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /owner_id/i.test(sql),
    )
    expect(ownershipCall).toBeDefined()
  })

  it('proceeds past ownership check when userId is omitted (system caller)', async () => {
    const client = buildClient(0)
    installPool(client)

    const { getClientProfileById } = await loadClientProfiles()
    ;(getClientProfileById as jest.Mock).mockResolvedValue({
      id: '42',
      agencyName: 'Test',
      telegramChatId: null,
      targetCity: null,
      specialization: null,
      includeKeywords: [],
      excludeKeywords: [],
      dailyDigestLimit: 10,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    })

    const { runDigestForClientProfile } = await loadDigest()

    await expect(
      runDigestForClientProfile({ clientProfileId: '42' }),
    ).rejects.not.toThrow(/access denied|ownership/i)

    const ownershipCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /owner_id/i.test(sql),
    )
    expect(ownershipCall).toBeUndefined()
  })
})
