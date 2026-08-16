/** @jest-environment node */

const session = {
  id: '3a7438ab-a476-4771-a833-934797eeb23b',
  subject: 'rr_owner',
  upstreamSessionId: null as string | null,
  protocolVersion: '2025-11-25',
  createdAt: new Date('2026-08-16T16:10:00.000Z'),
  lastSeenAt: new Date('2026-08-16T16:10:00.000Z'),
  expiresAt: new Date('2026-08-17T04:10:00.000Z'),
  recoveryCount: 0,
}

const manager = {
  getOrCreate: jest.fn(async (_subject: string, _requestedId?: string | null, protocolVersion = '2025-03-26') => {
    session.protocolVersion = protocolVersion
    return { session, created: false }
  }),
  touch: jest.fn(async () => session),
  setUpstreamSession: jest.fn(async (_session: unknown, upstreamSessionId: string | null) => {
    session.upstreamSessionId = upstreamSessionId
    return session
  }),
  markRecovered: jest.fn(async () => {
    session.upstreamSessionId = null
    session.recoveryCount += 1
    return session
  }),
  clear: jest.fn(async () => undefined),
}

jest.mock('@/lib/timeweb-mcp-session', () => ({
  timewebMcpSessionManager: manager,
}))

jest.mock('@/lib/timeweb-mcp-auth', () => ({
  TIMEWEB_MCP_PREAUTH_RATE_LIMIT: 120,
  checkTimewebMcpRateLimit: jest.fn(() => ({ allowed: true, retryAfterSeconds: 1 })),
  getTimewebMcpAuthenticateChallenge: jest.fn(() => 'Bearer'),
  isTimewebMcpConfigured: jest.fn(() => true),
  verifyTimewebMcpAccessToken: jest.fn(async () => ({
    ok: true,
    subject: 'rr_owner',
    scopes: new Set(['rr.timeweb.manage']),
  })),
}))

import { POST, TIMEWEB_MCP_UPSTREAM } from '@/app/api/internal/timeweb-mcp/route'

const originalFetch = global.fetch
const originalToken = process.env.RR_TIMEWEB_MCP_TOKEN

function request(id: number) {
  return new Request('https://recruiter-radar.ru/api/internal/timeweb-mcp', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-access-token',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      'mcp-session-id': session.id,
      'x-real-ip': '203.0.113.50',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list' }),
  })
}

function rpcMethod(init?: RequestInit) {
  return (JSON.parse(String(init?.body ?? '{}')) as { method?: string }).method
}

function rpcResponse(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Timeweb MCP stateless upstream compatibility', () => {
  beforeAll(() => {
    process.env.RR_TIMEWEB_MCP_TOKEN = 'server-side-timeweb-token'
  })

  afterAll(() => {
    global.fetch = originalFetch
    if (originalToken === undefined) delete process.env.RR_TIMEWEB_MCP_TOKEN
    else process.env.RR_TIMEWEB_MCP_TOKEN = originalToken
  })

  it('keeps the local ChatGPT session alive when Timeweb initialize succeeds without Mcp-Session-Id', async () => {
    let initializeCalls = 0
    let notificationCalls = 0
    let listCalls = 0

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(TIMEWEB_MCP_UPSTREAM)
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer server-side-timeweb-token')
      expect(headers.get('mcp-protocol-version')).toBe('2025-11-25')
      expect(headers.get('mcp-session-id')).toBeNull()

      const method = rpcMethod(init)
      if (method === 'initialize') {
        initializeCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        const body = JSON.parse(String(init?.body)) as { id: unknown }
        return rpcResponse(body.id, {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'timeweb-cloud', version: 'test' },
        })
      }
      if (method === 'notifications/initialized') {
        notificationCalls += 1
        return new Response(null, { status: 202 })
      }
      if (method === 'tools/list') {
        listCalls += 1
        const body = JSON.parse(String(init?.body)) as { id: unknown }
        return rpcResponse(body.id, {
          tools: [{ name: 'official_timeweb_tool', inputSchema: { type: 'object' } }],
        })
      }
      throw new Error(`unexpected upstream method: ${method}`)
    }) as unknown as typeof fetch

    const [first, second] = await Promise.all([POST(request(1)), POST(request(2))])
    const third = await POST(request(3))

    for (const response of [first, second, third]) {
      expect(response.status).toBe(200)
      expect(response.headers.get('mcp-session-id')).toBe(session.id)
      const body = await response.json() as { result?: { tools?: Array<{ name: string }> } }
      expect(body.result?.tools?.some((tool) => tool.name === 'official_timeweb_tool')).toBe(true)
    }

    expect(initializeCalls).toBe(1)
    expect(notificationCalls).toBe(1)
    expect(listCalls).toBe(3)
    expect(manager.setUpstreamSession).not.toHaveBeenCalled()
    expect(manager.markRecovered).not.toHaveBeenCalled()
    expect(session.upstreamSessionId).toBeNull()
  })
})
