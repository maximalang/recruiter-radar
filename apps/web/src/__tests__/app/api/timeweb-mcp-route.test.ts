/** @jest-environment node */

import { generateKeyPairSync, sign } from 'node:crypto'

jest.mock('@/lib/timeweb-mcp-session', () => {
  type Session = {
    id: string
    subject: string
    upstreamSessionId: string | null
    protocolVersion: string
    createdAt: Date
    lastSeenAt: Date
    expiresAt: Date
    recoveryCount: number
  }

  const localSessionId = '7a287cf2-1e6b-4af2-85e8-937a5eea3f0f'
  const sessions = new Map<string, Session>()
  let sequence = 1

  const makeSession = (id: string, subject = 'rr_owner', protocolVersion = '2025-06-18'): Session => ({
    id,
    subject,
    upstreamSessionId: null,
    protocolVersion,
    createdAt: new Date('2026-08-17T10:00:00.000Z'),
    lastSeenAt: new Date('2026-08-17T10:00:00.000Z'),
    expiresAt: new Date('2026-08-17T22:00:00.000Z'),
    recoveryCount: 0,
  })

  const reset = () => {
    sessions.clear()
    sessions.set(localSessionId, makeSession(localSessionId))
    sequence = 1
  }
  reset()

  const manager = {
    createSession: jest.fn(async (subject: string, protocolVersion = '2025-03-26') => {
      const id = `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`
      const session = makeSession(id, subject, protocolVersion)
      sessions.set(id, session)
      return session
    }),
    findOwnedSession: jest.fn(async (id: string, subject: string) => {
      const session = sessions.get(id)
      return session?.subject === subject ? session : null
    }),
    touch: jest.fn(async (session: Session) => session),
    setUpstreamSession: jest.fn(async (session: Session, upstreamSessionId: string | null) => {
      session.upstreamSessionId = upstreamSessionId
      return session
    }),
    markRecovered: jest.fn(async (session: Session) => {
      session.upstreamSessionId = null
      session.recoveryCount += 1
      return session
    }),
    clear: jest.fn(async (session: Session) => {
      sessions.delete(session.id)
    }),
  }

  return {
    timewebMcpSessionManager: manager,
    __mockSessions: sessions,
    __mockSessionManager: manager,
    __mockResetSessions: reset,
  }
})

import { GET as legacyGet, POST as legacyPost } from '@/app/api/internal/mcp/route'
import {
  DELETE,
  GET,
  POST,
  TIMEWEB_MCP_MAX_BODY_BYTES,
  TIMEWEB_MCP_UPSTREAM,
} from '@/app/api/internal/timeweb-mcp/route'
import { GET as metadataGet } from '@/app/.well-known/oauth-protected-resource/api/internal/timeweb-mcp/route'
import {
  TIMEWEB_MCP_OAUTH_ISSUER,
  TIMEWEB_MCP_RESOURCE,
  TIMEWEB_MCP_SCOPE,
} from '@/lib/timeweb-mcp-auth'

const LOCAL_SESSION_ID = '7a287cf2-1e6b-4af2-85e8-937a5eea3f0f'
type MockSession = {
  id: string
  subject: string
  upstreamSessionId: string | null
  protocolVersion: string
  recoveryCount: number
}
type MockManager = {
  createSession: jest.Mock
  findOwnedSession: jest.Mock
  touch: jest.Mock
  setUpstreamSession: jest.Mock
  markRecovered: jest.Mock
  clear: jest.Mock
}
const mockedSessionModule = jest.requireMock('@/lib/timeweb-mcp-session') as {
  __mockSessions: Map<string, MockSession>
  __mockSessionManager: MockManager
  __mockResetSessions: () => void
}
const mockSessions = mockedSessionModule.__mockSessions
const mockSessionManager = mockedSessionModule.__mockSessionManager
const resetMockSessions = mockedSessionModule.__mockResetSessions

const API_TOKEN = 'timeweb-server-secret-token-do-not-leak'
const NOW = Math.floor(Date.now() / 1000)
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'route-test-key', alg: 'ES256', use: 'sig' }

function accessToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'route-test-key' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: TIMEWEB_MCP_OAUTH_ISSUER,
    aud: TIMEWEB_MCP_RESOURCE,
    sub: 'rr_owner',
    scope: TIMEWEB_MCP_SCOPE,
    iat: NOW - 5,
    exp: NOW + 600,
  })).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${header}.${payload}.${signature}`
}

function postRequest(body: unknown, sessionId: string | null = LOCAL_SESSION_ID, headers: Record<string, string> = {}) {
  const requestHeaders: Record<string, string> = {
    authorization: `Bearer ${accessToken()}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
    'x-real-ip': '203.0.113.40',
    ...headers,
  }
  if (sessionId) requestHeaders['mcp-session-id'] = sessionId
  return new Request(TIMEWEB_MCP_RESOURCE, {
    method: 'POST',
    headers: requestHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function transportRequest(method: 'GET' | 'DELETE', sessionId: string | null = LOCAL_SESSION_ID) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken()}`,
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
    'x-real-ip': '203.0.113.40',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  return new Request(TIMEWEB_MCP_RESOURCE, { method, headers })
}

function oauthResponse(url: string) {
  if (url === `${TIMEWEB_MCP_OAUTH_ISSUER}/.well-known/openid-configuration`) {
    return new Response(JSON.stringify({ issuer: TIMEWEB_MCP_OAUTH_ISSUER, jwks_uri: `${TIMEWEB_MCP_OAUTH_ISSUER}/jwks` }), { status: 200 })
  }
  if (url === `${TIMEWEB_MCP_OAUTH_ISSUER}/jwks`) {
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
  }
  return null
}

function rpcBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? '{}')) as { id?: string | number | null; method: string }
}

function upstreamResponse(body: unknown, sessionId?: string, status = 200) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (sessionId) headers.set('mcp-session-id', sessionId)
  return new Response(JSON.stringify(body), { status, headers })
}

function installHappyUpstream() {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const oauth = oauthResponse(url)
    if (oauth) return oauth
    expect(url).toBe(TIMEWEB_MCP_UPSTREAM)
    const parsed = rpcBody(init)
    if (parsed.method === 'initialize') {
      return upstreamResponse({
        jsonrpc: '2.0',
        id: parsed.id ?? null,
        result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'timeweb', version: '1' } },
      }, `upstream-${String(parsed.id)}`)
    }
    if (parsed.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (parsed.method === 'tools/list') {
      return upstreamResponse({ jsonrpc: '2.0', id: parsed.id ?? null, result: { tools: [] } })
    }
    throw new Error(`unexpected method ${parsed.method}`)
  }) as unknown as typeof fetch
}

const originalFetch = global.fetch
const originalEnv = {
  enabled: process.env.RR_TIMEWEB_MCP_ENABLED,
  token: process.env.RR_TIMEWEB_MCP_TOKEN,
  issuer: process.env.RR_MCP_OAUTH_ISSUER,
  subjects: process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS,
}

describe('Timeweb MCP persistent multi-session bridge', () => {
  beforeEach(() => {
    process.env.RR_TIMEWEB_MCP_ENABLED = 'true'
    process.env.RR_TIMEWEB_MCP_TOKEN = API_TOKEN
    process.env.RR_MCP_OAUTH_ISSUER = TIMEWEB_MCP_OAUTH_ISSUER
    process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS = 'rr_owner'
    resetMockSessions()
    jest.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  afterAll(() => {
    restore('RR_TIMEWEB_MCP_ENABLED', originalEnv.enabled)
    restore('RR_TIMEWEB_MCP_TOKEN', originalEnv.token)
    restore('RR_MCP_OAUTH_ISSUER', originalEnv.issuer)
    restore('RR_MCP_OAUTH_ALLOWED_SUBJECTS', originalEnv.subjects)
  })

  it('publishes exact protected resource metadata without secrets', async () => {
    const response = await metadataGet()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      resource: TIMEWEB_MCP_RESOURCE,
      authorization_servers: [TIMEWEB_MCP_OAUTH_ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: [TIMEWEB_MCP_SCOPE],
    })
    expect(JSON.stringify(body)).not.toContain(API_TOKEN)
  })

  it('returns 401 + RFC 9728 challenge before contacting any upstream', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    const response = await POST(new Request(TIMEWEB_MCP_RESOURCE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.41' },
      body: '{}',
    }))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata="https://recruiter-radar.ru/.well-known/oauth-protected-resource/api/internal/timeweb-mcp"')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('creates a fresh local session for every initialize without a session header', async () => {
    installHappyUpstream()
    const initialize = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    }

    const first = await POST(postRequest(initialize, null))
    const second = await POST(postRequest({ ...initialize, id: 2 }, null))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstId = first.headers.get('mcp-session-id')
    const secondId = second.headers.get('mcp-session-id')
    expect(firstId).toBeTruthy()
    expect(secondId).toBeTruthy()
    expect(firstId).not.toBe(secondId)
    expect(mockSessionManager.createSession).toHaveBeenCalledTimes(2)
  })

  it('rejects non-initialize POST without a local session instead of reusing a subject session', async () => {
    installHappyUpstream()
    const response = await POST(postRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, null))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'missing_session' })
    expect(mockSessionManager.createSession).not.toHaveBeenCalled()
  })

  it('requires exact owned local session on GET and DELETE', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const oauth = oauthResponse(String(input))
      if (oauth) return oauth
      throw new Error('unexpected upstream call')
    }) as unknown as typeof fetch

    const missingGet = await GET(transportRequest('GET', null))
    const missingDelete = await DELETE(transportRequest('DELETE', null))
    const unknown = await GET(transportRequest('GET', '00000000-0000-4000-8000-999999999999'))

    expect(missingGet.status).toBe(400)
    expect(missingDelete.status).toBe(400)
    expect(unknown.status).toBe(404)
    expect(mockSessionManager.createSession).not.toHaveBeenCalled()
  })

  it('initializes the official Timeweb MCP, keeps its session private, and merges local runtime tools', async () => {
    const session = mockSessions.get(LOCAL_SESSION_ID)!
    const upstreamCalls: string[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const oauth = oauthResponse(url)
      if (oauth) return oauth
      expect(url).toBe(TIMEWEB_MCP_UPSTREAM)
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${API_TOKEN}`)
      expect(headers.get('mcp-protocol-version')).toBe('2025-06-18')
      const parsed = rpcBody(init)
      upstreamCalls.push(parsed.method)
      if (parsed.method === 'initialize') {
        return upstreamResponse({
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'timeweb', version: '1' } },
        }, 'upstream-session-1')
      }
      if (parsed.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (parsed.method === 'tools/list') {
        expect(headers.get('mcp-session-id')).toBe('upstream-session-1')
        return upstreamResponse({
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          result: { tools: [{ name: 'official_timeweb_tool', inputSchema: { type: 'object' } }] },
        })
      }
      throw new Error(`unexpected method ${parsed.method}`)
    }) as unknown as typeof fetch

    const response = await POST(postRequest({ jsonrpc: '2.0', id: 4, method: 'tools/list' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('mcp-session-id')).toBe(LOCAL_SESSION_ID)
    expect(response.headers.get('mcp-session-id')).not.toBe('upstream-session-1')
    const body = await response.json() as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'official_timeweb_tool',
      'docker_ps',
      'docker_logs',
      'ssh_execute',
    ]))
    expect(upstreamCalls).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(session.upstreamSessionId).toBe('upstream-session-1')
  })

  it('single-flights concurrent recovery for one local session', async () => {
    const session = mockSessions.get(LOCAL_SESSION_ID)!
    session.upstreamSessionId = 'expired-upstream-session'
    let listCalls = 0
    let initializeCalls = 0
    const expiredWaiters: Array<() => void> = []

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const oauth = oauthResponse(String(input))
      if (oauth) return oauth
      const parsed = rpcBody(init)
      const headers = new Headers(init?.headers)

      if (parsed.method === 'tools/list') {
        listCalls += 1
        if (listCalls <= 2) {
          await new Promise<void>((resolve) => {
            expiredWaiters.push(resolve)
            if (expiredWaiters.length === 2) expiredWaiters.splice(0).forEach((release) => release())
          })
          expect(headers.get('mcp-session-id')).toBe('expired-upstream-session')
          return upstreamResponse({
            jsonrpc: '2.0',
            id: parsed.id ?? null,
            error: { code: -32000, message: 'session expired' },
          }, undefined, 410)
        }
        expect(headers.get('mcp-session-id')).toBe('recovered-upstream-session')
        return upstreamResponse({ jsonrpc: '2.0', id: parsed.id ?? null, result: { tools: [] } })
      }
      if (parsed.method === 'initialize') {
        initializeCalls += 1
        return upstreamResponse({
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          result: { protocolVersion: '2025-06-18', capabilities: {} },
        }, 'recovered-upstream-session')
      }
      if (parsed.method === 'notifications/initialized') return new Response(null, { status: 202 })
      throw new Error(`unexpected method ${parsed.method}`)
    }) as unknown as typeof fetch

    const [first, second] = await Promise.all([
      POST(postRequest({ jsonrpc: '2.0', id: 5, method: 'tools/list' })),
      POST(postRequest({ jsonrpc: '2.0', id: 6, method: 'tools/list' })),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(listCalls).toBe(4)
    expect(initializeCalls).toBe(1)
    expect(mockSessionManager.markRecovered).toHaveBeenCalledTimes(1)
    expect(session.recoveryCount).toBe(1)
    expect(session.upstreamSessionId).toBe('recovered-upstream-session')
  })

  it('deletes only the requested local session and leaves a sibling session intact', async () => {
    const siblingId = '00000000-0000-4000-8000-000000000777'
    mockSessions.set(siblingId, {
      ...mockSessions.get(LOCAL_SESSION_ID)!,
      id: siblingId,
    })
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const oauth = oauthResponse(String(input))
      if (oauth) return oauth
      throw new Error('unexpected upstream call')
    }) as unknown as typeof fetch

    const response = await DELETE(transportRequest('DELETE', LOCAL_SESSION_ID))

    expect(response.status).toBe(204)
    expect(mockSessions.has(LOCAL_SESSION_ID)).toBe(false)
    expect(mockSessions.has(siblingId)).toBe(true)
  })

  it('does not follow an upstream redirect or leak the server credential', async () => {
    mockSessions.get(LOCAL_SESSION_ID)!.upstreamSessionId = 'upstream-session-1'
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const oauth = oauthResponse(String(input))
      if (oauth) return oauth
      return new Response(null, { status: 307, headers: { location: 'https://evil.example/mcp' } })
    }) as unknown as typeof fetch

    const response = await POST(postRequest({ jsonrpc: '2.0', id: 7, method: 'tools/list' }))
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain(API_TOKEN)
    expect(text).not.toContain('evil.example')
  })

  it('rejects declared oversized bodies before OAuth discovery or Timeweb', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    const huge = 'x'.repeat(TIMEWEB_MCP_MAX_BODY_BYTES + 1)
    const response = await POST(new Request(TIMEWEB_MCP_RESOURCE, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken()}`,
        'content-type': 'application/json',
        'content-length': String(huge.length),
        'x-real-ip': '203.0.113.42',
      },
      body: huge,
    }))
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'request_too_large' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('keeps the legacy Recruiter Radar MCP endpoint fail-closed for every MCP method', async () => {
    const get = await legacyGet()
    const post = await legacyPost()
    expect(get.status).toBe(404)
    expect(post.status).toBe(404)
    expect(await get.json()).toEqual({ error: 'not_found' })
  })
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
