/** @jest-environment node */

import { generateKeyPairSync, sign } from 'node:crypto'

jest.mock('@/lib/timeweb-mcp-session', () => {
  const session = {
    id: '7a287cf2-1e6b-4af2-85e8-937a5eea3f0f',
    subject: 'rr_owner',
    upstreamSessionId: null as string | null,
    protocolVersion: '2025-06-18',
    createdAt: new Date('2026-08-16T10:00:00.000Z'),
    lastSeenAt: new Date('2026-08-16T10:00:00.000Z'),
    expiresAt: new Date('2026-08-16T22:00:00.000Z'),
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
  return {
    timewebMcpSessionManager: manager,
    __mockSession: session,
    __mockSessionManager: manager,
  }
})

import { GET as legacyGet, POST as legacyPost } from '@/app/api/internal/mcp/route'
import {
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
  getOrCreate: jest.Mock
  touch: jest.Mock
  setUpstreamSession: jest.Mock
  markRecovered: jest.Mock
  clear: jest.Mock
}
const mockedSessionModule = jest.requireMock('@/lib/timeweb-mcp-session') as {
  __mockSession: MockSession
  __mockSessionManager: MockManager
}
const mockSession = mockedSessionModule.__mockSession
const mockSessionManager = mockedSessionModule.__mockSessionManager

const API_TOKEN = 'timeweb-server-secret-token-do-not-leak'
const NOW = Math.floor(Date.now() / 1000)
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'route-test-key', alg: 'ES256', use: 'sig' }

function accessToken(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'route-test-key' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: TIMEWEB_MCP_OAUTH_ISSUER,
    aud: TIMEWEB_MCP_RESOURCE,
    sub: 'rr_owner',
    scope: TIMEWEB_MCP_SCOPE,
    iat: NOW - 5,
    exp: NOW + 600,
    ...overrides,
  })).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${header}.${payload}.${signature}`
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(TIMEWEB_MCP_RESOURCE, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken()}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      'mcp-session-id': LOCAL_SESSION_ID,
      'x-real-ip': '203.0.113.40',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
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

const originalFetch = global.fetch
const originalEnv = {
  enabled: process.env.RR_TIMEWEB_MCP_ENABLED,
  token: process.env.RR_TIMEWEB_MCP_TOKEN,
  issuer: process.env.RR_MCP_OAUTH_ISSUER,
  subjects: process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS,
}

describe('Timeweb MCP persistent fixed-upstream bridge', () => {
  beforeEach(() => {
    process.env.RR_TIMEWEB_MCP_ENABLED = 'true'
    process.env.RR_TIMEWEB_MCP_TOKEN = API_TOKEN
    process.env.RR_MCP_OAUTH_ISSUER = TIMEWEB_MCP_OAUTH_ISSUER
    process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS = 'rr_owner'
    mockSession.upstreamSessionId = null
    mockSession.protocolVersion = '2025-06-18'
    mockSession.recoveryCount = 0
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

  it('initializes the official Timeweb MCP, keeps its session private, and merges local runtime tools', async () => {
    const upstreamCalls: Array<{ method: string; headers: Headers }> = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const oauth = oauthResponse(url); if (oauth) return oauth
      expect(url).toBe(TIMEWEB_MCP_UPSTREAM)
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${API_TOKEN}`)
      expect(headers.get('mcp-protocol-version')).toBe('2025-06-18')
      expect(headers.get('x-user-upstream')).toBeNull()
      const parsed = rpcBody(init)
      upstreamCalls.push({ method: parsed.method, headers })

      if (parsed.method === 'initialize') {
        expect(headers.get('mcp-session-id')).toBeNull()
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

    const response = await POST(request(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { 'x-user-upstream': 'https://evil.example/' },
    ))
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
    expect(upstreamCalls.map((call) => call.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
  })

  it('recovers an expired upstream session and retries the original request exactly once', async () => {
    mockSession.upstreamSessionId = 'expired-upstream-session'
    let listCalls = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const oauth = oauthResponse(String(input)); if (oauth) return oauth
      const parsed = rpcBody(init)
      const headers = new Headers(init?.headers)

      if (parsed.method === 'tools/list') {
        listCalls += 1
        if (listCalls === 1) {
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
        return upstreamResponse({
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          result: { protocolVersion: '2025-06-18', capabilities: {} },
        }, 'recovered-upstream-session')
      }
      if (parsed.method === 'notifications/initialized') return new Response(null, { status: 202 })
      throw new Error(`unexpected method ${parsed.method}`)
    }) as unknown as typeof fetch

    const response = await POST(request({ jsonrpc: '2.0', id: 5, method: 'tools/list' }))
    expect(response.status).toBe(200)
    expect(listCalls).toBe(2)
    expect(mockSessionManager.markRecovered).toHaveBeenCalledTimes(1)
    expect(mockSession.recoveryCount).toBe(1)
    expect(mockSession.upstreamSessionId).toBe('recovered-upstream-session')
  })

  it('does not follow an upstream redirect or leak the server credential', async () => {
    mockSession.upstreamSessionId = 'upstream-session-1'
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const oauth = oauthResponse(String(input)); if (oauth) return oauth
      return new Response(null, { status: 307, headers: { location: 'https://evil.example/mcp' } })
    }) as unknown as typeof fetch

    const response = await POST(request({ jsonrpc: '2.0', id: 6, method: 'tools/list' }))
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain(API_TOKEN)
    expect(text).not.toContain('evil.example')
    expect(JSON.parse(text)).toEqual(expect.objectContaining({
      error: expect.objectContaining({ data: { status: 502 } }),
    }))
  })

  it('returns a bounded JSON-RPC timeout error for an established upstream session', async () => {
    mockSession.upstreamSessionId = 'upstream-session-1'
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const oauth = oauthResponse(String(input)); if (oauth) return oauth
      throw new DOMException('Timed out', 'TimeoutError')
    }) as unknown as typeof fetch

    const response = await POST(request({ jsonrpc: '2.0', id: 7, method: 'tools/list' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32002, message: 'Upstream timeout' },
    })
    expect(mockSessionManager.markRecovered).not.toHaveBeenCalled()
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
