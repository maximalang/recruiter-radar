/** @jest-environment node */

import { generateKeyPairSync, sign } from 'node:crypto'

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
      'mcp-session-id': 'session-from-chatgpt',
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

const originalFetch = global.fetch
const originalEnv = {
  enabled: process.env.RR_TIMEWEB_MCP_ENABLED,
  token: process.env.RR_TIMEWEB_MCP_TOKEN,
  issuer: process.env.RR_MCP_OAUTH_ISSUER,
  subjects: process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS,
}

describe('Timeweb MCP fixed-upstream bridge', () => {
  beforeEach(() => {
    process.env.RR_TIMEWEB_MCP_ENABLED = 'true'
    process.env.RR_TIMEWEB_MCP_TOKEN = API_TOKEN
    process.env.RR_MCP_OAUTH_ISSUER = TIMEWEB_MCP_OAUTH_ISSUER
    process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS = 'rr_owner'
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
    const response = await POST(new Request(TIMEWEB_MCP_RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.41' }, body: '{}' }))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata="https://recruiter-radar.ru/.well-known/oauth-protected-resource/api/internal/timeweb-mcp"')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('proxies tools/list and tools/call unchanged to the one fixed Timeweb endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const oauth = oauthResponse(url); if (oauth) return oauth
      calls.push({ url, init })
      expect(url).toBe(TIMEWEB_MCP_UPSTREAM)
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${API_TOKEN}`)
      expect(headers.get('mcp-protocol-version')).toBe('2025-06-18')
      expect(headers.get('mcp-session-id')).toBe('session-from-chatgpt')
      expect(headers.get('x-user-upstream')).toBeNull()
      const parsed = JSON.parse(Buffer.from(init?.body as ArrayBuffer).toString('utf8'))
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { mirroredMethod: parsed.method } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-from-timeweb', 'mcp-protocol-version': '2025-06-18' },
      })
    }) as unknown as typeof fetch

    for (const [id, method] of [[1, 'tools/list'], [2, 'tools/call']] as const) {
      const payload = method === 'tools/list'
        ? { jsonrpc: '2.0', id, method }
        : { jsonrpc: '2.0', id, method, params: { name: 'read_only_example', arguments: {} } }
      const response = await POST(request(payload, { 'x-user-upstream': 'https://evil.example/', authorization: `Bearer ${accessToken()}` }))
      expect(response.status).toBe(200)
      expect(response.headers.get('mcp-session-id')).toBe('session-from-timeweb')
      expect(await response.json()).toEqual({ jsonrpc: '2.0', id, result: { mirroredMethod: method } })
    }
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.url === TIMEWEB_MCP_UPSTREAM)).toBe(true)
    expect(JSON.stringify(calls.map((call) => call.url))).not.toContain('evil.example')
  })

  it.each([401, 403, 429, 500, 503])('passes through upstream %i without leaking the server credential', async (status) => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const oauth = oauthResponse(String(input)); if (oauth) return oauth
      return new Response(JSON.stringify({ error: `upstream-${status}` }), { status, headers: { 'content-type': 'application/json', 'retry-after': status === 429 ? '10' : '' } })
    }) as unknown as typeof fetch
    const response = await POST(request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    expect(response.status).toBe(status)
    const text = await response.text()
    expect(text).not.toContain(API_TOKEN)
    expect([...response.headers.entries()].join('\n')).not.toContain(API_TOKEN)
  })

  it('refuses upstream redirects instead of following them', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const oauth = oauthResponse(String(input)); if (oauth) return oauth
      return new Response(null, { status: 307, headers: { location: 'https://evil.example/mcp' } })
    }) as unknown as typeof fetch
    const response = await POST(request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'upstream_redirect_refused' })
  })

  it('maps an upstream timeout to 504', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const oauth = oauthResponse(String(input)); if (oauth) return oauth
      throw new DOMException('Timed out', 'TimeoutError')
    }) as unknown as typeof fetch
    const response = await POST(request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: 'upstream_timeout' })
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
