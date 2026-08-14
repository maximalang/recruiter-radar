import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import argon2 from 'argon2'
import pg from 'pg'

const { Pool } = pg
const ADMIN_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
const REDIRECT_URI = 'https://client.example/callback'
const PASSWORD = 'timeweb-test-password-which-is-not-a-production-secret'
const RESOURCE = 'https://recruiter-radar.ru/api/internal/timeweb-mcp'
const ISSUER = 'https://recruiter-radar.ru/operator/oauth'
const SCOPE = 'rr.timeweb.manage'

function decodeJwt(token) {
  const parts = String(token).split('.')
  assert.equal(parts.length, 3)
  return {
    header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
    claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
  }
}
function form(values) { return new URLSearchParams(values).toString() }
function extractCsrf(html) {
  const match = html.match(/name="csrf" value="([^"]+)"/)
  assert.ok(match, 'CSRF field must be rendered')
  return match[1]
}
function makeCookieJar() {
  const values = new Map()
  return {
    absorb(response) {
      const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean)
      for (const value of setCookies) {
        const first = value.split(';', 1)[0]
        const index = first.indexOf('=')
        if (index > 0) values.set(first.slice(0, index), first.slice(index + 1))
      }
    },
    header() { return [...values.entries()].map(([key, value]) => `${key}=${value}`).join('; ') },
  }
}
async function prepareStorage() {
  const pool = new Pool({ connectionString: ADMIN_DATABASE_URL })
  await pool.query('DROP SCHEMA IF EXISTS operator_auth CASCADE')
  await pool.query('CREATE SCHEMA operator_auth')
  await pool.query(`
    CREATE TABLE operator_auth.oidc_store (
      model text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
      expires_at timestamptz, consumed_at timestamptz, grant_id text, user_code text, uid text,
      PRIMARY KEY (model, id)
    );
    CREATE INDEX oidc_store_grant_idx ON operator_auth.oidc_store(model, grant_id) WHERE grant_id IS NOT NULL;
    CREATE INDEX oidc_store_user_code_idx ON operator_auth.oidc_store(model, user_code) WHERE user_code IS NOT NULL;
    CREATE INDEX oidc_store_uid_idx ON operator_auth.oidc_store(model, uid) WHERE uid IS NOT NULL;
    CREATE INDEX oidc_store_expires_idx ON operator_auth.oidc_store(expires_at) WHERE expires_at IS NOT NULL;
    CREATE TABLE operator_auth.login_throttle (
      throttle_key text PRIMARY KEY, failures integer NOT NULL DEFAULT 0,
      locked_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  await pool.end()
}
async function createFixtureFiles() {
  const dir = await mkdtemp(join(tmpdir(), 'rr-timeweb-auth-'))
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const privateJwk = privateKey.export({ format: 'jwk' })
  const jwksFile = join(dir, 'jwks.json')
  const cookieFile = join(dir, 'cookie-keys.json')
  await writeFile(jwksFile, JSON.stringify({ keys: [{ ...privateJwk, kid: 'test-es256-timeweb', alg: 'ES256', use: 'sig' }] }), { mode: 0o600 })
  await writeFile(cookieFile, JSON.stringify([randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')]), { mode: 0o600 })
  return { dir, jwksFile, cookieFile }
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}
async function stop(server) { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
function client(base, jar = makeCookieJar()) {
  return {
    jar,
    async request(path, options = {}) {
      const headers = new Headers(options.headers || {})
      headers.set('host', 'recruiter-radar.ru')
      headers.set('x-forwarded-host', 'recruiter-radar.ru')
      headers.set('x-forwarded-proto', 'https')
      headers.set('x-real-ip', '203.0.113.20')
      if (jar.header()) headers.set('cookie', jar.header())
      const response = await fetch(`${base}${path}`, { ...options, headers, redirect: 'manual' })
      jar.absorb(response)
      return response
    },
  }
}
async function registerPublicClient(httpClient) {
  const response = await httpClient.request('/operator/oauth/reg', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT Timeweb MCP test client', redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'none', response_types: ['code'], grant_types: ['authorization_code', 'refresh_token'] }),
  })
  const body = await response.json()
  assert.equal(response.status, 201, JSON.stringify(body))
  assert.equal(body.token_endpoint_auth_method, 'none')
  assert.equal(body.client_secret, undefined)
  assert.equal(body.rr_mcp_profile, 'timeweb-cloud')
  return body.client_id
}
function authorizationPath(clientId, verifier, overrides = {}) {
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'code', scope: `openid offline_access ${SCOPE}`, resource: RESOURCE, prompt: 'consent', state: 'state-timeweb-123', code_challenge: challenge, code_challenge_method: 'S256', ...overrides })
  return `/operator/oauth/auth?${params}`
}
async function completeAuthorization(httpClient, clientId, verifier) {
  let response = await httpClient.request(authorizationPath(clientId, verifier))
  assert.ok([302, 303].includes(response.status))
  let location = response.headers.get('location'); assert.ok(location?.startsWith('/operator/oauth/interaction/'))
  response = await httpClient.request(location); assert.equal(response.status, 200)
  let csrf = extractCsrf(await response.text())
  response = await httpClient.request(location.replace(/\/$/, '') + '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ csrf, password: PASSWORD }) })
  assert.ok([302, 303].includes(response.status)); location = response.headers.get('location'); assert.ok(location)
  let follow = new URL(location, ISSUER)
  response = await httpClient.request(follow.pathname + follow.search); assert.ok([302, 303].includes(response.status))
  location = response.headers.get('location'); assert.ok(location?.startsWith('/operator/oauth/interaction/'))
  response = await httpClient.request(location); assert.equal(response.status, 200)
  csrf = extractCsrf(await response.text())
  response = await httpClient.request(location.replace(/\/$/, '') + '/confirm', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ csrf }) })
  assert.ok([302, 303].includes(response.status)); location = response.headers.get('location'); assert.ok(location)
  follow = new URL(location, ISSUER)
  response = await httpClient.request(follow.pathname + follow.search); assert.ok([302, 303].includes(response.status))
  const callback = new URL(response.headers.get('location'))
  assert.equal(callback.origin + callback.pathname, REDIRECT_URI)
  assert.equal(callback.searchParams.get('state'), 'state-timeweb-123')
  assert.equal(callback.searchParams.get('iss'), ISSUER)
  const code = callback.searchParams.get('code'); assert.ok(code)
  return code
}
async function exchangeCode(httpClient, clientId, code, verifier, resource = RESOURCE) {
  return httpClient.request('/operator/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: REDIRECT_URI, code_verifier: verifier, resource }),
  })
}
async function refresh(httpClient, clientId, refreshToken) {
  return httpClient.request('/operator/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, resource: RESOURCE }) })
}

test('Timeweb OAuth is DCR + S256 PKCE + exact-resource bound with replay-safe refresh rotation', async () => {
  await prepareStorage()
  const fixture = await createFixtureFiles()
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
  process.env.NODE_ENV = 'test'
  process.env.RR_OPERATOR_AUTH_PROVIDER = 'local_oidc'
  process.env.RR_MCP_OAUTH_ISSUER = ISSUER
  process.env.RR_TIMEWEB_MCP_RESOURCE = RESOURCE
  process.env.RR_MCP_ALLOWED_SUBJECTS = 'rr_owner'
  process.env.RR_MCP_OWNER_PASSWORD_HASH = passwordHash
  process.env.RR_MCP_AUTH_DATABASE_URL = ADMIN_DATABASE_URL
  process.env.RR_MCP_OAUTH_JWKS_FILE = fixture.jwksFile
  process.env.RR_MCP_OAUTH_COOKIE_KEYS_FILE = fixture.cookieFile

  const { createTimewebAuthServer } = await import('../src/timeweb-server.js')
  let runtime = await createTimewebAuthServer()
  let base = await listen(runtime.server)
  let httpClient = client(base)
  try {
    const discovery = await httpClient.request('/operator/oauth/.well-known/openid-configuration')
    assert.equal(discovery.status, 200)
    const metadata = await discovery.json()
    assert.equal(metadata.issuer, ISSUER)
    assert.equal(metadata.authorization_endpoint, `${ISSUER}/auth`)
    assert.equal(metadata.token_endpoint, `${ISSUER}/token`)
    assert.equal(metadata.jwks_uri, `${ISSUER}/jwks`)
    assert.equal(metadata.registration_endpoint, `${ISSUER}/reg`)
    assert.equal(metadata.revocation_endpoint, `${ISSUER}/token/revocation`)
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])
    assert.ok(metadata.scopes_supported.includes(SCOPE))
    assert.ok(!metadata.scopes_supported.includes('rr.operator.read'))

    const jwksResponse = await httpClient.request('/operator/oauth/jwks')
    assert.equal(jwksResponse.status, 200)
    const publicJwks = await jwksResponse.json()
    assert.ok(publicJwks.keys.length > 0)
    assert.ok(publicJwks.keys.every((key) => key.crv === 'P-256' && key.alg === 'ES256' && key.d === undefined))

    const rfc8414 = await httpClient.request('/.well-known/oauth-authorization-server/operator/oauth')
    assert.equal(rfc8414.status, 200)
    assert.equal((await rfc8414.json()).issuer, ISSUER)

    const confidential = await httpClient.request('/operator/oauth/reg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'client_secret_basic' }) })
    assert.equal(confidential.status, 400)
    const wildcard = await httpClient.request('/operator/oauth/reg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://client.example/*'], token_endpoint_auth_method: 'none' }) })
    assert.equal(wildcard.status, 400)
    const insecure = await httpClient.request('/operator/oauth/reg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://client.example/callback'], token_endpoint_auth_method: 'none' }) })
    assert.equal(insecure.status, 400)

    const clientId = await registerPublicClient(httpClient)
    const verifier = randomBytes(48).toString('base64url')
    const missingPkce = await httpClient.request(authorizationPath(clientId, verifier, { code_challenge: '', code_challenge_method: '' }))
    assert.ok(missingPkce.status === 400 || String(missingPkce.headers.get('location')).includes('error='))
    const plainPkce = await httpClient.request(authorizationPath(clientId, verifier, { code_challenge: verifier, code_challenge_method: 'plain' }))
    assert.ok(plainPkce.status === 400 || String(plainPkce.headers.get('location')).includes('error='))
    const wrongResource = await httpClient.request(authorizationPath(clientId, verifier, { resource: 'https://recruiter-radar.ru/api/internal/mcp' }))
    assert.ok(wrongResource.status === 400 || String(wrongResource.headers.get('location')).includes('error='))
    const wrongScope = await httpClient.request(authorizationPath(clientId, verifier, { scope: 'openid offline_access rr.operator.read' }))
    assert.ok([302, 303, 400].includes(wrongScope.status))
    if (wrongScope.status !== 400) {
      const wrongScopeLocation = String(wrongScope.headers.get('location') || '')
      assert.ok(wrongScopeLocation.includes('error=') || wrongScopeLocation.startsWith('/operator/oauth/interaction/'))
      assert.ok(!wrongScopeLocation.includes('code='), 'legacy scope must never receive an authorization code at the authorization endpoint')
    }

    const code = await completeAuthorization(httpClient, clientId, verifier)
    const tokenResponse = await exchangeCode(httpClient, clientId, code, verifier)
    assert.equal(tokenResponse.status, 200)
    const tokens = await tokenResponse.json(); assert.ok(tokens.refresh_token)
    const jwt = decodeJwt(tokens.access_token)
    assert.equal(jwt.header.alg, 'ES256')
    assert.equal(jwt.claims.iss, ISSUER)
    assert.equal(jwt.claims.aud, RESOURCE)
    assert.equal(jwt.claims.sub, 'rr_owner')
    assert.match(jwt.claims.scope, /(?:^| )rr\.timeweb\.manage(?: |$)/)
    assert.doesNotMatch(jwt.claims.scope, /rr\.operator\.read/)

    const firstRefresh = await refresh(httpClient, clientId, tokens.refresh_token)
    assert.equal(firstRefresh.status, 200)
    const rotated = await firstRefresh.json(); assert.ok(rotated.refresh_token); assert.notEqual(rotated.refresh_token, tokens.refresh_token)
    const replay = await refresh(httpClient, clientId, tokens.refresh_token)
    assert.equal(replay.status, 400)
    const familyRevoked = await refresh(httpClient, clientId, rotated.refresh_token)
    assert.equal(familyRevoked.status, 400, 'refresh-token replay must revoke its grant family')
  } finally {
    if (runtime.server.listening) await stop(runtime.server)
    await rm(fixture.dir, { recursive: true, force: true })
  }
})