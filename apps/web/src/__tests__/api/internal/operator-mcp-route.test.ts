/** @jest-environment node */

import { generateKeyPairSync, sign } from 'node:crypto'
import { NextRequest } from 'next/server'

jest.mock('@/lib/db-pool', () => ({
  getClient: jest.fn(),
}))

import { getClient } from '@/lib/db-pool'
import {
  OPERATOR_MCP_LEGACY_PROTOCOL_VERSION,
  OPERATOR_MCP_PROTOCOL_VERSION,
  getOperatorMcpTools,
} from '@/lib/operator-mcp'
import {
  OPERATOR_MCP_PROXY_SCOPE,
  OPERATOR_MCP_RATE_LIMIT,
  OPERATOR_MCP_READ_SCOPE,
  OPERATOR_MCP_RESOURCE,
  OPERATOR_MCP_RESTART_SCOPE,
  checkOperatorMcpRateLimit,
  resetOperatorMcpSecurityCachesForTests,
} from '@/lib/operator-mcp-auth'
import { GET, POST } from '@/app/api/internal/mcp/route'
import { GET as GET_COMPAT_PROTECTED_RESOURCE } from '@/app/.well-known/oauth-protected-resource/route'
import { GET as GET_PATH_PROTECTED_RESOURCE } from '@/app/.well-known/oauth-protected-resource/api/internal/mcp/route'

const mockedGetClient = jest.mocked(getClient)
const ISSUER = 'https://recruiter-radar.authkit.app'
const SUBJECT = 'user_01MCPPRIVATEOWNER000000000001'
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
  options: {
    token?: string
    modern?: boolean
    protocol?: string
    origin?: string
    realIp?: string
  } = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-real-ip': options.realIp ?? '203.0.113.10',
  }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
  if (options.origin !== undefined) headers.origin = options.origin

  const modern = options.modern ?? true
  if (modern) {
    headers['mcp-protocol-version'] = options.protocol ?? OPERATOR_MCP_PROTOCOL_VERSION
    headers['mcp-method'] = String(body.method ?? '')
    if (body.method === 'tools/call') {
      const params = body.params as { name?: string } | undefined
      if (params?.name) headers['mcp-name'] = params.name
    }
  } else if (options.protocol) {
    headers['mcp-protocol-version'] = options.protocol
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
    scope: OPERATOR_MCP_READ_SCOPE,
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
        jwks_uri: `${ISSUER}/oauth2/jwks`,
      })
    }
    if (url === `${ISSUER}/oauth2/jwks`) {
      return Response.json({ keys: [publicJwk] })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

function mockReadOnlyClient() {
  const client = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes("current_setting('server_version')")) {
        return {
          rows: [{
            serverVersion: '16.9',
            inRecovery: false,
            transactionReadOnly: 'on',
            serverTime: '2026-08-12T09:00:00.000Z',
          }],
        }
      }
      if (sql.includes("TO_REGCLASS('public.schema_migrations')")) {
        return { rows: [{ present: true }] }
      }
      if (sql.includes('FROM schema_migrations')) {
        return {
          rows: [{
            migrationCount: '42',
            latestMigration: '20260809140000_add_query_plan_quality_feedback_v2',
            latestAppliedAt: '2026-08-12T08:00:00.000Z',
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

describe('private operator MCP route', () => {
  const originalEnv = {
    enabled: process.env.RR_MCP_ENABLED,
    operatorMode: process.env.RR_OPERATOR_MODE,
    mutations: process.env.RR_MCP_MUTATIONS_ENABLED,
    issuer: process.env.RR_MCP_OAUTH_ISSUER,
    subjects: process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS,
    deploySha: process.env.RR_DEPLOY_SHA,
    databaseUrl: process.env.DATABASE_URL,
  }
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.RR_OPERATOR_MODE = 'true'
    process.env.RR_MCP_ENABLED = 'true'
    process.env.RR_MCP_MUTATIONS_ENABLED = 'false'
    process.env.RR_MCP_OAUTH_ISSUER = ISSUER
    process.env.RR_MCP_OAUTH_ALLOWED_SUBJECTS = SUBJECT
    process.env.RR_DEPLOY_SHA = 'b0a7bad0f4da76e2d3aeb575684349409b124a75'
    process.env.DATABASE_URL = 'postgres://rr_operator_ro:redacted@db:5432/recruiter_radar'
    delete process.env.RR_MCP_TOKEN
    resetOperatorMcpSecurityCachesForTests()
    jest.clearAllMocks()
    mockOAuthDiscovery()
  })

  afterAll(() => {
    restore('RR_MCP_ENABLED', originalEnv.enabled)
    restore('RR_OPERATOR_MODE', originalEnv.operatorMode)
    restore('RR_MCP_MUTATIONS_ENABLED', originalEnv.mutations)
    restore('RR_MCP_OAUTH_ISSUER', originalEnv.issuer)
    restore('RR_MCP_OAUTH_ALLOWED_SUBJECTS', originalEnv.subjects)
    restore('RR_DEPLOY_SHA', originalEnv.deploySha)
    restore('DATABASE_URL', originalEnv.databaseUrl)
    global.fetch = originalFetch
  })

  it('fails dark outside the isolated operator runtime or while disabled', async () => {
    process.env.RR_OPERATOR_MODE = 'false'
    expect((await POST(request(rpc('tools/list'), { token: accessToken() }))).status).toBe(404)
    expect((await GET_PATH_PROTECTED_RESOURCE()).status).toBe(404)

    process.env.RR_OPERATOR_MODE = 'true'
    process.env.RR_MCP_ENABLED = 'false'
    expect((await POST(request(rpc('tools/list'), { token: accessToken() }))).status).toBe(404)
  })

  it('publishes exact RFC 9728 path metadata plus a compatibility root document', async () => {
    for (const response of [
      await GET_PATH_PROTECTED_RESOURCE(),
      await GET_COMPAT_PROTECTED_RESOURCE(),
    ]) {
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        resource: OPERATOR_MCP_RESOURCE,
        authorization_servers: [ISSUER],
        bearer_methods_supported: ['header'],
        scopes_supported: [OPERATOR_MCP_READ_SCOPE],
      })
    }
  })

  it('validates exact issuer, resource audience, immutable subject and expiry', async () => {
    expect((await POST(request(rpc('tools/list'), { token: accessToken() }))).status).toBe(200)
    expect((await POST(request(
      rpc('tools/list'),
      { token: accessToken({ iss: 'https://attacker.authkit.app' }), realIp: '203.0.113.11' },
    ))).status).toBe(401)
    expect((await POST(request(
      rpc('tools/list'),
      { token: accessToken({ aud: 'https://attacker.example/mcp' }), realIp: '203.0.113.12' },
    ))).status).toBe(401)
    expect((await POST(request(
      rpc('tools/list'),
      { token: accessToken({ sub: 'user_other' }), realIp: '203.0.113.13' },
    ))).status).toBe(401)
    expect((await POST(request(
      rpc('tools/list'),
      { token: accessToken({ exp: NOW_SECONDS - 300 }), realIp: '203.0.113.14' },
    ))).status).toBe(401)
  })

  it('uses a path-specific OAuth challenge and 403 for insufficient read scope', async () => {
    const missing = await POST(request(rpc('tools/list')))
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toContain(
      '/.well-known/oauth-protected-resource/api/internal/mcp',
    )

    const insufficient = await POST(request(
      rpc('tools/list'),
      { token: accessToken({ scope: 'openid' }), realIp: '203.0.113.15' },
    ))
    expect(insufficient.status).toBe(403)
    expect(insufficient.headers.get('www-authenticate')).toContain('error="insufficient_scope"')
  })

  it('exposes only bounded read tools by default', async () => {
    const response = await POST(request(rpc('tools/list'), { token: accessToken() }))
    expect(response.status).toBe(200)
    const body = await response.json()
    const names = body.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toEqual([
      'get_production_state',
      'get_system_health',
      'get_service_state',
      'get_recent_logs',
      'get_resource_usage',
      'get_reverse_proxy_state',
      'get_database_state',
      'get_quality_validation_state',
      'list_quality_review_targets',
    ])
    expect(names.join(' ')).not.toMatch(/shell|exec|sql|file|fetch|secret|environment/i)
    const logs = body.result.tools.find((tool: { name: string }) => tool.name === 'get_recent_logs')
    expect(logs.description).toContain('untrusted diagnostic content')
    for (const tool of body.result.tools) {
      expect(tool.securitySchemes).toEqual([
        { type: 'oauth2', scopes: [OPERATOR_MCP_READ_SCOPE] },
      ])
      expect(tool.annotations.readOnlyHint).toBe(true)
    }
  })

  it('keeps mutations hidden by default and requires distinct scopes when enabled', async () => {
    process.env.RR_MCP_MUTATIONS_ENABLED = 'true'
    const list = await POST(request(rpc('tools/list'), {
      token: accessToken({
        scope: `${OPERATOR_MCP_READ_SCOPE} ${OPERATOR_MCP_RESTART_SCOPE} ${OPERATOR_MCP_PROXY_SCOPE}`,
      }),
    }))
    const body = await list.json()
    const restart = body.result.tools.find((tool: { name: string }) => tool.name === 'restart_service')
    const proxy = body.result.tools.find((tool: { name: string }) => tool.name === 'reload_proxy')
    expect(restart.securitySchemes[0].scopes).toEqual([
      OPERATOR_MCP_READ_SCOPE,
      OPERATOR_MCP_RESTART_SCOPE,
    ])
    expect(proxy.securitySchemes[0].scopes).toEqual([
      OPERATOR_MCP_READ_SCOPE,
      OPERATOR_MCP_PROXY_SCOPE,
    ])
    expect(restart.inputSchema.properties.service.enum).toEqual(['web', 'n8n'])
    expect(restart.annotations.readOnlyHint).toBe(false)

    const denied = await POST(request(rpc('tools/call', {
      name: 'restart_service',
      arguments: { service: 'web', idempotencyKey: 'restart:test:0001' },
    }), { token: accessToken(), realIp: '203.0.113.20' }))
    expect(denied.status).toBe(403)
    expect(denied.headers.get('www-authenticate')).toContain(OPERATOR_MCP_RESTART_SCOPE)
  })

  it('rejects untrusted browser origins while allowing ChatGPT origin', async () => {
    expect((await POST(request(rpc('tools/list'), {
      token: accessToken(),
      origin: 'https://evil.example',
    }))).status).toBe(403)
    expect((await POST(request(rpc('tools/list'), {
      token: accessToken(),
      origin: 'https://chatgpt.com',
      realIp: '203.0.113.21',
    }))).status).toBe(200)
  })

  it('supports current stateless discovery and only the bounded 2025-11-25 fallback', async () => {
    const discovery = await POST(request(rpc('server/discover'), { token: accessToken() }))
    expect(discovery.status).toBe(200)
    const discoverBody = await discovery.json()
    expect(discoverBody.result.supportedVersions).toEqual([
      OPERATOR_MCP_PROTOCOL_VERSION,
      OPERATOR_MCP_LEGACY_PROTOCOL_VERSION,
    ])

    const legacy = await POST(request(rpc('initialize', {
      protocolVersion: OPERATOR_MCP_LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    }), { token: accessToken(), modern: false }))
    expect(legacy.status).toBe(200)

    const obsolete = await POST(request(rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'obsolete', version: '1.0.0' },
    }), { token: accessToken(), modern: false, realIp: '203.0.113.22' }))
    expect(obsolete.status).toBe(400)

    const missingHeader = await POST(request(
      rpc('tools/list'),
      { token: accessToken(), modern: false, realIp: '203.0.113.23' },
    ))
    expect(missingHeader.status).toBe(400)
  })

  it('requires current routing headers to match JSON-RPC', async () => {
    const body = rpc('tools/list')
    const req = request(body, { token: accessToken() })
    const headers = new Headers(req.headers)
    headers.set('mcp-method', 'tools/call')
    const mismatched = new NextRequest(req.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    expect((await POST(mismatched)).status).toBe(400)
  })

  it('runs database diagnostics inside explicit read-only transactions and emits sanitized audit', async () => {
    const client = mockReadOnlyClient()
    const audit = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const response = await POST(request(rpc('tools/call', {
      name: 'get_database_state',
      arguments: {},
    }), { token: accessToken(), realIp: '203.0.113.24' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.isError).not.toBe(true)
    expect(body.result.content[0].text).toContain('"transactionMode": "read_only"')
    expect(body.result.content[0].text).toContain('"transactionReadOnly": "on"')

    const sql = client.query.mock.calls.map(([query]) => query).join('\n')
    expect(sql).toContain('BEGIN READ ONLY')
    expect(sql).toContain('SET LOCAL statement_timeout')
    expect(sql).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)

    const auditText = audit.mock.calls.flat().join(' ')
    expect(auditText).toContain('rr_operator_mcp_audit')
    expect(auditText).toContain(SUBJECT)
    expect(auditText).not.toContain('redacted@db')
    expect(auditText).not.toContain(accessToken())
    audit.mockRestore()
  })

  it('rate limits authenticated buckets independently', () => {
    resetOperatorMcpSecurityCachesForTests()
    const now = Date.now()
    for (let index = 0; index < OPERATOR_MCP_RATE_LIMIT; index += 1) {
      expect(checkOperatorMcpRateLimit('sub:owner', now).allowed).toBe(true)
    }
    expect(checkOperatorMcpRateLimit('sub:owner', now).allowed).toBe(false)
    expect(checkOperatorMcpRateLimit('sub:different', now).allowed).toBe(true)
  })

  it('rejects GET transport and advertises stateless POST only', async () => {
    const response = await GET()
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
  })

  it('keeps tool discovery deterministic for the current environment', () => {
    expect(getOperatorMcpTools().map((tool) => tool.name)).toHaveLength(9)
  })
})

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
