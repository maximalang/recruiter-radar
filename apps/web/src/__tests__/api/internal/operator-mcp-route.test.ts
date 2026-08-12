/** @jest-environment node */

import { generateKeyPairSync, sign } from 'node:crypto'
import { NextRequest } from 'next/server'

jest.mock('@/lib/db-pool', () => ({
  getClient: jest.fn(),
}))

import { getClient } from '@/lib/db-pool'
import {
  OPERATOR_MCP_PROTOCOL_VERSION,
  getOperatorMcpTools,
} from '@/lib/operator-mcp'
import {
  OPERATOR_MCP_RATE_LIMIT,
  OPERATOR_MCP_REQUIRED_SCOPE,
  OPERATOR_MCP_RESOURCE,
  checkOperatorMcpRateLimit,
  resetOperatorMcpSecurityCachesForTests,
} from '@/lib/operator-mcp-auth'
import { GET, POST } from '@/app/api/internal/mcp/route'
import { GET as GET_PROTECTED_RESOURCE } from '@/app/.well-known/oauth-protected-resource/route'

const mockedGetClient = jest.mocked(getClient)
const ISSUER = 'https://auth.example.test'
const SUBJECT = 'auth0|operator-123'
const KID = 'operator-test-key'
const NOW_SECONDS = Math.floor(Date.now() / 1000)

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicJwk = {
  ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
  kid: KID,
  alg: 'RS256',
  use: 'sig',
}

function request(
  body: Record<string, unknown>,
  options: { token?: string; modern?: boolean; origin?: string; realIp?: string } = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-real-ip': options.realIp ?? '203.0.113.10',
  }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
  if (options.origin !== undefined) headers.origin = options.origin
  if (options.modern) {
    headers['mcp-protocol-version'] = OPERATOR_MCP_PROTOCOL_VERSION
    headers['mcp-method'] = String(body.method ?? '')
    if (body.method === 'tools/call') {
      const params = body.params as { name?: string } | undefined
      if (params?.name) headers['mcp-name'] = params.name
    }
  }
  return new NextRequest('https://recruiter-radar.ru/api/internal/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function rpc(method: string, params: Record<string, unknown> = {}, id: number | string = 1) {
  return { jsonrpc: '2.0', id, method, params }
}

function encodeJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function accessToken(overrides: Record<string, unknown> = {}) {
  const header = encodeJson({ alg: 'RS256', typ: 'JWT', kid: KID })
  const payload = encodeJson({
    iss: ISSUER,
    aud: OPERATOR_MCP_RESOURCE,
    sub: SUBJECT,
    scope: OPERATOR_MCP_REQUIRED_SCOPE,
    iat: NOW_SECONDS - 30,
    exp: NOW_SECONDS + 3600,
    ...overrides,
  })
  const signingInput = `${header}.${payload}`
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
    .toString('base64url')
  return `${signingInput}.${signature}`
}

function mockOAuthDiscovery() {
  global.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
      })
    }
    if (url === `${ISSUER}/.well-known/jwks.json`) {
      return Response.json({ keys: [publicJwk] })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

function mockReadOnlyClient() {
  const client = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes("current_setting('server_version')")) {
        return { rows: [{ serverVersion: '16.9', inRecovery: false, serverTime: '2026-08-10T16:00:00.000Z' }] }
      }
      if (sql.includes("TO_REGCLASS('public.schema_migrations')")) {
        return { rows: [{ present: true }] }
      }
      if (sql.includes('FROM schema_migrations')) {
        return {
          rows: [{
            migrationCount: '42',
            latestMigration: '20260809140000_add_query_plan_quality_feedback_v2',
            latestAppliedAt: '2026-08-10T15:00:00.000Z',
          }],
        }
      }
      return { rows: [] }
    }),
    release: jest.fn(),
  }
  mockedGetClient.mockResolvedValue(client as never)
  return client
}

describe('read-only operator MCP route', () => {
  const originalEnabled = process.env.RR_MCP_ENABLED
  const originalIssuer = process.env.RR_MCP_OAUTH_ISSUER
  const originalSubjects = process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS
  const originalDeploySha = process.env.RR_DEPLOY_SHA
  const originalDatabaseUrl = process.env.DATABASE_URL
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.RR_MCP_ENABLED = 'true'
    process.env.RR_MCP_OAUTH_ISSUER = ISSUER
    process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS = SUBJECT
    process.env.RR_DEPLOY_SHA = '9c343597a1e49175220d4c95134d4a03fb8bcd0d'
    process.env.DATABASE_URL = 'postgres://redacted.example.invalid/database'
    delete process.env.RR_MCP_TOKEN
    resetOperatorMcpSecurityCachesForTests()
    jest.clearAllMocks()
    mockOAuthDiscovery()
  })

  afterAll(() => {
    restore('RR_MCP_ENABLED', originalEnabled)
    restore('RR_MCP_OAUTH_ISSUER', originalIssuer)
    restore('RR_MCP_OAUTH_ALLOWED_SUBJECTS', originalSubjects)
    restore('RR_DEPLOY_SHA', originalDeploySha)
    restore('DATABASE_URL', originalDatabaseUrl)
    global.fetch = originalFetch
  })

  it('is invisible while disabled', async () => {
    process.env.RR_MCP_ENABLED = 'false'
    expect((await POST(request(rpc('tools/list'), { token: accessToken() }))).status).toBe(404)
    expect((await GET_PROTECTED_RESOURCE()).status).toBe(404)
  })

  it('publishes OAuth protected-resource metadata without exposing credentials', async () => {
    const response = await GET_PROTECTED_RESOURCE()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      resource: OPERATOR_MCP_RESOURCE,
      authorization_servers: [ISSUER],
      scopes_supported: [OPERATOR_MCP_REQUIRED_SCOPE],
    })
  })

  it('requires a valid OAuth access token and advertises resource metadata on 401', async () => {
    const missing = await POST(request(rpc('tools/list')))
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toContain('oauth-protected-resource')

    const wrongAudience = await POST(request(
      rpc('tools/list'),
      { token: accessToken({ aud: 'https://attacker.example' }), realIp: '203.0.113.11' },
    ))
    expect(wrongAudience.status).toBe(401)

    const wrongSubject = await POST(request(
      rpc('tools/list'),
      { token: accessToken({ sub: 'auth0|other-user' }), realIp: '203.0.113.12' },
    ))
    expect(wrongSubject.status).toBe(401)

    const good = await POST(request(
      rpc('tools/list'),
      { token: accessToken(), realIp: '203.0.113.13' },
    ))
    expect(good.status).toBe(200)
    expect(await good.text()).not.toContain(accessToken())
  })

  it('rejects missing scope and expired tokens', async () => {
    expect((await POST(request(
      rpc('tools/list'),
      { token: accessToken({ scope: 'openid' }), realIp: '203.0.113.14' },
    ))).status).toBe(401)

    expect((await POST(request(
      rpc('tools/list'),
      { token: accessToken({ exp: NOW_SECONDS - 300 }), realIp: '203.0.113.15' },
    ))).status).toBe(401)
  })

  it('rejects untrusted browser origins while allowing ChatGPT origin', async () => {
    expect((await POST(request(rpc('tools/list'), {
      token: accessToken(),
      origin: 'https://evil.example',
      realIp: '203.0.113.16',
    }))).status).toBe(403)

    expect((await POST(request(rpc('tools/list'), {
      token: accessToken(),
      origin: 'https://chatgpt.com',
      realIp: '203.0.113.17',
    }))).status).toBe(200)
  })

  it('advertises per-tool OAuth security schemes', async () => {
    const list = await POST(request(rpc('tools/list'), {
      token: accessToken(),
      modern: true,
      realIp: '203.0.113.18',
    }))
    expect(list.status).toBe(200)
    const listBody = await list.json()
    for (const tool of listBody.result.tools) {
      expect(tool.securitySchemes).toEqual([
        { type: 'oauth2', scopes: [OPERATOR_MCP_REQUIRED_SCOPE] },
      ])
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      })
    }
  })

  it('supports modern stateless discovery and deterministic read-only tools', async () => {
    const discovery = await POST(request(rpc('server/discover'), {
      token: accessToken(),
      modern: true,
      realIp: '203.0.113.19',
    }))
    expect(discovery.status).toBe(200)
    const discoverBody = await discovery.json()
    expect(discoverBody.result.supportedVersions).toContain(OPERATOR_MCP_PROTOCOL_VERSION)
    expect(discoverBody.result.capabilities).toEqual({ tools: {} })

    const list = await POST(request(rpc('tools/list'), {
      token: accessToken(),
      modern: true,
      realIp: '203.0.113.20',
    }))
    expect(list.status).toBe(200)
    const listBody = await list.json()
    expect(listBody.result.cacheScope).toBe('private')
    expect(listBody.result.ttlMs).toBeGreaterThan(0)
    expect(listBody.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      getOperatorMcpTools().map((tool) => tool.name),
    )
  })

  it('supports the initialize handshake for pre-2026 clients', async () => {
    const response = await POST(request(rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    }), { token: accessToken(), realIp: '203.0.113.21' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.protocolVersion).toBe('2025-11-25')
    expect(body.result.capabilities.tools.listChanged).toBe(false)
  })

  it('requires modern routing headers to agree with the JSON-RPC body', async () => {
    const body = rpc('tools/list')
    const req = request(body, {
      token: accessToken(),
      modern: true,
      realIp: '203.0.113.22',
    })
    const headers = new Headers(req.headers)
    headers.set('mcp-method', 'tools/call')
    const mismatched = new NextRequest(req.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    expect((await POST(mismatched)).status).toBe(400)
  })

  it('runs database diagnostics inside an explicit read-only transaction', async () => {
    const client = mockReadOnlyClient()
    const response = await POST(request(rpc('tools/call', {
      name: 'get_database_state',
      arguments: {},
    }), {
      token: accessToken(),
      modern: true,
      realIp: '203.0.113.23',
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.isError).not.toBe(true)
    expect(body.result.content[0].text).toContain('"transactionMode": "read_only"')

    const sql = client.query.mock.calls.map(([query]) => query).join('\n')
    expect(sql).toContain('BEGIN READ ONLY')
    expect(sql).toContain('SET LOCAL statement_timeout')
    expect(sql).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('rate limits MCP requests', () => {
    resetOperatorMcpSecurityCachesForTests()
    const now = Date.now()
    for (let i = 0; i < OPERATOR_MCP_RATE_LIMIT; i += 1) {
      expect(checkOperatorMcpRateLimit('203.0.113.50', now).allowed).toBe(true)
    }
    const blocked = checkOperatorMcpRateLimit('203.0.113.50', now)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('does not expose arbitrary SQL, shell, mutation or secrets as tools', () => {
    const names = getOperatorMcpTools().map((tool) => tool.name).join(' ')
    expect(names).not.toMatch(/sql|shell|exec|write|delete|update|secret|env/i)
  })

  it('rejects GET transport and advertises POST only', async () => {
    const response = await GET()
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
  })
})

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
