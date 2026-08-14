/** @jest-environment node */

import { NextRequest } from 'next/server'

import { DELETE, GET, OPTIONS, POST } from '@/app/api/internal/mcp/route'
import { GET as GET_PATH_PROTECTED_RESOURCE } from '@/app/.well-known/oauth-protected-resource/api/internal/mcp/route'

const MCP_URL = 'https://recruiter-radar.ru/api/internal/mcp'

function request(method = 'POST') {
  return new NextRequest(MCP_URL, {
    method,
    headers: {
      authorization: 'Bearer legacy-token-must-not-reactivate-the-route',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
      'x-real-ip': '203.0.113.10',
    },
    body: method === 'POST'
      ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      : undefined,
  })
}

describe('retired Recruiter Radar operator MCP public boundary', () => {
  const originalEnv = {
    enabled: process.env.RR_MCP_ENABLED,
    operatorMode: process.env.RR_OPERATOR_MODE,
    mutations: process.env.RR_MCP_MUTATIONS_ENABLED,
  }

  afterAll(() => {
    restore('RR_MCP_ENABLED', originalEnv.enabled)
    restore('RR_OPERATOR_MODE', originalEnv.operatorMode)
    restore('RR_MCP_MUTATIONS_ENABLED', originalEnv.mutations)
  })

  it('returns 404 for every legacy MCP transport method even when stale enabling env is present', async () => {
    process.env.RR_OPERATOR_MODE = 'true'
    process.env.RR_MCP_ENABLED = 'true'
    process.env.RR_MCP_MUTATIONS_ENABLED = 'true'

    const responses = [
      await GET(request('GET')),
      await POST(request('POST')),
      await DELETE(request('DELETE')),
      await OPTIONS(request('OPTIONS')),
    ]

    for (const response of responses) {
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: 'not_found' })
    }
  })

  it('does not publish protected-resource metadata for the retired legacy resource', async () => {
    process.env.RR_MCP_ENABLED = 'true'
    const response = await GET_PATH_PROTECTED_RESOURCE()
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'not_found' })
  })
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
