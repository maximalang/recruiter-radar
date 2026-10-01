/**
 * G3+G4: testNotificationConnection across telegram/vk/webhook and the real
 * sendSignedWebhook HTTP round-trip.
 *
 * G4 delivery evidence: the webhook path is NOT mocked. A real local HTTP
 * server (node:http on an ephemeral loopback port) receives the delivery,
 * recomputes the HMAC-SHA256 over the exact raw body with the real signing
 * secret and only accepts a matching X-Radar-Signature header. NODE_ENV is
 * 'test' under jest, which is what allows the http://localhost loopback
 * target by design (localWebhookAllowed in notification-providers).
 *
 * jest.setup.ts replaces global.fetch with a stub, so this suite installs a
 * minimal node:http-backed fetch shim for the loopback round-trips.
 */

import { createHmac } from 'node:crypto'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'

jest.mock('@/lib/db-pool', () => ({
  getPool: jest.fn(),
}))
jest.mock('@/lib/notification-providers', () => {
  const actual = jest.requireActual('@/lib/notification-providers')
  return {
    ...actual,
    sendTelegramNotification: jest.fn(),
    sendVkNotification: jest.fn(),
    // validateWebhookUrl and sendSignedWebhook intentionally REAL (G4).
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
import {
  sendSignedWebhook,
  sendTelegramNotification,
  sendVkNotification,
} from '@/lib/notification-providers'
import { decryptNotificationSecret } from '@/lib/notification-secrets'
import { testNotificationConnection } from '@/lib/notifications'

const mockGetPool = jest.mocked(getPool)
const mockSendTelegram = jest.mocked(sendTelegramNotification)
const mockSendVk = jest.mocked(sendVkNotification)
const mockDecrypt = jest.mocked(decryptNotificationSecret)

const TEST_MESSAGE =
  'Recruiter Radar: тестовое уведомление доставлено. Канал настроен правильно.'

// ---------------------------------------------------------------------------
// fetch shim (jest.setup.ts stubs global.fetch with jest.fn())
// ---------------------------------------------------------------------------

const stubbedFetch = global.fetch

function installLocalFetch(): void {
  global.fetch = ((
    input: unknown,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(String(input))
      const req = httpRequest(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: `${url.pathname}${url.search}`,
          method: init?.method ?? 'GET',
          headers: init?.headers ?? {},
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)))
          res.on('end', () => {
            const headers: Record<string, string> = {}
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === 'string') headers[key] = value
              else if (Array.isArray(value)) headers[key] = value.join(', ')
            }
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode ?? 200,
                headers,
              }),
            )
          })
        },
      )
      req.on('error', reject)
      if (init?.body != null) req.write(init.body)
      req.end()
    })) as unknown as typeof fetch
}

// ---------------------------------------------------------------------------
// local webhook server harness
// ---------------------------------------------------------------------------

type CapturedRequest = {
  method: string
  headers: Record<string, string | string[] | undefined>
  rawBody: string
  json: Record<string, unknown> | null
  hmacValid: boolean | null
}

type ServerHandle = {
  baseUrl: string
  captured: CapturedRequest[]
  close: () => Promise<void>
}

function startWebhookServer(options: {
  status?: number
  verifyWith?: string | null
  redirectLocation?: string
} = {}): Promise<ServerHandle> {
  return new Promise((resolve) => {
    const captured: CapturedRequest[] = []
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(Buffer.from(c)))
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        let json: Record<string, unknown> | null = null
        try {
          json = JSON.parse(rawBody) as Record<string, unknown>
        } catch {
          json = null
        }
        let hmacValid: boolean | null = null
        if (options.verifyWith) {
          const expected =
            'sha256=' + createHmac('sha256', options.verifyWith).update(rawBody).digest('hex')
          hmacValid = String(req.headers['x-radar-signature'] ?? '') === expected
        }
        captured.push({ method: req.method ?? '', headers: req.headers, rawBody, json, hmacValid })
        if (options.redirectLocation) {
          res.writeHead(302, { Location: options.redirectLocation })
          res.end()
          return
        }
        const status = options.status ?? 200
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ received: status < 300 }))
      })
    })
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        baseUrl: `http://localhost:${port}`,
        captured,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      })
    })
  })
}

// ---------------------------------------------------------------------------
// db harness
// ---------------------------------------------------------------------------

type AccountRow = {
  id: string
  publicId: string
  ownerId: string
  clientProfileId: string
  provider: 'telegram' | 'vk' | 'webhook'
  displayName: string
  status: 'active'
  externalAccountId: string | null
  externalAccountName: string | null
  secretCiphertext: string
  providerMetadata: Record<string, unknown> | null
}

function makeAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'conn-1',
    publicId: 'public-1',
    ownerId: '10',
    clientProfileId: '7',
    provider: 'telegram',
    displayName: 'Test channel',
    status: 'active',
    externalAccountId: null,
    externalAccountName: null,
    secretCiphertext: 'enc:telegram',
    providerMetadata: {},
    ...overrides,
  }
}

type EndpointRow = { id: string; destinationId: string; destinationLabel: string | null }

function makePool(account: AccountRow | null, endpointRow: EndpointRow | null) {
  const queries: string[] = []
  const pool = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql)
      if (sql.includes('FROM notification_provider_accounts')) {
        return account ? { rows: [account], rowCount: 1 } : { rows: [], rowCount: 0 }
      }
      if (sql.includes('FROM notification_endpoints')) {
        return endpointRow ? { rows: [endpointRow], rowCount: 1 } : { rows: [], rowCount: 0 }
      }
      return { rows: [], rowCount: 1 }
    }),
  }
  return { pool, queries }
}

const credentialStore: Record<string, unknown> = {}

beforeAll(() => {
  installLocalFetch()
})

afterAll(() => {
  global.fetch = stubbedFetch
})

beforeEach(() => {
  jest.clearAllMocks()
  for (const key of Object.keys(credentialStore)) delete credentialStore[key]
  mockDecrypt.mockImplementation(((ciphertext: string) => credentialStore[ciphertext]) as never)
})

// ---------------------------------------------------------------------------
// testNotificationConnection per provider
// ---------------------------------------------------------------------------

describe('testNotificationConnection', () => {
  it('delivers the telegram test message and stamps last_delivery_at', async () => {
    credentialStore['enc:telegram'] = {
      botToken: 'tg-bot-token',
      webhookSecret: 'tg-webhook-secret',
      username: 'test_bot',
    }
    const { pool, queries } = makePool(makeAccount({ provider: 'telegram' }), {
      id: 'ep-tg',
      destinationId: '-100123',
      destinationLabel: 'Private chat',
    })
    mockGetPool.mockReturnValue(pool as never)
    mockSendTelegram.mockResolvedValue({ providerMessageId: '77' })

    await expect(
      testNotificationConnection({ ownerId: 10, connectionId: 'conn-1' }),
    ).resolves.toBeUndefined()

    expect(mockSendTelegram).toHaveBeenCalledWith({
      botToken: 'tg-bot-token',
      chatId: '-100123',
      text: TEST_MESSAGE,
    })
    expect(
      queries.some((q) => q.includes('UPDATE notification_endpoints') && q.includes('last_delivery_at')),
    ).toBe(true)
  })

  it('delivers the vk test message and stamps last_delivery_at', async () => {
    credentialStore['enc:vk'] = {
      token: 'vk-token',
      groupId: '555',
      callbackSecret: 'cb-secret',
      confirmationCode: 'code-1',
    }
    const { pool, queries } = makePool(
      makeAccount({ provider: 'vk', secretCiphertext: 'enc:vk' }),
      { id: 'ep-vk', destinationId: '2000000000012', destinationLabel: 'VK диалог' },
    )
    mockGetPool.mockReturnValue(pool as never)
    mockSendVk.mockResolvedValue({ providerMessageId: 'vk-1' })

    await expect(
      testNotificationConnection({ ownerId: 10, connectionId: 'conn-1' }),
    ).resolves.toBeUndefined()

    expect(mockSendVk).toHaveBeenCalledWith({
      token: 'vk-token',
      peerId: '2000000000012',
      text: TEST_MESSAGE,
      randomId: expect.any(Number),
    })
    expect(
      queries.some((q) => q.includes('UPDATE notification_endpoints') && q.includes('last_delivery_at')),
    ).toBe(true)
  })

  it('delivers the webhook test message over real local HTTP with a valid HMAC (G4)', async () => {
    const secret = 'local-webhook-signing-secret'
    const server = await startWebhookServer({ verifyWith: secret })
    try {
      credentialStore['enc:webhook'] = { url: `${server.baseUrl}/hook`, signingSecret: secret }
      const { pool, queries } = makePool(
        makeAccount({ provider: 'webhook', id: 'conn-wh', secretCiphertext: 'enc:webhook' }),
        { id: 'ep-wh', destinationId: 'webhook:tok-hash-value', destinationLabel: 'localhost' },
      )
      mockGetPool.mockReturnValue(pool as never)

      await expect(
        testNotificationConnection({ ownerId: 10, connectionId: 'conn-wh' }),
      ).resolves.toBeUndefined()

      expect(server.captured).toHaveLength(1)
      const delivered = server.captured[0]
      expect(delivered.method).toBe('POST')
      expect(delivered.hmacValid).toBe(true)
      expect(delivered.headers['x-radar-event']).toBe('notification.test')
      expect(String(delivered.headers['x-radar-event-id'] ?? '')).toMatch(/^test_/)
      expect(delivered.headers['idempotency-key']).toBe(delivered.headers['x-radar-event-id'])
      expect(Number.isNaN(Date.parse(String(delivered.headers['x-radar-timestamp'])))).toBe(false)
      expect(delivered.json).not.toBeNull()
      expect(delivered.json!.event).toBe('notification.test')
      expect(delivered.json!.event_id).toBe(delivered.headers['x-radar-event-id'])
      const data = delivered.json!.data as { text: string; connection_id: string }
      expect(data.text).toBe(TEST_MESSAGE)
      expect(data.connection_id).toBe('conn-wh')
      expect(
        queries.some((q) => q.includes('UPDATE notification_endpoints') && q.includes('last_delivery_at')),
      ).toBe(true)
      // Sanitized G4 evidence line: no URLs, no secret material.
      console.log(
        '[evidence] G4 real local HTTP webhook delivery: hmac_verified=' +
          String(delivered.hmacValid) +
          ' http_status=200 node_env=' +
          String(process.env.NODE_ENV),
      )
    } finally {
      await server.close()
    }
  })

  it('fails with the bind-first error when no active endpoint exists', async () => {
    const { pool, queries } = makePool(makeAccount({ provider: 'telegram' }), null)
    mockGetPool.mockReturnValue(pool as never)

    await expect(
      testNotificationConnection({ ownerId: 10, connectionId: 'conn-1' }),
    ).rejects.toThrow(/Сначала привяжите чат или точку доставки/)

    expect(mockSendTelegram).not.toHaveBeenCalled()
    expect(mockSendVk).not.toHaveBeenCalled()
    expect(queries.some((q) => q.includes('UPDATE notification_endpoints'))).toBe(false)
  })

  it('fails when DATABASE_URL is not configured', async () => {
    mockGetPool.mockReturnValue(null)

    await expect(
      testNotificationConnection({ ownerId: 10, connectionId: 'conn-1' }),
    ).rejects.toThrow(/DATABASE_URL/)
  })
})

// ---------------------------------------------------------------------------
// sendSignedWebhook against the real local server
// ---------------------------------------------------------------------------

describe('sendSignedWebhook (real local HTTP)', () => {
  it('signs the exact raw body and sends the radar headers', async () => {
    const secret = 'direct-signing-secret'
    const server = await startWebhookServer({ verifyWith: secret })
    try {
      const result = await sendSignedWebhook({
        url: `${server.baseUrl}/hook`,
        secret,
        event: 'notification.test',
        eventId: 'test_direct_1',
        payload: { text: 'hello', connection_id: 'conn-direct' },
      })

      expect(result.status).toBe(200)
      expect(server.captured).toHaveLength(1)
      const delivered = server.captured[0]
      expect(delivered.hmacValid).toBe(true)
      expect(delivered.headers['content-type']).toBe('application/json')
      expect(delivered.headers['x-radar-event']).toBe('notification.test')
      expect(delivered.headers['x-radar-event-id']).toBe('test_direct_1')
      expect(delivered.headers['idempotency-key']).toBe('test_direct_1')
      const expectedSignature =
        'sha256=' + createHmac('sha256', secret).update(delivered.rawBody).digest('hex')
      expect(delivered.headers['x-radar-signature']).toBe(expectedSignature)
      expect(delivered.json).toEqual({
        event: 'notification.test',
        event_id: 'test_direct_1',
        occurred_at: expect.any(String),
        data: { text: 'hello', connection_id: 'conn-direct' },
      })
      expect(JSON.parse(delivered.rawBody)).toEqual(delivered.json)
      // Sanitized G4 evidence line.
      console.log(
        '[evidence] G4 sendSignedWebhook: hmac_sha256=verified signature_header=sha256-prefix idempotency_key=present',
      )
    } finally {
      await server.close()
    }
  })

  it('rejects redirects without following them', async () => {
    const server = await startWebhookServer({ redirectLocation: 'https://evil.example.com' })
    try {
      await expect(
        sendSignedWebhook({
          url: `${server.baseUrl}/hook`,
          secret: 'redirect-secret',
          event: 'notification.test',
          eventId: 'test_redirect_1',
          payload: {},
        }),
      ).rejects.toMatchObject({ code: 'webhook_redirect_blocked' })
    } finally {
      await server.close()
    }
  })

  it('surfaces HTTP 500 as a provider error', async () => {
    const server = await startWebhookServer({ status: 500 })
    try {
      await expect(
        sendSignedWebhook({
          url: `${server.baseUrl}/hook`,
          secret: 'error-secret',
          event: 'notification.test',
          eventId: 'test_error_1',
          payload: {},
        }),
      ).rejects.toThrow(/Webhook returned HTTP 500/)
    } finally {
      await server.close()
    }
  })

  it('fails closed when the receiver rejects the HMAC signature', async () => {
    const server = await startWebhookServer({ status: 401, verifyWith: 'another-secret' })
    try {
      await expect(
        sendSignedWebhook({
          url: `${server.baseUrl}/hook`,
          secret: 'signing-secret',
          event: 'notification.test',
          eventId: 'test_hmac_1',
          payload: {},
        }),
      ).rejects.toThrow(/Webhook returned HTTP 401/)
      expect(server.captured[0].hmacValid).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('propagates webhook failure from testNotificationConnection without stamping delivery', async () => {
    const server = await startWebhookServer({ status: 500, verifyWith: 'wh-secret' })
    try {
      credentialStore['enc:webhook'] = { url: `${server.baseUrl}/hook`, signingSecret: 'wh-secret' }
      const { pool, queries } = makePool(
        makeAccount({ provider: 'webhook', id: 'conn-wh2', secretCiphertext: 'enc:webhook' }),
        { id: 'ep-wh2', destinationId: 'webhook:tok-hash-value', destinationLabel: 'localhost' },
      )
      mockGetPool.mockReturnValue(pool as never)

      await expect(
        testNotificationConnection({ ownerId: 10, connectionId: 'conn-wh2' }),
      ).rejects.toThrow(/Webhook returned HTTP 500/)
      expect(server.captured).toHaveLength(1)
      expect(server.captured[0].hmacValid).toBe(true)
      expect(queries.some((q) => q.includes('UPDATE notification_endpoints'))).toBe(false)
    } finally {
      await server.close()
    }
  })
})
