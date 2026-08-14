/** @jest-environment node */

import { generateKeyPairSync, sign } from 'node:crypto'

import {
  TIMEWEB_MCP_OAUTH_ISSUER,
  TIMEWEB_MCP_RESOURCE,
  TIMEWEB_MCP_SCOPE,
  getTimewebMcpAuthenticateChallenge,
  getTimewebMcpProtectedResourceMetadata,
  isTimewebMcpConfigured,
  verifyTimewebMcpAccessToken,
} from '@/lib/timeweb-mcp-auth'

const NOW_MS = Date.UTC(2026, 7, 14, 10, 0, 0)
const NOW = Math.floor(NOW_MS / 1000)

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const privateJwk = privateKey.export({ format: 'jwk' })
const publicJwk = publicKey.export({ format: 'jwk' })
const jwk = { ...publicJwk, kid: 'timeweb-test-key', alg: 'ES256', use: 'sig' }

const env = {
  RR_TIMEWEB_MCP_ENABLED: 'true',
  RR_TIMEWEB_MCP_TOKEN: 'server-side-timeweb-token-for-test',
  RR_MCP_OAUTH_ISSUER: TIMEWEB_MCP_OAUTH_ISSUER,
  RR_MCP_OAUTH_ALLOWED_SUBJECTS: 'rr_owner',
}

function token(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'timeweb-test-key' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: TIMEWEB_MCP_OAUTH_ISSUER,
    aud: TIMEWEB_MCP_RESOURCE,
    sub: 'rr_owner',
    scope: TIMEWEB_MCP_SCOPE,
    iat: NOW - 10,
    exp: NOW + 600,
    ...claims,
  })).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url')
  return `${header}.${payload}.${signature}`
}

function discoveryFetch() {
  return jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === `${TIMEWEB_MCP_OAUTH_ISSUER}/.well-known/openid-configuration`) {
      return new Response(JSON.stringify({
        issuer: TIMEWEB_MCP_OAUTH_ISSUER,
        jwks_uri: `${TIMEWEB_MCP_OAUTH_ISSUER}/jwks`,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === `${TIMEWEB_MCP_OAUTH_ISSUER}/jwks`) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch
}

describe('Timeweb MCP OAuth resource boundary', () => {
  it('publishes exact RFC 9728 resource metadata and challenge', () => {
    expect(getTimewebMcpProtectedResourceMetadata()).toEqual({
      resource: TIMEWEB_MCP_RESOURCE,
      authorization_servers: [TIMEWEB_MCP_OAUTH_ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: [TIMEWEB_MCP_SCOPE],
    })
    const challenge = getTimewebMcpAuthenticateChallenge('invalid_token')
    expect(challenge).toContain('resource_metadata="https://recruiter-radar.ru/.well-known/oauth-protected-resource/api/internal/timeweb-mcp"')
    expect(challenge).toContain(`scope="${TIMEWEB_MCP_SCOPE}"`)
  })

  it('is fail-closed unless the server-side token and exact OAuth config exist', () => {
    expect(isTimewebMcpConfigured(env)).toBe(true)
    expect(isTimewebMcpConfigured({ ...env, RR_TIMEWEB_MCP_TOKEN: '' })).toBe(false)
    expect(isTimewebMcpConfigured({ ...env, RR_TIMEWEB_MCP_ENABLED: 'false' })).toBe(false)
    expect(isTimewebMcpConfigured({ ...env, RR_MCP_OAUTH_ALLOWED_SUBJECTS: 'someone_else' })).toBe(false)
  })

  it('accepts only a valid ES256 token with exact audience, scope and owner subject', async () => {
    const valid = await verifyTimewebMcpAccessToken(`Bearer ${token({})}`, env, discoveryFetch(), NOW_MS)
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(valid.scopes.has(TIMEWEB_MCP_SCOPE)).toBe(true)

    const wrongAudience = await verifyTimewebMcpAccessToken(
      `Bearer ${token({ aud: 'https://recruiter-radar.ru/api/internal/mcp' })}`,
      env,
      discoveryFetch(),
      NOW_MS,
    )
    expect(wrongAudience).toEqual({ ok: false, reason: 'audience_mismatch' })

    const multipleAudience = await verifyTimewebMcpAccessToken(
      `Bearer ${token({ aud: [TIMEWEB_MCP_RESOURCE, 'https://example.com'] })}`,
      env,
      discoveryFetch(),
      NOW_MS,
    )
    expect(multipleAudience).toEqual({ ok: false, reason: 'audience_mismatch' })

    const wrongScope = await verifyTimewebMcpAccessToken(
      `Bearer ${token({ scope: 'rr.operator.read' })}`,
      env,
      discoveryFetch(),
      NOW_MS,
    )
    expect(wrongScope).toEqual({ ok: false, reason: 'insufficient_scope' })

    const wrongSubject = await verifyTimewebMcpAccessToken(
      `Bearer ${token({ sub: 'other_user' })}`,
      env,
      discoveryFetch(),
      NOW_MS,
    )
    expect(wrongSubject).toEqual({ ok: false, reason: 'subject_not_allowed' })
  })

  it('rejects private JWK material from discovery and never depends on the Timeweb API token', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify({ issuer: TIMEWEB_MCP_OAUTH_ISSUER, jwks_uri: `${TIMEWEB_MCP_OAUTH_ISSUER}/jwks` }), { status: 200 })
      }
      return new Response(JSON.stringify({ keys: [{ ...jwk, d: privateJwk.d }] }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await verifyTimewebMcpAccessToken(`Bearer ${token({})}`, env, fetchImpl, NOW_MS)
    expect(result).toEqual({ ok: false, reason: 'signing_key_not_found' })
    expect(JSON.stringify(getTimewebMcpProtectedResourceMetadata())).not.toContain(env.RR_TIMEWEB_MCP_TOKEN)
  })
})
