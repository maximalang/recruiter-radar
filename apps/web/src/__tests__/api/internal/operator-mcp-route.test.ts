/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/db-pool', () => ({
  getClient: jest.fn(),
}))

import { getClient } from '@/lib/db-pool'
import {
  OPERATOR_MCP_PROTOCOL_VERSION,
  getOperatorMcpTools,
} from '@/lib/operator-mcp'
import { GET, POST } from '@/app/api/internal/mcp/route'

const mockedGetClient = jest.mocked(getClient)
const TOKEN = 'test-operator-mcp-token-'.padEnd(48, 'x')

function request(
  body: Record<string, unknown>,
  options: { token?: string; modern?: boolean; origin?: string } = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
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

function mockReadOnlyClient() {
  const client = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes("current_setting('server_version')")) {
        return { rows: [{ serverVersion: '16.9', inRecovery: false, serverTime: '2026-08-10T16:00:00.000Z' }] }
      }
      if (sql.includes("TO_REGCLASS('public.schema_migrations')")) {
        return {
          rows: [{
            migrationTablePresent: true,
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
  const originalToken = process.env.RR_MCP_TOKEN
  const originalDeploySha = process.env.RR_DEPLOY_SHA
  const originalDatabaseUrl = process.env.DATABASE_URL

  beforeEach(() => {
    process.env.RR_MCP_ENABLED = 'true'
    process.env.RR_MCP_TOKEN = TOKEN
    process.env.RR_DEPLOY_SHA = '9c343597a1e49175220d4c95134d4a03fb8bcd0d'
    process.env.DATABASE_URL = 'postgres://redacted.example.invalid/database'
    jest.clearAllMocks()
  })

  afterAll(() => {
    restore('RR_MCP_ENABLED', originalEnabled)
    restore('RR_MCP_TOKEN', originalToken)
    restore('RR_DEPLOY_SHA', originalDeploySha)
    restore('DATABASE_URL', originalDatabaseUrl)
  })

  it('is invisible while disabled', async () => {
    process.env.RR_MCP_ENABLED = 'false'
    expect((await POST(request(rpc('tools/list'), { token: TOKEN }))).status).toBe(404)
  })

  it('requires a strong bearer token and never returns it', async () => {
    const missing = await POST(request(rpc('tools/list')))
    expect(missing.status).toBe(401)

    const wrong = await POST(request(rpc('tools/list'), { token: `${TOKEN}wrong` }))
    expect(wrong.status).toBe(401)

    const good = await POST(request(rpc('tools/list'), { token: TOKEN }))
    expect(good.status).toBe(200)
    expect(await good.text()).not.toContain(TOKEN)
  })

  it('rejects untrusted browser origins while allowing ChatGPT origin', async () => {
    expect((await POST(request(rpc('tools/list'), {
      token: TOKEN,
      origin: 'https://evil.example',
    }))).status).toBe(403)

    expect((await POST(request(rpc('tools/list'), {
      token: TOKEN,
      origin: 'https://chatgpt.com',
    }))).status).toBe(200)
  })

  it('supports modern stateless discovery and deterministic read-only tools', async () => {
    const discovery = await POST(request(rpc('server/discover'), {
      token: TOKEN,
      modern: true,
    }))
    expect(discovery.status).toBe(200)
    const discoverBody = await discovery.json()
    expect(discoverBody.result.supportedVersions).toContain(OPERATOR_MCP_PROTOCOL_VERSION)
    expect(discoverBody.result.capabilities).toEqual({ tools: {} })

    const list = await POST(request(rpc('tools/list'), {
      token: TOKEN,
      modern: true,
    }))
    expect(list.status).toBe(200)
    const listBody = await list.json()
    expect(listBody.result.cacheScope).toBe('private')
    expect(listBody.result.ttlMs).toBeGreaterThan(0)
    expect(listBody.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      getOperatorMcpTools().map((tool) => tool.name),
    )
    for (const tool of listBody.result.tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      })
    }
  })

  it('supports the initialize handshake for pre-2026 clients', async () => {
    const response = await POST(request(rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    }), { token: TOKEN }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.protocolVersion).toBe('2025-11-25')
    expect(body.result.capabilities.tools.listChanged).toBe(false)
  })

  it('requires modern routing headers to agree with the JSON-RPC body', async () => {
    const body = rpc('tools/list')
    const req = request(body, { token: TOKEN, modern: true })
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
    }), { token: TOKEN, modern: true }))
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
